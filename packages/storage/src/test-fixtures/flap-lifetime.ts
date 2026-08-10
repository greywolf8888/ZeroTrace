import { createEvidence } from '@zerotrace/evidence';
import {
  FlapLifetimeExtensionSchema,
  FlapLifetimeMaterializationSchema,
  knownValue,
  type FlapLifetimeExtension,
  type FlapLifetimeMaterialization,
} from '@zerotrace/schemas';

export const flapLifetimeFixtureToken = `0x${'a'.repeat(40)}`;
export const flapLifetimeInitialScanId = '11111111-1111-4111-8111-111111111111';
export const flapLifetimeExtensionScanId = '22222222-2222-4222-8222-222222222222';
const originScanId = '33333333-3333-4333-8333-333333333333';
const historyScanId = '44444444-4444-4444-8444-444444444444';
const deltaScanId = '55555555-5555-4555-8555-555555555555';

export function flapLifetimeSnapshot(block: number) {
  return {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: String(block),
    blockHash: `0x${block.toString(16).padStart(64, '0')}`,
    parentBlockHash: `0x${(block - 1).toString(16).padStart(64, '0')}`,
    finality: 'finalized' as const,
    capturedAt: `2026-08-10T00:${block === 103 ? '00' : '01'}:00.000Z`,
    providerVersions: { 'bsc-rpc@test.example': 'evm-v1', 'sqd:binance-mainnet': 'sqd-v1' },
    adapterVersions: { evm: 'evm-v1' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
}

function terminal(block: number, source: string, locator: string, sourceEvidenceIds: string[]) {
  return createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source,
    locator,
    payload: { block },
    observedAt: flapLifetimeSnapshot(block).capturedAt,
    blockOrSlot: String(block),
    finality: 'finalized',
    summary: 'Durable lifetime head fixture.',
    sourceEvidenceIds,
  });
}

function origin(evidenceIds: string[]) {
  return knownValue({
    contractCreator: `0x${'b'.repeat(40)}`,
    launchCreator: `0x${'c'.repeat(40)}`,
    bytecodeFingerprint: 'd'.repeat(64),
    creationTrace: {
      transactionHash: `0x${'e'.repeat(64)}`,
      blockNumber: '100',
      blockHash: `0x${'f'.repeat(64)}`,
      transactionIndex: '0',
      traceAddress: [0],
    },
    tokenCreatedPosition: {
      transactionHash: `0x${'e'.repeat(64)}`,
      blockNumber: '100',
      blockHash: `0x${'f'.repeat(64)}`,
      transactionIndex: '0',
      logIndex: '1',
    },
    evidenceIds,
  });
}

export function flapLifetimeInitialResult(): FlapLifetimeMaterialization {
  const sourceId = `ev_${'0'.repeat(24)}`;
  const historyTerminalId = `ev_${'1'.repeat(24)}`;
  const resultTerminal = terminal(
    103,
    'zerotrace:flap-lifetime-materialization-v1',
    `flap-lifetime-materialization:${flapLifetimeFixtureToken}:100-103`,
    [sourceId, historyTerminalId],
  );
  const evidenceIds = [sourceId, historyTerminalId, resultTerminal.id].sort();
  return FlapLifetimeMaterializationSchema.parse({
    platform: 'flap',
    token: flapLifetimeFixtureToken,
    dataset: 'binance-mainnet',
    datasetStartBlock: '0',
    targetBlock: '103',
    originScanId,
    originSearchCoverage: 1,
    origin: origin([sourceId, historyTerminalId]),
    historyProjection: {
      scanId: historyScanId,
      fromBlock: '100',
      toBlock: '103',
      segmentCount: 2,
      transactionCount: 1,
      unrecognizedPortalLogCount: 0,
      requestedRangeCoverage: 1,
      terminalEvidenceId: historyTerminalId,
    },
    lifetimeCoverage: knownValue(true),
    terminalEvidenceId: resultTerminal.id,
    metadata: {
      snapshot: flapLifetimeSnapshot(103),
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: flapLifetimeSnapshot(103).capturedAt,
      sourceSet: ['bsc-rpc@test.example', 'sqd:binance-mainnet'],
      modelVersion: 'flap-lifetime-materialization-v1',
      confidence: 0.98,
      evidenceIds,
    },
    evidence: [resultTerminal],
  });
}

export function flapLifetimeExtensionResult(
  previous: FlapLifetimeMaterialization,
): FlapLifetimeExtension {
  const continuitySource = `ev_${'2'.repeat(24)}`;
  const continuityTerminal = terminal(105, 'zerotrace-data-quality', 'anchor-continuity:103:105', [
    continuitySource,
  ]);
  const historyTerminalId = `ev_${'3'.repeat(24)}`;
  const resultTerminal = terminal(
    105,
    'zerotrace:flap-lifetime-extension-v1',
    `flap-lifetime-extension:${flapLifetimeFixtureToken}:103-105`,
    [previous.terminalEvidenceId, continuityTerminal.id, historyTerminalId],
  );
  const evidenceIds = [
    previous.terminalEvidenceId,
    continuitySource,
    continuityTerminal.id,
    historyTerminalId,
    resultTerminal.id,
  ].sort();
  return FlapLifetimeExtensionSchema.parse({
    platform: 'flap',
    token: flapLifetimeFixtureToken,
    dataset: 'binance-mainnet',
    datasetStartBlock: '0',
    targetBlock: '105',
    predecessor: {
      scanId: flapLifetimeInitialScanId,
      targetBlock: previous.targetBlock,
      targetHash: flapLifetimeSnapshot(103).blockHash,
      terminalEvidenceId: previous.terminalEvidenceId,
    },
    originScanId,
    origin: previous.origin,
    continuity: {
      status: 'HISTORICAL_MATCH',
      continuous: knownValue(true),
      evidenceIds: [continuitySource, continuityTerminal.id],
      terminalEvidenceId: continuityTerminal.id,
    },
    historyProjection: {
      scanId: deltaScanId,
      fromBlock: '104',
      toBlock: '105',
      segmentCount: 1,
      transactionCount: 0,
      unrecognizedPortalLogCount: 0,
      requestedRangeCoverage: 1,
      terminalEvidenceId: historyTerminalId,
    },
    lifetimeCoverage: knownValue(true),
    terminalEvidenceId: resultTerminal.id,
    metadata: {
      snapshot: flapLifetimeSnapshot(105),
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: flapLifetimeSnapshot(105).capturedAt,
      sourceSet: ['bsc-rpc@test.example', 'sqd:binance-mainnet', 'zerotrace-data-quality'],
      modelVersion: 'flap-lifetime-extension-v1',
      confidence: 0.97,
      evidenceIds,
    },
    evidence: [resultTerminal],
  });
}
