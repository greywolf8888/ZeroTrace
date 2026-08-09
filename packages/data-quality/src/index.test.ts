import { describe, expect, it, vi } from 'vitest';

import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import type { AnalysisSnapshot, ChainAnchor, ChainAnchorRead, Evidence } from '@zerotrace/schemas';

import {
  AnchorDataQualityService,
  MemoryDataQualityRepository,
  type ChainAnchorReader,
  type DataQualityEvidenceWriter,
} from './index.js';

const observedAt = '2026-08-10T01:00:00.000Z';

function evmHash(character: string): string {
  return `0x${character.repeat(64)}`;
}

function evmRead(input: {
  source: string;
  position: string;
  hash: string;
  parentPosition?: string;
  parentHash?: string;
  observedAt?: string;
}): ChainAnchorRead {
  const numericPosition = BigInt(input.position);
  const defaultParent =
    numericPosition === 0n
      ? {}
      : {
          parentPosition: (numericPosition - 1n).toString(),
          parentHash: evmHash('0'),
        };
  const parent =
    input.parentPosition === undefined && input.parentHash === undefined
      ? defaultParent
      : { parentPosition: input.parentPosition, parentHash: input.parentHash };
  const anchor: ChainAnchor = {
    ledger: 'EVM',
    chainId: 'eip155:56',
    position: input.position,
    hash: input.hash,
    finality: 'finalized',
    source: input.source,
    observedAt: input.observedAt ?? observedAt,
    ...(parent.parentPosition === undefined ? {} : { parentPosition: parent.parentPosition }),
    ...(parent.parentHash === undefined ? {} : { parentHash: parent.parentHash }),
  };
  const snapshot: AnalysisSnapshot = {
    ledger: 'EVM',
    chainId: 'eip155:56',
    blockNumber: input.position,
    blockHash: input.hash,
    ...(parent.parentHash === undefined ? {} : { parentBlockHash: parent.parentHash }),
    finality: 'finalized',
    capturedAt: input.observedAt ?? observedAt,
    providerVersions: { [input.source]: 'json-rpc' },
    adapterVersions: { evm: 'test' },
    configHash: hashPayload({ source: input.source, position: input.position }),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  return {
    anchor,
    snapshot,
    payload: {
      number: input.position,
      hash: input.hash,
      parentHash: parent.parentHash ?? null,
    },
  };
}

class MutableReader implements ChainAnchorReader {
  readonly sourceId: string;
  readonly ledger = 'EVM' as const;
  readonly chainId = 'eip155:56';
  head: ChainAnchorRead | Error;
  readonly at = new Map<string, ChainAnchorRead | Error>();
  headCalls = 0;
  atCalls: string[] = [];

  constructor(sourceId: string, head: ChainAnchorRead | Error) {
    this.sourceId = sourceId;
    this.head = head;
  }

  async readHead(): Promise<ChainAnchorRead> {
    this.headCalls += 1;
    if (this.head instanceof Error) throw this.head;
    return this.head;
  }

  async readAt(position: string): Promise<ChainAnchorRead> {
    this.atCalls.push(position);
    const value = this.at.get(position);
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`No fixture for ${position}.`);
    return value;
  }
}

function evidenceWriter(ledger: EvidenceLedger): DataQualityEvidenceWriter {
  return {
    put: async (evidence: Evidence, sourceEvidenceIds = [], snapshot) => {
      const existing = ledger.get(evidence.id);
      if (existing !== undefined) return existing;
      return ledger.add(evidence, sourceEvidenceIds, snapshot);
    },
  };
}

function service(
  readers: readonly ChainAnchorReader[],
  repository = new MemoryDataQualityRepository(),
  ledger = new EvidenceLedger(),
) {
  return {
    repository,
    ledger,
    value: new AnchorDataQualityService({
      targets: [{ ledger: 'EVM', chainId: 'eip155:56', readers }],
      repository,
      evidence: evidenceWriter(ledger),
      nowImplementation: () => new Date('2026-08-10T01:00:05.000Z'),
    }),
  };
}

describe('anchor reconciliation', () => {
  it('compares providers at a common historical position and preserves unknown independence', async () => {
    const sourceA = new MutableReader(
      'bsc-a',
      evmRead({
        source: 'bsc-a',
        position: '101',
        hash: evmHash('c'),
        parentPosition: '100',
        parentHash: evmHash('b'),
      }),
    );
    sourceA.at.set(
      '100',
      evmRead({
        source: 'bsc-a',
        position: '100',
        hash: evmHash('b'),
        parentPosition: '99',
        parentHash: evmHash('a'),
      }),
    );
    const sourceB = new MutableReader(
      'bsc-b',
      evmRead({
        source: 'bsc-b',
        position: '100',
        hash: evmHash('b'),
        parentPosition: '99',
        parentHash: evmHash('a'),
      }),
    );
    const runtime = service([sourceA, sourceB]);

    const [result] = await runtime.value.inspectAll();

    expect(result).toMatchObject({
      status: 'AGREEMENT',
      configuredSources: 2,
      observedSources: 2,
      comparisonPosition: { state: 'known', value: '100' },
      canonicalAnchor: { state: 'known', value: { position: '100', hash: evmHash('b') } },
      sourceIndependence: { state: 'unknown', reason: 'NOT_QUERIED' },
      metadata: { sourceCoverage: 1, confidence: 1 },
    });
    expect(result?.metadata.snapshot).not.toBeNull();
    expect(result?.snapshotSet).toHaveLength(2);
    expect(result?.alerts).toEqual([]);
    expect(sourceA.atCalls).toEqual(['100']);
    expect(runtime.repository.anchors()).toHaveLength(3);
    expect(result?.metadata.evidenceIds).toHaveLength(4);
  });

  it('returns an explicit conflict and creates an Evidence-linked Data Quality Alert', async () => {
    const sourceA = new MutableReader(
      'bsc-a',
      evmRead({ source: 'bsc-a', position: '100', hash: evmHash('a') }),
    );
    const sourceB = new MutableReader(
      'bsc-b',
      evmRead({ source: 'bsc-b', position: '100', hash: evmHash('b') }),
    );
    const runtime = service([sourceA, sourceB]);

    const [result] = await runtime.value.inspectAll();

    expect(result).toMatchObject({
      status: 'DISAGREEMENT',
      canonicalAnchor: { state: 'unknown', reason: 'CONFLICTING_SOURCES' },
      metadata: { snapshot: null, confidence: 1 },
    });
    expect(result?.alerts).toHaveLength(1);
    expect(result?.alerts[0]).toMatchObject({
      kind: 'CROSS_SOURCE_DISAGREEMENT',
      severity: 'CRITICAL',
      position: '100',
    });
    expect(result?.alerts[0]?.evidenceIds.length).toBe(3);
    expect(runtime.repository.alerts()).toEqual(result?.alerts);
    const derivedId = result?.metadata.evidenceIds.find(
      (id) => runtime.ledger.get(id)?.evidence.kind === 'DERIVED_FEATURE',
    );
    expect(derivedId).toBeDefined();
    expect(runtime.ledger.drilldown(derivedId!)).toHaveLength(3);
  });

  it('does not turn a failed second source into agreement or a zero-like value', async () => {
    const sourceA = new MutableReader(
      'bsc-a',
      evmRead({ source: 'bsc-a', position: '100', hash: evmHash('a') }),
    );
    const failure = Object.assign(new Error('quota exceeded'), { code: 'RATE_LIMITED' });
    const sourceB = new MutableReader('bsc-b', failure);
    const runtime = service([sourceA, sourceB]);

    const [result] = await runtime.value.inspectAll();

    expect(result).toMatchObject({
      status: 'INSUFFICIENT_SOURCES',
      observedSources: 1,
      canonicalAnchor: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      metadata: { sourceCoverage: 0.5, confidence: 0 },
    });
    expect(result?.sources.find((item) => item.source === 'bsc-b')?.head).toEqual({
      state: 'unavailable',
      reason: 'RATE_LIMITED',
      detail: 'quota exceeded',
    });
  });

  it('marks a same-position hash replacement as a reorg and links prior/current Evidence', async () => {
    const source = new MutableReader(
      'bsc-a',
      evmRead({ source: 'bsc-a', position: '100', hash: evmHash('a') }),
    );
    const repository = new MemoryDataQualityRepository();
    const ledger = new EvidenceLedger();
    const runtime = service([source], repository, ledger);
    await runtime.value.inspectAll();
    source.head = evmRead({
      source: 'bsc-a',
      position: '100',
      hash: evmHash('b'),
      observedAt: '2026-08-10T01:01:00.000Z',
    });

    const [result] = await runtime.value.inspectAll();
    const continuity = result?.sources[0]?.continuity;

    expect(continuity).toMatchObject({
      status: 'REORG_DETECTED',
      continuous: { state: 'known', value: false },
    });
    expect(continuity?.evidenceIds).toHaveLength(3);
    expect(result?.alerts).toContainEqual(
      expect.objectContaining({ kind: 'REORG_DETECTED', severity: 'CRITICAL' }),
    );
  });

  it('rechecks the prior height across a gap before declaring historical continuity', async () => {
    const source = new MutableReader(
      'bsc-a',
      evmRead({ source: 'bsc-a', position: '100', hash: evmHash('a') }),
    );
    const runtime = service([source]);
    await runtime.value.inspectAll();
    source.head = evmRead({
      source: 'bsc-a',
      position: '105',
      hash: evmHash('f'),
      parentPosition: '104',
      parentHash: evmHash('e'),
      observedAt: '2026-08-10T01:01:00.000Z',
    });
    source.at.set(
      '100',
      evmRead({
        source: 'bsc-a',
        position: '100',
        hash: evmHash('a'),
        observedAt: '2026-08-10T01:01:01.000Z',
      }),
    );

    const [result] = await runtime.value.inspectAll();

    expect(result?.sources[0]?.continuity).toMatchObject({
      status: 'HISTORICAL_MATCH',
      continuous: { state: 'known', value: true },
    });
    expect(source.atCalls).toEqual(['100']);
    expect(runtime.repository.anchors().some((item) => item.role === 'CONTINUITY_CHECK')).toBe(
      true,
    );
  });

  it('deduplicates overlapping inspection calls', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = new MutableReader(
      'bsc-a',
      evmRead({ source: 'bsc-a', position: '100', hash: evmHash('a') }),
    );
    const original = reader.readHead.bind(reader);
    vi.spyOn(reader, 'readHead').mockImplementation(async () => {
      await pending;
      return original();
    });
    const runtime = service([reader]);

    const first = runtime.value.inspectAll();
    const second = runtime.value.inspectAll();
    expect(second).toBe(first);
    release?.();
    await first;
    expect(reader.headCalls).toBe(1);
  });
});
