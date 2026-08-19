import { describe, expect, it } from 'vitest';

import { createEvidence } from '@zerotrace/evidence';

import { decideTokenAnalyzeCapability } from './capability.js';
import { materializeTokenMarketStructure } from './materialize.js';
import { originHistoryWithoutReader } from './origin-job.js';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '1000',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

const request = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  token: '0xAeCBD0E461047d6B7Cfc82e637AD197097407777',
  snapshotPolicy: 'FINALIZED' as const,
  analysisMode: 'FULL_LIFETIME' as const,
};

function evidence(locator: string) {
  return createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'CONTRACT_STATE',
    source: 'test-rpc',
    locator,
    payload: { locator },
    summary: locator,
    blockOrSlot: '1000',
    finality: 'finalized',
  });
}

describe('forensic pipeline', () => {
  it('rejects unsupported ledgers without inventing coverage', () => {
    const decision = decideTokenAnalyzeCapability({
      ...request,
      ledger: 'SOLANA',
      chainId: 'solana-mainnet',
      token: 'So11111111111111111111111111111111111111112',
    });
    expect(decision.status).toBe('UNSUPPORTED');
  });

  it('stays offline when no inspection observation is supplied', () => {
    const report = materializeTokenMarketStructure({ request });
    expect(report.status).toBe('OFFLINE');
    expect(report.envelopes).toEqual([]);
    expect(report.supply).toBeUndefined();
  });

  it('materializes supply cells from observed reserve and circulating without JSON paste', () => {
    const report = materializeTokenMarketStructure({
      request,
      observation: {
        token: request.token,
        chainId: request.chainId,
        snapshot,
        evidence: [evidence('portal-code'), evidence('token-state')],
        portalAddress: '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0',
        circulatingSupplyAtomic: '900',
        reserveAtomic: '100',
        platformMatch: true,
      },
    });
    expect(report.status).toBe('PARTIAL');
    expect(report.supply?.conservation.protocolSupplyAtomic).toBe('1000');
    expect(report.supply?.conservation.identityHolds).toBe(true);
    expect(report.supply?.cells).toHaveLength(2);
    expect(report.envelopes.some((item) => item.reportType === 'supply-reality-v1')).toBe(true);
    expect(report.roles?.assessments[0]?.role).toBe('ROUTER_OR_SERVICE');
    expect(report.casePackage?.manifest).toBeDefined();
    expect(report.limitations.some((item) => item.includes('0'))).toBe(true);
  });

  it('does not treat missing circulating supply as numeric zero', () => {
    const report = materializeTokenMarketStructure({
      request,
      observation: {
        token: request.token,
        chainId: request.chainId,
        snapshot,
        evidence: [evidence('a'), evidence('b')],
      },
    });
    expect(report.supply).toBeUndefined();
    expect(report.status).toBe('PARTIAL');
    expect(report.limitations.some((item) => item.includes('未物化供应现实'))).toBe(true);
  });

  it('rejects unsupported snapshot policy and malformed EVM tokens without inventing coverage', () => {
    expect(
      decideTokenAnalyzeCapability({
        ...request,
        snapshotPolicy: 'SAFE' as typeof request.snapshotPolicy,
      }).reason,
    ).toContain('FINALIZED');
    expect(decideTokenAnalyzeCapability({ ...request, token: 'not-an-address' }).status).toBe(
      'UNSUPPORTED',
    );
    const unfinalized = materializeTokenMarketStructure({
      request: { ...request, snapshotPolicy: 'FINALIZED' },
      observation: {
        token: request.token,
        chainId: request.chainId,
        snapshot: { ...snapshot, finality: 'safe' },
        evidence: [evidence('a'), evidence('b')],
      },
    });
    expect(unfinalized).toMatchObject({ status: 'FAILED', reason: 'SNAPSHOT_NOT_FINALIZED' });
    const thin = materializeTokenMarketStructure({
      request,
      observation: {
        token: request.token,
        chainId: request.chainId,
        snapshot,
        evidence: [evidence('only-one')],
      },
    });
    expect(thin).toMatchObject({ status: 'FAILED', reason: 'INSUFFICIENT_EVIDENCE' });
    const bounded = materializeTokenMarketStructure({
      request: { ...request, analysisMode: 'BOUNDED_WINDOW' },
    });
    expect(bounded.status).toBe('OFFLINE');
    expect(
      materializeTokenMarketStructure({
        request: { ...request, ledger: 'BITCOIN', chainId: 'bitcoin-mainnet', token: 'addr' },
      }).status,
    ).toBe('UNSUPPORTED');
    expect(originHistoryWithoutReader().status).toBe('OFFLINE');
  });
});
