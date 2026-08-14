import { describe, expect, it } from 'vitest';

import {
  LAUNCHPAD_DECODER_POLICY_VERSION,
  LAUNCHPAD_PROTOCOL_REGISTRY,
  LAUNCHPAD_REGISTRY_VERSION,
  evaluateLaunchpadDecoderActivation,
  getLaunchpadProtocolRegistryEntry,
  inferGenericLaunchMechanism,
  type ProtocolDeploymentVersion,
} from './launchpad-registry.js';
import {
  PUMP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES,
  PUMP_LAUNCHPAD_PROVENANCE_RECORD,
  PUMP_LAUNCHPAD_PROTOCOL_VERSION,
  PUMPSWAP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES,
  PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD,
  PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION,
} from './launchpad-provenance.js';
import { EvidenceLedger } from '@zerotrace/evidence';

describe('launchpad protocol registry', () => {
  it('keeps every named launchpad visible while refusing unpinned activation', () => {
    expect(LAUNCHPAD_REGISTRY_VERSION).toBe('launchpad-registry-v1');
    expect(LAUNCHPAD_DECODER_POLICY_VERSION).toBe('launchpad-decoder-policy-v1');

    for (const entry of LAUNCHPAD_PROTOCOL_REGISTRY) {
      expect(entry.officialSourceUris.length).toBeGreaterThan(0);
      if (entry.platform === 'pump') {
        expect(entry.provenanceStatus).toBe('PINNED');
        expect(entry.decoderStatus).toBe('READY_READ_ONLY');
        expect(entry.versions).toEqual(
          expect.arrayContaining([
            PUMP_LAUNCHPAD_PROTOCOL_VERSION,
            PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION,
          ]),
        );
        expect(entry.versions).toHaveLength(2);
      } else {
        expect(entry.versions).toHaveLength(0);
      }
      expect(
        evaluateLaunchpadDecoderActivation({
          platform: entry.platform,
          deploymentId:
            entry.platform === 'pump'
              ? PUMP_LAUNCHPAD_PROTOCOL_VERSION.deploymentId
              : 'unresolved-current-deployment',
          hasRealHistoricalFixture: entry.platform === 'pump',
          chainIdentityVerified: entry.platform === 'pump',
        }),
      ).toMatchObject(
        entry.platform === 'pump'
          ? { state: 'READY', reasons: [], version: PUMP_LAUNCHPAD_PROTOCOL_VERSION }
          : {
              state: 'BLOCKED',
              reasons: expect.arrayContaining([
                'DEPLOYMENT_VERSION_NOT_PINNED',
                'CHAIN_IDENTITY_NOT_VERIFIED',
                'REAL_HISTORICAL_FIXTURE_MISSING',
              ]),
            },
      );
    }
  });

  it('keeps the Pump activation evidence closed over real finalized captures', () => {
    const ledger = new EvidenceLedger();
    for (const node of [
      ...PUMP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES,
      ...PUMPSWAP_LAUNCHPAD_PROVENANCE_EVIDENCE_NODES,
    ]) {
      ledger.add(node.evidence, node.sourceEvidenceIds, node.snapshot);
    }
    expect(PUMP_LAUNCHPAD_PROVENANCE_RECORD.captureKind).toBe('REAL_FINALIZED_PROVIDER_CAPTURE');
    expect(PUMP_LAUNCHPAD_PROVENANCE_RECORD.observation.execution).toBe('SUCCESS');
    expect(PUMP_LAUNCHPAD_PROVENANCE_RECORD.observation.evidenceIds).toEqual(
      PUMP_LAUNCHPAD_PROVENANCE_RECORD.evidenceIds,
    );
    const ledgerEvidenceIds = ledger
      .values()
      .map((node) => node.evidence.id)
      .sort();
    expect(ledgerEvidenceIds).toEqual(
      expect.arrayContaining(PUMP_LAUNCHPAD_PROVENANCE_RECORD.evidenceIds),
    );
    expect(PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD.observation.platform).toBe('PUMPSWAP');
    expect(PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD.observation.instructionName).toBe('buy');
    expect(PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD.observation.decodedArguments).toEqual([
      { name: 'base_amount_out', value: '558870' },
      { name: 'max_quote_amount_in', value: '151001' },
      { name: 'track_volume', value: 'true' },
    ]);
    expect(ledger.values().map((node) => node.evidence.id)).toEqual(
      expect.arrayContaining(PUMPSWAP_LAUNCHPAD_PROVENANCE_RECORD.evidenceIds),
    );
    expect(
      evaluateLaunchpadDecoderActivation({
        platform: 'pump',
        deploymentId: PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION.deploymentId,
        hasRealHistoricalFixture: true,
        chainIdentityVerified: true,
      }),
    ).toMatchObject({
      state: 'READY',
      reasons: [],
      version: PUMPSWAP_LAUNCHPAD_PROTOCOL_VERSION,
    });
  });

  it('records the license boundary for Raydium and Meteora', () => {
    expect(getLaunchpadProtocolRegistryEntry('raydium-launchlab')).toMatchObject({
      provenanceStatus: 'LICENSE_REVIEW_REQUIRED',
      decoderStatus: 'NOT_AVAILABLE',
    });
    expect(getLaunchpadProtocolRegistryEntry('meteora-dbc')).toMatchObject({
      provenanceStatus: 'LICENSE_REVIEW_REQUIRED',
      decoderStatus: 'NOT_AVAILABLE',
    });
  });

  it('keeps an otherwise complete version blocked when it is outside the registry', () => {
    const version: ProtocolDeploymentVersion = {
      platform: 'fixture-launchpad',
      ledger: 'EVM',
      chain: 'eip155:56',
      deploymentId: 'fixture-v1',
      validFrom: { state: 'known', value: '100' },
      validTo: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      programOrContract: '0x0000000000000000000000000000000000000001',
      factories: ['0x0000000000000000000000000000000000000002'],
      abiOrIdlHash: '0'.repeat(64),
      sourceCommit: 'official/repo@0123456789abcdef0123456789abcdef01234567',
      officialSourceUris: ['https://example.com/official-read-only-spec'],
      evidenceIds: ['ev_registry_fixture'],
    };
    const blocked = evaluateLaunchpadDecoderActivation({
      platform: 'fixture-launchpad',
      deploymentId: version.deploymentId,
      version,
      hasRealHistoricalFixture: false,
      chainIdentityVerified: true,
    });
    expect(blocked).toMatchObject({
      state: 'BLOCKED',
      reasons: ['PLATFORM_NOT_REGISTERED', 'REAL_HISTORICAL_FIXTURE_MISSING'],
    });

    const ready = evaluateLaunchpadDecoderActivation({
      platform: 'fixture-launchpad',
      deploymentId: version.deploymentId,
      version,
      hasRealHistoricalFixture: true,
      chainIdentityVerified: true,
    });
    expect(ready).toMatchObject({
      state: 'BLOCKED',
      reasons: ['PLATFORM_NOT_REGISTERED'],
    });
  });

  it('keeps generic launch detection platform-agnostic', () => {
    const detection = inferGenericLaunchMechanism({
      ledger: 'EVM',
      chainId: 'eip155:56',
      factoryOrProgram: 'factory-observation',
      quoteReserve: '100',
      virtualReserve: '1000',
      buySellEvents: 20,
      migrationEvents: 1,
      liquidityEvents: 1,
      feeTransferEvents: 2,
      evidenceIds: ['ev_raw_launch'],
    });
    expect(detection.platform).toBe('UNKNOWN_LAUNCHPAD');
    expect(detection.mechanism).toEqual({ state: 'known', value: 'BONDING_CURVE_LIKE' });
  });
});
