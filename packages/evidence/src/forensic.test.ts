import { describe, expect, it } from 'vitest';

import {
  buildForensicFinding,
  buildReportEnvelope,
  coverageFromRatios,
  inconclusiveSourceIndependence,
  unknownCoverageVector,
} from './forensic.js';
import { unknownValue } from '@zerotrace/schemas';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '10',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

describe('forensic envelope', () => {
  it('binds snapshot, evidence closure, and counter-evidence on every finding', () => {
    const finding = buildForensicFinding({
      schemaVersion: 'forensic-finding-v1',
      assertionClass: 'MODEL_HYPOTHESIS',
      subject: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'ADDRESS',
        identifier: '0x1',
      },
      findingType: 'unit',
      payload: {},
      evidenceFor: [{ id: `ev_${'1'.repeat(24)}` }],
      evidenceAgainst: [{ id: `ev_${'4'.repeat(24)}` }],
      evidenceFamilies: [
        {
          id: 'fam-unit',
          kind: 'PROVIDER_CROSS_CHECK',
          underlyingEventId: `ev_${'1'.repeat(24)}`,
          correlationGroupId: 'unit',
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
      evidenceScore: unknownValue('NOT_QUERIED'),
      calibratedProbability: unknownValue('NOT_APPLICABLE'),
      calibrationStatus: 'UNCALIBRATED',
      snapshot,
      modelVersion: 'forensic-v1',
      policyVersion: 'policy-v1',
      replayRef: 'unit',
      analystDisposition: 'UNREVIEWED',
    });
    expect(finding.snapshot.ledger).toBe('EVM');
    expect(finding.snapshot).toMatchObject({ blockHash: snapshot.blockHash });
    expect(finding.evidenceAgainst).toHaveLength(1);
    expect(finding.calibratedProbability.state).toBe('unknown');
    const envelope = buildReportEnvelope({
      schemaVersion: 'report-envelope-v1',
      reportType: 'unit',
      schemaContractVersion: 'unit-v1',
      modelVersion: 'forensic-v1',
      policyVersion: 'policy-v1',
      subject: finding.subject,
      snapshot,
      status: 'PARTIAL',
      coverage: coverageFromRatios({ historyCoverage: 0.5 }),
      sourceSet: ['unit'],
      sourceIndependence: finding.sourceIndependence,
      evidenceClosure: [`ev_${'1'.repeat(24)}`, `ev_${'2'.repeat(24)}`].sort(),
      createdAt: '2026-08-19T00:00:00.000Z',
      replayRef: {
        command: 'unit',
        snapshot,
        modelVersion: 'forensic-v1',
        policyVersion: 'policy-v1',
        inputHash: 'c'.repeat(64),
      },
      payload: finding,
    });
    expect(envelope.evidenceClosure.length).toBeGreaterThan(0);
    expect(envelope.coverage.originCoverage.state).toBe('unknown');
  });
});
