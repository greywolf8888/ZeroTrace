import { describe, expect, it } from 'vitest';

import type { AnalysisSnapshot } from '@zerotrace/schemas';

import {
  createTerminalBoundary,
  matchBridgePair,
  netAtomicFlow,
  type AssetLedgerEvent,
  type BridgeMessageProof,
} from './index.js';

const sourceSnapshot: AnalysisSnapshot = {
  ledger: 'EVM',
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized',
  capturedAt: '2026-08-01T00:00:00.000Z',
  providerVersions: { source: 'test-v1' },
  adapterVersions: { evm: 'test-v1' },
  configHash: '1'.repeat(64),
  entityModelVersion: 'entity-test-v1',
  labelSnapshot: 'labels-test-v1',
};

const destinationSnapshot: AnalysisSnapshot = {
  ...sourceSnapshot,
  chainId: 'eip155:1',
  blockNumber: '200',
  blockHash: `0x${'b'.repeat(64)}`,
  configHash: '2'.repeat(64),
};

const sourceAsset = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  token: `0x${'a'.repeat(40)}`,
  decimals: 18,
};
const destinationAsset = {
  ledger: 'EVM' as const,
  chainId: 'eip155:1',
  token: `0x${'b'.repeat(40)}`,
  decimals: 6,
};

function event(
  partial: Partial<AssetLedgerEvent> & Pick<AssetLedgerEvent, 'id' | 'kind' | 'from' | 'to'>,
): AssetLedgerEvent {
  return {
    ledger: 'EVM',
    chainId: 'eip155:56',
    txId: `0x${'1'.repeat(64)}`,
    position: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: '100' },
    asset: sourceAsset,
    amountAtomic: '1000000000000000000',
    internal: false,
    failed: false,
    evidenceIds: [`ev_${'1'.repeat(24)}`],
    ...partial,
  };
}

function bridgeEvents(): { deposit: AssetLedgerEvent; release: AssetLedgerEvent } {
  return {
    deposit: event({
      id: 'dep',
      kind: 'BRIDGE_DEPOSIT',
      from: 'source-user',
      to: 'source-bridge',
    }),
    release: event({
      id: 'rel',
      kind: 'BRIDGE_RELEASE',
      from: 'destination-bridge',
      to: 'destination-user',
      chainId: 'eip155:1',
      position: { ledger: 'EVM', chainId: 'eip155:1', blockOrSlot: '200' },
      asset: destinationAsset,
      amountAtomic: '999000',
      evidenceIds: [`ev_${'2'.repeat(24)}`],
    }),
  };
}

function bridgeProof(events: ReturnType<typeof bridgeEvents>): BridgeMessageProof {
  return {
    protocol: 'TestBridge',
    protocolVersion: 'test-v1',
    protocolMessageId: 'message-001',
    sourceMessageRef: 'source-log-1',
    destinationMessageRef: 'destination-log-1',
    sourceEventId: events.deposit.id,
    destinationEventId: events.release.id,
    sourceSender: events.deposit.from,
    sourceBridgeEndpoint: events.deposit.to,
    destinationBridgeEndpoint: events.release.from,
    destinationRecipient: events.release.to,
    sourceAsset,
    destinationAsset,
    sourceDecimals: 18,
    destinationDecimals: 6,
    canonicalDecimals: 18,
    feeCanonicalAtomic: '1000000000000000',
    sourceSnapshot,
    destinationSnapshot,
    officialSourceUris: ['https://bridge.example/protocol/test-v1'],
    evidenceIds: [...events.deposit.evidenceIds, ...events.release.evidenceIds],
    modelVersion: 'bridge-message-test-v1',
  };
}

describe('asset ledger hardening', () => {
  it('matches a cross-chain bridge pair only with message, endpoint, mapping, fee, Snapshot, and Evidence proof', () => {
    const events = bridgeEvents();
    const match = matchBridgePair(events.deposit, events.release, bridgeProof(events));

    expect(match).toMatchObject({
      status: 'VERIFIED_PROTOCOL_MESSAGE',
      protocolMessageId: 'message-001',
      sourceAmountCanonicalAtomic: '1000000000000000000',
      destinationAmountCanonicalAtomic: '999000000000000000',
      feeCanonicalAtomic: '1000000000000000',
      realizationStatus: 'CROSS_LEDGER_TRANSFER_NOT_MARKET_REALIZATION',
    });
    expect(match.sourceEvent.matchedBridgeEventId).toBe(events.release.id);
    expect(match.destinationEvent.matchedBridgeEventId).toBe(events.deposit.id);
    expect(match.evidenceIds).toHaveLength(2);
  });

  it('rejects amount coincidence without protocol-message proof and rejects inconsistent fee math', () => {
    const events = bridgeEvents();
    expect(() => matchBridgePair(events.deposit, events.release)).toThrow(
      /message proof is required/,
    );
    expect(() =>
      matchBridgePair(events.deposit, events.release, {
        ...bridgeProof(events),
        feeCanonicalAtomic: '0',
      }),
    ).toThrow(/release plus explicit bridge fee/);
  });

  it('records CEX/privacy/bridge exits only as last-observable boundaries, never realization', () => {
    const cexDeposit = event({
      id: 'cex-deposit',
      kind: 'CEX_DEPOSIT',
      from: 'user',
      to: 'cex-service-hub',
    });
    const boundary = createTerminalBoundary({
      event: cexDeposit,
      boundary: 'CEX',
      snapshot: sourceSnapshot,
      coverage: 1,
      freshness: '2026-08-01T00:00:00.000Z',
      sourceSet: ['test-source'],
      evidenceIds: cexDeposit.evidenceIds,
      modelVersion: 'terminal-boundary-test-v1',
      evidenceScore: 85,
    });

    expect(boundary).toMatchObject({
      status: 'LAST_OBSERVABLE_BOUNDARY',
      boundary: 'CEX',
      ownershipPropagation: 'STOPPED',
      realization: {
        state: 'unknown',
        reason: 'BOUNDARY_IS_NOT_CONFIRMED_REALIZATION',
      },
      confidence: { kind: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY' },
    });
  });

  it('rejects a boundary whose Snapshot does not bind the event position', () => {
    const cexDeposit = event({
      id: 'cex-deposit',
      kind: 'CEX_DEPOSIT',
      from: 'user',
      to: 'cex-service-hub',
    });
    expect(() =>
      createTerminalBoundary({
        event: cexDeposit,
        boundary: 'CEX',
        snapshot: destinationSnapshot,
        coverage: 1,
        freshness: '2026-08-01T00:00:00.000Z',
        sourceSet: ['test-source'],
        evidenceIds: cexDeposit.evidenceIds,
        modelVersion: 'terminal-boundary-test-v1',
        evidenceScore: 85,
      }),
    ).toThrow(/identities must agree/);
  });

  it('does not net flows from a different ledger, chain, or asset', () => {
    const events = [
      event({ id: 'a', kind: 'TRANSFER', from: 'x', to: 'owner', amountAtomic: '5' }),
      event({
        id: 'b',
        kind: 'TRANSFER',
        from: 'x',
        to: 'owner',
        amountAtomic: '9',
        chainId: 'eip155:1',
        asset: { ledger: 'EVM', chainId: 'eip155:1', token: sourceAsset.token },
      }),
    ];
    expect(netAtomicFlow(events, 'owner', sourceAsset).toString()).toBe('5');
  });
});
