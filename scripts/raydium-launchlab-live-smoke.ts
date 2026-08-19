import {
  SafeJsonRpcTransport,
  SolanaLedgerAdapter,
  type SolanaSnapshot,
  type SolanaTransactionRecord,
} from '@zerotrace/chain-adapters';
import { createEvidence, EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  analyzeSolanaTransactionSemantics,
  decodeRaydiumLaunchlabInstructions,
  inspectRaydiumLaunchlabPoolState,
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION,
} from '@zerotrace/platform-adapters';
import type { AnalysisSnapshot, Evidence } from '@zerotrace/schemas';

const DEFAULT_RPC_URL = 'https://api.mainnet.solana.com';
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function signatureList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const signature = (item as { signature?: unknown }).signature;
    return typeof signature === 'string' && SIGNATURE_PATTERN.test(signature) ? [signature] : [];
  });
}

function snapshotFromAnchor(
  anchor: Awaited<ReturnType<SolanaLedgerAdapter['readAnchorAt']>>,
): SolanaSnapshot {
  if (anchor.snapshot.ledger !== 'SOLANA') {
    throw new Error('Raydium LaunchLab anchor returned a non-Solana Snapshot.');
  }
  return anchor.snapshot;
}

function optionalSolanaSnapshot(snapshot: AnalysisSnapshot | undefined) {
  if (snapshot === undefined) return undefined;
  if (snapshot.ledger !== 'SOLANA') {
    throw new Error('Raydium LaunchLab Evidence must be bound to a Solana Snapshot.');
  }
  return snapshot;
}

function addEvidence(
  ledger: EvidenceLedger,
  evidence: Evidence,
  sourceEvidenceIds: readonly string[] = [],
  snapshot?: SolanaSnapshot,
): Evidence {
  return ledger.add(evidence, sourceEvidenceIds, snapshot).evidence;
}

async function chooseSignature(adapter: SolanaLedgerAdapter): Promise<{
  signature: string;
  transaction: SolanaTransactionRecord;
}> {
  const requested = argument('--signature', process.env.RAYDIUM_LAUNCHLAB_SMOKE_SIGNATURE);
  if (requested !== undefined) {
    if (!SIGNATURE_PATTERN.test(requested)) {
      throw new Error('--signature is not a valid Solana signature.');
    }
    const transaction = await adapter.getTransaction(requested);
    if (transaction === null) {
      throw new Error('The requested signature was not returned at finalized commitment.');
    }
    const semantics = analyzeSolanaTransactionSemantics(transaction);
    if (!semantics.programIds.includes(RAYDIUM_LAUNCHLAB_PROGRAM_ID)) {
      throw new Error('The requested signature does not invoke the Raydium LaunchLab program.');
    }
    return { signature: requested, transaction };
  }

  const candidates = signatureList(
    await adapter.read<unknown>(
      'getSignaturesForAddress',
      [RAYDIUM_LAUNCHLAB_PROGRAM_ID, { limit: 50, commitment: 'finalized' }],
      { cacheMode: 'bypass' },
    ),
  );
  for (const signature of candidates) {
    const transaction = await adapter.getTransaction(signature);
    if (transaction === null || transaction.success !== true) continue;
    const semantics = analyzeSolanaTransactionSemantics(transaction);
    if (semantics.programIds.includes(RAYDIUM_LAUNCHLAB_PROGRAM_ID)) {
      return { signature, transaction };
    }
  }
  throw new Error(
    'No successful finalized Raydium LaunchLab transaction was found in the bounded sample.',
  );
}

async function main(): Promise<void> {
  const rpcUrl =
    argument('--rpc-url', process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL) ?? DEFAULT_RPC_URL;
  const host = new URL(rpcUrl).hostname.toLowerCase();
  const adapter = new SolanaLedgerAdapter(
    {
      id: `raydium-launchlab-live-smoke@${host}`,
      commitment: 'finalized',
      adapterVersion: '0.1.0',
    },
    new SafeJsonRpcTransport({
      endpointId: `raydium-launchlab-live-smoke@${host}`,
      baseUrl: rpcUrl,
      policy: {
        allowedHosts: [host],
        allowPrivateNetworks: false,
        allowHttpForPrivateNetworks: false,
      },
      timeoutMs: 30_000,
      maxResponseBytes: 64 * 1024 * 1024,
      resilience: {
        maxAttempts: 3,
        retryBaseDelayMs: 150,
        retryMaxDelayMs: 1_500,
        requestsPerSecond: 4,
        circuitFailureThreshold: 4,
        circuitResetMs: 30_000,
      },
    }),
  );
  const selected = await chooseSignature(adapter);
  const anchor = await adapter.readAnchorAt(selected.transaction.slot);
  const snapshot = snapshotFromAnchor(anchor);
  const semantics = analyzeSolanaTransactionSemantics(selected.transaction);
  const ledger = new EvidenceLedger();
  const transactionEvidence = addEvidence(
    ledger,
    createEvidence({
      ledger: 'SOLANA',
      chainId: snapshot.chainId,
      kind: 'TRANSACTION',
      source: adapter.sourceId,
      locator: `transaction:${selected.signature}@${snapshot.slot}`,
      payload: selected.transaction.raw,
      blockOrSlot: snapshot.slot,
      finality: snapshot.commitment,
      summary: 'Finalized Raydium LaunchLab transaction captured from the public Solana RPC.',
    }),
    [],
    snapshot,
  );
  const instructionEvidenceByPath = new Map<string, Evidence>();
  for (const instruction of [...semantics.outerInstructions, ...semantics.innerInstructions]) {
    const evidence = addEvidence(
      ledger,
      createEvidence({
        ledger: 'SOLANA',
        chainId: snapshot.chainId,
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:solana-transaction-semantics-v1.1.0',
        locator: `instruction:${selected.signature}:${instruction.path}@${snapshot.slot}`,
        payload: instruction,
        blockOrSlot: snapshot.slot,
        finality: snapshot.commitment,
        summary: `Normalized finalized Solana instruction ${instruction.path}.`,
        sourceEvidenceIds: [transactionEvidence.id],
      }),
      [transactionEvidence.id],
      snapshot,
    );
    instructionEvidenceByPath.set(instruction.path, evidence);
  }
  const draft = decodeRaydiumLaunchlabInstructions({
    transaction: selected.transaction,
    semantics,
    snapshot,
    evidenceIdsForInstruction: (path) => {
      const instructionEvidence = instructionEvidenceByPath.get(path);
      return instructionEvidence === undefined
        ? [transactionEvidence.id]
        : [transactionEvidence.id, instructionEvidence.id];
    },
  });
  if (draft.length === 0) {
    throw new Error(
      'The selected finalized transaction did not contain a recognized Raydium instruction.',
    );
  }
  const decoderEvidence = new Map<string, Evidence>();
  for (const observation of draft) {
    const instructionEvidence = instructionEvidenceByPath.get(observation.instructionPath);
    const sourceEvidenceIds = [
      transactionEvidence.id,
      ...(instructionEvidence === undefined ? [] : [instructionEvidence.id]),
    ];
    const evidence = addEvidence(
      ledger,
      createEvidence({
        ledger: 'SOLANA',
        chainId: snapshot.chainId,
        kind: 'DERIVED_FEATURE',
        source: `zerotrace:${SOLANA_RAYDIUM_LAUNCHLAB_MODEL_VERSION}`,
        locator: `launchpad:${observation.platform}:${selected.signature}:${observation.instructionPath}@${snapshot.slot}`,
        payload: observation,
        blockOrSlot: snapshot.slot,
        finality: snapshot.commitment,
        summary: `Official ${observation.platform} ${observation.instructionName} decoded without enabling a write path.`,
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
      snapshot,
    );
    decoderEvidence.set(observation.instructionPath, evidence);
  }
  const observations = decodeRaydiumLaunchlabInstructions({
    transaction: selected.transaction,
    semantics,
    snapshot,
    evidenceIdsForInstruction: (path) => {
      const instructionEvidence = instructionEvidenceByPath.get(path);
      const derived = decoderEvidence.get(path);
      return [
        transactionEvidence.id,
        ...(instructionEvidence === undefined ? [] : [instructionEvidence.id]),
        ...(derived === undefined ? [] : [derived.id]),
      ];
    },
  });
  const poolAddresses = [
    ...new Set(
      observations.flatMap((observation) =>
        observation.accounts
          .filter((account) => account.name === 'pool_state' && account.address !== undefined)
          .map((account) => account.address!),
      ),
    ),
  ].sort();
  const poolStates = await Promise.all(
    poolAddresses.map((account) =>
      inspectRaydiumLaunchlabPoolState({
        account,
        requestedSlot: snapshot.slot,
        adapter,
        writeEvidence: async (evidence, sourceEvidenceIds = [], boundSnapshot) =>
          addEvidence(ledger, evidence, sourceEvidenceIds, optionalSolanaSnapshot(boundSnapshot)),
      }),
    ),
  );
  const programIdentity = await adapter.getAccountInfoObservation(
    RAYDIUM_LAUNCHLAB_PROGRAM_ID,
    Number(snapshot.slot),
  );
  const providerHealth = await adapter.probe();
  const replay = decodeRaydiumLaunchlabInstructions({
    transaction: selected.transaction,
    semantics,
    snapshot,
    evidenceIdsForInstruction: (path) => {
      const instructionEvidence = instructionEvidenceByPath.get(path);
      const derived = decoderEvidence.get(path);
      return [
        transactionEvidence.id,
        ...(instructionEvidence === undefined ? [] : [instructionEvidence.id]),
        ...(derived === undefined ? [] : [derived.id]),
      ];
    },
  });
  const replaySameHash =
    observations.length === replay.length &&
    observations.every(
      (observation, index) => observation.resultHash === replay[index]?.resultHash,
    );
  const result = {
    signature: selected.signature,
    slot: snapshot.slot,
    snapshot,
    programIdentity: {
      programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
      executable: programIdentity.value.value?.executable ?? false,
      owner: programIdentity.value.value?.owner ?? null,
      contextSlot: programIdentity.value.context.slot,
      requestedMinimumContextSlot: snapshot.slot,
    },
    observations,
    poolStates,
    replaySameHash,
    evidenceCount: ledger.values().length,
    sourceSet: [...new Set([adapter.sourceId, ...Object.keys(snapshot.providerVersions)])].sort(),
    providerHealth,
  };
  console.log(
    JSON.stringify(
      {
        event: 'raydium_launchlab_live_smoke_complete',
        ...result,
        resultHash: hashPayload(result),
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
