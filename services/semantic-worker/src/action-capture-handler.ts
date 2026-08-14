import { SQD_DATASETS, type SqdDataset } from '@zerotrace/chain-adapters';
import {
  RAW_LEDGER_ACTION_ADAPTER_VERSION,
  buildActionSemanticsFromRawFacts,
} from '@zerotrace/action-semantics';
import { CaptureExecutionError, type CaptureHandler } from '@zerotrace/capture-scheduler';
import { hashPayload, type EvidenceNode } from '@zerotrace/evidence';
import {
  ActionSemanticsTransactionCaptureParametersSchema,
  type AnalysisSnapshot,
  type CaptureRun,
  type CaptureRunSuccess,
  type RawChainFact,
} from '@zerotrace/schemas';
import type {
  ClickHouseRawFactRepository,
  PostgresActionSemanticsReportRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
} from '@zerotrace/storage';

export const ACTION_SEMANTICS_CAPTURE_HANDLER_VERSION =
  'action-semantics-transaction-capture-handler-v0.1.0';

export interface ActionSemanticsCaptureResources {
  facts: Pick<ClickHouseRawFactRepository, 'listTransactionFacts'>;
  ingestion: Pick<PostgresIngestionCheckpointRepository, 'findCompletedCoverage'>;
  evidence: Pick<PostgresEvidenceRepository, 'get' | 'put'>;
  reports: Pick<PostgresActionSemanticsReportRepository, 'put'>;
}

function position(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'EVM'
    ? snapshot.blockNumber
    : snapshot.ledger === 'BITCOIN'
      ? snapshot.height
      : snapshot.slot;
}

function canonicalChainId(ledger: CaptureRun['target']['ledger'], chainId: string): string {
  if (ledger !== 'EVM') return chainId;
  return chainId.startsWith('eip155:') ? chainId : `eip155:${chainId}`;
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function profileHasCompleteTransactionRecords(
  query: Readonly<Record<string, unknown>>,
  dataset: SqdDataset,
): boolean {
  const materialize = object(query.materialize);
  const fields = object(query.fields);
  const transactionFields = object(fields?.transaction);
  if (
    query.schema !== 'sqd-finalized-ingestion-v4' ||
    query.dataset !== dataset ||
    query.includeAllBlocks !== true ||
    materialize?.blocks !== true ||
    materialize.transactions !== true ||
    transactionFields?.transactionIndex !== true
  ) {
    return false;
  }
  if (SQD_DATASETS[dataset].ledger === 'EVM') {
    return (
      materialize.logs === true && materialize.traces === true && materialize.stateDiffs === true
    );
  }
  if (SQD_DATASETS[dataset].ledger === 'BITCOIN') {
    return materialize.inputs === true && materialize.outputs === true;
  }
  return (
    materialize.instructions === true &&
    materialize.logs === true &&
    materialize.balances === true &&
    materialize.tokenBalances === true
  );
}

function exactSnapshot(nodes: readonly EvidenceNode[]): AnalysisSnapshot {
  const first = nodes[0]?.snapshot;
  if (first === undefined) {
    throw new CaptureExecutionError(
      'ACTION_EVIDENCE_SNAPSHOT_MISSING',
      'Raw transaction Evidence does not carry a durable Snapshot.',
      false,
    );
  }
  const expected = hashPayload(first);
  if (
    nodes.some((node) => node.snapshot === undefined || hashPayload(node.snapshot) !== expected)
  ) {
    throw new CaptureExecutionError(
      'ACTION_EVIDENCE_SNAPSHOT_CONFLICT',
      'Raw transaction Evidence spans more than one Snapshot.',
      false,
    );
  }
  return first;
}

async function loadEvidence(
  facts: readonly RawChainFact[],
  repository: ActionSemanticsCaptureResources['evidence'],
): Promise<EvidenceNode[]> {
  const nodes = await Promise.all(facts.map((fact) => repository.get(fact.evidenceId)));
  if (nodes.some((node) => node === undefined)) {
    throw new CaptureExecutionError(
      'ACTION_EVIDENCE_MISSING',
      'A raw transaction fact references missing durable Evidence.',
      false,
    );
  }
  return nodes as EvidenceNode[];
}

function safeFailure(error: unknown): CaptureExecutionError {
  if (error instanceof CaptureExecutionError) return error;
  const shaped = object(error);
  const code =
    typeof shaped?.code === 'string' && /^[A-Z0-9_:-]{1,160}$/.test(shaped.code)
      ? shaped.code
      : 'ACTION_SEMANTICS_CAPTURE_FAILED';
  const retryable = shaped?.retryable === true;
  const message = error instanceof Error ? error.message : 'Action Semantics capture failed.';
  return new CaptureExecutionError(code, message, retryable, error);
}

export function createActionSemanticsTransactionCaptureHandler(
  resources: ActionSemanticsCaptureResources,
): CaptureHandler {
  return async (run: CaptureRun): Promise<CaptureRunSuccess> => {
    try {
      if (
        run.captureKind !== 'TRANSACTION' ||
        run.operation !== 'READ_ONLY_CAPTURE' ||
        run.target.subjectType !== 'TRANSACTION'
      ) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_TARGET_INVALID',
          'Action Semantics handler accepts read-only transaction captures only.',
          false,
        );
      }
      const parameters = ActionSemanticsTransactionCaptureParametersSchema.parse(run.parameters);
      if (parameters.adapterVersion !== RAW_LEDGER_ACTION_ADAPTER_VERSION) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_ADAPTER_UNSUPPORTED',
          'Action capture adapter version is unsupported.',
          false,
        );
      }
      const dataset = SQD_DATASETS[parameters.dataset];
      if (
        dataset.ledger !== run.target.ledger ||
        canonicalChainId(dataset.ledger, dataset.chainId) !==
          canonicalChainId(run.target.ledger, run.target.chainId)
      ) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_DATASET_MISMATCH',
          'Action capture dataset does not match the scheduled ledger target.',
          false,
        );
      }
      const provider = `sqd:${parameters.dataset}`;
      const facts = await resources.facts.listTransactionFacts({
        ledger: run.target.ledger,
        chainId: run.target.chainId,
        blockOrSlot: parameters.blockOrSlot,
        transactionId: run.target.normalizedIdentifier,
        provider,
      });
      const nodes = await loadEvidence(facts, resources.evidence);
      const snapshot = exactSnapshot(nodes);
      if (
        snapshot.ledger !== run.target.ledger ||
        snapshot.chainId !== run.target.chainId ||
        position(snapshot) !== parameters.blockOrSlot
      ) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_SNAPSHOT_MISMATCH',
          'Ingested transaction Snapshot does not match the scheduled target.',
          false,
        );
      }
      const numericPosition = Number(parameters.blockOrSlot);
      if (!Number.isSafeInteger(numericPosition)) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_POSITION_UNSAFE',
          'Capture position exceeds the supported completed-range lookup precision.',
          false,
        );
      }
      const coverage = await resources.ingestion.findCompletedCoverage({
        source: provider,
        dataset: parameters.dataset,
        ledger: run.target.ledger,
        chainId: run.target.chainId,
        position: numericPosition,
        queryHash: snapshot.configHash,
      });
      if (coverage === undefined) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_INGESTION_PENDING',
          'No completed ingestion range proves this transaction fact set yet.',
          true,
        );
      }
      if (!profileHasCompleteTransactionRecords(coverage.query, parameters.dataset)) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_COVERAGE_INCOMPLETE',
          'The completed ingestion run did not materialize the full ledger-record profile.',
          false,
        );
      }
      const report = buildActionSemanticsFromRawFacts({
        snapshot,
        facts,
        evidence: nodes.map((node) => node.evidence),
        dataCoverage: 1,
        sourceCoverage: 0.5,
        historyCoverage: 0,
        simulationCoverage: 0,
      });
      const terminal = report.evidence.find((item) => item.id === report.terminalEvidenceId);
      if (terminal === undefined) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_TERMINAL_MISSING',
          'Action Semantics report did not contain terminal Evidence.',
          false,
        );
      }
      const parents = report.evidence
        .filter((item) => item.id !== report.terminalEvidenceId)
        .map((item) => item.id)
        .sort();
      await resources.evidence.put(terminal, parents, snapshot);
      const stored = await resources.reports.put(report);
      if (report.metadata.freshness === null) {
        throw new CaptureExecutionError(
          'ACTION_CAPTURE_FRESHNESS_MISSING',
          'Action Semantics report did not retain Snapshot freshness.',
          false,
        );
      }
      return {
        resultRef: stored.id,
        snapshot,
        terminalEvidenceId: stored.terminalEvidenceId,
        evidenceIds: [...stored.evidenceIds],
        sourceSet: [...stored.sourceSet],
        modelVersion: stored.modelVersion,
        coverage: report.metadata.dataCoverage,
        freshness: report.metadata.freshness,
        confidence: report.metadata.confidence,
      };
    } catch (error) {
      throw safeFailure(error);
    }
  };
}
