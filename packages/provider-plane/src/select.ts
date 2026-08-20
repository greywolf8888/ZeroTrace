import type { ProviderRecord, ProviderSelectionEvidence, QueryRequest } from './types.js';
import { methodClassOf } from './catalog.js';
import type { ProviderCapabilitySnapshot } from './types.js';

export function recordAllows(record: ProviderRecord, request: QueryRequest): string | undefined {
  const methodClass = methodClassOf(request.method, request.params);
  if (record.chainId !== request.chainId) return 'CHAIN_MISMATCH';
  if (methodClass === 'LOGS' && record.forensicGrade === 'PUBLIC_NO_SLA')
    return 'PUBLIC_LOGS_FORBIDDEN';
  if (methodClass === 'TRACE' && record.forensicGrade === 'PUBLIC_NO_SLA')
    return 'PUBLIC_TRACE_FORBIDDEN';
  if (record.deniedMethods.includes(request.method)) return 'METHOD_DENIED';
  if (!record.allowedMethodClasses.includes(methodClass)) return 'METHOD_CLASS_DENIED';
  if (record.role === 'SHADOW' && request.allowShadow !== true) return 'SHADOW';
  if (record.credentialStatus === 'UNCONFIGURED') return 'UNCONFIGURED';
  if (request.archiveRequired === true && !record.archiveDeclared) return 'ARCHIVE_REQUIRED';
  if (request.traceRequired === true && !record.traceDeclared) return 'TRACE_REQUIRED';
  return undefined;
}

export function selectProviders(
  records: readonly ProviderRecord[],
  request: QueryRequest,
  snapshots: readonly ProviderCapabilitySnapshot[] = [],
): ProviderSelectionEvidence {
  const methodClass = methodClassOf(request.method, request.params);
  const rejected: ProviderSelectionEvidence['rejected'] = [];
  const eligible: ProviderRecord[] = [];
  for (const record of records) {
    const reason = recordAllows(record, request);
    if (reason !== undefined) {
      rejected.push({ providerId: record.providerId, reason });
      continue;
    }
    eligible.push(record);
  }
  eligible.sort((left, right) => compareRecords(left, right, snapshots));
  const selected: ProviderSelectionEvidence['selected'] = [];
  const groups = new Set<string>();
  const need = request.loadBearing === true ? 2 : 1;
  for (const record of eligible) {
    if (groups.has(record.independenceGroup)) continue;
    groups.add(record.independenceGroup);
    selected.push({
      providerId: record.providerId,
      operatorId: record.operatorId,
      independenceGroup: record.independenceGroup,
      endpointRef: record.endpointRef,
      forensicGrade: record.forensicGrade,
      role: record.role,
      costClass: record.costClass,
    });
    if (selected.length >= need) break;
  }
  const unavailableReason =
    selected.length < need
      ? methodClass === 'LOGS'
        ? 'LOGS_REQUIRE_BULK_OR_KEYED'
        : methodClass === 'TRACE'
          ? 'TRACE_UNAVAILABLE'
          : 'PROVIDER_UNAVAILABLE'
      : undefined;
  return {
    method: request.method,
    methodClass,
    selected,
    rejected,
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
}

function compareRecords(
  left: ProviderRecord,
  right: ProviderRecord,
  snapshots: readonly ProviderCapabilitySnapshot[],
): number {
  const leftSnap = snapshots.find((item) => item.providerId === left.providerId);
  const rightSnap = snapshots.find((item) => item.providerId === right.providerId);
  const probed = Number(rightSnap?.chainIdOk === true) - Number(leftSnap?.chainIdOk === true);
  if (probed !== 0) return probed;
  if (left.costClass !== right.costClass) return left.costClass - right.costClass;
  if (left.startRps !== right.startRps) return right.startRps - left.startRps;
  return left.providerId.localeCompare(right.providerId);
}
