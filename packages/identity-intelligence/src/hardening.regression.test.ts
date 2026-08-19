import { describe, expect, it } from 'vitest';

import { assessRoles, type RoleCandidateInput } from './index.js';
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
    onchainPrivilegeEvidence: false,
    ...partial,
  };
}

describe('identity intelligence hardening', () => {
  it('does not mint ONCHAIN_FACT from a caller-proposed controller role', () => {
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
          subject: subject('0xcaller'),
          proposedRole: 'CONFIRMED_ONCHAIN_CONTROLLER',
          onchainPrivilegeEvidence: false,
        }),
      ],
    });
    expect(report.assessments[0]?.role).not.toBe('CONFIRMED_ONCHAIN_CONTROLLER');
    expect(report.assessments[0]?.finding.assertionClass).not.toBe('ONCHAIN_FACT');
  });

  it('measures hidden-affiliate sellable share with executableAtomic', () => {
    const report = assessRoles({
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      protocolSupplyAtomic: '1000',
      executableSellableAtomic: '50',
      nonServiceNonPoolAtomic: '1000',
      marketWideExitU: '1',
      candidates: [
        candidate({
          subject: subject('0xhidden'),
          proposedRole: 'SUSPECTED_HIDDEN_AFFILIATE',
          amountAtomic: '400',
          executableAtomic: '10',
          features: features({
            insiderAccessScore: 80,
            commonControlScore: 80,
            benefitReturnScore: 80,
          }),
        }),
      ],
    });
    expect(report.hiddenAffiliate.ofProtocolSupply.scenario).toBe('400');
    expect(report.hiddenAffiliate.ofExecutableSellable.scenario).toBe('10');
  });

  it('deduplicates retail by entity rather than raw address count', () => {
    const report = assessRoles({
      snapshot,
      registryEvidenceId: `ev_${'2'.repeat(24)}`,
      terminalEvidenceId: `ev_${'3'.repeat(24)}`,
      protocolSupplyAtomic: '40',
      executableSellableAtomic: '40',
      nonServiceNonPoolAtomic: '40',
      marketWideExitU: '1',
      candidates: [
        candidate({
          subject: subject('0xa1'),
          proposedRole: 'INDEPENDENT_NATURAL_TRADER',
          amountAtomic: '10',
          entityId: 'ent-1',
          features: features({ independenceScore: 80, positiveIndependenceEvidence: true }),
        }),
        candidate({
          subject: subject('0xa2'),
          proposedRole: 'INDEPENDENT_NATURAL_TRADER',
          amountAtomic: '10',
          entityId: 'ent-1',
          features: features({ independenceScore: 80, positiveIndependenceEvidence: true }),
        }),
      ],
    });
    expect(report.retail.rawAddressCount).toBe(2);
    expect(report.retail.effectiveRetailCount).toBe(1);
  });
});
