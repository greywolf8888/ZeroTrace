import { getMintEncoder as getToken2022MintEncoder } from '@solana-program/token-2022';
import { describe, expect, it } from 'vitest';

import {
  type SolanaAccountInfoResponse,
  type SolanaAccountState,
  type SolanaMultipleAccountsResponse,
  type TransportObservation,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger } from '@zerotrace/evidence';
import type { AnalysisSnapshot, ChainAnchorRead, Evidence } from '@zerotrace/schemas';
import bs58 from 'bs58';

import {
  inspectSolanaControlSurface,
  type SolanaControlReadAdapter,
} from './solana-control-rights.js';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const LOADER_V3 = 'BPFLoaderUpgradeab1e11111111111111111111111';
const subject = bs58.encode(Buffer.alloc(32, 1));
const authority = bs58.encode(Buffer.alloc(32, 2));
const signerA = bs58.encode(Buffer.alloc(32, 3));
const signerB = bs58.encode(Buffer.alloc(32, 4));
const signerC = bs58.encode(Buffer.alloc(32, 5));
const blockhash = bs58.encode(Buffer.alloc(32, 6));
const previousBlockhash = bs58.encode(Buffer.alloc(32, 7));

function snapshot(slot: number) {
  return {
    ledger: 'SOLANA' as const,
    chainId: 'solana-mainnet' as const,
    slot: String(slot),
    blockhash,
    parentSlot: String(slot - 1),
    previousBlockhash,
    commitment: 'finalized' as const,
    blockTimestamp: '2026-08-11T00:00:00.000Z',
    capturedAt: '2026-08-11T00:00:01.000Z',
    providerVersions: { 'solana-fixture': 'solana-json-rpc' },
    adapterVersions: { solana: 'fixture' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
}

function account(data: Uint8Array, owner: string, executable = false): SolanaAccountState {
  return {
    data: [Buffer.from(data).toString('base64'), 'base64'],
    executable,
    lamports: '1000000',
    owner,
    rentEpoch: '0',
    space: data.length,
  };
}

function classicMint(mintAuthority: string | null, freezeAuthority: string | null): Buffer {
  const data = Buffer.alloc(82);
  if (mintAuthority !== null) {
    data.writeUInt32LE(1, 0);
    Buffer.from(bs58.decode(mintAuthority)).copy(data, 4);
  }
  data.writeBigUInt64LE(1_000_000n, 36);
  data[44] = 6;
  data[45] = 1;
  if (freezeAuthority !== null) {
    data.writeUInt32LE(1, 46);
    Buffer.from(bs58.decode(freezeAuthority)).copy(data, 50);
  }
  return data;
}

function classicMultisig(): Buffer {
  const data = Buffer.alloc(355);
  data[0] = 2;
  data[1] = 3;
  data[2] = 1;
  for (const [index, signer] of [signerA, signerB, signerC].entries()) {
    Buffer.from(bs58.decode(signer)).copy(data, 3 + index * 32);
  }
  return data;
}

function fixtureAdapter(
  accounts: ReadonlyMap<string, SolanaAccountState | null>,
): SolanaControlReadAdapter {
  const sourced = <T>(value: T): Promise<TransportObservation<T>> =>
    Promise.resolve({ value, endpointId: 'solana-fixture' });
  return {
    sourceId: 'solana-fixture',
    config: { commitment: 'finalized' },
    getAccountInfoObservation: (
      address,
    ): Promise<TransportObservation<SolanaAccountInfoResponse>> =>
      sourced({ context: { slot: 100 }, value: accounts.get(address) ?? null }),
    getMultipleAccountsObservation: (
      addresses,
    ): Promise<TransportObservation<SolanaMultipleAccountsResponse>> =>
      sourced({
        context: { slot: 101 },
        value: addresses.map((address) => accounts.get(address) ?? null),
      }),
    readAnchorAt: (position): Promise<ChainAnchorRead> =>
      Promise.resolve({
        anchor: {
          ledger: 'SOLANA',
          chainId: 'solana-mainnet',
          position,
          hash: blockhash,
          parentPosition: String(Number(position) - 1),
          parentHash: previousBlockhash,
          finality: 'finalized',
          source: 'solana-fixture',
          observedAt: '2026-08-11T00:00:01.000Z',
        },
        snapshot: snapshot(Number(position)),
        payload: { fixture: true },
      }),
  };
}

function evidenceWriter() {
  const ledger = new EvidenceLedger();
  const writes: Evidence[] = [];
  return {
    ledger,
    writes,
    write: async (
      evidence: Evidence,
      sourceEvidenceIds: readonly string[] = [],
      analysisSnapshot?: AnalysisSnapshot,
    ) => {
      const existing = ledger.get(evidence.id);
      if (existing !== undefined) return existing.evidence;
      writes.push(evidence);
      return ledger.add(evidence, sourceEvidenceIds, analysisSnapshot).evidence;
    },
  };
}

describe('Solana control surface', () => {
  it('binds a mint authority to a same-slot SPL Token multisig threshold', async () => {
    const writer = evidenceWriter();
    const report = await inspectSolanaControlSurface({
      subject,
      adapter: fixtureAdapter(
        new Map([
          [subject, account(classicMint(authority, null), TOKEN_PROGRAM)],
          [authority, account(classicMultisig(), TOKEN_PROGRAM)],
        ]),
      ),
      writeEvidence: writer.write,
    });

    expect(report).toMatchObject({
      ledger: 'SOLANA',
      subject,
      accountKind: { state: 'known', value: 'SPL_TOKEN_MINT' },
      mint: {
        state: 'known',
        value: {
          supply: '1000000',
          decimals: 6,
          mintAuthority: { state: 'known', value: authority },
          freezeAuthority: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        },
      },
      sourceAgreement: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      sourceIndependence: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      metadata: { historyCoverage: 0, simulationCoverage: 0, sourceCoverage: 0.5 },
    });
    expect(report.rights).toHaveLength(1);
    expect(report.rights[0]).toMatchObject({
      controller: authority,
      rightType: 'MINT_AUTHORITY',
      threshold: { state: 'known', value: '2' },
    });
    expect(report.coverage).toHaveLength(38);
    expect(report.coverage.find((item) => item.domain === 'FREEZE_AUTHORITY')).toMatchObject({
      observed: { state: 'known', value: false },
    });
    expect(report.coverage.find((item) => item.domain === 'SQUADS_CONFIGURATION')).toMatchObject({
      observed: { state: 'unknown', reason: 'NOT_IMPLEMENTED' },
    });
    expect(writer.ledger.get(report.terminalEvidenceId)?.sourceEvidenceIds).toHaveLength(1);
  });

  it('decodes Token-2022 permanent delegate extensions without calling absence zero', async () => {
    const encoder = getToken2022MintEncoder();
    const data = encoder.encode({
      mintAuthority: { __option: 'None' },
      supply: 99n,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: { __option: 'None' },
      extensions: {
        __option: 'Some',
        value: [{ __kind: 'PermanentDelegate', delegate: authority }],
      },
    } as Parameters<typeof encoder.encode>[0]);
    const writer = evidenceWriter();
    const report = await inspectSolanaControlSurface({
      subject,
      adapter: fixtureAdapter(
        new Map([
          [subject, account(Buffer.from(data), TOKEN_2022_PROGRAM)],
          [authority, null],
        ]),
      ),
      writeEvidence: writer.write,
    });

    expect(report.accountKind).toEqual({ state: 'known', value: 'TOKEN_2022_MINT' });
    expect(report.extensions).toMatchObject([
      {
        extensionType: 'PermanentDelegate',
        authorities: [{ role: 'PERMANENT_DELEGATE', address: authority }],
      },
    ]);
    expect(report.rights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rightType: 'PERMANENT_DELEGATE',
          controller: authority,
          threshold: expect.objectContaining({
            state: 'unknown',
            reason: 'INSUFFICIENT_DATA',
          }),
        }),
      ]),
    );
    expect(report.coverage.find((item) => item.domain === 'PERMANENT_DELEGATE')).toMatchObject({
      observed: { state: 'known', value: true },
    });
  });

  it('links loader-v3 ProgramData and distinguishes upgradeable from immutable state', async () => {
    const programDataAddress = bs58.encode(Buffer.alloc(32, 8));
    const programBytes = Buffer.alloc(36);
    programBytes.writeUInt32LE(2, 0);
    Buffer.from(bs58.decode(programDataAddress)).copy(programBytes, 4);
    const programData = Buffer.alloc(49);
    programData.writeUInt32LE(3, 0);
    programData.writeBigUInt64LE(88n, 4);
    programData[12] = 1;
    Buffer.from(bs58.decode(authority)).copy(programData, 13);
    programData.set([1, 2, 3, 4], 45);
    const writer = evidenceWriter();
    const report = await inspectSolanaControlSurface({
      subject,
      adapter: fixtureAdapter(
        new Map([
          [subject, account(programBytes, LOADER_V3, true)],
          [programDataAddress, account(programData, LOADER_V3)],
          [authority, null],
        ]),
      ),
      writeEvidence: writer.write,
    });

    expect(report.accountKind).toEqual({ state: 'known', value: 'UPGRADEABLE_PROGRAM' });
    expect(report.program).toMatchObject({
      state: 'known',
      value: {
        programDataAddress: { state: 'known', value: programDataAddress },
        upgradeAuthority: { state: 'known', value: authority },
        immutable: { state: 'known', value: false },
        deploymentSlot: { state: 'known', value: '88' },
        programDataBytes: { state: 'known', value: 4 },
      },
    });
    expect(report.rights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          controller: authority,
          rightType: 'PROGRAM_UPGRADE_AUTHORITY',
        }),
      ]),
    );
  });

  it('rejects non-finalized adapters before persisting Evidence', async () => {
    const writer = evidenceWriter();
    const adapter = fixtureAdapter(
      new Map([[subject, account(classicMint(null, null), TOKEN_PROGRAM)]]),
    );
    await expect(
      inspectSolanaControlSurface({
        subject,
        adapter: { ...adapter, config: { commitment: 'confirmed' } },
        writeEvidence: writer.write,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(writer.writes).toHaveLength(0);
  });
});
