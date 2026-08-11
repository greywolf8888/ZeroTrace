import { hashPayload } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type EntityResolution,
  type KnowledgeValue,
} from '@zerotrace/schemas';

const PROBABILITY_SCALE = 1_000_000n;

export const ENTITY_EVALUATION_POLICY_VERSION = 'entity-precision-gates-v1.0.0';

export type EntityCorpusKind = 'STRUCTURAL_GOLDEN' | 'LABELED_REAL_WORLD';
export type EntityEvaluationStatus = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA';

export interface EntityEvaluationTruth {
  sameController: boolean | null;
  coordinated: boolean | null;
  independent: boolean | null;
  serviceHub: boolean;
  coinjoin: boolean;
}

export interface EntityEvaluationCase {
  id: string;
  truth: EntityEvaluationTruth;
  expectedClassifications?: EntityResolution['classification'][] | undefined;
  labelReferences: string[];
  resolution: EntityResolution;
}

export interface EntityEvaluationPolicy {
  highConfidenceSameControllerThreshold: string;
  sameControllerPrecisionMinimum: string;
  coordinationThreshold: string;
  coordinationSameControllerMaximum: string;
  coordinationPrecisionMinimum: string;
  serviceHubFalseMergeMaximum: string;
  coinjoinFalseMergeMaximum: string;
  brierScoreMaximum: string;
  expectedCalibrationErrorMaximum: string;
  minimumCalibrationCasesPerAxis: number;
  calibrationBins: number;
}

export const DEFAULT_ENTITY_EVALUATION_POLICY: Readonly<EntityEvaluationPolicy> = Object.freeze({
  highConfidenceSameControllerThreshold: '0.98',
  sameControllerPrecisionMinimum: '0.98',
  coordinationThreshold: '0.95',
  coordinationSameControllerMaximum: '0.75',
  coordinationPrecisionMinimum: '0.95',
  serviceHubFalseMergeMaximum: '0.001',
  coinjoinFalseMergeMaximum: '0',
  brierScoreMaximum: '0.15',
  expectedCalibrationErrorMaximum: '0.05',
  minimumCalibrationCasesPerAxis: 100,
  calibrationBins: 10,
});

export interface EntityPrecisionGate {
  status: EntityEvaluationStatus;
  selectedCases: number;
  correctCases: number;
  incorrectCases: number;
  precision: KnowledgeValue<string>;
  minimum: string;
}

export interface EntityFalseMergeGate {
  status: EntityEvaluationStatus;
  evaluatedCases: number;
  falseMergeCases: number;
  falseMergeRate: KnowledgeValue<string>;
  maximum: string;
}

export interface EntityCalibrationAxis {
  status: EntityEvaluationStatus | 'DIAGNOSTIC_ONLY';
  evaluatedCases: number;
  excludedCases: number;
  brierScore: KnowledgeValue<string>;
  expectedCalibrationError: KnowledgeValue<string>;
  brierScoreMaximum: string;
  expectedCalibrationErrorMaximum: string;
  minimumCases: number;
}

export interface EntityEvaluationReport {
  status: EntityEvaluationStatus;
  policyVersion: string;
  policy: EntityEvaluationPolicy;
  corpus: {
    kind: EntityCorpusKind;
    revision: string;
    hash: string;
    evaluatedAt: string;
    totalCases: number;
    fullyScoredCases: number;
    abstainedCases: number;
    probabilityCoverage: string;
    modelVersion: string;
    caseIds: string[];
    labelReferences: string[];
    predictionEvidenceIds: string[];
  };
  sameControllerPrecision: EntityPrecisionGate;
  coordinationPrecision: EntityPrecisionGate;
  serviceHubFalseMerge: EntityFalseMergeGate;
  coinjoinFalseMerge: EntityFalseMergeGate;
  classificationRegression: {
    status: EntityEvaluationStatus;
    evaluatedCases: number;
    mismatchedCases: string[];
  };
  calibration: {
    status: EntityEvaluationStatus | 'DIAGNOSTIC_ONLY';
    bins: number;
    sameController: EntityCalibrationAxis;
    coordination: EntityCalibrationAxis;
    independence: EntityCalibrationAxis;
  };
}

export interface EvaluateEntityCorpusInput {
  kind: EntityCorpusKind;
  revision: string;
  evaluatedAt: string;
  modelVersion: string;
  cases: EntityEvaluationCase[];
  policy?: Partial<EntityEvaluationPolicy> | undefined;
}

function parseProbability(value: string, field: string): bigint {
  if (!/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(value)) {
    throw new Error(`${field} must be a decimal probability from 0 to 1 with at most six places.`);
  }
  const [integer = '0', fraction = ''] = value.split('.');
  return BigInt(integer) * PROBABILITY_SCALE + BigInt(fraction.padEnd(6, '0'));
}

function probabilityToPpm(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Entity prediction probabilities must be finite values from 0 to 1.');
  }
  return parseProbability(value.toFixed(6), 'entity prediction probability');
}

function formatScaled(value: bigint, scale: number): string {
  const denominator = 10n ** BigInt(scale);
  const integer = value / denominator;
  const fraction = (value % denominator).toString().padStart(scale, '0').replace(/0+$/, '');
  return fraction.length === 0 ? integer.toString() : `${integer}.${fraction}`;
}

function ratio(value: number, total: number): string {
  if (total === 0) throw new Error('A ratio denominator may not be zero.');
  return formatScaled((BigInt(value) * PROBABILITY_SCALE) / BigInt(total), 6);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isSameControllerClassification(
  classification: EntityResolution['classification'],
): boolean {
  return [
    'CONFIRMED_SAME_CONTROLLER',
    'HIGHLY_PROBABLE_SAME_CONTROLLER',
    'PROBABLE_SAME_CONTROLLER',
  ].includes(classification);
}

function knownProbability(
  value: EntityResolution['sameControllerProbability'],
): bigint | undefined {
  return value.state === 'known' ? probabilityToPpm(value.value) : undefined;
}

function precisionGate(options: {
  selected: readonly EntityEvaluationCase[];
  correct: (item: EntityEvaluationCase) => boolean;
  minimum: string;
}): EntityPrecisionGate {
  const minimum = parseProbability(options.minimum, 'precision minimum');
  const correctCases = options.selected.filter(options.correct).length;
  const selectedCases = options.selected.length;
  if (selectedCases === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      selectedCases: 0,
      correctCases: 0,
      incorrectCases: 0,
      precision: unknownValue(
        'INSUFFICIENT_DATA',
        'No labeled prediction met this precision gate selection rule.',
      ),
      minimum: options.minimum,
    };
  }
  return {
    status:
      BigInt(correctCases) * PROBABILITY_SCALE >= BigInt(selectedCases) * minimum ? 'PASS' : 'FAIL',
    selectedCases,
    correctCases,
    incorrectCases: selectedCases - correctCases,
    precision: knownValue(ratio(correctCases, selectedCases)),
    minimum: options.minimum,
  };
}

function falseMergeGate(options: {
  evaluated: readonly EntityEvaluationCase[];
  maximum: string;
}): EntityFalseMergeGate {
  const maximum = parseProbability(options.maximum, 'false-merge maximum');
  const evaluatedCases = options.evaluated.length;
  const falseMergeCases = options.evaluated.filter((item) =>
    isSameControllerClassification(item.resolution.classification),
  ).length;
  if (evaluatedCases === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      evaluatedCases: 0,
      falseMergeCases: 0,
      falseMergeRate: unknownValue(
        'INSUFFICIENT_DATA',
        'The corpus contains no labeled cases for this false-merge gate.',
      ),
      maximum: options.maximum,
    };
  }
  return {
    status:
      BigInt(falseMergeCases) * PROBABILITY_SCALE <= BigInt(evaluatedCases) * maximum
        ? 'PASS'
        : 'FAIL',
    evaluatedCases,
    falseMergeCases,
    falseMergeRate: knownValue(ratio(falseMergeCases, evaluatedCases)),
    maximum: options.maximum,
  };
}

function calibrationAxis(
  cases: readonly EntityEvaluationCase[],
  bins: number,
  gateEnabled: boolean,
  minimumCases: number,
  brierScoreMaximum: string,
  expectedCalibrationErrorMaximum: string,
  truth: (item: EntityEvaluationCase) => boolean | null,
  prediction: (item: EntityEvaluationCase) => EntityResolution['sameControllerProbability'],
): EntityCalibrationAxis {
  const observations: Array<{ probability: bigint; actual: bigint }> = [];
  for (const item of cases) {
    const actual = truth(item);
    const predicted = knownProbability(prediction(item));
    if (actual !== null && predicted !== undefined) {
      observations.push({ probability: predicted, actual: actual ? PROBABILITY_SCALE : 0n });
    }
  }
  if (observations.length === 0) {
    const unavailable = () =>
      unknownValue(
        'INSUFFICIENT_DATA' as const,
        'No cases contain both a known probability and a ground-truth label for this axis.',
      );
    return {
      status: gateEnabled ? 'INSUFFICIENT_DATA' : 'DIAGNOSTIC_ONLY',
      evaluatedCases: 0,
      excludedCases: cases.length,
      brierScore: unavailable(),
      expectedCalibrationError: unavailable(),
      brierScoreMaximum,
      expectedCalibrationErrorMaximum,
      minimumCases,
    };
  }

  const squaredError = observations.reduce((total, item) => {
    const difference = item.probability - item.actual;
    return total + difference * difference;
  }, 0n);
  const buckets = Array.from({ length: bins }, () => ({ sumProbability: 0n, sumActual: 0n }));
  for (const item of observations) {
    const index =
      item.probability === PROBABILITY_SCALE
        ? bins - 1
        : Number((item.probability * BigInt(bins)) / PROBABILITY_SCALE);
    const bucket = buckets[index];
    if (bucket === undefined) throw new Error('Entity calibration bin selection is invalid.');
    bucket.sumProbability += item.probability;
    bucket.sumActual += item.actual;
  }
  const calibrationError = buckets.reduce(
    (total, bucket) =>
      total +
      (bucket.sumProbability >= bucket.sumActual
        ? bucket.sumProbability - bucket.sumActual
        : bucket.sumActual - bucket.sumProbability),
    0n,
  );
  const averageSquaredError = squaredError / BigInt(observations.length);
  const averageCalibrationError = calibrationError / BigInt(observations.length);
  const brierMaximum = parseProbability(brierScoreMaximum, 'brierScoreMaximum');
  const calibrationMaximum = parseProbability(
    expectedCalibrationErrorMaximum,
    'expectedCalibrationErrorMaximum',
  );
  const status = !gateEnabled
    ? ('DIAGNOSTIC_ONLY' as const)
    : observations.length < minimumCases
      ? ('INSUFFICIENT_DATA' as const)
      : averageSquaredError <= brierMaximum * PROBABILITY_SCALE &&
          averageCalibrationError <= calibrationMaximum
        ? ('PASS' as const)
        : ('FAIL' as const);
  return {
    status,
    evaluatedCases: observations.length,
    excludedCases: cases.length - observations.length,
    brierScore: knownValue(formatScaled(averageSquaredError, 12)),
    expectedCalibrationError: knownValue(formatScaled(averageCalibrationError, 6)),
    brierScoreMaximum,
    expectedCalibrationErrorMaximum,
    minimumCases,
  };
}

function assertInput(input: EvaluateEntityCorpusInput, policy: EntityEvaluationPolicy): void {
  if (input.cases.length === 0 || input.cases.length > 100_000) {
    throw new Error('Entity evaluation requires one to 100000 cases.');
  }
  if (input.revision.trim().length === 0 || input.modelVersion.trim().length === 0) {
    throw new Error('Entity evaluation revision and model version are required.');
  }
  if (Number.isNaN(Date.parse(input.evaluatedAt))) {
    throw new Error('Entity evaluation time must be an ISO-compatible timestamp.');
  }
  if (
    !Number.isSafeInteger(policy.calibrationBins) ||
    policy.calibrationBins < 2 ||
    policy.calibrationBins > 100
  ) {
    throw new Error('Entity calibrationBins must be an integer from 2 to 100.');
  }
  if (
    !Number.isSafeInteger(policy.minimumCalibrationCasesPerAxis) ||
    policy.minimumCalibrationCasesPerAxis < 1 ||
    policy.minimumCalibrationCasesPerAxis > 1_000_000
  ) {
    throw new Error('Entity minimumCalibrationCasesPerAxis must be from 1 to 1000000.');
  }
  parseProbability(
    policy.highConfidenceSameControllerThreshold,
    'highConfidenceSameControllerThreshold',
  );
  parseProbability(policy.sameControllerPrecisionMinimum, 'sameControllerPrecisionMinimum');
  parseProbability(policy.coordinationThreshold, 'coordinationThreshold');
  parseProbability(policy.coordinationSameControllerMaximum, 'coordinationSameControllerMaximum');
  parseProbability(policy.coordinationPrecisionMinimum, 'coordinationPrecisionMinimum');
  parseProbability(policy.serviceHubFalseMergeMaximum, 'serviceHubFalseMergeMaximum');
  parseProbability(policy.coinjoinFalseMergeMaximum, 'coinjoinFalseMergeMaximum');
  parseProbability(policy.brierScoreMaximum, 'brierScoreMaximum');
  parseProbability(policy.expectedCalibrationErrorMaximum, 'expectedCalibrationErrorMaximum');

  const caseIds = new Set<string>();
  for (const item of input.cases) {
    if (item.id.trim().length === 0 || caseIds.has(item.id)) {
      throw new Error('Entity evaluation case ids must be non-empty and unique.');
    }
    caseIds.add(item.id);
    if (
      item.resolution.subjectA === item.resolution.subjectB ||
      item.resolution.metadata.modelVersion !== input.modelVersion
    ) {
      throw new Error('Entity evaluation cases require distinct subjects and one model version.');
    }
    if (item.labelReferences.length === 0 || item.labelReferences.some((value) => !value.trim())) {
      throw new Error('Every entity evaluation label requires at least one source reference.');
    }
    if (
      input.kind === 'LABELED_REAL_WORLD' &&
      (item.resolution.metadata.snapshot === null ||
        item.resolution.metadata.evidenceIds.length === 0 ||
        item.resolution.metadata.evidenceIds.some(
          (evidenceId) => !/^ev_[0-9a-f]{24}$/.test(evidenceId),
        ) ||
        item.labelReferences.some((reference) => /^(?:test-only|golden):/i.test(reference)))
    ) {
      throw new Error(
        'Real-world entity evaluation requires a Snapshot, canonical prediction Evidence ids and non-test label sources.',
      );
    }
  }
}

export function evaluateEntityResolutionCorpus(
  input: EvaluateEntityCorpusInput,
): EntityEvaluationReport {
  const policy: EntityEvaluationPolicy = {
    ...DEFAULT_ENTITY_EVALUATION_POLICY,
    ...input.policy,
  };
  assertInput(input, policy);
  const sameThreshold = parseProbability(
    policy.highConfidenceSameControllerThreshold,
    'highConfidenceSameControllerThreshold',
  );
  const coordinationThreshold = parseProbability(
    policy.coordinationThreshold,
    'coordinationThreshold',
  );
  const coordinationSameMaximum = parseProbability(
    policy.coordinationSameControllerMaximum,
    'coordinationSameControllerMaximum',
  );

  const sameSelected = input.cases.filter((item) => {
    const probability = knownProbability(item.resolution.sameControllerProbability);
    return (
      item.truth.sameController !== null &&
      probability !== undefined &&
      probability >= sameThreshold
    );
  });
  const coordinationSelected = input.cases.filter((item) => {
    const coordination = knownProbability(item.resolution.coordinationProbability);
    const same = knownProbability(item.resolution.sameControllerProbability);
    return (
      item.truth.coordinated !== null &&
      coordination !== undefined &&
      same !== undefined &&
      coordination >= coordinationThreshold &&
      same < coordinationSameMaximum
    );
  });
  const sameControllerPrecision = precisionGate({
    selected: sameSelected,
    correct: (item) => item.truth.sameController === true,
    minimum: policy.sameControllerPrecisionMinimum,
  });
  const coordinationPrecision = precisionGate({
    selected: coordinationSelected,
    correct: (item) => item.truth.coordinated === true && item.truth.sameController === false,
    minimum: policy.coordinationPrecisionMinimum,
  });
  const serviceHubFalseMerge = falseMergeGate({
    evaluated: input.cases.filter((item) => item.truth.serviceHub),
    maximum: policy.serviceHubFalseMergeMaximum,
  });
  const coinjoinFalseMerge = falseMergeGate({
    evaluated: input.cases.filter((item) => item.truth.coinjoin),
    maximum: policy.coinjoinFalseMergeMaximum,
  });
  const regressionCases = input.cases.filter(
    (item) =>
      item.expectedClassifications !== undefined &&
      !item.expectedClassifications.includes(item.resolution.classification),
  );
  const classifiedCases = input.cases.filter(
    (item) => item.expectedClassifications !== undefined,
  ).length;
  const classificationRegression = {
    status:
      classifiedCases === 0
        ? ('INSUFFICIENT_DATA' as const)
        : regressionCases.length === 0
          ? ('PASS' as const)
          : ('FAIL' as const),
    evaluatedCases: classifiedCases,
    mismatchedCases: regressionCases.map((item) => item.id),
  };
  const calibrationSameController = calibrationAxis(
    input.cases,
    policy.calibrationBins,
    input.kind === 'LABELED_REAL_WORLD',
    policy.minimumCalibrationCasesPerAxis,
    policy.brierScoreMaximum,
    policy.expectedCalibrationErrorMaximum,
    (item) => item.truth.sameController,
    (item) => item.resolution.sameControllerProbability,
  );
  const calibrationCoordination = calibrationAxis(
    input.cases,
    policy.calibrationBins,
    input.kind === 'LABELED_REAL_WORLD',
    policy.minimumCalibrationCasesPerAxis,
    policy.brierScoreMaximum,
    policy.expectedCalibrationErrorMaximum,
    (item) => item.truth.coordinated,
    (item) => item.resolution.coordinationProbability,
  );
  const calibrationIndependence = calibrationAxis(
    input.cases,
    policy.calibrationBins,
    input.kind === 'LABELED_REAL_WORLD',
    policy.minimumCalibrationCasesPerAxis,
    policy.brierScoreMaximum,
    policy.expectedCalibrationErrorMaximum,
    (item) => item.truth.independent,
    (item) => item.resolution.independenceProbability,
  );
  const calibrationStatuses = [
    calibrationSameController.status,
    calibrationCoordination.status,
    calibrationIndependence.status,
  ];
  const calibrationStatus =
    input.kind === 'STRUCTURAL_GOLDEN'
      ? ('DIAGNOSTIC_ONLY' as const)
      : calibrationStatuses.includes('FAIL')
        ? ('FAIL' as const)
        : calibrationStatuses.includes('INSUFFICIENT_DATA')
          ? ('INSUFFICIENT_DATA' as const)
          : ('PASS' as const);
  const requiredStatuses = [
    sameControllerPrecision.status,
    coordinationPrecision.status,
    serviceHubFalseMerge.status,
    coinjoinFalseMerge.status,
    ...(input.kind === 'STRUCTURAL_GOLDEN' ? [classificationRegression.status] : []),
    ...(input.kind === 'LABELED_REAL_WORLD' ? [calibrationStatus] : []),
  ];
  const status: EntityEvaluationStatus = requiredStatuses.includes('FAIL')
    ? 'FAIL'
    : requiredStatuses.includes('INSUFFICIENT_DATA')
      ? 'INSUFFICIENT_DATA'
      : 'PASS';
  const fullyScoredCases = input.cases.filter(
    (item) =>
      item.resolution.sameControllerProbability.state === 'known' &&
      item.resolution.coordinationProbability.state === 'known' &&
      item.resolution.independenceProbability.state === 'known',
  ).length;

  return {
    status,
    policyVersion: ENTITY_EVALUATION_POLICY_VERSION,
    policy,
    corpus: {
      kind: input.kind,
      revision: input.revision,
      hash: hashPayload({
        kind: input.kind,
        revision: input.revision,
        modelVersion: input.modelVersion,
        cases: input.cases,
      }),
      evaluatedAt: input.evaluatedAt,
      totalCases: input.cases.length,
      fullyScoredCases,
      abstainedCases: input.cases.length - fullyScoredCases,
      probabilityCoverage: ratio(fullyScoredCases, input.cases.length),
      modelVersion: input.modelVersion,
      caseIds: input.cases.map((item) => item.id),
      labelReferences: unique(input.cases.flatMap((item) => item.labelReferences)),
      predictionEvidenceIds: unique(
        input.cases.flatMap((item) => item.resolution.metadata.evidenceIds),
      ),
    },
    sameControllerPrecision,
    coordinationPrecision,
    serviceHubFalseMerge,
    coinjoinFalseMerge,
    classificationRegression,
    calibration: {
      status: calibrationStatus,
      bins: policy.calibrationBins,
      sameController: calibrationSameController,
      coordination: calibrationCoordination,
      independence: calibrationIndependence,
    },
  };
}
