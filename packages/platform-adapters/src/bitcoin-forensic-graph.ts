import { hashPayload } from '@zerotrace/evidence';
import type { BitcoinTransactionRecord } from '@zerotrace/chain-adapters';
import {
  BitcoinForensicCaseBundleSchema,
  BitcoinForensicEvidenceLineSchema,
  BitcoinForensicGraphEdgeSchema,
  BitcoinForensicGraphNodeSchema,
  BitcoinForensicGraphReportSchema,
  type AnalysisSnapshot,
  type BitcoinForensicGraphEdge,
  type BitcoinForensicGraphNode,
  type BitcoinForensicGraphReport,
  type KnowledgeReason,
  knownValue,
  unknownValue,
  type BitcoinTransactionEntityAnalysis,
} from '@zerotrace/schemas';
import { analyzeBitcoinTransactionEntity } from './bitcoin-transaction-entity.js';

export const BITCOIN_FORENSIC_GRAPH_MODEL_VERSION = 'bitcoin-forensic-graph-v1.0.0' as const;
export const BITCOIN_FORENSIC_GRAPH_POLICY_VERSION = 'bitcoin-forensic-policy-v1.0.0' as const;

type BitcoinSnapshot = NonNullable<Extract<AnalysisSnapshot, { ledger: 'BITCOIN' }>>;

export interface BuildBitcoinForensicGraphInput {
  rootTxids: readonly string[];
  transactions: readonly BitcoinTransactionRecord[];
  snapshotStart: BitcoinSnapshot;
  snapshotEnd: BitcoinSnapshot;
  evidenceIds: readonly string[];
  transactionEvidenceIds?: ReadonlyMap<string, readonly string[]>;
  sourceSet: readonly string[];
  dataCoverage?: number;
  sourceCoverage?: number;
  historyCoverage?: number;
  freshness?: string;
}

export interface BitcoinForensicGraphBuildResult {
  report: BitcoinForensicGraphReport;
  analyses: readonly BitcoinTransactionEntityAnalysis[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function assertSnapshot(snapshot: BitcoinSnapshot, field: string): void {
  if (snapshot.ledger !== 'BITCOIN' || snapshot.chainId !== 'bitcoin-mainnet') {
    throw new TypeError(`${field} must be a Bitcoin mainnet Snapshot.`);
  }
}

function snapshotPosition(snapshot: BitcoinSnapshot): bigint {
  return BigInt(snapshot.height);
}

function evidenceFor(txid: string, input: BuildBitcoinForensicGraphInput): string[] {
  const scoped = input.transactionEvidenceIds?.get(txid);
  const ids = scoped === undefined ? input.evidenceIds : scoped;
  const result = sortedUnique(ids);
  if (result.length === 0) throw new TypeError(`Transaction ${txid} requires Evidence IDs.`);
  return result;
}

function nodeId(kind: string, reference: string): string {
  return `${kind.toLowerCase()}:${reference}`;
}

function addNode(
  nodes: Map<string, BitcoinForensicGraphNode>,
  input: {
    id: string;
    kind: BitcoinForensicGraphNode['kind'];
    reference: string;
    evidenceIds: readonly string[];
    valueSats?: string;
    valueSatsUnknownReason?: KnowledgeReason;
    valueSatsUnknownDetail?: string;
    label?: string;
  },
): string {
  const existing = nodes.get(input.id);
  const evidenceIds = sortedUnique([...(existing?.evidenceIds ?? []), ...input.evidenceIds]);
  const node = BitcoinForensicGraphNodeSchema.parse({
    id: input.id,
    kind: input.kind,
    reference: input.reference,
    label:
      input.label === undefined
        ? unknownValue('NOT_QUERIED', 'No external label attribution was queried.')
        : knownValue(input.label),
    valueSats:
      input.valueSats === undefined
        ? unknownValue(
            input.valueSatsUnknownReason ?? 'NOT_APPLICABLE',
            input.valueSatsUnknownDetail ?? 'This node is not a single observed UTXO value.',
          )
        : knownValue(input.valueSats),
    evidenceIds,
  });
  nodes.set(input.id, node);
  return input.id;
}

function edgeId(value: Omit<BitcoinForensicGraphEdge, 'id'>): string {
  return `bge_${hashPayload({ schema: 'bitcoin-forensic-edge-v1', value }).slice(0, 24)}`;
}

function addEdge(
  edges: Map<string, BitcoinForensicGraphEdge>,
  input: Omit<BitcoinForensicGraphEdge, 'id'>,
): void {
  const id = edgeId(input);
  const edge = BitcoinForensicGraphEdgeSchema.parse({ ...input, id });
  const existing = edges.get(id);
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(edge)) {
    throw new TypeError(`Bitcoin forensic edge ${id} has conflicting definitions.`);
  }
  edges.set(id, edge);
}

function amount(valueSats: string) {
  return knownValue(valueSats);
}

function noAmount() {
  return unknownValue('NOT_APPLICABLE', 'The relationship is structural and has no single amount.');
}

function heuristicConfidence() {
  return knownValue(0.5);
}

function observedConfidence() {
  return knownValue(1);
}

function unknownConfidence() {
  return unknownValue(
    'PRECISION_UNSAFE',
    'The relationship is deliberately suppressed pending attribution.',
  );
}

function buildEvidenceLine(input: {
  graphId: string;
  edges: readonly BitcoinForensicGraphEdge[];
  snapshotStart: BitcoinSnapshot;
  snapshotEnd: BitcoinSnapshot;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage: number;
  freshness: string;
}): ReturnType<typeof BitcoinForensicEvidenceLineSchema.parse> {
  const phaseDefinitions = [
    { phase: 'FUNDING' as const, kinds: new Set(['FUNDING_PATH']) },
    {
      phase: 'FLOW' as const,
      kinds: new Set([
        'UTXO_FUNDING',
        'UTXO_SPEND',
        'COMMON_INPUT_CANDIDATE',
        'CHANGE_CANDIDATE',
        'PEELING_PATTERN',
        'FANOUT_PATTERN',
        'CONSOLIDATION_PATTERN',
      ]),
    },
    { phase: 'SETTLEMENT' as const, kinds: new Set(['SETTLEMENT_PATH']) },
    {
      phase: 'NEGATIVE' as const,
      kinds: new Set(['SERVICE_SUPPRESSED', 'COINJOIN_SUPPRESSED', 'PAYJOIN_UNKNOWN']),
    },
  ];
  const phases = phaseDefinitions.flatMap(({ phase, kinds }) => {
    const edges = input.edges.filter((edge) => kinds.has(edge.kind));
    if (edges.length === 0) return [];
    const evidenceIds = sortedUnique(edges.flatMap((edge) => edge.evidenceIds));
    return [
      {
        phase,
        edgeIds: edges.map((edge) => edge.id).sort(),
        evidenceIds,
        coverage: phase === 'NEGATIVE' ? 1 : input.dataCoverage,
        attributionStopped:
          phase === 'NEGATIVE' && edges.some((edge) => edge.kind === 'SERVICE_SUPPRESSED'),
      },
    ];
  });
  const terminalBoundary = phases.some((phase) => phase.attributionStopped)
    ? 'SERVICE_BOUNDARY'
    : phases.length === 0
      ? 'UNKNOWN'
      : 'NONE_OBSERVED';
  const value = {
    schemaVersion: 'bitcoin-forensic-evidence-line-v1' as const,
    graphId: input.graphId,
    phases,
    terminalBoundary,
    edgeIds: sortedUnique(phases.flatMap((phase) => phase.edgeIds)),
    evidenceIds: sortedUnique(input.evidenceIds),
    snapshotStart: input.snapshotStart,
    snapshotEnd: input.snapshotEnd,
    dataCoverage: input.dataCoverage,
    freshness: input.freshness,
    sourceSet: sortedUnique(input.sourceSet),
    modelVersion: BITCOIN_FORENSIC_GRAPH_MODEL_VERSION,
    confidence: unknownValue(
      'NOT_QUERIED',
      'Forensic graph confidence is not a calibrated probability of ownership.',
    ),
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage,
  };
  return BitcoinForensicEvidenceLineSchema.parse({
    ...value,
    resultHash: hashPayload(value),
  });
}

function buildCase(input: {
  graphId: string;
  evidenceLine: ReturnType<typeof BitcoinForensicEvidenceLineSchema.parse>;
  snapshot: BitcoinSnapshot;
}): ReturnType<typeof BitcoinForensicCaseBundleSchema.parse> {
  const value = {
    schemaVersion: 'bitcoin-forensic-case-v1' as const,
    graphId: input.graphId,
    ledger: 'BITCOIN' as const,
    chainId: 'bitcoin-mainnet' as const,
    evidenceLine: input.evidenceLine,
    automaticOwnershipMergeAllowed: false as const,
    evidenceIds: sortedUnique(input.evidenceLine.evidenceIds),
    snapshot: input.snapshot,
    modelVersion: BITCOIN_FORENSIC_GRAPH_MODEL_VERSION,
  };
  return BitcoinForensicCaseBundleSchema.parse({
    ...value,
    id: `bfc_${hashPayload({ schema: 'bitcoin-forensic-case-v1', value }).slice(0, 24)}`,
    resultHash: hashPayload(value),
  });
}

export function buildBitcoinForensicGraph(
  input: BuildBitcoinForensicGraphInput,
): BitcoinForensicGraphBuildResult {
  assertSnapshot(input.snapshotStart, 'snapshotStart');
  assertSnapshot(input.snapshotEnd, 'snapshotEnd');
  if (snapshotPosition(input.snapshotStart) > snapshotPosition(input.snapshotEnd)) {
    throw new TypeError('Bitcoin forensic graph snapshotStart cannot follow snapshotEnd.');
  }
  const rootTxids = sortedUnique(input.rootTxids.map((txid) => txid.toLowerCase()));
  const transactions = [...input.transactions].sort((left, right) =>
    left.txid.localeCompare(right.txid),
  );
  if (transactions.length === 0 || transactions.length > 100) {
    throw new TypeError('Bitcoin forensic graph requires between 1 and 100 transactions.');
  }
  const transactionIds = sortedUnique(transactions.map((transaction) => transaction.txid));
  if (rootTxids.some((txid) => !transactionIds.includes(txid))) {
    throw new TypeError('Every Bitcoin forensic graph root transaction must be captured.');
  }
  const evidenceIds = sortedUnique(input.evidenceIds);
  const sourceSet = sortedUnique(input.sourceSet);
  if (evidenceIds.length === 0) throw new TypeError('Bitcoin forensic graph requires Evidence.');
  if (sourceSet.length === 0) throw new TypeError('Bitcoin forensic graph requires a source set.');
  const analyses = transactions.map(analyzeBitcoinTransactionEntity);
  const analysisByTxid = new Map(analyses.map((analysis) => [analysis.txid, analysis]));
  const nodes = new Map<string, BitcoinForensicGraphNode>();
  const edges = new Map<string, BitcoinForensicGraphEdge>();
  const addTransaction = (txid: string, txEvidenceIds: readonly string[]) =>
    addNode(nodes, {
      id: nodeId('transaction', txid),
      kind: 'TRANSACTION',
      reference: txid,
      evidenceIds: txEvidenceIds,
    });
  const addOutpoint = (
    txid: string,
    vout: number,
    valueSats: string | undefined,
    txEvidenceIds: readonly string[],
    valueSatsUnknownReason?: KnowledgeReason,
    valueSatsUnknownDetail?: string,
  ) =>
    addNode(nodes, {
      id: nodeId('outpoint', `${txid}:${vout}`),
      kind: 'OUTPOINT',
      reference: `${txid}:${vout}`,
      ...(valueSats === undefined
        ? {
            ...(valueSatsUnknownReason === undefined ? {} : { valueSatsUnknownReason }),
            ...(valueSatsUnknownDetail === undefined ? {} : { valueSatsUnknownDetail }),
          }
        : { valueSats }),
      evidenceIds: txEvidenceIds,
    });
  const addAddress = (address: string, txEvidenceIds: readonly string[]) =>
    addNode(nodes, {
      id: nodeId('address', address),
      kind: 'ADDRESS',
      reference: address,
      evidenceIds: txEvidenceIds,
    });
  const unknownServiceNode = 'unknown:service-attribution';
  const unknownCoinjoinNode = 'unknown:coinjoin-or-mixing';
  const unknownPayjoinNode = 'unknown:payjoin';

  for (const transaction of transactions) {
    const txEvidenceIds = evidenceFor(transaction.txid, input);
    const txNode = addTransaction(transaction.txid, txEvidenceIds);
    const analysis = analysisByTxid.get(transaction.txid);
    if (analysis === undefined) throw new TypeError(`Missing analysis for ${transaction.txid}.`);
    transaction.outputs.forEach((output, vout) => {
      const outpointNode = addOutpoint(transaction.txid, vout, output.valueSats, txEvidenceIds);
      addEdge(edges, {
        from: txNode,
        to: outpointNode,
        kind: 'UTXO_FUNDING',
        classification: 'OBSERVED',
        amountSats: amount(output.valueSats),
        confidence: observedConfidence(),
        evidenceIds: txEvidenceIds,
        reason: 'Observed transaction output creates this UTXO outpoint.',
        automaticOwnershipMergeAllowed: false,
      });
      if (output.address !== undefined) {
        const addressNode = addAddress(output.address, txEvidenceIds);
        addEdge(edges, {
          from: outpointNode,
          to: addressNode,
          kind: 'SETTLEMENT_PATH',
          classification: 'OBSERVED',
          amountSats: amount(output.valueSats),
          confidence: observedConfidence(),
          evidenceIds: txEvidenceIds,
          reason: 'Esplora script-derived output address is observed; it is not an entity merge.',
          automaticOwnershipMergeAllowed: false,
        });
      }
    });
    transaction.inputs.forEach((inputRecord) => {
      if (
        inputRecord.coinbase ||
        inputRecord.previousTxid === undefined ||
        inputRecord.previousVout === undefined
      )
        return;
      const previousNode = addOutpoint(
        inputRecord.previousTxid,
        Number(inputRecord.previousVout),
        inputRecord.previousOutput?.valueSats,
        txEvidenceIds,
        'INSUFFICIENT_DATA',
        'Previous output value is unavailable; the graph does not substitute numeric zero.',
      );
      addEdge(edges, {
        from: previousNode,
        to: txNode,
        kind: 'UTXO_SPEND',
        classification: 'OBSERVED',
        amountSats:
          inputRecord.previousOutput === undefined
            ? unknownValue('INSUFFICIENT_DATA', 'Prevout value is unavailable.')
            : amount(inputRecord.previousOutput.valueSats),
        confidence:
          inputRecord.previousOutput === undefined ? unknownConfidence() : observedConfidence(),
        evidenceIds: txEvidenceIds,
        reason: 'Transaction input references this previous outpoint.',
        automaticOwnershipMergeAllowed: false,
      });
      if (inputRecord.previousOutput?.address !== undefined) {
        const addressNode = addAddress(inputRecord.previousOutput.address, txEvidenceIds);
        addEdge(edges, {
          from: addressNode,
          to: previousNode,
          kind: 'FUNDING_PATH',
          classification: 'OBSERVED',
          amountSats: amount(inputRecord.previousOutput.valueSats),
          confidence: observedConfidence(),
          evidenceIds: txEvidenceIds,
          reason: 'Previous-output script address is observed as a funding-path representation.',
          automaticOwnershipMergeAllowed: false,
        });
      }
    });

    if (analysis.commonInputHeuristic.state === 'known' && analysis.commonInputHeuristic.value) {
      const candidateAddresses =
        analysis.commonInputOwnershipCandidate.state === 'known'
          ? analysis.commonInputOwnershipCandidate.value
          : [];
      for (const address of candidateAddresses) {
        const addressNode = addAddress(address, txEvidenceIds);
        addEdge(edges, {
          from: addressNode,
          to: txNode,
          kind: 'COMMON_INPUT_CANDIDATE',
          classification: 'HEURISTIC_CANDIDATE',
          amountSats: noAmount(),
          confidence: heuristicConfidence(),
          evidenceIds: txEvidenceIds,
          reason:
            'Common-input heuristic is a candidate only; automatic ownership merge remains disabled.',
          automaticOwnershipMergeAllowed: false,
        });
      }
    }
    for (const candidate of analysis.changeCandidates) {
      if (candidate.address.state !== 'known') continue;
      const addressNode = addAddress(candidate.address.value, txEvidenceIds);
      addEdge(edges, {
        from: txNode,
        to: addressNode,
        kind: 'CHANGE_CANDIDATE',
        classification: 'HEURISTIC_CANDIDATE',
        amountSats: amount(candidate.valueSats),
        confidence: heuristicConfidence(),
        evidenceIds: txEvidenceIds,
        reason:
          'Script-type and value structure suggests change; PayJoin and service attribution remain unresolved.',
        automaticOwnershipMergeAllowed: false,
      });
    }
    if (analysis.structuralPattern === 'EQUAL_OUTPUT_COINJOIN_LIKE') {
      addNode(nodes, {
        id: unknownCoinjoinNode,
        kind: 'UNKNOWN',
        reference: 'coinjoin-or-mixing',
        evidenceIds: txEvidenceIds,
      });
      addEdge(edges, {
        from: txNode,
        to: unknownCoinjoinNode,
        kind: 'COINJOIN_SUPPRESSED',
        classification: 'SUPPRESSED',
        amountSats: noAmount(),
        confidence: unknownConfidence(),
        evidenceIds: txEvidenceIds,
        reason:
          'Equal-output CoinJoin-like structure suppresses common-input and change attribution.',
        automaticOwnershipMergeAllowed: false,
      });
    }
    if (analysis.serviceClusterRisk.state !== 'known') {
      addNode(nodes, {
        id: unknownServiceNode,
        kind: 'UNKNOWN',
        reference: 'service-attribution',
        evidenceIds: txEvidenceIds,
      });
      addEdge(edges, {
        from: txNode,
        to: unknownServiceNode,
        kind: 'SERVICE_SUPPRESSED',
        classification: 'SUPPRESSED',
        amountSats: noAmount(),
        confidence: unknownConfidence(),
        evidenceIds: txEvidenceIds,
        reason:
          'Exchange, mixer, custodian, and service labels were not queried; attribution stops here.',
        automaticOwnershipMergeAllowed: false,
      });
    }
    if (analysis.payjoinContaminationRisk.state !== 'known') {
      addNode(nodes, {
        id: unknownPayjoinNode,
        kind: 'UNKNOWN',
        reference: 'payjoin',
        evidenceIds: txEvidenceIds,
      });
      addEdge(edges, {
        from: txNode,
        to: unknownPayjoinNode,
        kind: 'PAYJOIN_UNKNOWN',
        classification: 'UNKNOWN',
        amountSats: noAmount(),
        confidence: unknownConfidence(),
        evidenceIds: txEvidenceIds,
        reason: 'Final transaction structure cannot exclude BIP78 PayJoin negotiation.',
        automaticOwnershipMergeAllowed: false,
      });
    }
    const spendableOutputs = transaction.outputs.filter(
      (output) => output.scriptType !== 'op_return',
    );
    if (spendableOutputs.length >= 10 && spendableOutputs.length >= transaction.inputs.length * 2) {
      for (const [vout, output] of transaction.outputs.entries()) {
        if (output.scriptType === 'op_return') continue;
        const outpointNode = nodeId('outpoint', `${transaction.txid}:${vout}`);
        addEdge(edges, {
          from: txNode,
          to: outpointNode,
          kind: 'FANOUT_PATTERN',
          classification: 'HEURISTIC_CANDIDATE',
          amountSats: amount(output.valueSats),
          confidence: heuristicConfidence(),
          evidenceIds: txEvidenceIds,
          reason: 'Many spendable outputs relative to inputs indicate fanout or batching risk.',
          automaticOwnershipMergeAllowed: false,
        });
      }
    }
    if (!analysis.coinbase && transaction.inputs.length >= 3 && spendableOutputs.length <= 2) {
      for (const inputRecord of transaction.inputs) {
        if (
          inputRecord.coinbase ||
          inputRecord.previousTxid === undefined ||
          inputRecord.previousVout === undefined
        )
          continue;
        const previousNode = nodeId(
          'outpoint',
          `${inputRecord.previousTxid}:${Number(inputRecord.previousVout)}`,
        );
        addEdge(edges, {
          from: previousNode,
          to: txNode,
          kind: 'CONSOLIDATION_PATTERN',
          classification: 'HEURISTIC_CANDIDATE',
          amountSats:
            inputRecord.previousOutput === undefined
              ? noAmount()
              : amount(inputRecord.previousOutput.valueSats),
          confidence: heuristicConfidence(),
          evidenceIds: txEvidenceIds,
          reason:
            'Multiple observed inputs converging on few outputs indicate consolidation; ownership is not inferred.',
          automaticOwnershipMergeAllowed: false,
        });
      }
    }
  }

  const spendingByOutpoint = new Map<string, string>();
  for (const transaction of transactions) {
    for (const inputRecord of transaction.inputs) {
      if (
        inputRecord.coinbase ||
        inputRecord.previousTxid === undefined ||
        inputRecord.previousVout === undefined
      )
        continue;
      spendingByOutpoint.set(
        `${inputRecord.previousTxid}:${Number(inputRecord.previousVout)}`,
        transaction.txid,
      );
    }
  }
  for (const transaction of transactions) {
    const txEvidenceIds = evidenceFor(transaction.txid, input);
    const spendableOutputs = transaction.outputs.filter(
      (output) => output.scriptType !== 'op_return',
    );
    if (transaction.inputs.length !== 1 || spendableOutputs.length < 2) continue;
    for (const [vout] of transaction.outputs.entries()) {
      const nextTxid = spendingByOutpoint.get(`${transaction.txid}:${vout}`);
      if (nextTxid === undefined || nextTxid === transaction.txid) continue;
      addEdge(edges, {
        from: nodeId('transaction', transaction.txid),
        to: nodeId('transaction', nextTxid),
        kind: 'PEELING_PATTERN',
        classification: 'HEURISTIC_CANDIDATE',
        amountSats: amount(transaction.outputs[vout]!.valueSats),
        confidence: heuristicConfidence(),
        evidenceIds: sortedUnique([...txEvidenceIds, ...evidenceFor(nextTxid, input)]),
        reason:
          'A single-input transaction has a spendable output that continues into another captured transaction.',
        automaticOwnershipMergeAllowed: false,
      });
    }
  }

  const sortedEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const dataCoverage = Math.max(0, Math.min(1, input.dataCoverage ?? 1));
  const sourceCoverage = Math.max(0, Math.min(1, input.sourceCoverage ?? 1));
  const historyCoverage = Math.max(0, Math.min(1, input.historyCoverage ?? 0));
  const freshness = new Date(input.freshness ?? input.snapshotEnd.capturedAt);
  if (Number.isNaN(freshness.getTime()))
    throw new TypeError('Bitcoin forensic graph freshness is invalid.');
  const freshnessIso = freshness.toISOString();
  const base = {
    schemaVersion: 'bitcoin-forensic-graph-v1' as const,
    ledger: 'BITCOIN' as const,
    chainId: 'bitcoin-mainnet' as const,
    rootTxids,
    transactionIds,
    nodes: sortedNodes,
    edges: sortedEdges,
    transactionAnalyses: analyses,
    suppressionReasons: sortedUnique(
      analyses.flatMap((analysis) => analysis.suppressionReasons),
    ) as BitcoinForensicGraphReport['suppressionReasons'],
    snapshotStart: input.snapshotStart,
    snapshotEnd: input.snapshotEnd,
    dataCoverage,
    sourceCoverage,
    historyCoverage,
    freshness: freshnessIso,
    sourceSet,
    modelVersion: BITCOIN_FORENSIC_GRAPH_MODEL_VERSION,
    policyVersion: BITCOIN_FORENSIC_GRAPH_POLICY_VERSION,
    confidence: unknownValue(
      'NOT_QUERIED',
      'Graph relationships include heuristics and suppressed attribution; no calibrated ownership probability is claimed.',
    ),
    automaticOwnershipMergeAllowed: false as const,
    evidenceIds,
  };
  const graphId = `bfg_${hashPayload({ schema: 'bitcoin-forensic-graph-v1', value: base }).slice(0, 24)}`;
  const evidenceLine = buildEvidenceLine({
    graphId,
    edges: sortedEdges,
    snapshotStart: input.snapshotStart,
    snapshotEnd: input.snapshotEnd,
    evidenceIds,
    sourceSet,
    dataCoverage,
    sourceCoverage,
    historyCoverage,
    freshness: freshnessIso,
  });
  const caseBundle = buildCase({ graphId, evidenceLine, snapshot: input.snapshotEnd });
  const reportValue = { ...base, id: graphId, case: caseBundle };
  const report = BitcoinForensicGraphReportSchema.parse({
    ...reportValue,
    resultHash: hashPayload(reportValue),
  });
  return { report, analyses };
}
