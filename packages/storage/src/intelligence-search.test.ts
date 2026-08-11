import { describe, expect, it, vi } from 'vitest';

import { PostgresIntelligenceSearchRepository } from './intelligence-search.js';

const terminalEvidenceId = `ev_${'a'.repeat(24)}`;

function searchRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    document_key: 'ecs_111111111111111111111111:CONTROL_SUBJECT',
    ledger: 'EVM',
    chain_id: 'eip155:56',
    subject_type: 'CONTRACT',
    normalized_identifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
    record_type: 'EVM_CONTROL_SURFACE',
    record_id: 'ecs_111111111111111111111111',
    role: 'CONTROL_SUBJECT',
    snapshot_position: '100',
    snapshot_hash: `0x${'b'.repeat(64)}`,
    terminal_evidence_id: terminalEvidenceId,
    source_set: ['rpc:bsc'],
    model_version: 'evm-control-surface-v0.1.0',
    confidence: '0.8',
    captured_at: new Date('2026-08-12T00:00:00.000Z'),
    matched_by: 'IDENTIFIER',
    evidence_ledger: 'EVM',
    evidence_chain_id: 'eip155:56',
    evidence_kind: 'DERIVED_FEATURE',
    evidence_source: 'zerotrace:test',
    evidence_locator: 'control-surface:test',
    evidence_source_uri: null,
    evidence_payload_hash: 'c'.repeat(64),
    evidence_observed_at: new Date('2026-08-12T00:00:00.000Z'),
    evidence_block_or_slot: '100',
    evidence_finality: 'finalized',
    evidence_summary: 'Evidence-bound durable intelligence search fixture.',
    evidence_raw_artifact_ref: null,
    subject_count: 0,
    labels_json: [],
    entities_json: [],
    ...overrides,
  };
}

describe('PostgreSQL durable intelligence search repository', () => {
  it('rejects invalid query bounds before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresIntelligenceSearchRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.search({ query: '' })).rejects.toMatchObject({
      code: 'INTELLIGENCE_SEARCH_INVALID',
    });
    await expect(repository.search({ query: 'subject', limit: 101 })).rejects.toMatchObject({
      code: 'INTELLIGENCE_SEARCH_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('maps an immutable report into an Evidence-bound projection without inventing labels', async () => {
    const query = vi.fn(async () => ({ rows: [searchRow()], rowCount: 1 }));
    const repository = PostgresIntelligenceSearchRepository.fromPool({
      query,
      end: vi.fn(),
    });

    const projection = await repository.search({
      query: '0xDCFB441A1F38802820A4E7B4CC8AAB37833C7777',
      ledger: 'EVM',
      chainId: 'eip155:56',
      limit: 1,
    });

    expect(projection).toMatchObject({
      coverageScope: 'IMMUTABLE_REPORTS_AND_REGISTERED_LABELS_V1',
      matchCount: 1,
      truncated: false,
      terminalEvidenceIds: [terminalEvidenceId],
      matches: [
        {
          recordType: 'EVM_CONTROL_SURFACE',
          subjectType: { state: 'known', value: 'CONTRACT' },
          labels: { state: 'unknown', reason: 'NOT_QUERIED' },
          entities: { state: 'unknown', reason: 'NOT_QUERIED' },
          terminalEvidence: { id: terminalEvidenceId, ledger: 'EVM', chainId: 'eip155:56' },
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('matched_documents'), [
      '0xDCFB441A1F38802820A4E7B4CC8AAB37833C7777',
      'EVM',
      'eip155:56',
      2,
    ]);
  });

  it('fails closed when stored provenance conflicts with terminal Evidence', async () => {
    const repository = PostgresIntelligenceSearchRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [searchRow({ evidence_chain_id: 'eip155:1' })],
        rowCount: 1,
      })),
      end: vi.fn(),
    });

    await expect(repository.search({ query: 'subject' })).rejects.toMatchObject({
      code: 'INTELLIGENCE_SEARCH_CONFLICT',
    });
  });

  it('distinguishes an initialized projection from missing migration state', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            view_name: 'durable_intelligence_search_documents_v1',
            migration_applied: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ view_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresIntelligenceSearchRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'INTELLIGENCE_SEARCH_NOT_INITIALIZED',
    });
  });
});
