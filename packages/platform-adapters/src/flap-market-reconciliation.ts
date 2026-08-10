import { ProviderError, type EvmLedgerAdapter } from '@zerotrace/chain-adapters';
import {
  BSC_SOURCE_OPERATOR_REGISTRY,
  SOURCE_OPERATOR_REGISTRY_VERSION,
  auditDiscrepancies,
  resolveSourceOperators,
  type SourceOperatorRegistryEntry,
} from '@zerotrace/data-quality';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  FlapPancakeV2ReconciliationResultSchema,
  SourceIndependenceAssessmentSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type AnchorReconciliationResult,
  type ComparableValue,
  type ComparisonObservation,
  type DiscrepancyCheckInput,
  type Evidence,
  type FlapPancakeV2BuyScenarioResult,
  type FlapPancakeV2Market,
  type FlapPancakeV2ReconciliationResult,
  type FlapPancakeV2SellScenarioResult,
  type KnowledgeValue,
  type SourceIndependenceAssessment,
} from '@zerotrace/schemas';

import {
  FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
  FLAP_PANCAKE_V2_SELL_MODEL_VERSION,
  quoteFlapPancakeV2BuyScenarios,
  quoteFlapPancakeV2SellScenarios,
} from './flap-market.js';
import type { FlapDeployment, FlapEvidenceWriter } from './flap.js';

export const FLAP_PANCAKE_V2_RECONCILIATION_MODEL_VERSION =
  'flap-pancake-v2-multi-source-reconciliation-v1.0.0';

interface ReconciledSourceResult {
  sourceId: string;
  operatorId: KnowledgeValue<string>;
  buy: FlapPancakeV2BuyScenarioResult;
  sell: FlapPancakeV2SellScenarioResult;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sourceSnapshot(
  result: FlapPancakeV2BuyScenarioResult | FlapPancakeV2SellScenarioResult,
): AnalysisSnapshot {
  const snapshot = result.metadata.snapshot;
  if (snapshot === null) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Market reconciliation child result has no Snapshot.',
    );
  }
  return snapshot;
}

function observation(
  value: KnowledgeValue<ComparableValue>,
  result: FlapPancakeV2BuyScenarioResult | FlapPancakeV2SellScenarioResult,
  sourceId: string,
  modelVersion: string,
): ComparisonObservation {
  return {
    value,
    snapshot: sourceSnapshot(result),
    evidenceIds: [result.terminalEvidenceId],
    sourceSet: [sourceId],
    modelVersion,
  };
}

async function sourceIndependenceAssessment(options: {
  sourceIds: readonly string[];
  snapshot: AnalysisSnapshot;
  writeEvidence: FlapEvidenceWriter;
  operatorRegistry?: readonly SourceOperatorRegistryEntry[];
}): Promise<{ assessment: SourceIndependenceAssessment; evidence: Evidence[] }> {
  if (options.snapshot.ledger !== 'EVM') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Source operator assessment requires an EVM Snapshot.',
    );
  }
  const operatorRegistry = options.operatorRegistry ?? BSC_SOURCE_OPERATOR_REGISTRY;
  const resolution = resolveSourceOperators(options.sourceIds, operatorRegistry);
  const attestations = [];
  const evidence: Evidence[] = [];
  const registryObservedAt = [...operatorRegistry]
    .map((entry) => entry.registryObservedAt)
    .sort()
    .at(-1);
  if (registryObservedAt === undefined) {
    throw new ProviderError('INVALID_RESPONSE', 'Source operator registry cannot be empty.');
  }
  const registryEvidence = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: options.snapshot.chainId,
      kind: 'ANALYST_OBSERVATION',
      source: `zerotrace:${SOURCE_OPERATOR_REGISTRY_VERSION}`,
      locator: `source-operator-registry:${hashPayload(operatorRegistry)}`,
      payload: {
        modelVersion: SOURCE_OPERATOR_REGISTRY_VERSION,
        entries: operatorRegistry,
      },
      observedAt: registryObservedAt,
      finality: 'versioned-registry',
      summary:
        'Versioned source-operator registry compiled from cited official endpoint documents.',
    }),
  );
  evidence.push(registryEvidence);
  for (const match of resolution.matches) {
    const attestationEvidence = await options.writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: options.snapshot.chainId,
        kind: 'OFFICIAL_DOCUMENT',
        source: match.officialSource,
        sourceUri: match.officialSource,
        locator: `provider-operator:${match.operatorId}:${match.hostname}:${match.registryRevision}`,
        payload: {
          modelVersion: SOURCE_OPERATOR_REGISTRY_VERSION,
          sourceId: match.sourceId,
          hostname: match.hostname,
          operatorId: match.operatorId,
          operatorName: match.operatorName,
          registryRevision: match.registryRevision,
        },
        observedAt: match.registryObservedAt,
        finality: 'official-document-registry-observation',
        summary: `Official endpoint documentation attributes ${match.hostname} to ${match.operatorName}.`,
      }),
    );
    attestations.push({ ...match, evidenceId: attestationEvidence.id });
    evidence.push(attestationEvidence);
  }

  const registryEvidenceIds = [registryEvidence.id, ...attestations.map((item) => item.evidenceId)];
  const terminal = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: options.snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${SOURCE_OPERATOR_REGISTRY_VERSION}`,
      locator: `source-independence:${hashPayload(options.sourceIds)}@${options.snapshot.blockNumber}`,
      payload: {
        modelVersion: SOURCE_OPERATOR_REGISTRY_VERSION,
        sourceIds: [...options.sourceIds].sort(),
        distinctOperatorIds: resolution.distinctOperatorIds,
        unresolvedSources: resolution.unresolvedSources,
        independence: resolution.independence,
      },
      observedAt: options.snapshot.capturedAt,
      blockOrSlot: options.snapshot.blockNumber,
      finality: options.snapshot.finality,
      summary:
        resolution.independence.state !== 'known'
          ? 'Source operator independence is inconclusive because registry coverage is incomplete.'
          : resolution.independence.value
            ? 'Observation sources resolve to at least two officially documented operators.'
            : 'Observation sources resolve to the same documented operator.',
      sourceEvidenceIds: registryEvidenceIds,
    }),
    registryEvidenceIds,
    options.snapshot,
  );
  evidence.push(terminal);
  const status =
    resolution.independence.state !== 'known'
      ? 'INCONCLUSIVE'
      : resolution.independence.value
        ? 'VERIFIED_INDEPENDENT'
        : 'SAME_OPERATOR';
  return {
    assessment: SourceIndependenceAssessmentSchema.parse({
      status,
      independence: resolution.independence,
      requiredOperators: 2,
      observedSources: unique(options.sourceIds).length,
      operatorCount: resolution.distinctOperatorIds.length,
      unresolvedSources: resolution.unresolvedSources,
      attestations,
      registryEvidenceId: registryEvidence.id,
      terminalEvidenceId: terminal.id,
      evidenceIds: [...registryEvidenceIds, terminal.id],
      modelVersion: SOURCE_OPERATOR_REGISTRY_VERSION,
    }),
    evidence,
  };
}

function marketState(
  result: FlapPancakeV2BuyScenarioResult | FlapPancakeV2SellScenarioResult,
): KnowledgeValue<string> {
  return result.market.state === 'known'
    ? knownValue('KNOWN')
    : result.market.state === 'unknown'
      ? unknownValue(result.market.reason, result.market.detail)
      : unavailableValue(result.market.reason, result.market.detail);
}

function normalizedKnowledgeString(
  value: FlapPancakeV2Market['configuredBuyTaxBps'],
): KnowledgeValue<string> {
  return value.state === 'known'
    ? knownValue(value.value)
    : value.state === 'unknown'
      ? unknownValue(value.reason, value.detail)
      : unavailableValue(value.reason, value.detail);
}

function comparisons(
  reference: ReconciledSourceResult,
  actual: ReconciledSourceResult,
  independence: SourceIndependenceAssessment,
): DiscrepancyCheckInput[] {
  const checks: DiscrepancyCheckInput[] = [];
  const add = (options: {
    fieldPath: string;
    comparisonClass: DiscrepancyCheckInput['comparisonClass'];
    actualValue: KnowledgeValue<ComparableValue>;
    referenceValue: KnowledgeValue<ComparableValue>;
    actualResult: FlapPancakeV2BuyScenarioResult | FlapPancakeV2SellScenarioResult;
    referenceResult: FlapPancakeV2BuyScenarioResult | FlapPancakeV2SellScenarioResult;
    modelVersion: string;
  }) => {
    checks.push({
      fieldPath: options.fieldPath,
      comparisonClass: options.comparisonClass,
      actual: observation(
        options.actualValue,
        options.actualResult,
        actual.sourceId,
        options.modelVersion,
      ),
      reference: observation(
        options.referenceValue,
        options.referenceResult,
        reference.sourceId,
        options.modelVersion,
      ),
      coverage: 1,
      requiredCoverage: 1,
      ...(options.comparisonClass === 'INDEPENDENT_MARKET_QUOTE_RV'
        ? {
            sourceIndependence: independence.independence,
            sourceIndependenceEvidenceIds: [independence.terminalEvidenceId],
          }
        : {}),
    });
  };

  add({
    fieldPath: `${actual.sourceId}.market.state`,
    comparisonClass: 'EXACT_IDENTITY_STATE',
    actualValue: marketState(actual.buy),
    referenceValue: marketState(reference.buy),
    actualResult: actual.buy,
    referenceResult: reference.buy,
    modelVersion: FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
  });
  if (reference.buy.market.state === 'known' && actual.buy.market.state === 'known') {
    const fields: Array<
      [string, string | number | KnowledgeValue<string>, string | number | KnowledgeValue<string>]
    > = [
      ['pool', actual.buy.market.value.pool, reference.buy.market.value.pool],
      ['factory', actual.buy.market.value.factory, reference.buy.market.value.factory],
      ['router', actual.buy.market.value.router, reference.buy.market.value.router],
      ['quoteAsset', actual.buy.market.value.quoteAsset, reference.buy.market.value.quoteAsset],
      ['token0', actual.buy.market.value.token0, reference.buy.market.value.token0],
      ['token1', actual.buy.market.value.token1, reference.buy.market.value.token1],
      [
        'tokenDecimals',
        actual.buy.market.value.tokenDecimals,
        reference.buy.market.value.tokenDecimals,
      ],
      [
        'quoteDecimals',
        actual.buy.market.value.quoteDecimals,
        reference.buy.market.value.quoteDecimals,
      ],
      [
        'tokenReserve.atomic',
        actual.buy.market.value.tokenReserve.atomic,
        reference.buy.market.value.tokenReserve.atomic,
      ],
      [
        'quoteReserve.atomic',
        actual.buy.market.value.quoteReserve.atomic,
        reference.buy.market.value.quoteReserve.atomic,
      ],
      [
        'currentSpotPriceWad',
        actual.buy.market.value.currentSpotPriceWad,
        reference.buy.market.value.currentSpotPriceWad,
      ],
      ['dexFeeBps', actual.buy.market.value.dexFeeBps, reference.buy.market.value.dexFeeBps],
      [
        'configuredBuyTaxBps',
        normalizedKnowledgeString(actual.buy.market.value.configuredBuyTaxBps),
        normalizedKnowledgeString(reference.buy.market.value.configuredBuyTaxBps),
      ],
      [
        'configuredSellTaxBps',
        normalizedKnowledgeString(actual.buy.market.value.configuredSellTaxBps),
        normalizedKnowledgeString(reference.buy.market.value.configuredSellTaxBps),
      ],
      [
        'pairTimestampLast',
        actual.buy.market.value.pairTimestampLast,
        reference.buy.market.value.pairTimestampLast,
      ],
    ];
    for (const [field, actualValue, referenceValue] of fields) {
      add({
        fieldPath: `${actual.sourceId}.market.${field}`,
        comparisonClass: 'EXACT_IDENTITY_STATE',
        actualValue:
          typeof actualValue === 'object' ? actualValue : knownValue(String(actualValue)),
        referenceValue:
          typeof referenceValue === 'object' ? referenceValue : knownValue(String(referenceValue)),
        actualResult: actual.buy,
        referenceResult: reference.buy,
        modelVersion: FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
      });
    }
  }

  if (actual.buy.scenarios.length !== reference.buy.scenarios.length) {
    add({
      fieldPath: `${actual.sourceId}.buy.scenarioCount`,
      comparisonClass: 'EXACT_IDENTITY_STATE',
      actualValue: knownValue(String(actual.buy.scenarios.length)),
      referenceValue: knownValue(String(reference.buy.scenarios.length)),
      actualResult: actual.buy,
      referenceResult: reference.buy,
      modelVersion: FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
    });
  } else {
    actual.buy.scenarios.forEach((scenario, index) => {
      const baseline = reference.buy.scenarios[index];
      if (baseline === undefined) return;
      add({
        fieldPath: `${actual.sourceId}.buy[${index}].quoteInput.atomic`,
        comparisonClass: 'EXACT_IDENTITY_STATE',
        actualValue: knownValue(scenario.quoteInput.atomic),
        referenceValue: knownValue(baseline.quoteInput.atomic),
        actualResult: actual.buy,
        referenceResult: reference.buy,
        modelVersion: FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
      });
      add({
        fieldPath: `${actual.sourceId}.buy[${index}].officialRouterGrossTokenOutput.atomic`,
        comparisonClass: 'INDEPENDENT_MARKET_QUOTE_RV',
        actualValue: knownValue(scenario.officialRouterGrossTokenOutput.atomic),
        referenceValue: knownValue(baseline.officialRouterGrossTokenOutput.atomic),
        actualResult: actual.buy,
        referenceResult: reference.buy,
        modelVersion: FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
      });
      add({
        fieldPath: `${actual.sourceId}.buy[${index}].deterministicPoolGrossTokenOutput.atomic`,
        comparisonClass: 'DETERMINISTIC_DERIVED',
        actualValue: knownValue(scenario.deterministicPoolGrossTokenOutput.atomic),
        referenceValue: knownValue(baseline.deterministicPoolGrossTokenOutput.atomic),
        actualResult: actual.buy,
        referenceResult: reference.buy,
        modelVersion: FLAP_PANCAKE_V2_BUY_MODEL_VERSION,
      });
    });
  }

  if (actual.sell.scenarios.length !== reference.sell.scenarios.length) {
    add({
      fieldPath: `${actual.sourceId}.sell.scenarioCount`,
      comparisonClass: 'EXACT_IDENTITY_STATE',
      actualValue: knownValue(String(actual.sell.scenarios.length)),
      referenceValue: knownValue(String(reference.sell.scenarios.length)),
      actualResult: actual.sell,
      referenceResult: reference.sell,
      modelVersion: FLAP_PANCAKE_V2_SELL_MODEL_VERSION,
    });
  } else {
    actual.sell.scenarios.forEach((scenario, index) => {
      const baseline = reference.sell.scenarios[index];
      if (baseline === undefined) return;
      add({
        fieldPath: `${actual.sourceId}.sell[${index}].tokenInput.atomic`,
        comparisonClass: 'EXACT_IDENTITY_STATE',
        actualValue: knownValue(scenario.tokenInput.atomic),
        referenceValue: knownValue(baseline.tokenInput.atomic),
        actualResult: actual.sell,
        referenceResult: reference.sell,
        modelVersion: FLAP_PANCAKE_V2_SELL_MODEL_VERSION,
      });
      add({
        fieldPath: `${actual.sourceId}.sell[${index}].officialRouterGrossQuoteOutput.atomic`,
        comparisonClass: 'INDEPENDENT_MARKET_QUOTE_RV',
        actualValue: knownValue(scenario.officialRouterGrossQuoteOutput.atomic),
        referenceValue: knownValue(baseline.officialRouterGrossQuoteOutput.atomic),
        actualResult: actual.sell,
        referenceResult: reference.sell,
        modelVersion: FLAP_PANCAKE_V2_SELL_MODEL_VERSION,
      });
      add({
        fieldPath: `${actual.sourceId}.sell[${index}].deterministicPoolGrossQuoteOutput.atomic`,
        comparisonClass: 'DETERMINISTIC_DERIVED',
        actualValue: knownValue(scenario.deterministicPoolGrossQuoteOutput.atomic),
        referenceValue: knownValue(baseline.deterministicPoolGrossQuoteOutput.atomic),
        actualResult: actual.sell,
        referenceResult: reference.sell,
        modelVersion: FLAP_PANCAKE_V2_SELL_MODEL_VERSION,
      });
      add({
        fieldPath: `${actual.sourceId}.sell[${index}].nominalSpotQuoteValue.atomic`,
        comparisonClass: 'DETERMINISTIC_DERIVED',
        actualValue: knownValue(scenario.nominalSpotQuoteValue.atomic),
        referenceValue: knownValue(baseline.nominalSpotQuoteValue.atomic),
        actualResult: actual.sell,
        referenceResult: reference.sell,
        modelVersion: FLAP_PANCAKE_V2_SELL_MODEL_VERSION,
      });
    });
  }
  return checks;
}

export async function reconcileFlapPancakeV2Market(options: {
  sourceAdapters: readonly EvmLedgerAdapter[];
  anchorReconciliation: AnchorReconciliationResult;
  token: string;
  quoteInputs: readonly string[];
  tokenInputs: readonly string[];
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  operatorRegistry?: readonly SourceOperatorRegistryEntry[];
}): Promise<FlapPancakeV2ReconciliationResult> {
  const anchor = options.anchorReconciliation;
  if (
    anchor.status !== 'AGREEMENT' ||
    anchor.canonicalAnchor.state !== 'known' ||
    anchor.metadata.snapshot === null ||
    anchor.metadata.snapshot.ledger !== 'EVM' ||
    anchor.metadata.snapshot.chainId !== 'eip155:56' ||
    anchor.metadata.snapshot.finality !== 'finalized'
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Market reconciliation requires a common finalized BSC anchor agreement.',
    );
  }
  const snapshot = anchor.metadata.snapshot;
  const sourceIds = anchor.sources.flatMap((source) =>
    source.comparison.state === 'known' ? [source.source] : [],
  );
  const adapterMap = new Map(options.sourceAdapters.map((adapter) => [adapter.sourceId, adapter]));
  if (
    sourceIds.length < 2 ||
    sourceIds.length > 8 ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((sourceId) => !adapterMap.has(sourceId))
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Every reconciled source requires one unique executable read-only adapter.',
    );
  }

  const independence = await sourceIndependenceAssessment({
    sourceIds,
    snapshot,
    writeEvidence: options.writeEvidence,
    ...(options.operatorRegistry === undefined
      ? {}
      : { operatorRegistry: options.operatorRegistry }),
  });
  const operatorIds = new Map(
    independence.assessment.attestations.map((attestation) => [
      attestation.sourceId,
      attestation.operatorId,
    ]),
  );
  const sourceResults: ReconciledSourceResult[] = [];
  for (const sourceId of [...sourceIds].sort()) {
    const adapter = adapterMap.get(sourceId);
    if (adapter === undefined) throw new Error('Reconciled source adapter disappeared.');
    const buy = await quoteFlapPancakeV2BuyScenarios({
      adapter,
      token: options.token,
      quoteInputs: options.quoteInputs,
      deployment: options.deployment,
      writeEvidence: options.writeEvidence,
      blockNumber: anchor.canonicalAnchor.value.position,
    });
    const sell = await quoteFlapPancakeV2SellScenarios({
      adapter,
      token: options.token,
      tokenInputs: options.tokenInputs,
      deployment: options.deployment,
      writeEvidence: options.writeEvidence,
      blockNumber: anchor.canonicalAnchor.value.position,
    });
    sourceResults.push({
      sourceId,
      operatorId:
        operatorIds.get(sourceId) === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Source operator is not in the verified registry.')
          : knownValue(operatorIds.get(sourceId) as string),
      buy,
      sell,
    });
  }

  const reference = sourceResults[0];
  if (reference === undefined) throw new Error('Market reconciliation has no reference source.');
  const checks = sourceResults
    .slice(1)
    .flatMap((actual) => comparisons(reference, actual, independence.assessment));
  const sourceTerminalEvidenceIds = sourceResults.flatMap((source) => [
    source.buy.terminalEvidenceId,
    source.sell.terminalEvidenceId,
  ]);
  const auditMetadata: AnalysisMetadata = {
    snapshot,
    dataCoverage: 1,
    sourceCoverage:
      independence.assessment.independence.state === 'known' &&
      independence.assessment.independence.value
        ? 1
        : 0.5,
    historyCoverage: 0,
    simulationCoverage: 0.5,
    freshness: snapshot.capturedAt,
    sourceSet: unique([...sourceIds, ...anchor.metadata.sourceSet]).sort(),
    modelVersion: FLAP_PANCAKE_V2_RECONCILIATION_MODEL_VERSION,
    confidence: 1,
    evidenceIds: unique([
      ...anchor.metadata.evidenceIds,
      independence.assessment.terminalEvidenceId,
      ...sourceTerminalEvidenceIds,
    ]).sort(),
  };
  const audit = auditDiscrepancies(checks, auditMetadata);
  const status =
    audit.status === 'FAIL'
      ? 'FAIL'
      : independence.assessment.independence.state !== 'known' ||
          !independence.assessment.independence.value
        ? 'INCONCLUSIVE'
        : audit.status;
  const terminalSourceEvidenceIds = unique([
    ...anchor.metadata.evidenceIds,
    independence.assessment.terminalEvidenceId,
    ...sourceTerminalEvidenceIds,
  ]).sort();
  const terminal = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_PANCAKE_V2_RECONCILIATION_MODEL_VERSION}`,
      locator: `rv:flap-pancake-v2-reconciliation:${reference.buy.token}:${hashPayload({
        sourceIds,
        quoteInputs: options.quoteInputs,
        tokenInputs: options.tokenInputs,
      })}@${anchor.canonicalAnchor.value.position}`,
      payload: {
        modelVersion: FLAP_PANCAKE_V2_RECONCILIATION_MODEL_VERSION,
        token: reference.buy.token,
        status,
        anchor: anchor.canonicalAnchor.value,
        sourceIndependence: independence.assessment,
        audit,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: `Independent-source Flap/Pancake V2 market and RV reconciliation is ${status.toLowerCase()}.`,
      sourceEvidenceIds: terminalSourceEvidenceIds,
    }),
    terminalSourceEvidenceIds,
    snapshot,
  );
  const evidenceById = new Map<string, Evidence>();
  for (const item of [
    ...independence.evidence,
    ...sourceResults.flatMap((source) => [...source.buy.evidence, ...source.sell.evidence]),
    terminal,
  ]) {
    evidenceById.set(item.id, item);
  }
  const evidence = [...evidenceById.values()];
  return FlapPancakeV2ReconciliationResultSchema.parse({
    platform: 'flap',
    token: reference.buy.token,
    status,
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash.toLowerCase(),
    anchorReconciliation: anchor,
    sourceIndependence: independence.assessment,
    sources: sourceResults,
    audit,
    terminalEvidenceId: terminal.id,
    metadata: {
      ...audit.metadata,
      dataCoverage: audit.summary.inconclusive === 0 ? 1 : 0.8,
      confidence:
        status === 'PASS' || status === 'PASS_WITH_WARNINGS' ? 0.99 : status === 'FAIL' ? 1 : 0.5,
      modelVersion: FLAP_PANCAKE_V2_RECONCILIATION_MODEL_VERSION,
      evidenceIds: unique([...audit.metadata.evidenceIds, terminal.id]).sort(),
    },
    evidence,
  });
}
