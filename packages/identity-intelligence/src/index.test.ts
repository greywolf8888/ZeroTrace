import { describe, expect, it } from 'vitest';

import {
  assessRoles,
  confirmHiddenAffiliate,
  confirmRetail,
  type RoleCandidateInput,
} from './index.js';
import type { ForensicSubject, RoleFeatureVector } from '@zerotrace/schemas';

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

const features = (overrides: Partial<RoleFeatureVector> = {}): RoleFeatureVector => ({
  insiderAccessScore: 0,
  commonControlScore: 0,
  coordinationScore: 0,
  benefitReturnScore: 0,
  independenceScore: 0,
  serviceHubScore: 0,
  marketMakerScore: 0,
  botScore: 0,
  forbiddenSingleFactors: [],
  positiveIndependenceEvidence: false,
  ...overrides,
});

const subject = (id: string): ForensicSubject => ({
  ledger: 'EVM',
  chainId: 'eip155:56',
  subjectType: 'ADDRESS',
  identifier: id,
});

function candidate(
  partial: Partial<RoleCandidateInput> & Pick<RoleCandidateInput, 'subject' | 'proposedRole'>,
): RoleCandidateInput {
  return {
    features: features(),
    amountAtomic: '100',
    executableAtomic: '100',
    evidenceFor: [`ev_${'1'.repeat(24)}`],
    evidenceAgainst: [],
    coverageShrink: 1,
    historyCoverage: 1,
    serviceHub: false,
    disclosedTeam: false,
    publicAirdrop: false,
    publicVesting: false,
    ...partial,
  };
}

describe('identity intelligence', () => {
  it('never confirms a hidden affiliate from early or small-balance alone', () => {
    expect(
      confirmHiddenAffiliate(
        features({ forbiddenSingleFactors: ['early'], insiderAccessScore: 10 }),
      ),
    ).toBe(false);
    expect(
      confirmHiddenAffiliate(
        features({ forbiddenSingleFactors: ['small_balance'], commonControlScore: 10 }),
      ),
    ).toBe(false);
    const report = assessRoles({
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      protocolSupplyAtomic: '100',
      executableSellableAtomic: '100',
      nonServiceNonPoolAtomic: '100',
      marketWideExitU: '1',
      candidates: [
        candidate({
          subject: subject('0xearly'),
          proposedRole: 'SUSPECTED_HIDDEN_AFFILIATE',
          features: features({
            forbiddenSingleFactors: ['early'],
            insiderAccessScore: 10,
            commonControlScore: 10,
            benefitReturnScore: 10,
          }),
        }),
      ],
    });
    expect(report.assessments[0]?.role).toBe('UNKNOWN');
    expect(report.assessments[0]?.finding.calibrationStatus).toBe('UNCALIBRATED');
    expect(report.assessments[0]?.finding.calibratedProbability.state).toBe('unknown');
  });

  it('requires positive independence evidence before confirming retail', () => {
    expect(confirmRetail(features({ independenceScore: 90 }), false)).toBe(false);
    const report = assessRoles({
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      protocolSupplyAtomic: '50',
      executableSellableAtomic: '50',
      nonServiceNonPoolAtomic: '50',
      marketWideExitU: '1',
      candidates: [
        candidate({
          subject: subject('0xsmall'),
          proposedRole: 'INDEPENDENT_NATURAL_TRADER',
          amountAtomic: '1',
          features: features({ independenceScore: 10, positiveIndependenceEvidence: false }),
        }),
      ],
    });
    expect(report.assessments[0]?.role).toBe('UNKNOWN');
  });

  it('suppresses service hubs and confirms hidden affiliates only with three orthogonal families', () => {
    const report = assessRoles({
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      protocolSupplyAtomic: '200',
      executableSellableAtomic: '200',
      nonServiceNonPoolAtomic: '150',
      marketWideExitU: '9',
      candidates: [
        candidate({
          subject: subject('0xrouter'),
          proposedRole: 'PROBABLE_COMMON_CONTROLLER',
          serviceHub: true,
        }),
        candidate({
          subject: subject('0xhidden'),
          proposedRole: 'SUSPECTED_HIDDEN_AFFILIATE',
          amountAtomic: '40',
          features: features({
            insiderAccessScore: 80,
            commonControlScore: 80,
            benefitReturnScore: 80,
          }),
        }),
        candidate({
          subject: subject('0xretail'),
          proposedRole: 'INDEPENDENT_NATURAL_TRADER',
          amountAtomic: '20',
          features: features({
            independenceScore: 80,
            positiveIndependenceEvidence: true,
          }),
        }),
      ],
    });
    expect(report.assessments.map((item) => item.role)).toEqual([
      'ROUTER_OR_SERVICE',
      'SUSPECTED_HIDDEN_AFFILIATE',
      'INDEPENDENT_NATURAL_TRADER',
    ]);
    expect(report.serviceHubsSuppressed).toHaveLength(1);
    expect(report.hiddenAffiliate.ofProtocolSupply.scenario).toBe('40');
    expect(report.retail.effectiveRetailCount).toBe(1);
  });
});
