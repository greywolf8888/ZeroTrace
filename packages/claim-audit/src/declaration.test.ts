import { describe, expect, it } from 'vitest';

import {
  calculateClaimDeclarationResultHash,
  expectedClaimDeclarationTerminalEvidence,
  parseEvmClaimDeclaration,
  validateClaimDeclarationReport,
} from './declaration.js';

const announcement = `
FFT 社区税费分配公示（第1期）

税费接收总钱包（100%）
0x8231Bb4E2891e85E79f28f0816EDE7AeAab06af1

社区建设基金（20%）
0x412DFD5Ac528C05ab78cd005385bC51759e29e46

回购销毁钱包（40%）
0x0928Ecc01081CB765d349f49cfc4e78Fc8acd630

回购加池钱包（40%）
0x5383203C064917186C8341B823ECA578Bd2777D9

税费分配机制：
税费接收总钱包：100%
社区建设基金：20%
回购销毁：40%
回购加池：40%

养老钱包是打入100w币为1股进行加入不可退出，然后每周分红，8月2号开始。
`;

const options = {
  text: announcement,
  chainId: 'eip155:56',
  assetId: 'eip155:56:erc20:0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
  source: 'user-supplied-announcement',
  observedAt: '2026-08-10T00:00:00.000Z',
  auditWindow: {
    from: '2026-08-02T00:00:00.000Z',
    to: '2026-08-10T00:00:00.000Z',
  },
} as const;

describe('claim declaration parser', () => {
  it('compiles the supplied FFT-style announcement without promoting it to a chain fact', () => {
    const result = parseEvmClaimDeclaration(options);

    expect(result.evidence).toMatchObject({
      kind: 'ANALYST_OBSERVATION',
      source: 'user-supplied-announcement',
      chainId: 'eip155:56',
    });
    expect(result).toMatchObject({
      schemaVersion: 'claim-declaration-report-v1',
      sourceSnapshot: {
        schemaVersion: 'claim-source-document-snapshot-v1',
        content: announcement.trim(),
        source: 'user-supplied-announcement',
        capturedAt: '2026-08-10T00:00:00.000Z',
        offsetEncoding: 'UTF16_CODE_UNITS',
      },
      coverage: {
        documentCapture: 1,
        sourceIndependence: { state: 'unknown', reason: 'NOT_QUERIED' },
        chainVerification: { state: 'unknown', reason: 'NOT_QUERIED' },
      },
      freshness: '2026-08-10T00:00:00.000Z',
      sourceSet: ['user-supplied-announcement'],
      extractionConfidence: { state: 'known', value: 1 },
    });
    expect(result.evidenceIds).toEqual([result.evidence.id, result.terminalEvidenceId].sort());
    expect(result.terminalEvidence).toEqual(expectedClaimDeclarationTerminalEvidence(result));
    expect(calculateClaimDeclarationResultHash(result)).toBe(result.resultHash);
    expect(validateClaimDeclarationReport(result)).toEqual(result);
    expect(result.drafts).toHaveLength(6);
    expect(result.warnings).toEqual([]);
    expect(result.unmatchedAddresses).toEqual([]);

    const tax = result.drafts.find((draft) => draft.role === 'TAX_RECEIVER');
    expect(tax).toMatchObject({
      expectedAction: 'RECEIVE',
      destinationAddress: {
        state: 'known',
        value: '0x8231bb4e2891e85e79f28f0816ede7aeaab06af1',
      },
      expectedShareBps: { state: 'known', value: '10000' },
      sourceAddress: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      chainVerifyReadiness: 'INCOMPLETE',
      requiresHumanReview: true,
    });

    const community = result.drafts.find((draft) => draft.role === 'COMMUNITY_FUND');
    expect(community).toMatchObject({
      expectedAction: 'DISTRIBUTE',
      sourceAddress: {
        state: 'known',
        value: '0x8231bb4e2891e85e79f28f0816ede7aeaab06af1',
      },
      destinationAddress: {
        state: 'known',
        value: '0x412dfd5ac528c05ab78cd005385bc51759e29e46',
      },
      expectedShareBps: { state: 'known', value: '2000' },
      chainVerifyReadiness: 'READY_FOR_REVIEW',
    });

    const burn = result.drafts.find((draft) => draft.role === 'BUYBACK_BURN');
    expect(burn).toMatchObject({
      expectedAction: 'BURN',
      destinationAddress: {
        state: 'known',
        value: '0x0928ecc01081cb765d349f49cfc4e78fc8acd630',
      },
      expectedShareBps: { state: 'known', value: '4000' },
      chainVerifyReadiness: 'READY_FOR_REVIEW',
    });

    const liquidity = result.drafts.find((draft) => draft.role === 'BUYBACK_LIQUIDITY');
    expect(liquidity).toMatchObject({
      expectedAction: 'ADD_LIQUIDITY',
      destinationAddress: {
        state: 'known',
        value: '0x5383203c064917186c8341b823eca578bd2777d9',
      },
      expectedShareBps: { state: 'known', value: '4000' },
      chainVerifyReadiness: 'READY_FOR_REVIEW',
    });

    const pension = result.drafts.find((draft) => draft.role === 'PENSION_VAULT');
    expect(pension).toMatchObject({
      expectedAction: 'LOCK',
      destinationAddress: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      shareUnitTokens: { state: 'known', value: '1000000' },
      noExit: { state: 'known', value: true },
      chainVerifyReadiness: 'INCOMPLETE',
    });
    expect(pension?.destinationAddress).not.toEqual({
      state: 'known',
      value: '0x8d50a68b4f9ada119d198d6472eaf0cb6db302d9',
    });

    const dividend = result.drafts.find((draft) => draft.role === 'DIVIDEND_DISTRIBUTOR');
    expect(dividend).toMatchObject({
      expectedAction: 'PAY_DIVIDEND',
      sourceAddress: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      destinationAddress: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      expectedShareBps: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      cadenceSeconds: { state: 'known', value: '604800' },
      chainVerifyReadiness: 'INCOMPLETE',
    });
  });

  it('keeps conflicting address candidates Unknown and exposes every unmatched address', () => {
    const result = parseEvmClaimDeclaration({
      ...options,
      text: `社区建设基金（20%）\n0x${'1'.repeat(40)}\n0x${'2'.repeat(40)}`,
    });

    expect(result.drafts[0]?.destinationAddress).toMatchObject({
      state: 'unknown',
      reason: 'CONFLICTING_SOURCES',
    });
    expect(result.unmatchedAddresses).toEqual([`0x${'1'.repeat(40)}`, `0x${'2'.repeat(40)}`]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Declared downstream allocation totals 2000 bps instead of 10000.',
        'COMMUNITY_FUND contains multiple destination-address candidates.',
      ]),
    );
  });

  it('does not turn absent percentages, windows, or roles into zeros', () => {
    const result = parseEvmClaimDeclaration({
      ...options,
      text: `回购销毁钱包\n0x${'3'.repeat(40)}`,
      auditWindow: undefined,
    });
    expect(result.drafts[0]).toMatchObject({
      expectedShareBps: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      window: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      chainVerifyReadiness: 'INCOMPLETE',
    });
    expect(result.drafts[0]?.expectedShareBps).not.toEqual({ state: 'known', value: '0' });
  });

  it('never parses hexadecimal wallet digits as a pension share-unit quantity', () => {
    const pensionAddress = `0x${'5'.repeat(40)}`;
    const result = parseEvmClaimDeclaration({
      ...options,
      text: `养老钱包\n${pensionAddress}\n打入1000000币为1股进行加入不可退出。`,
    });

    expect(result.drafts[0]).toMatchObject({
      destinationAddress: { state: 'known', value: pensionAddress },
      shareUnitTokens: { state: 'known', value: '1000000' },
      noExit: { state: 'known', value: true },
    });
  });

  it('rejects empty documents and cross-chain asset identities', () => {
    expect(() => parseEvmClaimDeclaration({ ...options, text: ' ' })).toThrow(
      'between 1 and 100000',
    );
    expect(() => parseEvmClaimDeclaration({ ...options, assetId: 'eip155:1:erc20:token' })).toThrow(
      'canonical ERC-20 asset',
    );
  });

  it('rejects mutated source Snapshots, result hashes, and terminal derivations', () => {
    const report = parseEvmClaimDeclaration(options);
    expect(() =>
      validateClaimDeclarationReport({
        ...report,
        sourceSnapshot: { ...report.sourceSnapshot, content: `${report.sourceSnapshot.content}!` },
      }),
    ).toThrow(/identity|canonical/i);
    expect(() => validateClaimDeclarationReport({ ...report, resultHash: '0'.repeat(64) })).toThrow(
      /identity|canonical/i,
    );
    expect(() =>
      validateClaimDeclarationReport({
        ...report,
        terminalEvidence: { ...report.terminalEvidence, summary: 'Mutated terminal.' },
      }),
    ).toThrow(/identity|canonical/i);
  });

  it('keeps identical captures deterministic and distinct capture times immutable', () => {
    const first = parseEvmClaimDeclaration(options);
    const replay = parseEvmClaimDeclaration(options);
    const laterCapture = parseEvmClaimDeclaration({
      ...options,
      observedAt: '2026-08-10T00:00:01.000Z',
    });

    expect(replay).toEqual(first);
    expect(laterCapture.sourceSnapshot.contentHash).toBe(first.sourceSnapshot.contentHash);
    expect(laterCapture.documentHash).not.toBe(first.documentHash);
    expect(laterCapture.id).not.toBe(first.id);
  });
});
