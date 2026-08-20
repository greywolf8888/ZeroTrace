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

  it('fails closed when Snapshot position or Subject Registry count is corrupt', async () => {
    const repository = PostgresIntelligenceSearchRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [searchRow({ snapshot_position: '999', evidence_block_or_slot: '100' })],
        rowCount: 1,
      })),
      end: vi.fn(),
    });
    await expect(repository.search({ query: 'subject' })).rejects.toMatchObject({
      code: 'INTELLIGENCE_SEARCH_CONFLICT',
    });

    const invalidCount = PostgresIntelligenceSearchRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [searchRow({ subject_count: -1 })],
        rowCount: 1,
      })),
      end: vi.fn(),
    });
    await expect(invalidCount.search({ query: 'subject' })).rejects.toMatchObject({
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
            label_view_name: 'label_intelligence_search_documents_v1',
            search_migration_applied: true,
            label_migration_applied: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            view_name: null,
            label_view_name: null,
            search_migration_applied: false,
            label_migration_applied: false,
          },
        ],
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

  it('projects registered labels and Entity memberships, including Unknown confidence', async () => {
    const query = vi.fn(async () => ({
      rows: [
        searchRow({
          subject_count: 1,
          matched_by: 'LABEL',
          labels_json: [
            {
              id: '10000000-0000-4000-8000-000000000002',
              label: 'Example Exchange',
              category: 'CEX',
              source: 'official-registry',
              sourceClass: 'CURATED',
              actorCandidate: 'Example Exchange',
              sourceConfidence: 0.9,
              evidenceId: terminalEvidenceId,
              observedAt: '2026-08-12T00:00:00.000Z',
              deterministic: false,
              licensePolicy: 'official registry attribution only',
            },
            {
              id: '10000000-0000-4000-8000-000000000003',
              label: 'Unknown Actor',
              category: 'identity',
              source: 'manual',
              sourceClass: 'CURATED',
              actorCandidate: null,
              sourceConfidence: '0.4',
              evidenceId: terminalEvidenceId,
              observedAt: new Date('2026-08-11T00:00:00.000Z'),
              deterministic: false,
              licensePolicy: 'manual observation',
            },
          ],
          entities_json: [
            {
              entityId: '10000000-0000-4000-8000-000000000099',
              classification: 'CLUSTER',
              confidenceState: 'KNOWN',
              confidence: 0.7,
              membershipClass: 'MEMBER',
              probabilityState: 'UNKNOWN',
              probability: null,
              evidenceIds: [terminalEvidenceId],
              modelVersion: 'entity-v0.1.0',
            },
            {
              entityId: '10000000-0000-4000-8000-000000000098',
              classification: 'CLUSTER',
              confidenceState: 'UNAVAILABLE',
              confidence: null,
              membershipClass: 'MEMBER',
              probabilityState: 'KNOWN',
              probability: 0.2,
              evidenceIds: [`ev_${'b'.repeat(24)}`],
              modelVersion: 'entity-v0.1.0',
            },
          ],
        }),
      ],
      rowCount: 1,
    }));
    const repository = PostgresIntelligenceSearchRepository.fromPool({
      query,
      end: vi.fn(),
    });
    const projection = await repository.search({ query: 'Example Exchange', limit: 1 });
    expect(projection.matches[0]).toMatchObject({
      matchedBy: 'LABEL',
      labels: { state: 'known' },
      entities: { state: 'known' },
    });
    expect(projection.matches[0]?.labels.state).toBe('known');
    if (projection.matches[0]?.labels.state === 'known') {
      expect(projection.matches[0].labels.value[0]?.actorCandidate).toEqual({
        state: 'known',
        value: 'Example Exchange',
      });
      expect(projection.matches[0].labels.value[1]?.actorCandidate).toMatchObject({
        state: 'unknown',
      });
    }
  });

  it('returns an empty projection, Bitcoin exact-match, truncated pages, and unavailable storage honestly', async () => {
    const empty = PostgresIntelligenceSearchRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.search({ query: 'missing-subject' })).resolves.toMatchObject({
      matchCount: 0,
      truncated: false,
      matches: [],
    });

    const bitcoin = PostgresIntelligenceSearchRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [
          searchRow({
            ledger: 'BITCOIN',
            chain_id: 'bitcoin-mainnet',
            subject_type: 'UNKNOWN',
            normalized_identifier: 'bc1qexample',
            evidence_ledger: 'BITCOIN',
            evidence_chain_id: 'bitcoin-mainnet',
            snapshot_position: null,
            snapshot_hash: null,
            confidence: null,
            evidence_block_or_slot: null,
            evidence_finality: null,
          }),
          searchRow({
            ledger: 'BITCOIN',
            chain_id: 'bitcoin-mainnet',
            subject_type: 'UNKNOWN',
            normalized_identifier: 'bc1qexample-2',
            record_id: 'ecs_222222222222222222222222',
            document_key: 'ecs_222222222222222222222222:CONTROL_SUBJECT',
            evidence_ledger: 'BITCOIN',
            evidence_chain_id: 'bitcoin-mainnet',
            snapshot_position: null,
            snapshot_hash: null,
            confidence: null,
            evidence_block_or_slot: null,
            evidence_finality: null,
            terminal_evidence_id: `ev_${'c'.repeat(24)}`,
          }),
        ],
        rowCount: 2,
      })),
      end: vi.fn(),
    });
    await expect(
      bitcoin.search({
        query: 'bc1qexample',
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      truncated: true,
      matchCount: 1,
      matches: [{ subjectType: { state: 'unknown' } }],
    });

    const down = PostgresIntelligenceSearchRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.search({ query: 'subject' })).rejects.toMatchObject({
      code: 'INTELLIGENCE_SEARCH_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'INTELLIGENCE_SEARCH_UNAVAILABLE',
    });
  });
});
