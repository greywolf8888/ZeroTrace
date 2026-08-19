import { describe, expect, it } from 'vitest';

import { exportCasePackage, recordAnalystDecision } from './index.js';
import {
  buildForensicFinding,
  inconclusiveSourceIndependence,
  unknownCoverageVector,
} from '@zerotrace/evidence';
import { knownValue, unknownValue } from '@zerotrace/schemas';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '1',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

describe('casework', () => {
  it('records an immutable analyst decision and exports a Chinese case package', () => {
    const finding = buildForensicFinding({
      schemaVersion: 'forensic-finding-v1',
      assertionClass: 'ANALYST_FINDING',
      subject: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        identifier: '0x1',
      },
      findingType: 'role-review',
      payload: { note: 'accepted after review' },
      evidenceFor: [{ id: `ev_${'1'.repeat(24)}` }],
      evidenceAgainst: [],
      evidenceFamilies: [
        {
          id: 'fam-1',
          kind: 'ANALYST_OVERRIDE',
          underlyingEventId: `ev_${'1'.repeat(24)}`,
          correlationGroupId: 'review',
          familyContributionCap: 1,
          evidenceIds: [`ev_${'1'.repeat(24)}`],
        },
      ],
      alternativeExplanations: [],
      coverage: unknownCoverageVector(),
      sourceIndependence: inconclusiveSourceIndependence(
        `ev_${'2'.repeat(24)}`,
        `ev_${'3'.repeat(24)}`,
      ),
      evidenceScore: knownValue(0),
      calibratedProbability: unknownValue('NOT_APPLICABLE'),
      calibrationStatus: 'NOT_APPLICABLE',
      snapshot,
      modelVersion: 'casework-v1.0.0',
      policyVersion: 'analyst-v1',
      replayRef: 'analyst:1',
      analystDisposition: 'ACCEPTED',
    });
    const decision = recordAnalystDecision({
      investigationId: `inv_${'a'.repeat(24)}`,
      actor: 'analyst-local',
      role: 'ANALYST',
      targetFindingId: finding.id,
      action: 'ACCEPT',
      disposition: 'ACCEPTED',
      rationale: '链上权限与资金回流证据一致。',
      evidenceIds: [`ev_${'1'.repeat(24)}`],
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    expect(decision.id.startsWith('ads_')).toBe(true);
    const exported = exportCasePackage({
      investigationId: `inv_${'a'.repeat(24)}`,
      findings: [finding],
      limitations: ['交易所内行为不可见', '模型未校准'],
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    expect(exported['summary.zh-CN.html']).toContain('链上盘面结构取证案件');
    expect(exported['evidence.jsonl']).toContain(finding.id);
    expect(exported['replay.ps1']).toContain('Invoke-RestMethod');
    expect(exported.manifest.files.some((file) => file.name === 'hashes.sha256')).toBe(true);
  });
});
