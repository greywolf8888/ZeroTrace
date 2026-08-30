import { createHash } from 'node:crypto';

import type { AnalysisSnapshot, Ledger } from '@zerotrace/schemas';

export const METRIC_REGISTRY_VERSION = 'metric-registry-v1.0.0';
export const METRIC_EVALUATOR_VERSION = 'metric-evaluator-pit-v1.0.0';

export type MetricBasis = 'RAW' | 'ENTITY_ADJUSTED' | 'ESTIMATED';

export interface MetricUnit {
  /** Base dimensions and their integer exponents. Empty means dimensionless. */
  dimensions: Readonly<Record<string, number>>;
}

export interface MetricReference {
  metricId: string;
  version: string;
}

export type MetricFormula =
  | ({ op: 'ref' } & MetricReference)
  | { op: 'constant'; value: string; unit: MetricUnit }
  | { op: 'add' | 'subtract' | 'min' | 'max'; operands: readonly MetricFormula[] }
  | { op: 'multiply' | 'divide'; left: MetricFormula; right: MetricFormula };

interface MetricDefinitionBase extends MetricReference {
  chineseName: string;
  chineseDescription: string;
  basis: MetricBasis;
  outputUnit: MetricUnit;
  ledgers: readonly Ledger[];
  assetScope: readonly string[];
  protocolScope: readonly string[];
  granularities: readonly string[];
  dependencies: readonly MetricReference[];
  staleAfterSeconds: number;
  modelVersion: string;
  limitations: readonly string[];
}

export type MetricDefinition =
  | (MetricDefinitionBase & { kind: 'SOURCE'; formula?: never })
  | (MetricDefinitionBase & { kind: 'DERIVED'; formula: MetricFormula });

export type MetricUnknownReason =
  'NO_PIT_OBSERVATION' | 'DEPENDENCY_UNKNOWN' | 'UNDEFINED_DIVISION' | 'SNAPSHOT_MISMATCH';

export type MetricDatum =
  | { state: 'known'; value: string }
  | { state: 'unknown'; reason: MetricUnknownReason; detail: string }
  | { state: 'unavailable'; reason: string; detail: string }
  | {
      state: 'stale';
      lastKnownAt: string;
      maxAgeSeconds: number;
      detail: string;
    }
  | { state: 'provider_down'; provider: string; detail: string };

export type MetricQuality =
  | { state: 'known'; value: number }
  | { state: 'unknown'; reason: string }
  | { state: 'unavailable'; reason: string };

export interface MetricCoverage {
  data: MetricQuality;
  source: MetricQuality;
  history: MetricQuality;
}

export interface MetricObservation extends MetricReference {
  observationId: string;
  subjectKey: string;
  value: MetricDatum;
  unit: MetricUnit;
  eventTime: string;
  knownAt: string;
  revision: number;
  snapshot: AnalysisSnapshot;
  coverage: MetricCoverage;
  sourceSet: readonly string[];
  evidenceIds: readonly string[];
  evidenceScore: number;
}

export interface MetricEvaluationRequest extends MetricReference {
  subjectKey: string;
  asOf: string;
  snapshot: AnalysisSnapshot;
  observations: readonly MetricObservation[];
}

interface ExactNumber {
  numerator: bigint;
  denominator: bigint;
}

export interface ExactMetricNumber {
  numerator: string;
  denominator: string;
  /** Null means the exact fraction has no finite base-10 representation. */
  exactDecimal: string | null;
}

export type MetricEvaluationValue =
  { state: 'known'; value: ExactMetricNumber } | Exclude<MetricDatum, { state: 'known' }>;

export interface MetricEvaluation {
  registryVersion: typeof METRIC_REGISTRY_VERSION;
  evaluatorVersion: typeof METRIC_EVALUATOR_VERSION;
  metricId: string;
  definitionVersion: string;
  subjectKey: string;
  asOf: string;
  snapshot: AnalysisSnapshot;
  basis: MetricBasis;
  unit: MetricUnit;
  value: MetricEvaluationValue;
  coverage: MetricCoverage;
  freshness: {
    state: 'CURRENT' | 'STALE' | 'UNKNOWN';
    asOf: string;
    oldestDependencyKnownAt: string | null;
    maxAgeSeconds: number;
  };
  sourceSet: string[];
  modelVersion: string;
  evidenceIds: string[];
  confidence: {
    kind: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY';
    score: number | null;
    methodologyVersion: 'metric-evidence-min-v1';
  };
  replay: {
    definition: MetricReference;
    formula: MetricFormula | null;
    inputObservationIds: string[];
    visibleAt: string;
  };
  resultHash: string;
}

export class MetricRegistryError extends Error {
  public constructor(
    public readonly code:
      | 'INVALID_DEFINITION'
      | 'DUPLICATE_DEFINITION'
      | 'MISSING_DEPENDENCY'
      | 'DEPENDENCY_CYCLE'
      | 'UNIT_MISMATCH'
      | 'INVALID_EVALUATION',
    message: string,
  ) {
    super(message);
    this.name = 'MetricRegistryError';
  }
}

const metricIdPattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/;
const versionPattern = /^v?\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function key(reference: MetricReference): string {
  return `${reference.metricId}@${reference.version}`;
}

function instant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new MetricRegistryError('INVALID_EVALUATION', `${field} 必须是有效 ISO 日期时间。`);
  }
  return parsed;
}

function normalizeUnit(unit: MetricUnit): MetricUnit {
  const entries = Object.entries(unit.dimensions)
    .filter(([, exponent]) => exponent !== 0)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [dimension, exponent] of entries) {
    if (
      !/^[a-z][a-z0-9:_-]*$/.test(dimension) ||
      !Number.isInteger(exponent) ||
      Math.abs(exponent) > 8
    ) {
      throw new MetricRegistryError(
        'INVALID_DEFINITION',
        `非法指标单位维度：${dimension}^${String(exponent)}。`,
      );
    }
  }
  return { dimensions: Object.fromEntries(entries) };
}

function unitKey(unit: MetricUnit): string {
  return JSON.stringify(normalizeUnit(unit).dimensions);
}

function sameUnit(left: MetricUnit, right: MetricUnit): boolean {
  return unitKey(left) === unitKey(right);
}

function combineUnits(left: MetricUnit, right: MetricUnit, direction: 1 | -1): MetricUnit {
  const combined: Record<string, number> = { ...normalizeUnit(left).dimensions };
  for (const [dimension, exponent] of Object.entries(normalizeUnit(right).dimensions)) {
    combined[dimension] = (combined[dimension] ?? 0) + exponent * direction;
  }
  return normalizeUnit({ dimensions: combined });
}

function refsInFormula(formula: MetricFormula, result: MetricReference[] = []): MetricReference[] {
  if (formula.op === 'ref') result.push({ metricId: formula.metricId, version: formula.version });
  else if (
    formula.op === 'add' ||
    formula.op === 'subtract' ||
    formula.op === 'min' ||
    formula.op === 'max'
  ) {
    for (const operand of formula.operands) refsInFormula(operand, result);
  } else if (formula.op === 'multiply' || formula.op === 'divide') {
    refsInFormula(formula.left, result);
    refsInFormula(formula.right, result);
  }
  return result;
}

function inferFormulaUnit(
  formula: MetricFormula,
  definitions: ReadonlyMap<string, MetricDefinition>,
): MetricUnit {
  if (formula.op === 'constant') {
    parseExact(formula.value);
    return normalizeUnit(formula.unit);
  }
  if (formula.op === 'ref') {
    const dependency = definitions.get(key(formula));
    if (dependency === undefined) {
      throw new MetricRegistryError('MISSING_DEPENDENCY', `缺少指标依赖 ${key(formula)}。`);
    }
    return dependency.outputUnit;
  }
  if (formula.op === 'multiply' || formula.op === 'divide') {
    return combineUnits(
      inferFormulaUnit(formula.left, definitions),
      inferFormulaUnit(formula.right, definitions),
      formula.op === 'multiply' ? 1 : -1,
    );
  }
  if (!('operands' in formula)) {
    throw new MetricRegistryError('INVALID_DEFINITION', `未知公式操作符 ${formula.op}。`);
  }
  if (formula.operands.length < 2) {
    throw new MetricRegistryError('INVALID_DEFINITION', `${formula.op} 至少需要两个操作数。`);
  }
  const units = formula.operands.map((operand) => inferFormulaUnit(operand, definitions));
  const first = units[0];
  if (first === undefined || units.some((unit) => !sameUnit(unit, first))) {
    throw new MetricRegistryError('UNIT_MISMATCH', `${formula.op} 的操作数单位不一致。`);
  }
  return first;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rational(numerator: bigint, denominator: bigint): ExactNumber {
  if (denominator === 0n) throw new Error('zero denominator');
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  };
}

function parseExact(value: string): ExactNumber {
  if (!decimalPattern.test(value) || value.length > 160) {
    throw new MetricRegistryError('INVALID_EVALUATION', `指标值不是安全十进制定点数：${value}。`);
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}` || '0') * (negative ? -1n : 1n);
  return rational(numerator, denominator);
}

function exactDecimal(value: ExactNumber): string | null {
  let denominator = value.denominator;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos += 1;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives += 1;
  }
  if (denominator !== 1n) return null;
  const scale = Math.max(twos, fives);
  const scaled = value.numerator * 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives);
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction.length === 0 ? '' : `.${fraction}`}`;
}

function publicNumber(value: ExactNumber): ExactMetricNumber {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    exactDecimal: exactDecimal(value),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, child]) => [name, canonical(child)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function snapshotHash(snapshot: AnalysisSnapshot): string {
  return hash(snapshot);
}

function quality(values: readonly MetricQuality[]): MetricQuality {
  const unavailable = values.find((value) => value.state === 'unavailable');
  if (unavailable !== undefined) return unavailable;
  const unknown = values.find((value) => value.state === 'unknown');
  if (unknown !== undefined) return unknown;
  const known = values.flatMap((value) => (value.state === 'known' ? [value.value] : []));
  return known.length === 0
    ? { state: 'unknown', reason: 'NO_SOURCE_OBSERVATION' }
    : { state: 'known', value: Math.min(...known) };
}

interface EvaluationNode {
  value: MetricEvaluationValue;
  coverage: MetricCoverage;
  observationIds: string[];
  evidenceIds: string[];
  sourceSet: string[];
  knownAt: string[];
  evidenceScores: number[];
}

const emptyCoverage: MetricCoverage = {
  data: { state: 'unknown', reason: 'NO_SOURCE_OBSERVATION' },
  source: { state: 'unknown', reason: 'NO_SOURCE_OBSERVATION' },
  history: { state: 'unknown', reason: 'NO_SOURCE_OBSERVATION' },
};

function combineNodes(nodes: readonly EvaluationNode[]): Omit<EvaluationNode, 'value'> {
  const provenanceNodes = nodes.filter(
    (node) =>
      node.observationIds.length > 0 ||
      node.evidenceIds.length > 0 ||
      node.sourceSet.length > 0 ||
      node.knownAt.length > 0,
  );
  return {
    coverage: {
      data: quality(provenanceNodes.map((node) => node.coverage.data)),
      source: quality(provenanceNodes.map((node) => node.coverage.source)),
      history: quality(provenanceNodes.map((node) => node.coverage.history)),
    },
    observationIds: [...new Set(nodes.flatMap((node) => node.observationIds))].sort(),
    evidenceIds: [...new Set(nodes.flatMap((node) => node.evidenceIds))].sort(),
    sourceSet: [...new Set(nodes.flatMap((node) => node.sourceSet))].sort(),
    knownAt: nodes.flatMap((node) => node.knownAt).sort(),
    evidenceScores: nodes.flatMap((node) => node.evidenceScores),
  };
}

function blockedValue(nodes: readonly EvaluationNode[]): MetricEvaluationValue | undefined {
  const values = nodes.map((node) => node.value);
  return (
    values.find((value) => value.state === 'provider_down') ??
    values.find((value) => value.state === 'unavailable') ??
    values.find((value) => value.state === 'stale') ??
    values.find((value) => value.state === 'unknown')
  );
}

export class MetricRegistry {
  readonly #definitions = new Map<string, MetricDefinition>();

  public constructor(definitions: readonly MetricDefinition[]) {
    for (const definition of definitions) {
      this.#validateShape(definition);
      const definitionKey = key(definition);
      if (this.#definitions.has(definitionKey)) {
        throw new MetricRegistryError('DUPLICATE_DEFINITION', `重复指标定义 ${definitionKey}。`);
      }
      this.#definitions.set(definitionKey, {
        ...definition,
        outputUnit: normalizeUnit(definition.outputUnit),
      });
    }
    this.#validateGraphAndUnits();
  }

  public list(): MetricDefinition[] {
    return [...this.#definitions.values()].sort((left, right) =>
      key(left).localeCompare(key(right)),
    );
  }

  public evaluate(request: MetricEvaluationRequest): MetricEvaluation {
    const definition = this.#definitions.get(key(request));
    if (definition === undefined) {
      throw new MetricRegistryError('INVALID_EVALUATION', `未知指标定义 ${key(request)}。`);
    }
    const asOf = instant(request.asOf, 'asOf');
    if (instant(request.snapshot.capturedAt, 'snapshot.capturedAt') > asOf) {
      throw new MetricRegistryError('INVALID_EVALUATION', 'Snapshot 不得晚于 point-in-time asOf。');
    }
    for (const observation of request.observations) this.#validateObservation(observation);

    const node = this.#evaluateDefinition(definition, request, asOf, new Map());
    const oldestKnownAt = node.knownAt[0] ?? null;
    const stale = node.value.state === 'stale';
    const resultWithoutHash: Omit<MetricEvaluation, 'resultHash'> = {
      registryVersion: METRIC_REGISTRY_VERSION,
      evaluatorVersion: METRIC_EVALUATOR_VERSION,
      metricId: definition.metricId,
      definitionVersion: definition.version,
      subjectKey: request.subjectKey,
      asOf: new Date(asOf).toISOString(),
      snapshot: request.snapshot,
      basis: definition.basis,
      unit: definition.outputUnit,
      value: node.value,
      coverage: node.coverage,
      freshness: {
        state: stale
          ? ('STALE' as const)
          : oldestKnownAt === null
            ? ('UNKNOWN' as const)
            : ('CURRENT' as const),
        asOf: new Date(asOf).toISOString(),
        oldestDependencyKnownAt: oldestKnownAt,
        maxAgeSeconds: definition.staleAfterSeconds,
      },
      sourceSet: node.sourceSet,
      modelVersion: definition.modelVersion,
      evidenceIds: node.evidenceIds,
      confidence: {
        kind: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY' as const,
        score: node.evidenceScores.length === 0 ? null : Math.min(...node.evidenceScores),
        methodologyVersion: 'metric-evidence-min-v1' as const,
      },
      replay: {
        definition: { metricId: definition.metricId, version: definition.version },
        formula: definition.kind === 'DERIVED' ? definition.formula : null,
        inputObservationIds: node.observationIds,
        visibleAt: new Date(asOf).toISOString(),
      },
    };
    return { ...resultWithoutHash, resultHash: hash(resultWithoutHash) };
  }

  #validateShape(definition: MetricDefinition): void {
    if (
      !metricIdPattern.test(definition.metricId) ||
      !versionPattern.test(definition.version) ||
      definition.chineseName.trim().length === 0 ||
      definition.chineseDescription.trim().length === 0 ||
      definition.modelVersion.trim().length === 0 ||
      !Number.isInteger(definition.staleAfterSeconds) ||
      definition.staleAfterSeconds <= 0 ||
      definition.ledgers.length === 0 ||
      definition.granularities.length === 0
    ) {
      throw new MetricRegistryError('INVALID_DEFINITION', `指标定义 ${key(definition)} 不完整。`);
    }
    normalizeUnit(definition.outputUnit);
    const dependencyKeys = definition.dependencies.map(key);
    if (new Set(dependencyKeys).size !== dependencyKeys.length) {
      throw new MetricRegistryError('INVALID_DEFINITION', `指标 ${key(definition)} 含重复依赖。`);
    }
    if (definition.kind === 'SOURCE' && definition.dependencies.length > 0) {
      throw new MetricRegistryError('INVALID_DEFINITION', 'SOURCE 指标不得声明派生依赖。');
    }
  }

  #validateGraphAndUnits(): void {
    for (const definition of this.#definitions.values()) {
      for (const dependency of definition.dependencies) {
        if (!this.#definitions.has(key(dependency))) {
          throw new MetricRegistryError('MISSING_DEPENDENCY', `缺少指标依赖 ${key(dependency)}。`);
        }
      }
      if (definition.kind === 'DERIVED') {
        const declared = new Set(definition.dependencies.map(key));
        const referenced = new Set(refsInFormula(definition.formula).map(key));
        if (
          declared.size !== referenced.size ||
          [...declared].some((dependency) => !referenced.has(dependency))
        ) {
          throw new MetricRegistryError(
            'INVALID_DEFINITION',
            `指标 ${key(definition)} 的 dependencies 与公式引用不一致。`,
          );
        }
        if (
          !sameUnit(inferFormulaUnit(definition.formula, this.#definitions), definition.outputUnit)
        ) {
          throw new MetricRegistryError(
            'UNIT_MISMATCH',
            `指标 ${key(definition)} 的输出单位不匹配。`,
          );
        }
      }
    }

    const active = new Set<string>();
    const complete = new Set<string>();
    const visit = (definitionKey: string): void => {
      if (active.has(definitionKey)) {
        throw new MetricRegistryError('DEPENDENCY_CYCLE', `指标依赖形成环：${definitionKey}。`);
      }
      if (complete.has(definitionKey)) return;
      active.add(definitionKey);
      const definition = this.#definitions.get(definitionKey);
      if (definition !== undefined) {
        for (const dependency of definition.dependencies) visit(key(dependency));
      }
      active.delete(definitionKey);
      complete.add(definitionKey);
    };
    for (const definitionKey of this.#definitions.keys()) visit(definitionKey);
  }

  #validateObservation(observation: MetricObservation): void {
    if (
      observation.observationId.trim().length === 0 ||
      observation.subjectKey.trim().length === 0 ||
      !Number.isInteger(observation.revision) ||
      observation.revision < 0 ||
      observation.evidenceScore < 0 ||
      observation.evidenceScore > 100
    ) {
      throw new MetricRegistryError(
        'INVALID_EVALUATION',
        '指标 Observation 标识、修订或证据分无效。',
      );
    }
    instant(observation.eventTime, 'observation.eventTime');
    instant(observation.knownAt, 'observation.knownAt');
    if (observation.value.state === 'known') parseExact(observation.value.value);
    for (const qualityValue of Object.values(observation.coverage)) {
      if (qualityValue.state === 'known' && (qualityValue.value < 0 || qualityValue.value > 1)) {
        throw new MetricRegistryError('INVALID_EVALUATION', '指标 coverage 必须在 0..1。');
      }
    }
  }

  #evaluateDefinition(
    definition: MetricDefinition,
    request: MetricEvaluationRequest,
    asOf: number,
    memo: Map<string, EvaluationNode>,
  ): EvaluationNode {
    const definitionKey = key(definition);
    const cached = memo.get(definitionKey);
    if (cached !== undefined) return cached;
    const node =
      definition.kind === 'SOURCE'
        ? this.#sourceNode(definition, request, asOf)
        : this.#formulaNode(definition.formula, request, asOf, memo);
    memo.set(definitionKey, node);
    return node;
  }

  #sourceNode(
    definition: MetricDefinition,
    request: MetricEvaluationRequest,
    asOf: number,
  ): EvaluationNode {
    const expectedSnapshotHash = snapshotHash(request.snapshot);
    const matching = request.observations
      .filter(
        (observation) =>
          observation.metricId === definition.metricId &&
          observation.version === definition.version &&
          observation.subjectKey === request.subjectKey &&
          snapshotHash(observation.snapshot) === expectedSnapshotHash &&
          instant(observation.eventTime, 'observation.eventTime') <= asOf &&
          instant(observation.knownAt, 'observation.knownAt') <= asOf,
      )
      .sort((left, right) => {
        const knownDifference =
          instant(right.knownAt, 'knownAt') - instant(left.knownAt, 'knownAt');
        return (
          knownDifference ||
          right.revision - left.revision ||
          right.observationId.localeCompare(left.observationId)
        );
      });
    const observation = matching[0];
    if (observation === undefined) {
      return {
        value: {
          state: 'unknown',
          reason: 'NO_PIT_OBSERVATION',
          detail: `截至 ${new Date(asOf).toISOString()} 无同 Snapshot 可见 Observation。`,
        },
        coverage: emptyCoverage,
        observationIds: [],
        evidenceIds: [],
        sourceSet: [],
        knownAt: [],
        evidenceScores: [],
      };
    }
    if (!sameUnit(observation.unit, definition.outputUnit)) {
      throw new MetricRegistryError(
        'UNIT_MISMATCH',
        `Observation ${observation.observationId} 与 ${key(definition)} 单位不匹配。`,
      );
    }
    const ageSeconds = (asOf - instant(observation.knownAt, 'knownAt')) / 1_000;
    const value: MetricEvaluationValue =
      observation.value.state === 'known' && ageSeconds > definition.staleAfterSeconds
        ? {
            state: 'stale',
            lastKnownAt: observation.knownAt,
            maxAgeSeconds: definition.staleAfterSeconds,
            detail: 'Observation 已超过指标定义的 freshness 上限。',
          }
        : observation.value.state === 'known'
          ? { state: 'known', value: publicNumber(parseExact(observation.value.value)) }
          : observation.value;
    return {
      value,
      coverage: observation.coverage,
      observationIds: [observation.observationId],
      evidenceIds: [...new Set(observation.evidenceIds)].sort(),
      sourceSet: [...new Set(observation.sourceSet)].sort(),
      knownAt: [observation.knownAt],
      evidenceScores: [observation.evidenceScore],
    };
  }

  #formulaNode(
    formula: MetricFormula,
    request: MetricEvaluationRequest,
    asOf: number,
    memo: Map<string, EvaluationNode>,
  ): EvaluationNode {
    if (formula.op === 'constant') {
      return {
        value: { state: 'known', value: publicNumber(parseExact(formula.value)) },
        coverage: emptyCoverage,
        observationIds: [],
        evidenceIds: [],
        sourceSet: [],
        knownAt: [],
        evidenceScores: [],
      };
    }
    if (formula.op === 'ref') {
      const dependency = this.#definitions.get(key(formula));
      if (dependency === undefined) {
        throw new MetricRegistryError('MISSING_DEPENDENCY', `缺少指标依赖 ${key(formula)}。`);
      }
      return this.#evaluateDefinition(dependency, request, asOf, memo);
    }
    const operands =
      'operands' in formula
        ? formula.operands.map((operand) => this.#formulaNode(operand, request, asOf, memo))
        : [
            this.#formulaNode(formula.left, request, asOf, memo),
            this.#formulaNode(formula.right, request, asOf, memo),
          ];
    const metadata = combineNodes(operands);
    const blocked = blockedValue(operands);
    if (blocked !== undefined) return { ...metadata, value: blocked };
    const numbers = operands.map((operand) => {
      if (operand.value.state !== 'known') throw new Error('unreachable blocked metric');
      return rational(
        BigInt(operand.value.value.numerator),
        BigInt(operand.value.value.denominator),
      );
    });
    const left = numbers[0];
    const right = numbers[1];
    if (left === undefined || right === undefined) {
      throw new MetricRegistryError('INVALID_DEFINITION', '公式缺少操作数。');
    }
    let value: ExactNumber;
    if (formula.op === 'add') {
      value = numbers
        .slice(1)
        .reduce(
          (sum, next) =>
            rational(
              sum.numerator * next.denominator + next.numerator * sum.denominator,
              sum.denominator * next.denominator,
            ),
          left,
        );
    } else if (formula.op === 'subtract') {
      value = numbers
        .slice(1)
        .reduce(
          (difference, next) =>
            rational(
              difference.numerator * next.denominator - next.numerator * difference.denominator,
              difference.denominator * next.denominator,
            ),
          left,
        );
    } else if (formula.op === 'min' || formula.op === 'max') {
      value = numbers.slice(1).reduce((selected, next) => {
        const order = selected.numerator * next.denominator - next.numerator * selected.denominator;
        return formula.op === 'min'
          ? order <= 0n
            ? selected
            : next
          : order >= 0n
            ? selected
            : next;
      }, left);
    } else if (formula.op === 'multiply') {
      value = rational(left.numerator * right.numerator, left.denominator * right.denominator);
    } else {
      if (right.numerator === 0n) {
        return {
          ...metadata,
          value: {
            state: 'unknown',
            reason: 'UNDEFINED_DIVISION',
            detail: '分母为零，指标保持 Unknown，不能填充为数值零。',
          },
        };
      }
      value = rational(left.numerator * right.denominator, left.denominator * right.numerator);
    }
    return { ...metadata, value: { state: 'known', value: publicNumber(value) } };
  }
}

const countUnit: MetricUnit = { dimensions: { count: 1 } };
const dimensionlessUnit: MetricUnit = { dimensions: {} };
const commonScope = {
  ledgers: ['EVM', 'BITCOIN', 'SOLANA'] as const,
  assetScope: ['*'] as const,
  protocolScope: ['*'] as const,
  granularities: ['SNAPSHOT', 'DAY'] as const,
  staleAfterSeconds: 86_400,
};

/**
 * Versioned catalog only. These definitions do not imply that observations exist or that a
 * production metric has passed its named real-chain gate.
 */
export const CORE_METRIC_DEFINITIONS = [
  {
    kind: 'SOURCE',
    metricId: 'raw.transfer_count',
    version: '1.0.0',
    chineseName: '原始转移笔数',
    chineseDescription: '同一 Snapshot 与观察窗口内可验证的原始账本转移记录数。',
    basis: 'RAW',
    outputUnit: countUnit,
    ...commonScope,
    dependencies: [],
    modelVersion: 'raw-transfer-count-v1',
    limitations: ['未完成全窗口覆盖时不得把缺失记录当作零。'],
  },
  {
    kind: 'SOURCE',
    metricId: 'raw.active_address_count',
    version: '1.0.0',
    chineseName: '原始活跃地址数',
    chineseDescription:
      '同一 Snapshot 与观察窗口内出现的唯一原始地址数，不等于钱包、实体或控制人数量。',
    basis: 'RAW',
    outputUnit: countUnit,
    ...commonScope,
    dependencies: [],
    modelVersion: 'raw-active-address-count-v1',
    limitations: ['地址不等于钱包或实体；服务枢纽不得传播所有权。'],
  },
  {
    kind: 'DERIVED',
    metricId: 'derived.transfers_per_active_address',
    version: '1.0.0',
    chineseName: '每活跃地址转移笔数',
    chineseDescription: '原始转移笔数除以原始活跃地址数；分母为零时结果为 Unknown。',
    basis: 'RAW',
    outputUnit: dimensionlessUnit,
    ...commonScope,
    dependencies: [
      { metricId: 'raw.transfer_count', version: '1.0.0' },
      { metricId: 'raw.active_address_count', version: '1.0.0' },
    ],
    formula: {
      op: 'divide',
      left: { op: 'ref', metricId: 'raw.transfer_count', version: '1.0.0' },
      right: { op: 'ref', metricId: 'raw.active_address_count', version: '1.0.0' },
    },
    modelVersion: 'transfers-per-active-address-v1',
    limitations: ['这是原始地址口径，不得解释为每个实体或每名用户。'],
  },
] as const satisfies readonly MetricDefinition[];

export function createCoreMetricRegistry(): MetricRegistry {
  return new MetricRegistry(CORE_METRIC_DEFINITIONS);
}
