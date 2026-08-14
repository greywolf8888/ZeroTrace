import {
  BitcoinUtxoLedgerAdapter,
  SafeRestTransport,
  type BitcoinTransactionRecord,
  type ChainAnchorRead,
} from '@zerotrace/chain-adapters';
import { EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import { captureBitcoinForensicGraph } from '../apps/api/src/bitcoin-forensic-graph.js';
import type { AnalysisSnapshot, Evidence } from '@zerotrace/schemas';

const DEFAULT_ESPLORA_URL = 'https://blockstream.info/api';
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function requiredTxid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!TXID_PATTERN.test(normalized)) throw new Error(`${field} must be a 32-byte txid.`);
  return normalized;
}

function requiredBlockHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!TXID_PATTERN.test(normalized)) throw new Error('Esplora returned an invalid block hash.');
  return normalized;
}

function requiredTxids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50_000) {
    throw new Error('Esplora returned an invalid tip block transaction list.');
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`Tip transaction ${index} is not a txid.`);
    return requiredTxid(item, `Tip transaction ${index}`);
  });
}

function createAdapter(esploraUrl: string): {
  adapter: BitcoinUtxoLedgerAdapter;
  transport: SafeRestTransport;
} {
  const host = new URL(esploraUrl).hostname.toLowerCase();
  const endpointId = `bitcoin-forensic-live-smoke@${host}`;
  const transport = new SafeRestTransport({
    endpointId,
    baseUrl: esploraUrl,
    policy: {
      allowedHosts: [host],
      allowPrivateNetworks: false,
      allowHttpForPrivateNetworks: false,
    },
    timeoutMs: 30_000,
    maxResponseBytes: 32 * 1024 * 1024,
    resilience: {
      maxAttempts: 3,
      retryBaseDelayMs: 150,
      retryMaxDelayMs: 1_500,
      requestsPerSecond: 4,
      circuitFailureThreshold: 4,
      circuitResetMs: 30_000,
    },
  });
  return {
    adapter: new BitcoinUtxoLedgerAdapter({ id: endpointId, adapterVersion: '0.1.0' }, transport),
    transport,
  };
}

async function discoverTransaction(
  transport: SafeRestTransport,
): Promise<{ tipHash: string; transactionId: string }> {
  const tipHash = requiredBlockHash(
    await transport.getText('/blocks/tip/hash', { cacheMode: 'bypass' }),
  );
  const txids = requiredTxids(
    await transport.getJson<unknown>(`/block/${tipHash}/txids`, { cacheMode: 'bypass' }),
  );
  const transactionId = txids.find((txid) => txid !== txids[0]);
  if (transactionId === undefined) {
    throw new Error('The current tip block has no non-coinbase transaction in the bounded list.');
  }
  return { tipHash, transactionId };
}

function writer(ledger: EvidenceLedger) {
  return async (
    evidence: Evidence,
    sourceEvidenceIds: readonly string[] = [],
    snapshot?: AnalysisSnapshot,
  ): Promise<Evidence> => ledger.add(evidence, sourceEvidenceIds, snapshot).evidence;
}

function frozenAdapter(input: {
  head: ChainAnchorRead;
  transaction: BitcoinTransactionRecord;
  transactionEndpointId: string;
  block: ChainAnchorRead;
}): BitcoinUtxoLedgerAdapter {
  return {
    async readHeadAnchor() {
      return input.head;
    },
    async getTransactionObservation() {
      return { value: input.transaction, endpointId: input.transactionEndpointId };
    },
    async readAnchorAt() {
      return input.block;
    },
  } as unknown as BitcoinUtxoLedgerAdapter;
}

async function main(): Promise<void> {
  const esploraUrl =
    argument('--esplora-url', process.env.BTC_ESPLORA_URL ?? DEFAULT_ESPLORA_URL) ??
    DEFAULT_ESPLORA_URL;
  const { adapter, transport } = createAdapter(esploraUrl);
  const requestedTransaction = argument(
    '--transaction',
    process.env.BITCOIN_FORENSIC_SMOKE_TRANSACTION,
  );
  const discovered =
    requestedTransaction === undefined ? await discoverTransaction(transport) : undefined;
  const transactionId = requiredTxid(
    requestedTransaction ?? discovered!.transactionId,
    '--transaction',
  );
  const liveLedger = new EvidenceLedger();
  const live = await captureBitcoinForensicGraph({
    adapter,
    request: { transactionIds: [transactionId] },
    writeEvidence: writer(liveLedger),
  });

  const frozenHead = await adapter.readHeadAnchor();
  const frozenTransaction = await adapter.getTransactionObservation(transactionId);
  const blockHeight = frozenTransaction.value.status.blockHeight;
  if (blockHeight === undefined) throw new Error('Confirmed transaction is missing block height.');
  const frozenBlock = await adapter.readAnchorAt(blockHeight);
  const replayAdapter = frozenAdapter({
    head: frozenHead,
    transaction: frozenTransaction.value,
    transactionEndpointId: frozenTransaction.endpointId,
    block: frozenBlock,
  });
  const firstReplayLedger = new EvidenceLedger();
  const firstReplay = await captureBitcoinForensicGraph({
    adapter: replayAdapter,
    request: { transactionIds: [transactionId] },
    writeEvidence: writer(firstReplayLedger),
  });
  const secondReplayLedger = new EvidenceLedger();
  const secondReplay = await captureBitcoinForensicGraph({
    adapter: replayAdapter,
    request: { transactionIds: [transactionId] },
    writeEvidence: writer(secondReplayLedger),
  });
  const providerHealth = await adapter.probe();
  const replaySameHash = secondReplay.report.resultHash === firstReplay.report.resultHash;
  if (!replaySameHash)
    throw new Error('Frozen Bitcoin forensic graph replay was not deterministic.');

  console.log(
    JSON.stringify(
      {
        event: 'bitcoin_forensic_graph_live_smoke_complete',
        transactionId,
        discoveredTipHash: discovered?.tipHash ?? null,
        live: {
          reportId: live.report.id,
          resultHash: live.report.resultHash,
          snapshotStart: live.report.snapshotStart,
          snapshotEnd: live.report.snapshotEnd,
          transactionCount: live.sourceSummary.transactionCount,
          evidenceCount: live.evidence.length,
          nodeCount: live.report.nodes.length,
          edgeCount: live.report.edges.length,
          suppressionReasons: live.report.suppressionReasons,
        },
        frozenReplay: {
          reportId: firstReplay.report.id,
          resultHash: firstReplay.report.resultHash,
          sameHash: replaySameHash,
          evidenceCount: firstReplay.evidence.length,
          snapshot: firstReplay.report.snapshotEnd,
        },
        sourceSet: live.sourceSummary.sourceSet,
        providerHealth,
        transport: transport.diagnostics(),
        resultHash: hashPayload({
          live: live.report.resultHash,
          replay: firstReplay.report.resultHash,
          replaySameHash,
        }),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
