import { describe, expect, it, vi } from 'vitest';

import { createEvidence } from '@zerotrace/evidence';
import {
  FlapPancakeV2PensionEntryResultSchema,
  unknownValue,
  type FlapPancakeV2PensionEntryResult,
} from '@zerotrace/schemas';

import { PostgresFlapPensionEntryReportRepository } from './flap-pension-entry-reports.js';

const tokenAddress = `0x${'a'.repeat(40)}`;
const pensionWallet = `0x${'d'.repeat(40)}`;
const capturedAt = '1970-01-01T00:01:40.000Z';

describe('Postgres Flap pension entry Scenario Report repository', () => {
  it('rejects invalid reports and lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as FlapPancakeV2PensionEntryResult)).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    await expect(repository.latest('invalid')).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the report table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ table_name: 'flap_pension_entry_reports', migration_applied: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'FLAP_PENSION_ENTRY_REPORT_NOT_INITIALIZED',
    });
  });

  it('keeps missing reports undefined and maps unavailable storage honestly', async () => {
    const empty = PostgresFlapPensionEntryReportRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.get(`per_${'a'.repeat(24)}`)).resolves.toBeUndefined();
    await expect(empty.latest(tokenAddress)).resolves.toBeUndefined();

    const down = PostgresFlapPensionEntryReportRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.put(storedPensionEntryReport())).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
    });
    await expect(down.get(`per_${'a'.repeat(24)}`)).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
    });
    await expect(down.latest(tokenAddress)).rejects.toMatchObject({
      code: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
    });
  });
});

function storedPensionEntryReport() {
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '16',
    blockHash: `0x${'b'.repeat(64)}`,
    parentBlockHash: `0x${'c'.repeat(64)}`,
    blockTimestamp: capturedAt,
    finality: 'finalized' as const,
    capturedAt,
    providerVersions: { fixture: '1' },
    adapterVersions: { evm: '1' },
    configHash: '5'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
  const candidate = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:evm-pension-candidate-discovery-v1.0.0',
    locator: `pension-behavior-candidate:${tokenAddress}:${pensionWallet}:1-15`,
    payload: { wallet: pensionWallet },
    observedAt: capturedAt,
    blockOrSlot: '15',
    finality: 'finalized',
    summary: 'Fixture pension behavior candidate.',
  });
  const behaviorTerminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:evm-pension-candidate-discovery-v1.0.0',
    locator: `pension-behavior-discovery:${tokenAddress}:1-15`,
    payload: { candidateCount: 1 },
    observedAt: capturedAt,
    blockOrSlot: '15',
    finality: 'finalized',
    summary: 'Fixture pension behavior discovery completed.',
    sourceEvidenceIds: [candidate.id],
  });
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:flap-pension-entry-economics-v0.1.0',
    locator: `rv:flap-pension-entry:${tokenAddress}:${pensionWallet}:@16`,
    payload: { destinationTreatment: 'NON_ZERO_CUSTODY_ADDRESS' },
    observedAt: capturedAt,
    blockOrSlot: snapshot.blockNumber,
    finality: snapshot.finality,
    summary: 'Pension-entry economics with unknown market remain Unknown, not zero.',
    sourceEvidenceIds: [candidate.id, behaviorTerminal.id],
  });
  const evidence = [candidate, behaviorTerminal, terminal].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return FlapPancakeV2PensionEntryResultSchema.parse({
    platform: 'flap',
    token: tokenAddress,
    behavior: {
      reportId: `pcr_${'1'.repeat(24)}`,
      resultHash: '1'.repeat(64),
      wallet: pensionWallet,
      shareUnit: { atomic: '1000000000000000000', decimal: '1' },
      fromBlock: '1',
      toBlock: '15',
      snapshotHash: `0x${'d'.repeat(64)}`,
      observedWholeShares: '5',
      candidateEvidenceId: candidate.id,
      reportTerminalEvidenceId: behaviorTerminal.id,
      roleAttribution: unknownValue('INSUFFICIENT_DATA'),
      participantExitPolicy: unknownValue('INSUFFICIENT_DATA'),
      dividendExecution: unknownValue('INSUFFICIENT_DATA'),
    },
    market: unknownValue(
      'PROVIDER_UNCONFIGURED',
      'This storage fixture does not quote Pancake V2; absence is Unknown, not a zero cost.',
    ),
    entries: [],
    validation: {
      status: 'NOT_RUN',
      deterministicToleranceBps: '0',
      evaluatedScenarioCount: 0,
      failedScenarioCount: 0,
    },
    destinationTreatment: 'NON_ZERO_CUSTODY_ADDRESS',
    totalSupplyReduction: unknownValue(
      'NOT_QUERIED',
      'A transfer to this non-zero custody address is not itself an ERC-20 supply burn.',
    ),
    custodyIrreversible: unknownValue(
      'INSUFFICIENT_DATA',
      'Observed deposit behavior does not prove that the wallet cannot transfer tokens.',
    ),
    terminalEvidenceId: terminal.id,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 0.5,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: capturedAt,
      sourceSet: ['bsc-history-fixture'],
      modelVersion: 'flap-pension-entry-economics-v0.1.0',
      confidence: 0.5,
      evidenceIds: evidence.map((item) => item.id),
    },
    evidence,
  });
}

function reportRow(values: readonly unknown[]) {
  return {
    id: values[0],
    chain_id: values[1],
    token_address: values[2],
    pension_report_id: values[3],
    pension_wallet: values[4],
    block_number: values[5],
    snapshot_hash: values[6],
    result_hash: values[7],
    report: values[8],
    terminal_evidence_id: values[9],
    evidence_ids: values[10],
    source_set: values[11],
    model_version: values[12],
    captured_at: values[13],
    created_at: values[13],
  };
}

describe('Postgres Flap pension entry report writes', () => {
  it('writes, replays, and lists the latest report without inventing missing rows', async () => {
    const report = storedPensionEntryReport();
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO flap_pension_entry_reports')) {
        row ??= reportRow(values);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM flap_pension_entry_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresFlapPensionEntryReportRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    const first = await repository.put(report);
    await expect(repository.put(report)).resolves.toMatchObject({ id: first.id });
    await expect(repository.get(first.id)).resolves.toMatchObject({ id: first.id });
    await expect(repository.latest(tokenAddress)).resolves.toMatchObject({ id: first.id });
    expect(first.report.destinationTreatment).toBe('NON_ZERO_CUSTODY_ADDRESS');
    expect(first.report.market.state).toBe('unknown');
    await repository.close();
  });
});
