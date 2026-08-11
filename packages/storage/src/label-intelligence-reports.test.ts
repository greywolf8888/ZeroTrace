import { describe, expect, it, vi } from 'vitest';

import type { LabelIntelligenceReport } from '@zerotrace/schemas';

import { PostgresLabelIntelligenceReportRepository } from './label-intelligence-reports.js';

describe('PostgreSQL Label Intelligence report repository', () => {
  it('rejects invalid reports and lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresLabelIntelligenceReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as LabelIntelligenceReport)).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'LABEL_INTELLIGENCE_INVALID',
    });
    await expect(
      repository.latest({
        ledger: 'EVM',
        chainId: '',
        subjectType: 'ADDRESS',
        normalizedIdentifier: '0x1111111111111111111111111111111111111111',
      }),
    ).rejects.toMatchObject({ code: 'LABEL_INTELLIGENCE_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('loads every append-only observation for one canonical EVM Subject', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          subject_id: '10000000-0000-4000-8000-000000000001',
          ledger: 'EVM',
          chain_id: 'eip155:56',
          subject_type: 'ADDRESS',
          normalized_identifier: '0x1111111111111111111111111111111111111111',
          observation_id: '10000000-0000-4000-8000-000000000002',
          source: 'official-registry',
          source_class: 'DETERMINISTIC',
          label: 'Example Exchange',
          category: 'CEX',
          actor_candidate: 'Example Exchange',
          source_confidence: '0.99',
          evidence_id: 'ev_000000000000000000000001',
          observed_at: new Date('2026-08-11T00:00:00.000Z'),
          valid_from: null,
          valid_to: null,
          deterministic: true,
          license_policy: 'official registry attribution only',
          raw_payload_hash: '1'.repeat(64),
        },
      ],
      rowCount: 1,
    });
    const repository = PostgresLabelIntelligenceReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(
      repository.loadObservationSet({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        normalizedIdentifier: '0x1111111111111111111111111111111111111111'.toUpperCase(),
      }),
    ).resolves.toMatchObject({
      subject: { id: '10000000-0000-4000-8000-000000000001' },
      observations: [
        {
          category: 'CEX',
          deterministic: true,
          actorCandidate: { state: 'known', value: 'Example Exchange' },
          validFrom: { state: 'unknown' },
          validTo: { state: 'unknown' },
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM subjects subject'), [
      'EVM',
      'eip155:56',
      'ADDRESS',
      '0x1111111111111111111111111111111111111111',
    ]);
  });

  it('distinguishes initialized Label storage from missing migration state', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: 'label_intelligence_reports',
            view_name: 'label_intelligence_search_documents_v1',
            migration_applied: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, view_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresLabelIntelligenceReportRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'LABEL_INTELLIGENCE_NOT_INITIALIZED',
    });
  });
});
