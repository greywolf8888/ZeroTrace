import {
  SafeJsonRpcTransport,
  SolanaLedgerAdapter,
  type SolanaTransactionRecord,
  type SolanaSnapshot,
} from '@zerotrace/chain-adapters';
import { createEvidence, EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import {
  analyzeSolanaTransactionSemantics,
  decodePumpLaunchpadInstructions,
  pumpLaunchpadProgramIds,
  SOLANA_PUMP_LAUNCHPAD_MODEL_VERSION,
} from '@zerotrace/platform-adapters';
import type { Evidence } from '@zerotrace/schemas';

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
    throw new Error('Solana anchor returned a non-Solana Snapshot.');
  }
  return anchor.snapshot;
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
  const requested = argument('--signature', process.env.PUMP_LAUNCHPAD_SMOKE_SIGNATURE);
  if (requested !== undefined) {
    if (!SIGNATURE_PATTERN.test(requested))
      throw new Error('--signature is not a valid Solana signature.');
    const transaction = await adapter.getTransaction(requested);
    if (transaction === null)
      throw new Error('The requested signature was not returned at finalized commitment.');
    return { signature: requested, transaction };
  }

  const requestedProgram = argument('--program-id');
  const programIds =
    requestedProgram === undefined
      ? pumpLaunchpadProgramIds()
      : pumpLaunchpadProgramIds().includes(requestedProgram)
        ? [requestedProgram]
        : (() => {
            throw new Error('--program-id must be a registered Pump or PumpSwap program.');
          })();
  const candidateLists = await Promise.all(
    programIds.map((programId) =>
      adapter.read<unknown>(
        'getSignaturesForAddress',
        [programId, { limit: 50, commitment: 'finalized' }],
        { cacheMode: 'bypass' },
      ),
    ),
  );
  const candidates = [...new Set(candidateLists.flatMap(signatureList))];
  for (const signature of candidates) {
    const transaction = await adapter.getTransaction(signature);
    if (transaction === null || transaction.success !== true) continue;
    const semantics = analyzeSolanaTransactionSemantics(transaction);
    if (semantics.programIds.some((programId) => pumpLaunchpadProgramIds().includes(programId))) {
      return { signature, transaction };
    }
  }
  throw new Error(
    'No successful finalized Pump/PumpSwap transaction was found in the bounded sample.',
  );
}

async function main(): Promise<void> {
  const rpcUrl =
    argument('--rpc-url', process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL) ?? DEFAULT_RPC_URL;
  const host = new URL(rpcUrl).hostname.toLowerCase();
  const adapter = new SolanaLedgerAdapter(
    { id: `pump-launchpad-live-smoke@${host}`, commitment: 'finalized', adapterVersion: '0.1.0' },
    new SafeJsonRpcTransport({
      endpointId: `pump-launchpad-live-smoke@${host}`,
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
      summary: 'Finalized Pump/PumpSwap transaction captured from the public Solana RPC.',
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
  const draft = decodePumpLaunchpadInstructions({
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
      'The selected finalized transaction did not contain a recognized Pump instruction.',
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
        source: `zerotrace:${SOLANA_PUMP_LAUNCHPAD_MODEL_VERSION}`,
        locator: `launchpad:${observation.platform}:${selected.signature}:${observation.instructionPath}@${snapshot.slot}`,
        payload: observation,
        blockOrSlot: snapshot.slot,
        finality: snapshot.commitment,
        summary: `Official ${observation.platform} ${observation.instructionName} discriminator decoded without enabling a write path.`,
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
      snapshot,
    );
    decoderEvidence.set(observation.instructionPath, evidence);
  }
  const observations = decodePumpLaunchpadInstructions({
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
  const replay = decodePumpLaunchpadInstructions({
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
  const programIds = [...new Set(observations.map((observation) => observation.programId))];
  const programIdentity = await Promise.all(
    programIds.map(async (programId) => {
      const account = await adapter.getAccountInfoObservation(programId, Number(snapshot.slot));
      return {
        programId,
        executable: account.value.value?.executable ?? false,
        owner: account.value.value?.owner ?? null,
        contextSlot: account.value.context.slot,
        requestedMinimumContextSlot: snapshot.slot,
      };
    }),
  );
  const providerHealth = await adapter.probe();
  console.log(
    JSON.stringify(
      {
        event: 'pump_launchpad_live_smoke_complete',
        signature: selected.signature,
        slot: snapshot.slot,
        snapshot,
        programIdentity,
        semantics: {
          execution: semantics.execution,
          programIds: semantics.programIds,
          recordingCoverage: semantics.recordingCoverage,
          accountResolutionComplete: semantics.accountResolutionComplete,
        },
        observations,
        replaySameHash:
          observations.length === replay.length &&
          observations.every(
            (observation, index) => observation.resultHash === replay[index]?.resultHash,
          ),
        evidenceCount: ledger.values().length,
        sourceSet: [
          ...new Set([adapter.sourceId, ...Object.keys(snapshot.providerVersions)]),
        ].sort(),
        providerHealth,
        resultHash: hashPayload(observations),
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
