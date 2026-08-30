export interface ObservationLabel {
  id: string;
  chain: string;
  address: string;
  label: string;
  source: string;
  upstreamGroup: string;
  knownAt: string;
  validFrom: string | null;
  validUntil: string | null;
  revokedAt: string | null;
  revocationKnownAt: string | null;
  visibility: 'PRIVATE' | 'SHAREABLE';
  externalAiAllowed: boolean;
  kind: 'USER_NOTE' | 'SOURCE_CLAIM' | 'CHAIN_OBSERVATION' | 'AI_HYPOTHESIS';
}
function time(s: string): number {
  const v = Date.parse(s);
  if (!Number.isFinite(v)) throw new Error('INVALID_OBSERVATION_TIME');
  return v;
}
export function visibleLabelAt(l: ObservationLabel, asOf: string): boolean {
  const at = time(asOf);
  if (time(l.knownAt) > at) return false;
  if (l.validFrom !== null && time(l.validFrom) > at) return false;
  if (l.validUntil !== null && time(l.validUntil) <= at) return false;
  if (l.revokedAt !== null) {
    if (l.revocationKnownAt === null) throw new Error('REVOCATION_KNOWLEDGE_TIME_REQUIRED');
    if (time(l.revocationKnownAt) <= at && time(l.revokedAt) <= at) return false;
  }
  return true;
}
export function selectLabelsForAi(
  labels: readonly ObservationLabel[],
  asOf: string,
): ObservationLabel[] {
  return labels.filter((l) => l.externalAiAllowed && visibleLabelAt(l, asOf));
}
export function independentSourceCount(labels: readonly ObservationLabel[]): number {
  return new Set(
    labels
      .filter((l) => l.kind !== 'AI_HYPOTHESIS' && l.kind !== 'USER_NOTE')
      .map((l) => l.upstreamGroup),
  ).size;
}
