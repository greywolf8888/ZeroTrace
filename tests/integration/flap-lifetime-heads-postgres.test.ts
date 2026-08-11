import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { createDataQualityAlert } from '@zerotrace/data-quality';
import { createEvidence } from '@zerotrace/evidence';
import {
  FlapLifetimeExtensionSchema,
  FlapLifetimeMaterializationSchema,
  FlapLifetimeRollbackSchema,
  type FlapLifetimeState,
  type JsonValue,
} from '@zerotrace/schemas';
import {
  PostgresEvidenceRepository,
  PostgresDataQualityRepository,
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
  let dataQuality: PostgresDataQualityRepository;
  let checkpoints: PostgresSemanticScanCheckpointRepository;
  let heads: PostgresFlapLifetimeHeadRepository;

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    dataQuality = new PostgresDataQualityRepository({
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

  afterAll(async () =>
    Promise.all([evidence.close(), dataQuality.close(), checkpoints.close(), heads.close()]),
  );

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

    const rollbackAlert = createDataQualityAlert({
      kind: 'REORG_DETECTED',
      severity: 'CRITICAL',
      ledger: 'EVM',
      chainId: 'eip155:56',
      position: String(second.targetBlock),
      summary: 'Integration accepted lifetime suffix conflicts with finalized BSC history.',
      details: {
        token,
        invalidatedFromHeadId: second.id,
        rollbackToHeadId: first.id,
      },
      evidenceIds: [initialTerminal.id, extensionRaw.id, extensionTerminal.id],
      observedAt: '2026-08-10T00:02:00.000Z',
      modelVersion: 'flap-lifetime-rollback-v1',
    });
    await dataQuality.putAlert(rollbackAlert);
    const rollbackSnapshot = {
      ...baseExtension.metadata.snapshot,
      blockNumber: '107',
      blockHash: `0x${'7'.repeat(64)}`,
      parentBlockHash: `0x${'6'.repeat(64)}`,
      capturedAt: '2026-08-10T00:02:00.000Z',
    };
    const rollbackTerminal = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:flap-lifetime-rollback-v1',
      locator: `flap-lifetime-rollback:${token}:105-107`,
      payload: {
        token,
        invalidatedFromHeadId: second.id,
        rollbackToHeadId: first.id,
      },
      observedAt: rollbackSnapshot.capturedAt,
      blockOrSlot: rollbackSnapshot.blockNumber,
      finality: 'finalized',
      summary: 'Integration accepted lifetime rollback root.',
      sourceEvidenceIds: [initialTerminal.id, extensionRaw.id, extensionTerminal.id],
    });
    await evidence.put(
      rollbackTerminal,
      [initialTerminal.id, extensionRaw.id, extensionTerminal.id],
      rollbackSnapshot,
    );
    const headReference = (head: typeof first) => ({
      headId: head.id,
      scanId: head.scanId,
      targetBlock: String(head.targetBlock),
      targetHash: head.targetHash,
      terminalEvidenceId: head.terminalEvidenceId,
    });
    const rollback = FlapLifetimeRollbackSchema.parse({
      chainId: 'eip155:56',
      token,
      reason: 'FINALIZED_REORG',
      invalidatedHeads: [headReference(second)],
      rollbackTo: headReference(first),
      observedTarget: {
        blockNumber: rollbackSnapshot.blockNumber,
        blockHash: rollbackSnapshot.blockHash,
      },
      lineageCoverage: 1,
      alertId: rollbackAlert.id,
      terminalEvidenceId: rollbackTerminal.id,
      metadata: {
        snapshot: rollbackSnapshot,
        dataCoverage: 1,
        sourceCoverage: 1,
        historyCoverage: 1,
        simulationCoverage: 0,
        freshness: rollbackSnapshot.capturedAt,
        sourceSet: ['bsc-rpc-a@integration', 'bsc-rpc-b@integration'],
        modelVersion: 'flap-lifetime-rollback-v1',
        confidence: 1,
        evidenceIds: canonical([
          initialTerminal.id,
          extensionRaw.id,
          extensionTerminal.id,
          rollbackTerminal.id,
        ]),
      },
      evidence: [rollbackTerminal],
    });
    const invalidation = await heads.putInvalidation({ result: rollback });
    expect(invalidation).toMatchObject({
      eventSequence: 0,
      invalidatedFromHeadId: second.id,
      invalidatedThroughHeadId: second.id,
      rollbackToHeadId: first.id,
    });
    await expect(heads.putInvalidation({ result: rollback })).resolves.toEqual(invalidation);
    await expect(heads.latestHead('eip155:56', token)).resolves.toEqual(first);
    await expect(heads.listActiveLineage('eip155:56', token)).resolves.toEqual([first]);
    await expect(heads.latestInvalidation('eip155:56', token)).resolves.toEqual(invalidation);
    await expect(
      heads.putHead({ scanId: extensionScan.id, result: extension }),
    ).rejects.toMatchObject({ code: 'FLAP_LIFETIME_HEAD_CONFLICT' });

    const replayCheck = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'BLOCK',
      source: 'bsc-rpc@lifetime-replay',
      locator: `lifetime-replay-predecessor:${token}:103`,
      payload: { token, block: '103', hash: first.targetHash },
      observedAt: rollbackSnapshot.capturedAt,
      blockOrSlot: '103',
      finality: 'finalized',
      summary: 'Integration replay predecessor check.',
    });
    const replayContinuity = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace-data-quality',
      locator: `flap-lifetime-continuity:${token}:103-107`,
      payload: { token, predecessor: '103', target: '107' },
      observedAt: rollbackSnapshot.capturedAt,
      blockOrSlot: '107',
      finality: 'finalized',
      summary: 'Integration replay continuity root.',
      sourceEvidenceIds: [initialTerminal.id, replayCheck.id],
    });
    const replayHistory = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:flap-history-projection-v1',
      locator: `flap-lifetime-replay-history:${token}:104-107`,
      payload: { token, fromBlock: '104', toBlock: '107' },
      observedAt: rollbackSnapshot.capturedAt,
      blockOrSlot: '107',
      finality: 'finalized',
      summary: 'Integration replay delta history root.',
      sourceEvidenceIds: [replayCheck.id],
    });
    const replayTerminal = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:flap-lifetime-extension-v1',
      locator: `flap-lifetime-replay:${token}:103-107`,
      payload: { token, lifetimeCoverage: true, replayedAfter: invalidation.id },
      observedAt: rollbackSnapshot.capturedAt,
      blockOrSlot: '107',
      finality: 'finalized',
      summary: 'Integration replayed lifetime root.',
      sourceEvidenceIds: [
        initialTerminal.id,
        replayContinuity.id,
        replayHistory.id,
        rollbackTerminal.id,
      ],
    });
    await evidence.put(replayCheck, [], initial.metadata.snapshot ?? undefined);
    await evidence.put(replayContinuity, [initialTerminal.id, replayCheck.id], rollbackSnapshot);
    await evidence.put(replayHistory, [replayCheck.id], rollbackSnapshot);
    await evidence.put(
      replayTerminal,
      [initialTerminal.id, replayContinuity.id, replayHistory.id, rollbackTerminal.id],
      rollbackSnapshot,
    );
    const replay = FlapLifetimeExtensionSchema.parse({
      ...baseExtension,
      token,
      targetBlock: '107',
      predecessor: {
        scanId: initialScan.id,
        targetBlock: String(first.targetBlock),
        targetHash: first.targetHash,
        terminalEvidenceId: first.terminalEvidenceId,
      },
      continuity: {
        status: 'HISTORICAL_MATCH',
        continuous: { state: 'known', value: true },
        evidenceIds: [initialTerminal.id, replayCheck.id, replayContinuity.id],
        terminalEvidenceId: replayContinuity.id,
      },
      historyProjection: {
        ...baseExtension.historyProjection,
        scanId: '66666666-6666-4666-8666-666666666666',
        fromBlock: '104',
        toBlock: '107',
        terminalEvidenceId: replayHistory.id,
      },
      terminalEvidenceId: replayTerminal.id,
      metadata: {
        ...baseExtension.metadata,
        snapshot: rollbackSnapshot,
        freshness: rollbackSnapshot.capturedAt,
        sourceSet: [
          'bsc-rpc-a@integration',
          'bsc-rpc-b@integration',
          'sqd:binance-mainnet',
          'zerotrace-data-quality',
        ],
        evidenceIds: canonical([
          first.terminalEvidenceId,
          replayCheck.id,
          replayContinuity.id,
          replayHistory.id,
          replayTerminal.id,
          rollbackTerminal.id,
        ]),
      },
      evidence: [replayTerminal],
    });
    const replayScan = await completedScan(
      'FLAP_LIFETIME_EXTENSION',
      'zerotrace:flap-lifetime-extension-v1',
      token,
      104,
      107,
      replay,
    );
    const replayedHead = await heads.putHead({ scanId: replayScan.id, result: replay });
    expect(replayedHead).toMatchObject({
      sequence: 2,
      predecessorId: first.id,
      targetBlock: 107,
      targetHash: rollbackSnapshot.blockHash,
    });
    await expect(heads.latestHead('eip155:56', token)).resolves.toEqual(replayedHead);
    await expect(heads.listActiveLineage('eip155:56', token)).resolves.toEqual([
      replayedHead,
      first,
    ]);

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE flap_lifetime_heads SET result = result WHERE id = $1', [second.id]),
      ).rejects.toThrow(/append-only|immutable/);
      await expect(
        pool.query('DELETE FROM flap_lifetime_heads WHERE id = $1', [second.id]),
      ).rejects.toThrow(/append-only|immutable/);
      await expect(
        pool.query('UPDATE flap_lifetime_head_invalidations SET result = result WHERE id = $1', [
          invalidation.id,
        ]),
      ).rejects.toThrow(/append-only|immutable/);
      await expect(
        pool.query('DELETE FROM flap_lifetime_head_invalidations WHERE id = $1', [invalidation.id]),
      ).rejects.toThrow(/append-only|immutable/);
    } finally {
      await pool.end();
    }
  });
});
