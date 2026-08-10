import {
  evaluateEntityResolutionCorpus,
  resolveEntityRelationship,
  type EntityEvaluationCase,
  type EntityFeature,
} from '../../packages/entity-engine/src/index.js';
import type { AnalysisMetadata, EntityResolution } from '../../packages/schemas/src/index.js';

export const ENTITY_STRUCTURAL_GOLDEN_REVISION = 'entity-structural-golden-v1';
export const ENTITY_STRUCTURAL_MODEL_VERSION = 'entity-v0.1.0';

function metadata(id: string): AnalysisMetadata {
  return {
    snapshot: null,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    simulationCoverage: 0,
    freshness: null,
    sourceSet: ['test-only:entity-structural-golden'],
    modelVersion: ENTITY_STRUCTURAL_MODEL_VERSION,
    confidence: 1,
    evidenceIds: [`test-only:${id}`],
  };
}

function feature(id: string, kind: EntityFeature['kind']): EntityFeature {
  return { kind, strength: 1, reliability: 1, evidenceId: `test-only:${id}:${kind}` };
}

function relationship(options: {
  id: string;
  features: EntityFeature[];
  subjectAIsService?: boolean | undefined;
}): EntityResolution {
  return resolveEntityRelationship({
    subjectA: `${options.id}:a`,
    subjectB: `${options.id}:b`,
    features: options.features,
    metadata: metadata(options.id),
    ...(options.subjectAIsService === undefined
      ? {}
      : { subjectAIsService: options.subjectAIsService }),
  });
}

function entry(options: {
  id: string;
  features: EntityFeature[];
  truth: EntityEvaluationCase['truth'];
  expectedClassifications: EntityResolution['classification'][];
  subjectAIsService?: boolean | undefined;
}): EntityEvaluationCase {
  return {
    id: options.id,
    truth: options.truth,
    expectedClassifications: options.expectedClassifications,
    labelReferences: [`test-only:${ENTITY_STRUCTURAL_GOLDEN_REVISION}:${options.id}`],
    resolution: relationship(options),
  };
}

export function entityStructuralGoldenCases(): EntityEvaluationCase[] {
  return [
    entry({
      id: 'deterministic-control-plus-funding',
      features: [
        feature('deterministic-control-plus-funding', 'SHARED_ONCHAIN_AUTHORITY'),
        feature('deterministic-control-plus-funding', 'COMMON_FUNDER'),
      ],
      truth: {
        sameController: true,
        coordinated: null,
        independent: false,
        serviceHub: false,
        coinjoin: false,
      },
      expectedClassifications: ['CONFIRMED_SAME_CONTROLLER'],
    }),
    entry({
      id: 'coordinated-independent',
      features: [
        feature('coordinated-independent', 'COMMON_FUNDER'),
        feature('coordinated-independent', 'SHARED_FEE_PAYER'),
        feature('coordinated-independent', 'SETTLEMENT_CONVERGENCE'),
        feature('coordinated-independent', 'TRANSACTION_GRAMMAR'),
        feature('coordinated-independent', 'TIMING_SYNCHRONY'),
        feature('coordinated-independent', 'EARLY_BUYER_COHORT'),
        feature('coordinated-independent', 'TOKEN_DISTRIBUTION'),
        feature('coordinated-independent', 'INDEPENDENT_HISTORY'),
        feature('coordinated-independent', 'DISTINCT_FUNDING'),
        feature('coordinated-independent', 'DISTINCT_SETTLEMENT'),
      ],
      truth: {
        sameController: false,
        coordinated: true,
        independent: true,
        serviceHub: false,
        coinjoin: false,
      },
      expectedClassifications: ['COORDINATED_BUT_INDEPENDENT'],
    }),
    entry({
      id: 'labeled-service-hub',
      features: [
        feature('labeled-service-hub', 'COMMON_FUNDER'),
        feature('labeled-service-hub', 'TIMING_SYNCHRONY'),
      ],
      subjectAIsService: true,
      truth: {
        sameController: false,
        coordinated: null,
        independent: null,
        serviceHub: true,
        coinjoin: false,
      },
      expectedClassifications: ['SERVICE_INFRASTRUCTURE'],
    }),
    entry({
      id: 'service-path-suppression',
      features: [
        feature('service-path-suppression', 'SERVICE_HUB'),
        feature('service-path-suppression', 'COMMON_FUNDER'),
        feature('service-path-suppression', 'TIMING_SYNCHRONY'),
      ],
      truth: {
        sameController: false,
        coordinated: null,
        independent: null,
        serviceHub: true,
        coinjoin: false,
      },
      expectedClassifications: ['SERVICE_INFRASTRUCTURE'],
    }),
    entry({
      id: 'coinjoin-suppression',
      features: [
        feature('coinjoin-suppression', 'COMMON_FUNDER'),
        feature('coinjoin-suppression', 'COINJOIN'),
      ],
      truth: {
        sameController: false,
        coordinated: null,
        independent: null,
        serviceHub: false,
        coinjoin: true,
      },
      expectedClassifications: ['UNKNOWN'],
    }),
    entry({
      id: 'independent-histories',
      features: [
        feature('independent-histories', 'INDEPENDENT_HISTORY'),
        feature('independent-histories', 'DISTINCT_FUNDING'),
        feature('independent-histories', 'DISTINCT_SETTLEMENT'),
      ],
      truth: {
        sameController: false,
        coordinated: false,
        independent: true,
        serviceHub: false,
        coinjoin: false,
      },
      expectedClassifications: ['LIKELY_INDEPENDENT'],
    }),
    entry({
      id: 'evidence-absent-abstention',
      features: [],
      truth: {
        sameController: null,
        coordinated: null,
        independent: null,
        serviceHub: false,
        coinjoin: false,
      },
      expectedClassifications: ['UNKNOWN'],
    }),
  ];
}

export function evaluateEntityStructuralGolden() {
  return evaluateEntityResolutionCorpus({
    kind: 'STRUCTURAL_GOLDEN',
    revision: ENTITY_STRUCTURAL_GOLDEN_REVISION,
    evaluatedAt: '2026-08-10T15:00:00.000Z',
    modelVersion: ENTITY_STRUCTURAL_MODEL_VERSION,
    cases: entityStructuralGoldenCases(),
  });
}
