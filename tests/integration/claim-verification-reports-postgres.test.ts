import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  auditClaims,
  buildClaimVerificationObservation,
  parseEvmClaimDeclaration,
  reviewClaimDeclarationDraft,
} from '@zerotrace/claim-audit';
import type { EvmLogQuery, EvmLogRecord } from '@zerotrace/chain-adapters';
import {
  observeEvmClaimAddress,
  type EvmClaimEvidenceWriter,
  type EvmClaimReadAdapter,
} from '@zerotrace/platform-adapters';
import { unknownValue, type AnalysisMetadata } from '@zerotrace/schemas';
import {
  PostgresClaimDeclarationReportRepository,
  PostgresClaimReportRepository,
  PostgresClaimRuleReviewReportRepository,
  PostgresClaimVerificationReportRepository,
  PostgresEvidenceRepository,
} from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;

function indexed(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

postgresDescribe('PostgreSQL terminal Claim verification integration', () => {
  let evidence: PostgresEvidenceRepository;
  let declarations: PostgresClaimDeclarationReportRepository;
  let reviews: PostgresClaimRuleReviewReportRepository;
  let addressReports: PostgresClaimReportRepository;
  let verifications: PostgresClaimVerificationReportRepository;

  beforeAll(() => {
    const options = { connectionString: connectionString as string, maxConnections: 2 };
    evidence = PostgresEvidenceRepository.fromConnectionString(options);
    declarations = new PostgresClaimDeclarationReportRepository(options);
    reviews = new PostgresClaimRuleReviewReportRepository(options);
    addressReports = new PostgresClaimReportRepository(options);
    verifications = new PostgresClaimVerificationReportRepository(options);
  });

  afterAll(async () => {
    await Promise.all([
      evidence.close(),
      declarations.close(),
      reviews.close(),
      addressReports.close(),
      verifications.close(),
    ]);
  });

  it('persists exact reviewed-rule, address-range, audit and terminal Evidence closure', async () => {
    const nonce = randomUUID().replaceAll('-', '');
    const token = `0x${nonce.padEnd(40, 'a').slice(0, 40)}`;
    const source = `0x${'1'.repeat(40)}`;
    const destination = `0x${'2'.repeat(40)}`;
    const member = `0x${'3'.repeat(40)}`;
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '100',
      blockHash: `0x${nonce.padEnd(64, 'b').slice(0, 64)}`,
      parentBlockHash: `0x${nonce.padEnd(64, 'c').slice(0, 64)}`,
      finality: 'finalized' as const,
      blockTimestamp: '2026-08-12T00:00:00.000Z',
      capturedAt: '2026-08-12T00:00:01.000Z',
      providerVersions: { [`rpc:integration:${nonce}`]: 'json-rpc' },
      adapterVersions: { claimEvm: 'claim-evm-transfer-v1.0.0' },
      configHash: nonce.padEnd(64, 'd').slice(0, 64),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-v1',
    };
    const declaration = parseEvmClaimDeclaration({
      text: `Tax receiver (100%)\n${source}\nCommunity fund (20%)\n${destination}\nReference ${nonce}`,
      chainId: snapshot.chainId,
      assetId: `${snapshot.chainId}:erc20:${token}`,
      source: `integration:claim-source:${nonce}`,
      observedAt: snapshot.blockTimestamp,
      auditWindow: { from: '2026-08-01T00:00:00.000Z', to: snapshot.blockTimestamp },
    });
    const draft = declaration.drafts.find((item) => item.role === 'COMMUNITY_FUND');
    if (draft === undefined) throw new Error('Community-fund draft is missing.');
    const review = reviewClaimDeclarationDraft({
      declarationReport: declaration,
      draftId: draft.id,
      reviewerLabel: `integration analyst ${nonce}`,
      reviewSource: `integration:claim-review:${nonce}`,
      reviewedAt: snapshot.capturedAt,
      rule: {
        sourceAddress: source,
        destinationAddress: destination,
        role: 'COMMUNITY_FUND',
        expectedAction: 'DISTRIBUTE',
        expectedShareBps: '2000',
        window: { from: '2026-08-01T00:00:00.000Z', to: snapshot.blockTimestamp },
      },
    });
    await evidence.put(declaration.evidence);
    await evidence.put(declaration.terminalEvidence, [declaration.evidence.id]);
    await declarations.put(declaration);
    await evidence.put(review.evidence.find((item) => item.id === review.reviewEvidenceId)!);
    await evidence.put(
      review.evidence.find((item) => item.id === review.terminalEvidenceId)!,
      [declaration.terminalEvidenceId, review.reviewEvidenceId],
    );
    await reviews.put(review);

    const txOne = `0x${nonce.padEnd(64, '4').slice(0, 64)}`;
    const txTwo = `0x${nonce.padEnd(64, '5').slice(0, 64)}`;
    const logs: EvmLogRecord[] = [
      {
        address: token,
        blockHash: `0x${nonce.padEnd(64, '6').slice(0, 64)}`,
        blockNumber: '0x5a',
        blockTimestamp: '2026-08-10T00:00:00.000Z',
        transactionHash: txOne,
        transactionIndex: '0x1',
        logIndex: '0x1',
        data: `0x${5_000n.toString(16).padStart(64, '0')}`,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          indexed(member),
          indexed(source),
        ],
        removed: false,
        raw: { provider: 'integration' },
      },
      {
        address: token,
        blockHash: `0x${nonce.padEnd(64, '7').slice(0, 64)}`,
        blockNumber: '0x5b',
        blockTimestamp: '2026-08-11T00:00:00.000Z',
        transactionHash: txTwo,
        transactionIndex: '0x1',
        logIndex: '0x2',
        data: `0x${1_000n.toString(16).padStart(64, '0')}`,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          indexed(source),
          indexed(destination),
        ],
        removed: false,
        raw: { provider: 'integration' },
      },
    ];
    const custodyAdapter: EvmClaimReadAdapter = {
      sourceId: `rpc:integration:${nonce}`,
      config: { chainId: 56 },
      getCodeObservation: vi.fn().mockResolvedValue({
        value: '0x',
        endpointId: `rpc:integration:${nonce}`,
      }),
      callObservation: vi.fn(),
      readSourced: vi.fn(),
    };
    const logReader = {
      getLogsObservation: vi.fn().mockImplementation(async (query: EvmLogQuery) => ({
        value: logs.filter((log) =>
          query.topics?.every(
            (topic, index) => topic === null || topic === undefined || log.topics[index] === topic,
          ),
        ),
        endpointId: `sqd:integration:${nonce}`,
      })),
    };
    const writeEvidence: EvmClaimEvidenceWriter = async (item, parents = [], boundSnapshot) =>
      (await evidence.put(item, parents, boundSnapshot)).evidence;
    const observe = (address: string) =>
      observeEvmClaimAddress({
        tokenAddress: token,
        address,
        fromBlock: '80',
        toBlock: '100',
        window: review.rule.window,
        snapshot,
        custodyAdapter,
        logReader,
        writeEvidence,
        now: () => snapshot.capturedAt,
      });
    const sourceRun = await observe(source);
    const destinationRun = await observe(destination);
    const sourceStored = await addressReports.put(sourceRun.report);
    const destinationStored = await addressReports.put(destinationRun.report);
    const transfers = [...sourceRun.transfers, ...destinationRun.transfers].filter(
      (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index,
    );
    const auditMetadata: AnalysisMetadata = {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: snapshot.capturedAt,
      sourceSet: [custodyAdapter.sourceId, `sqd:integration:${nonce}`].sort(),
      modelVersion: 'claim-verification-audit-input-v1',
      confidence: 0.5,
      evidenceIds: [
        ...new Set([
          ...review.evidenceIds,
          ...sourceRun.report.metadata.evidenceIds,
          ...destinationRun.report.metadata.evidenceIds,
        ]),
      ].sort(),
    };
    const audit = auditClaims({
      baseAmount: unknownValue(
        'INSUFFICIENT_DATA',
        'Source inflow is a lower bound, not a complete tax denominator.',
      ),
      claims: [review.rule],
      transfers,
      actions: [],
      custody: [
        {
          address: destinationRun.report.custody.address,
          kind: destinationRun.report.custody.kind,
          canMoveFunds: { state: 'known', value: true },
          evidenceIds: destinationRun.report.custody.evidenceIds,
        },
      ],
      metadata: auditMetadata,
    });
    const built = buildClaimVerificationObservation({
      reviewReport: review,
      sourceObservationReportId: sourceStored.id,
      sourceObservation: sourceRun.report,
      destinationObservationReportId: destinationStored.id,
      destinationObservation: destinationRun.report,
      actions: [],
      audit,
    });
    await evidence.put(built.terminalEvidence, built.parentEvidenceIds, snapshot);

    await expect(verifications.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    const stored = await verifications.put(built.report);
    expect(stored.report).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      observedBaseAmountLowerBound: '5000',
      baseAmount: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      coverage: { actionSemantics: { state: 'unknown', reason: 'NOT_QUERIED' } },
      audit: { items: [{ observedReceivedAmount: '1000' }] },
    });
    await verifications.close();
    verifications = new PostgresClaimVerificationReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(verifications.get(stored.id)).resolves.toEqual(stored);
    await expect(verifications.latestByRule(review.rule.id)).resolves.toEqual(stored);

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE claim_verification_reports SET report = report WHERE id = $1', [
          stored.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM claim_verification_reports WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});
