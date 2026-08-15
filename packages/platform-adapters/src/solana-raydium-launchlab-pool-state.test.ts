import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type {
  SolanaAccountInfoResponse,
  SolanaSnapshot,
  TransportObservation,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import type { AnalysisSnapshot, Evidence } from '@zerotrace/schemas';

import {
  inspectRaydiumLaunchlabPoolState,
  type RaydiumLaunchlabPoolStateReadAdapter,
} from './solana-raydium-launchlab-pool-state.js';
import {
  RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR,
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
} from './solana-raydium-launchlab.js';

const ACCOUNT = bs58.encode(new Uint8Array(32).fill(7));
const OTHER_OWNER = bs58.encode(new Uint8Array(32).fill(8));

function snapshot(slot: string): SolanaSnapshot {
  const number = BigInt(slot);
  return {
    ledger: 'SOLANA',
    chainId: 'solana-mainnet',
    slot,
    blockhash: bs58.encode(new Uint8Array(32).fill(3)),
    parentSlot: number === 0n ? '0' : (number - 1n).toString(),
    previousBlockhash: bs58.encode(new Uint8Array(32).fill(4)),
    commitment: 'finalized',
    capturedAt: '2026-08-15T00:00:00.000Z',
    providerVersions: { 'raydium-test': 'solana-json-rpc' },
    adapterVersions: { solana: 'test' },
    configHash: hashPayload({ slot }),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  };
}

function poolStateData(): Uint8Array {
  const bytes: number[] = [...RAYDIUM_LAUNCHLAB_POOL_STATE_DISCRIMINATOR];
  const appendU64 = (value: bigint) => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigUint64(0, value, true);
    bytes.push(...new Uint8Array(buffer));
  };
  appendU64(77n);
  bytes.push(9, 0, 6, 6, 1);
  for (const value of [
    1_000n,
    700n,
    800n,
    900n,
    600n,
    500n,
    400n,
    30n,
    20n,
    10n,
    100n,
    11n,
    12n,
    13n,
    14n,
  ]) {
    appendU64(value);
  }
  for (let index = 1; index <= 7; index += 1) bytes.push(...new Uint8Array(32).fill(index));
  bytes.push(3, 1);
  appendU64(55n);
  bytes.push(...new Uint8Array(54));
  return Uint8Array.from(bytes);
}

function accountResponse(
  slot: number,
  owner: string = RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  data = poolStateData(),
): SolanaAccountInfoResponse {
  return {
    context: { slot },
    value: {
      data: [Buffer.from(data).toString('base64'), 'base64'],
      executable: false,
      lamports: '1',
      owner,
      rentEpoch: '0',
      space: data.length,
    },
  };
}

class FakePoolStateAdapter implements RaydiumLaunchlabPoolStateReadAdapter {
  readonly sourceId = 'raydium-test';
  readonly config = { commitment: 'finalized' as const };
  constructor(protected readonly response: SolanaAccountInfoResponse) {}

  async getAccountInfoObservation(
    _address: string,
    _minimumContextSlot?: number,
  ): Promise<TransportObservation<SolanaAccountInfoResponse>> {
    return { endpointId: this.sourceId, value: this.response };
  }

  async readAnchorAt(position: string): Promise<{ snapshot: AnalysisSnapshot }> {
    return { snapshot: snapshot(position) };
  }
}

class ArchivePoolStateAdapter extends FakePoolStateAdapter {
  async getAccountInfoAt(
    _address: string,
    slot: number,
  ): Promise<TransportObservation<SolanaAccountInfoResponse>> {
    return {
      endpointId: `${this.sourceId}:archive`,
      value: { ...this.response, context: { ...this.response.context, slot } },
    };
  }
}

async function inspect(
  adapter: RaydiumLaunchlabPoolStateReadAdapter,
  requestedSlot?: string,
): Promise<{
  result: Awaited<ReturnType<typeof inspectRaydiumLaunchlabPoolState>>;
  ledger: EvidenceLedger;
}> {
  const ledger = new EvidenceLedger();
  const writeEvidence = async (
    evidence: Evidence,
    sourceEvidenceIds: readonly string[] = [],
    boundSnapshot?: AnalysisSnapshot,
  ) => ledger.add(evidence, sourceEvidenceIds, boundSnapshot).evidence;
  const result = await inspectRaydiumLaunchlabPoolState({
    account: ACCOUNT,
    ...(requestedSlot === undefined ? {} : { requestedSlot }),
    adapter,
    writeEvidence,
  });
  return { result, ledger };
}

describe('Raydium LaunchLab PoolState inspection', () => {
  it('binds a full finalized account read and closes raw/derived Evidence', async () => {
    const first = await inspect(new FakePoolStateAdapter(accountResponse(77)), '77');
    const second = await inspect(new FakePoolStateAdapter(accountResponse(77)), '77');

    expect(first.result).toMatchObject({
      account: ACCOUNT,
      ownerVerified: true,
      discriminatorMatched: true,
      accountDataLength: 429,
      requestedSlot: '77',
      observedContextSlot: '77',
      stateAtRequestedSlot: 'EXACT',
      fieldCoverage: 1,
      historyCoverage: 1,
    });
    expect(first.result.evidenceIds).toHaveLength(2);
    expect(
      first.ledger
        .values()
        .map((node) => node.evidence.id)
        .sort(),
    ).toEqual(first.result.evidenceIds);
    expect(first.result.resultHash).toBe(second.result.resultHash);
    expect(first.result.id).toBe(second.result.id);
  });

  it('keeps a later minimum-context response out of exact historical claims', async () => {
    const { result } = await inspect(new FakePoolStateAdapter(accountResponse(78)), '77');

    expect(result.stateAtRequestedSlot).toBe('MIN_CONTEXT_ONLY');
    expect(result.observedContextSlot).toBe('78');
    expect(result.historyCoverage).toBe(0.5);
    expect(result.decodeWarnings).toEqual([]);
  });

  it('uses an explicit archive capability only when its context is exact', async () => {
    const { result } = await inspect(new ArchivePoolStateAdapter(accountResponse(999)), '77');

    expect(result.stateAtRequestedSlot).toBe('EXACT');
    expect(result.observedContextSlot).toBe('77');
    expect(result.historyCoverage).toBe(1);
    expect(result.sourceSet).toContain('raydium-test:archive');
  });

  it('fails closed for a wrong owner and preserves the account-state boundary', async () => {
    const { result } = await inspect(
      new FakePoolStateAdapter(accountResponse(77, OTHER_OWNER)),
      '77',
    );

    expect(result.ownerVerified).toBe(false);
    expect(result.discriminatorMatched).toBe(true);
    expect(result.fieldCoverage).toBe(0);
    expect(result.decodeWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('not the pinned Raydium')]),
    );
    expect(result.dataCoverage).toBe(0.5);
  });
});
