import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  ClaimDeclarationParseResultSchema,
  ClaimRuleReviewReportSchema,
  ClaimRuleSchema,
  unknownValue,
  type ClaimDeclarationDraft,
  type ClaimDeclarationParseResult,
  type ClaimExpectedAction,
  type ClaimRuleFieldOrigin,
  type ClaimRuleFieldOrigins,
  type ClaimRuleReviewReport,
  type ClaimWalletRole,
  type ClaimWindow,
  type Evidence,
  type KnowledgeValue,
} from '@zerotrace/schemas';

import { validateClaimDeclarationReport } from './declaration.js';

export const CLAIM_RULE_REVIEW_MODEL_VERSION = 'claim-rule-review-v1.0.0';
const CLAIM_RULE_REVIEW_REPORT_ID_SCHEMA = 'zerotrace-claim-rule-review-report-v1';
const CLAIM_RULE_ID_SCHEMA = 'zerotrace-reviewed-claim-rule-v1';
const TOKEN_DECIMALS_EVIDENCE_SCHEMA = 'zerotrace-token-decimals-v1';

type ParsedKnowledge<T> = { state: 'known'; value: T } | { state: 'unknown' | 'unavailable' };

export interface ReviewedClaimRuleValues {
  sourceAddress: string;
  destinationAddress: string;
  role: ClaimWalletRole;
  expectedAction: ClaimExpectedAction;
  expectedShareBps?: string | undefined;
  window: ClaimWindow;
  shareUnit?: string | undefined;
  noExit?: boolean | undefined;
  cadenceSeconds?: string | undefined;
}

export interface ReviewClaimDeclarationDraftOptions {
  declarationReport: ClaimDeclarationParseResult;
  draftId: string;
  reviewerLabel: string;
  reviewedAt: string;
  rule: ReviewedClaimRuleValues;
  reviewSource?: string | undefined;
  tokenDecimals?: KnowledgeValue<number> | undefined;
  tokenDecimalsEvidence?: Evidence | undefined;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function canonicalTime(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`${field} must be an ISO date-time.`);
  return date.toISOString();
}

function normalizeAddress(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new RangeError(`${field} must be a canonical EVM address.`);
  }
  return normalized;
}

function normalizeWindow(window: ClaimWindow): ClaimWindow {
  const normalized = {
    from: canonicalTime(window.from, 'rule.window.from'),
    to: canonicalTime(window.to, 'rule.window.to'),
  };
  if (Date.parse(normalized.from) > Date.parse(normalized.to)) {
    throw new RangeError('Reviewed Claim rule window must not end before it begins.');
  }
  return normalized;
}

function sameWindow(left: ClaimWindow, right: ClaimWindow): boolean {
  return (
    canonicalTime(left.from, 'declaration.window.from') ===
      canonicalTime(right.from, 'rule.window.from') &&
    canonicalTime(left.to, 'declaration.window.to') === canonicalTime(right.to, 'rule.window.to')
  );
}

function origin<T>(
  declared: ParsedKnowledge<T>,
  reviewed: T,
  equal: (left: T, right: T) => boolean = Object.is,
): ClaimRuleFieldOrigin {
  return declared.state === 'known' && equal(declared.value, reviewed)
    ? 'DECLARATION_CONFIRMED'
    : 'ANALYST_OVERRIDE';
}

function optionalOrigin<T>(
  declared: ParsedKnowledge<T>,
  reviewed: T | undefined,
  field: string,
  equal: (left: T, right: T) => boolean = Object.is,
): ClaimRuleFieldOrigin | null {
  if (reviewed === undefined) {
    if (declared.state === 'known') {
      throw new Error(`Reviewed Claim rule may not silently omit declared ${field}.`);
    }
    return null;
  }
  return origin(declared, reviewed, equal);
}

function decimalsEvidencePayload(assetId: string, decimals: number) {
  return { schema: TOKEN_DECIMALS_EVIDENCE_SCHEMA, assetId, decimals };
}

function validateDecimalsEvidence(
  assetId: string,
  chainId: string,
  reviewedAt: string,
  tokenDecimals: ParsedKnowledge<number>,
  evidence: Evidence | undefined,
): Evidence | undefined {
  if (tokenDecimals.state !== 'known') {
    if (evidence !== undefined) {
      throw new Error('Token-decimals Evidence requires a Known decimals value.');
    }
    return undefined;
  }
  if (
    !Number.isInteger(tokenDecimals.value) ||
    tokenDecimals.value < 0 ||
    tokenDecimals.value > 255
  ) {
    throw new RangeError('Token decimals must be an integer between 0 and 255.');
  }
  if (
    evidence === undefined ||
    evidence.ledger !== 'EVM' ||
    evidence.chainId !== chainId ||
    !['CONTRACT_STATE', 'RAW_RPC_RESPONSE'].includes(evidence.kind) ||
    Date.parse(evidence.observedAt) > Date.parse(reviewedAt) ||
    evidence.locator !== `token-decimals:${assetId}` ||
    evidence.payloadHash !== hashPayload(decimalsEvidencePayload(assetId, tokenDecimals.value))
  ) {
    throw new Error(
      'Known token decimals require prior same-chain state Evidence with the canonical decimals payload.',
    );
  }
  return evidence;
}

function shareUnitOrigin(
  draft: ClaimDeclarationDraft,
  shareUnit: string | undefined,
  tokenDecimals: ParsedKnowledge<number>,
): ClaimRuleFieldOrigin | null {
  if (draft.shareUnitTokens.state !== 'known') {
    return shareUnit === undefined ? null : 'ANALYST_OVERRIDE';
  }
  if (shareUnit === undefined) {
    throw new Error('Reviewed Claim rule may not silently omit the declared pension share unit.');
  }
  if (tokenDecimals.state !== 'known') {
    throw new Error(
      'A declared human-token share unit requires Known token decimals before atomic-unit review.',
    );
  }
  const expected = BigInt(draft.shareUnitTokens.value) * 10n ** BigInt(tokenDecimals.value);
  return expected.toString() === shareUnit ? 'DECLARATION_CONFIRMED' : 'ANALYST_OVERRIDE';
}

function reviewedValues(options: ReviewClaimDeclarationDraftOptions): ReviewedClaimRuleValues {
  return {
    sourceAddress: normalizeAddress(options.rule.sourceAddress, 'rule.sourceAddress'),
    destinationAddress: normalizeAddress(
      options.rule.destinationAddress,
      'rule.destinationAddress',
    ),
    role: options.rule.role,
    expectedAction: options.rule.expectedAction,
    ...(options.rule.expectedShareBps === undefined
      ? {}
      : { expectedShareBps: options.rule.expectedShareBps }),
    window: normalizeWindow(options.rule.window),
    ...(options.rule.shareUnit === undefined ? {} : { shareUnit: options.rule.shareUnit }),
    ...(options.rule.noExit === undefined ? {} : { noExit: options.rule.noExit }),
    ...(options.rule.cadenceSeconds === undefined
      ? {}
      : { cadenceSeconds: options.rule.cadenceSeconds }),
  };
}

function fieldOrigins(
  draft: ClaimDeclarationDraft,
  values: ReviewedClaimRuleValues,
  tokenDecimals: ParsedKnowledge<number>,
): ClaimRuleFieldOrigins {
  return {
    assetId: 'DECLARATION_CONFIRMED',
    sourceAddress: origin(draft.sourceAddress, values.sourceAddress, (left, right) =>
      Object.is(left.toLowerCase(), right.toLowerCase()),
    ),
    destinationAddress: origin(draft.destinationAddress, values.destinationAddress, (left, right) =>
      Object.is(left.toLowerCase(), right.toLowerCase()),
    ),
    role: draft.role === values.role ? 'DECLARATION_CONFIRMED' : 'ANALYST_OVERRIDE',
    expectedAction:
      draft.expectedAction === values.expectedAction ? 'DECLARATION_CONFIRMED' : 'ANALYST_OVERRIDE',
    expectedShareBps: optionalOrigin(
      draft.expectedShareBps,
      values.expectedShareBps,
      'expected allocation percentage',
    ),
    window: origin(draft.window, values.window, sameWindow),
    shareUnit: shareUnitOrigin(draft, values.shareUnit, tokenDecimals),
    noExit: optionalOrigin(draft.noExit, values.noExit, 'no-exit wording'),
    cadenceSeconds: optionalOrigin(draft.cadenceSeconds, values.cadenceSeconds, 'payout cadence'),
  };
}

function ruleValues(rule: ClaimRuleReviewReport['rule']) {
  return ClaimRuleSchema.omit({ id: true, assetId: true, claimEvidenceIds: true }).parse(rule);
}

function ruleIdentityCore(report: ClaimRuleReviewReport) {
  return {
    schema: CLAIM_RULE_ID_SCHEMA,
    declarationResultHash: report.declarationResultHash,
    draftId: report.draftId,
    values: ruleValues(report.rule),
    claimEvidenceIds: report.rule.claimEvidenceIds,
  };
}

function reportCore(report: ClaimRuleReviewReport) {
  return {
    schemaVersion: report.schemaVersion,
    declarationReportId: report.declarationReportId,
    declarationResultHash: report.declarationResultHash,
    documentHash: report.documentHash,
    draftId: report.draftId,
    assetId: report.assetId,
    declarationDraft: report.declarationDraft,
    reviewerLabel: report.reviewerLabel,
    reviewedAt: report.reviewedAt,
    rule: report.rule,
    fieldOrigins: report.fieldOrigins,
    tokenDecimals: report.tokenDecimals,
    tokenDecimalsEvidenceId: report.tokenDecimalsEvidenceId ?? null,
    reviewEvidenceId: report.reviewEvidenceId,
    declarationEvidenceIds: report.declarationEvidenceIds,
    evidenceIds: report.evidenceIds.filter((id) => id !== report.terminalEvidenceId),
    evidence: report.evidence.filter((item) => item.id !== report.terminalEvidenceId),
    coverage: report.coverage,
    claimTruth: report.claimTruth,
    reviewerAuthority: report.reviewerAuthority,
    freshness: report.freshness,
    sourceSet: report.sourceSet,
    modelVersion: report.modelVersion,
    confidence: report.confidence,
    requiresChainVerification: report.requiresChainVerification,
  };
}

export function claimRuleReviewReportId(resultHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(resultHash)) {
    throw new RangeError('Claim rule review result hash must be canonical SHA-256 hexadecimal.');
  }
  return `crr_${hashPayload({ schema: CLAIM_RULE_REVIEW_REPORT_ID_SCHEMA, resultHash }).slice(0, 24)}`;
}

export function calculateClaimRuleReviewResultHash(report: ClaimRuleReviewReport): string {
  return hashPayload(reportCore(ClaimRuleReviewReportSchema.parse(report)));
}

export function expectedClaimRuleReviewTerminalEvidence(
  reportInput: ClaimRuleReviewReport,
): Evidence {
  const report = ClaimRuleReviewReportSchema.parse(reportInput);
  const declarationTerminalEvidenceId = report.declarationEvidenceIds.find(
    (id) => !report.declarationDraft.claimEvidenceIds.includes(id),
  );
  if (declarationTerminalEvidenceId === undefined) {
    throw new Error('Claim rule review declaration terminal Evidence is missing.');
  }
  const directSources = canonical([
    report.reviewEvidenceId,
    declarationTerminalEvidenceId,
    ...(report.tokenDecimalsEvidenceId === undefined ? [] : [report.tokenDecimalsEvidenceId]),
  ]);
  return createEvidence({
    ledger: 'EVM',
    chainId: report.evidence.find((item) => item.id === report.reviewEvidenceId)?.chainId ?? '',
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${report.modelVersion}`,
    locator: `claim-rule-review-report:${report.id}:${report.resultHash}`,
    payload: {
      reportId: report.id,
      resultHash: report.resultHash,
      declarationReportId: report.declarationReportId,
      draftId: report.draftId,
      ruleId: report.rule.id,
      claimTruth: 'NOT_QUERIED',
      chainVerification: 'NOT_QUERIED',
    },
    observedAt: report.reviewedAt,
    summary:
      'An analyst-reviewed Claim rule was materialized for later chain verification; no claim truth was inferred.',
    sourceEvidenceIds: directSources,
  });
}

function expectedReviewEvidence(report: ClaimRuleReviewReport): Evidence {
  const reviewEvidence = report.evidence.find((item) => item.id === report.reviewEvidenceId);
  if (reviewEvidence === undefined) throw new Error('Claim rule review Evidence is missing.');
  return createEvidence({
    ledger: 'EVM',
    chainId: reviewEvidence.chainId,
    kind: 'ANALYST_OBSERVATION',
    source: reviewEvidence.source,
    locator: `claim-rule-review:${report.declarationReportId}:${report.draftId}`,
    payload: {
      reviewerLabel: report.reviewerLabel,
      declarationReportId: report.declarationReportId,
      declarationResultHash: report.declarationResultHash,
      draftId: report.draftId,
      values: ruleValues(report.rule),
      fieldOrigins: report.fieldOrigins,
      tokenDecimals: report.tokenDecimals,
      tokenDecimalsEvidenceId: report.tokenDecimalsEvidenceId ?? null,
    },
    observedAt: report.reviewedAt,
    summary:
      'User-submitted analyst review defines Expected Claim rules only; reviewer authority and claim truth remain unverified.',
  });
}

export function validateClaimRuleReviewReport(
  reportInput: ClaimRuleReviewReport,
): ClaimRuleReviewReport {
  const report = ClaimRuleReviewReportSchema.parse(reportInput);
  const declarationSourceEvidenceIds = report.declarationDraft.claimEvidenceIds;
  const declarationTerminalEvidenceIds = report.declarationEvidenceIds.filter(
    (id) => !declarationSourceEvidenceIds.includes(id),
  );
  const declarationSourceEvidence = report.evidence.find(
    (item) => item.id === declarationSourceEvidenceIds[0],
  );
  const declarationTerminalEvidence = report.evidence.find(
    (item) => item.id === declarationTerminalEvidenceIds[0],
  );
  const reviewEvidence = report.evidence.find((item) => item.id === report.reviewEvidenceId);
  if (
    declarationSourceEvidenceIds.length !== 1 ||
    declarationTerminalEvidenceIds.length !== 1 ||
    declarationSourceEvidence === undefined ||
    declarationTerminalEvidence === undefined ||
    reviewEvidence === undefined ||
    declarationSourceEvidence.ledger !== 'EVM' ||
    declarationTerminalEvidence.ledger !== 'EVM' ||
    reviewEvidence.ledger !== 'EVM' ||
    declarationSourceEvidence.chainId !== reviewEvidence.chainId ||
    declarationTerminalEvidence.chainId !== reviewEvidence.chainId ||
    declarationSourceEvidence.locator !== `claim-declaration:${report.documentHash}` ||
    declarationTerminalEvidence.locator !==
      `claim-declaration-report:${report.declarationReportId}:${report.declarationResultHash}` ||
    declarationTerminalEvidence.kind !== 'DERIVED_FEATURE' ||
    declarationTerminalEvidence.observedAt !== declarationSourceEvidence.observedAt ||
    Date.parse(declarationSourceEvidence.observedAt) > Date.parse(report.reviewedAt) ||
    reviewEvidence.source === declarationSourceEvidence.source
  ) {
    throw new Error('Claim rule review is not linked to one canonical declaration Evidence chain.');
  }
  const expectedReview = expectedReviewEvidence(report);
  const expectedTerminal = expectedClaimRuleReviewTerminalEvidence(report);
  const expectedOrigins = fieldOrigins(report.declarationDraft, report.rule, report.tokenDecimals);
  const decimalsEvidence =
    report.tokenDecimalsEvidenceId === undefined
      ? undefined
      : report.evidence.find((item) => item.id === report.tokenDecimalsEvidenceId);
  validateDecimalsEvidence(
    report.assetId,
    reviewEvidence.chainId,
    report.reviewedAt,
    report.tokenDecimals,
    decimalsEvidence,
  );
  if (
    hashPayload(expectedOrigins) !== hashPayload(report.fieldOrigins) ||
    hashPayload(expectedReview) !==
      hashPayload(report.evidence.find((item) => item.id === report.reviewEvidenceId)) ||
    `clr_${hashPayload(ruleIdentityCore(report)).slice(0, 24)}` !== report.rule.id ||
    calculateClaimRuleReviewResultHash(report) !== report.resultHash ||
    claimRuleReviewReportId(report.resultHash) !== report.id ||
    hashPayload(expectedTerminal) !==
      hashPayload(report.evidence.find((item) => item.id === report.terminalEvidenceId))
  ) {
    throw new Error('Claim rule review identity, field origins, or Evidence is not canonical.');
  }
  return report;
}

export function reviewClaimDeclarationDraft(
  options: ReviewClaimDeclarationDraftOptions,
): ClaimRuleReviewReport {
  const declaration = validateClaimDeclarationReport(
    ClaimDeclarationParseResultSchema.parse(options.declarationReport),
  );
  const draft = declaration.drafts.find((item) => item.id === options.draftId);
  if (draft === undefined) throw new Error('Claim declaration draft was not found in the report.');
  const reviewerLabel = options.reviewerLabel.trim();
  if (reviewerLabel.length === 0 || reviewerLabel.length > 256) {
    throw new RangeError('Reviewer label must contain between 1 and 256 characters.');
  }
  const reviewedAt = canonicalTime(options.reviewedAt, 'reviewedAt');
  if (Date.parse(reviewedAt) < Date.parse(declaration.freshness)) {
    throw new Error('Claim rule review may not predate its source declaration capture.');
  }
  const reviewSource = (options.reviewSource ?? 'api:user-submitted-claim-review').trim();
  if (reviewSource.length === 0 || reviewSource === declaration.evidence.source) {
    throw new Error('Claim rule review requires a distinct non-empty analyst source.');
  }
  const tokenDecimals =
    options.tokenDecimals ??
    unknownValue('NOT_QUERIED', 'Token decimals were not required or verified for this review.');
  const decimalsEvidence = validateDecimalsEvidence(
    declaration.assetId,
    declaration.evidence.chainId,
    reviewedAt,
    tokenDecimals,
    options.tokenDecimalsEvidence,
  );
  const values = reviewedValues(options);
  const origins = fieldOrigins(draft, values, tokenDecimals);
  const provisionalRule = ClaimRuleSchema.omit({
    id: true,
    assetId: true,
    claimEvidenceIds: true,
  }).parse(values);
  const reviewEvidence = createEvidence({
    ledger: 'EVM',
    chainId: declaration.evidence.chainId,
    kind: 'ANALYST_OBSERVATION',
    source: reviewSource,
    locator: `claim-rule-review:${declaration.id}:${draft.id}`,
    payload: {
      reviewerLabel,
      declarationReportId: declaration.id,
      declarationResultHash: declaration.resultHash,
      draftId: draft.id,
      values: provisionalRule,
      fieldOrigins: origins,
      tokenDecimals,
      tokenDecimalsEvidenceId: decimalsEvidence?.id ?? null,
    },
    observedAt: reviewedAt,
    summary:
      'User-submitted analyst review defines Expected Claim rules only; reviewer authority and claim truth remain unverified.',
  });
  const declarationEvidenceIds = canonical([
    declaration.evidence.id,
    declaration.terminalEvidenceId,
  ]);
  const claimEvidenceIds = canonical([
    ...declarationEvidenceIds,
    reviewEvidence.id,
    ...(decimalsEvidence === undefined ? [] : [decimalsEvidence.id]),
  ]);
  const ruleWithoutId = {
    ...provisionalRule,
    assetId: declaration.assetId,
    claimEvidenceIds,
  };
  const rule = ClaimRuleSchema.parse({
    ...ruleWithoutId,
    id: `clr_${hashPayload({
      schema: CLAIM_RULE_ID_SCHEMA,
      declarationResultHash: declaration.resultHash,
      draftId: draft.id,
      values: provisionalRule,
      claimEvidenceIds,
    }).slice(0, 24)}`,
  });
  const nonTerminalEvidence = [
    declaration.evidence,
    declaration.terminalEvidence,
    reviewEvidence,
    ...(decimalsEvidence === undefined ? [] : [decimalsEvidence]),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const sourceSet = canonical([
    declaration.evidence.source,
    reviewEvidence.source,
    ...(decimalsEvidence === undefined ? [] : [decimalsEvidence.source]),
  ]);
  const partial = {
    schemaVersion: 'claim-rule-review-report-v1' as const,
    declarationReportId: declaration.id,
    declarationResultHash: declaration.resultHash,
    documentHash: declaration.documentHash,
    draftId: draft.id,
    assetId: declaration.assetId,
    declarationDraft: draft,
    reviewerLabel,
    reviewedAt,
    rule,
    fieldOrigins: origins,
    tokenDecimals,
    ...(decimalsEvidence === undefined ? {} : { tokenDecimalsEvidenceId: decimalsEvidence.id }),
    reviewEvidenceId: reviewEvidence.id,
    declarationEvidenceIds,
    evidence: nonTerminalEvidence,
    coverage: {
      sourceDocument: 1 as const,
      humanReview: 1 as const,
      fieldCompleteness: 1 as const,
      chainVerification: unknownValue(
        'NOT_QUERIED',
        'Reviewed Expected rules have not yet been compared with complete chain observations.',
      ),
    },
    claimTruth: unknownValue(
      'NOT_QUERIED',
      'Human review defines Expected behavior and does not prove the public claim is true.',
    ),
    reviewerAuthority: unknownValue(
      'INSUFFICIENT_DATA',
      'The current local/staging API has no authenticated analyst identity authority.',
    ),
    freshness: reviewedAt,
    sourceSet,
    modelVersion: CLAIM_RULE_REVIEW_MODEL_VERSION,
    confidence: unknownValue(
      'NOT_QUERIED',
      'Claim confidence is assigned only after deterministic chain verification.',
    ),
    requiresChainVerification: true as const,
  };
  const resultHash = hashPayload({
    ...partial,
    tokenDecimalsEvidenceId: decimalsEvidence?.id ?? null,
    evidenceIds: claimEvidenceIds,
  });
  const id = claimRuleReviewReportId(resultHash);
  const directSources = canonical([
    declaration.terminalEvidenceId,
    reviewEvidence.id,
    ...(decimalsEvidence === undefined ? [] : [decimalsEvidence.id]),
  ]);
  const terminalEvidence = createEvidence({
    ledger: 'EVM',
    chainId: declaration.evidence.chainId,
    kind: 'DERIVED_FEATURE',
    source: `zerotrace:${CLAIM_RULE_REVIEW_MODEL_VERSION}`,
    locator: `claim-rule-review-report:${id}:${resultHash}`,
    payload: {
      reportId: id,
      resultHash,
      declarationReportId: declaration.id,
      draftId: draft.id,
      ruleId: rule.id,
      claimTruth: 'NOT_QUERIED',
      chainVerification: 'NOT_QUERIED',
    },
    observedAt: reviewedAt,
    summary:
      'An analyst-reviewed Claim rule was materialized for later chain verification; no claim truth was inferred.',
    sourceEvidenceIds: directSources,
  });
  return validateClaimRuleReviewReport(
    ClaimRuleReviewReportSchema.parse({
      ...partial,
      id,
      resultHash,
      terminalEvidenceId: terminalEvidence.id,
      evidenceIds: canonical([...claimEvidenceIds, terminalEvidence.id]),
      evidence: [...nonTerminalEvidence, terminalEvidence].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    }),
  );
}
