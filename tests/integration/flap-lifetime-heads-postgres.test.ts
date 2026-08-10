import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { createEvidence } from '@zerotrace/evidence';
import {
  FlapLifetimeExtensionSchema,
  FlapLifetimeMaterializationSchema,
  type FlapLifetimeState,
  type JsonValue,
} from '@zerotrace/schemas';
import {
  PostgresEvidenceRepository,
  PostgresFlapLifetimeHeadRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import {
  flapLifetimeExtensionResult,
  flapLifetimeInitialResult,
} from '../../packages/storage/src/test-fixtures/flap-lifetime.js';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

postgresDescribe('PostgreSQL Flap lifetime head integration', () => {
  let evidence: PostgresEvidenceRepository;
  let checkpoints: PostgresSemanticScanCheckpointRepository;
  let heads: PostgresFlapLifetimeHeadRepository;

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    checkpoints = new PostgresSemanticScanCheckpointRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    heads = new PostgresFlapLifetimeHeadRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => Promise.all([evidence.close(), checkpoints.close(), heads.close()]));

  async function completedScan(
    scanType: 'FLAP_LIFETIME_MATERIALIZATION' | 'FLAP_LIFETIME_EXTENSION',
    source: string,
    token: string,
    fromBlock: number,
    toBlock: number,
    result: FlapLifetimeState,
  ) {
    const run = await checkpoints.begin({
      scanType,
      source,
      ledger: 'EVM',
      chainId: 'eip155:56',
      subject: token,
      fromBlock,
      toBlock,
      chunkSize: toBlock - fromBlock + 1,
      identity: { integrationNonce: randomBytes(12).toString('hex') },
      initialState: { result: null },
    });
    const state = { result } as JsonValue;
    const advanced = await checkpoints.advance(run.id, {
      expectedNextBlock: fromBlock,
      completedToBlock: toBlock,
      state,
      evidenceIds: [result.terminalEvidenceId],
    });
    return checkpoints.finish(advanced.id, {
      state,
      evidenceIds: [result.terminalEvidenceId],
    });
  }

  it('stores and replays an append-only initial-to-extension chain', async () => {
    await expect(heads.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    const token = `0x${randomBytes(20).toString('hex')}`;
    const baseInitial = flapLifetimeInitialResult();
    const initialRaw = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'PROVIDER_OBSERVATION',
      source: 'bsc-rpc@lifetime-integration',
      locator: `lifetime-initial:${token}:103`,
      payload: { token, block: '103' },
      observedAt: baseInitial.metadata.freshness,
      blockOrSlot: '103',
      finality: 'finalized',
      summary: 'Integration initial lifetime source.',
    });
    const initialTerminal = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:flap-lifetime-materialization-v1',
      locator: `flap-lifetime-materialization:${token}:100-103`,
      payload: { token, lifetimeCoverage: true },
      observedAt: baseInitial.metadata.freshness,
      blockOrSlot: '103',
      finality: 'finalized',
      summary: 'Integration initial lifetime root.',
      sourceEvidenceIds: [initialRaw.id],
    });
    const initial = FlapLifetimeMaterializationSchema.parse({
      ...baseInitial,
      token,
      terminalEvidenceId: initialTerminal.id,
      metadata: {
        ...baseInitial.metadata,
        evidenceIds: canonical([
          ...baseInitial.metadata.evidenceIds,
          initialRaw.id,
          initialTerminal.id,
        ]),
      },
      evidence: [initialTerminal],
    });
    await evidence.put(initialRaw, [], initial.metadata.snapshot ?? undefined);
    await evidence.put(initialTerminal, [initialRaw.id], initial.metadata.snapshot ?? undefined);
    const initialScan = await completedScan(
      'FLAP_LIFETIME_MATERIALIZATION',
      'zerotrace:flap-lifetime-materialization-v1',
      token,
      0,
      103,
      initial,
    );
    const first = await heads.putHead({ scanId: initialScan.id, result: initial });
    expect(first).toMatchObject({ sequence: 0, headType: 'INITIAL', targetBlock: 103 });

    const extensionRaw = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'BLOCK',
      source: 'bsc-rpc@lifetime-integration',
      locator: `lifetime-extension:${token}:105`,
      payload: { token, block: '105' },
      observedAt: '2026-08-10T00:01:00.000Z',
      blockOrSlot: '105',
      finality: 'finalized',
      summary: 'Integration extension lifetime source.',
    });
    const extensionTerminal = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:flap-lifetime-extension-v1',
      locator: `flap-lifetime-extension:${token}:103-105`,
      payload: { token, lifetimeCoverage: true },
      observedAt: extensionRaw.observedAt,
      blockOrSlot: '105',
      finality: 'finalized',
      summary: 'Integration extension lifetime root.',
      sourceEvidenceIds: [initialTerminal.id, extensionRaw.id],
    });
    const baseExtension = flapLifetimeExtensionResult(initial);
    const extension = FlapLifetimeExtensionSchema.parse({
      ...baseExtension,
      token,
      predecessor: {
        ...baseExtension.predecessor,
        scanId: initialScan.id,
        terminalEvidenceId: initialTerminal.id,
      },
      terminalEvidenceId: extensionTerminal.id,
      metadata: {
        ...baseExtension.metadata,
        evidenceIds: canonical([
          ...baseExtension.metadata.evidenceIds,
          initialTerminal.id,
          extensionRaw.id,
          extensionTerminal.id,
        ]),
      },
      evidence: [extensionTerminal],
    });
    await evidence.put(extensionRaw, [], extension.metadata.snapshot ?? undefined);
    await evidence.put(
      extensionTerminal,
      [initialTerminal.id, extensionRaw.id],
      extension.metadata.snapshot ?? undefined,
    );
    const extensionScan = await completedScan(
      'FLAP_LIFETIME_EXTENSION',
      'zerotrace:flap-lifetime-extension-v1',
      token,
      104,
      105,
      extension,
    );
    const second = await heads.putHead({ scanId: extensionScan.id, result: extension });
    expect(second).toMatchObject({
      sequence: 1,
      headType: 'EXTENSION',
      predecessorId: first.id,
      targetBlock: 105,
    });
    await expect(heads.putHead({ scanId: extensionScan.id, result: extension })).resolves.toEqual(
      second,
    );
    await expect(heads.latestHead('eip155:56', token)).resolves.toEqual(second);

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE flap_lifetime_heads SET result = result WHERE id = $1', [second.id]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM flap_lifetime_heads WHERE id = $1', [second.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});
