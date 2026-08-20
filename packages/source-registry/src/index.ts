export type LogsCapability = 'denied' | 'declared' | 'probed' | 'allowed';

export type ForensicGrade =
  | 'PUBLIC_NO_SLA'
  | 'FREE_KEYED'
  | 'PAID_SHADOW'
  | 'PAID_PRIMARY'
  | 'BULK_INDEX'
  | 'ARCHIVE_SELF_HOSTED'
  | 'TRACE_SLOT';

export type CredentialStatus = 'NONE' | 'CONFIGURED' | 'UNCONFIGURED';

export interface SourceOperator {
  operatorId: string;
  endpointId: string;
  chainId: string;
  independenceGroup: string;
  archiveCapability: boolean;
  finalitySemantics: string;
  termsReference: string;
  forensicGrade?: ForensicGrade;
  logsCapability?: LogsCapability;
  deniedMethods?: readonly string[];
  credentialStatus?: CredentialStatus;
}

export const BSC_PUBLIC_NO_SLA_ENDPOINTS = [
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed-public.bnbchain.org',
  'https://bsc.nodereal.io',
  'https://rpc.ankr.com/bsc',
  'https://bsc-rpc.publicnode.com',
] as const;

export const PUBLIC_NO_SLA_DENIED_METHODS = [
  'eth_getLogs',
  'debug_traceTransaction',
  'debug_traceCall',
  'debug_traceBlockByNumber',
  'trace_transaction',
  'trace_block',
  'trace_call',
  'trace_filter',
] as const;

const HOST_GROUPS: Array<{ match: string; group: string; operatorId: string; terms: string }> = [
  {
    match: 'bnbchain.org',
    group: 'bnbchain',
    operatorId: 'bnbchain-public',
    terms: 'bnbchain-docs',
  },
  {
    match: 'binance.org',
    group: 'bnbchain',
    operatorId: 'bnbchain-public',
    terms: 'bnbchain-docs',
  },
  {
    match: 'nodereal.io',
    group: 'nodereal',
    operatorId: 'nodereal-public',
    terms: 'nodereal-docs',
  },
  { match: 'ankr.com', group: 'ankr', operatorId: 'ankr-public', terms: 'ankr-docs' },
  {
    match: 'publicnode.com',
    group: 'publicnode',
    operatorId: 'publicnode-public',
    terms: 'publicnode-docs',
  },
  { match: 'alchemy.com', group: 'alchemy', operatorId: 'alchemy', terms: 'alchemy-terms' },
  {
    match: 'chainstack.com',
    group: 'chainstack',
    operatorId: 'chainstack',
    terms: 'chainstack-terms',
  },
  { match: 'drpc.org', group: 'drpc', operatorId: 'drpc', terms: 'drpc-terms' },
  { match: 'helius-rpc.com', group: 'helius', operatorId: 'helius', terms: 'helius-terms' },
  { match: 'helius.dev', group: 'helius', operatorId: 'helius', terms: 'helius-terms' },
];

export function independentOperatorCount(operators: readonly SourceOperator[]): number {
  return new Set(operators.map((item) => item.independenceGroup)).size;
}

export function assertLoadBearingQuorum(operators: readonly SourceOperator[]): void {
  if (independentOperatorCount(operators) < 2) {
    throw new Error('Load-bearing facts require two independent operators, not two URLs.');
  }
}

export function sameGroupIsNotIndependent(left: SourceOperator, right: SourceOperator): boolean {
  return left.independenceGroup === right.independenceGroup;
}

export function independenceGroupForHost(hostname: string): string {
  const host = hostname.toLowerCase();
  for (const item of HOST_GROUPS) {
    if (host === item.match || host.endsWith(`.${item.match}`)) return item.group;
  }
  return host;
}

export function endpointRefFromUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const parts = parsed.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last !== undefined && last.length >= 16) parts.pop();
  parsed.pathname = parts.length === 0 ? '/' : `/${parts.join('/')}`;
  const path = parsed.pathname.replace(/\/$/, '');
  return path === '' ? parsed.origin : `${parsed.origin}${path}`;
}

export function normalizeEndpointUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function isOfficialBnbPublicDataseed(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'bsc-dataseed.bnbchain.org' || host === 'bsc-dataseed-public.bnbchain.org';
}

export function isPublicNoSlaEndpoint(url: string): boolean {
  const normalized = normalizeEndpointUrl(url);
  return (BSC_PUBLIC_NO_SLA_ENDPOINTS as readonly string[]).includes(normalized);
}

export function allowsMethod(operator: SourceOperator, method: string): boolean {
  if ((operator.deniedMethods ?? []).includes(method)) return false;
  if (method === 'eth_getLogs') {
    return (
      operator.logsCapability === 'allowed' ||
      operator.logsCapability === 'probed' ||
      operator.logsCapability === 'declared'
    );
  }
  return true;
}

export function allowsLogs(operator: SourceOperator): boolean {
  return allowsMethod(operator, 'eth_getLogs');
}

export function pickIndependentOperators(
  operators: readonly SourceOperator[],
  limit = 2,
): SourceOperator[] {
  const seen = new Set<string>();
  const selected: SourceOperator[] = [];
  for (const operator of operators) {
    if (seen.has(operator.independenceGroup)) continue;
    seen.add(operator.independenceGroup);
    selected.push(operator);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function operatorFromEndpoint(input: {
  endpointId: string;
  chainId: string;
  archiveCapability?: boolean;
  finalitySemantics?: string;
  forensicGrade?: ForensicGrade;
  logsCapability?: LogsCapability;
  deniedMethods?: readonly string[];
  credentialStatus?: CredentialStatus;
  operatorId?: string;
}): SourceOperator {
  const host = new URL(input.endpointId).hostname.toLowerCase();
  const known = HOST_GROUPS.find((item) => host === item.match || host.endsWith(`.${item.match}`));
  const publicNoSla = isPublicNoSlaEndpoint(input.endpointId);
  const forensicGrade = input.forensicGrade ?? 'PUBLIC_NO_SLA';
  const logsCapability =
    input.logsCapability ??
    (forensicGrade === 'PUBLIC_NO_SLA' || publicNoSla ? 'denied' : 'denied');
  const denyLogs =
    isOfficialBnbPublicDataseed(input.endpointId) ||
    logsCapability === 'denied' ||
    (forensicGrade === 'PUBLIC_NO_SLA' &&
      logsCapability !== 'allowed' &&
      logsCapability !== 'declared' &&
      logsCapability !== 'probed');
  const deniedMethods = [
    ...(input.deniedMethods ?? (denyLogs ? PUBLIC_NO_SLA_DENIED_METHODS : [])),
    ...(isOfficialBnbPublicDataseed(input.endpointId) &&
    !(input.deniedMethods ?? []).includes('eth_getLogs')
      ? (['eth_getLogs'] as const)
      : []),
  ];
  return {
    operatorId: input.operatorId ?? known?.operatorId ?? host,
    endpointId: endpointRefFromUrl(input.endpointId),
    chainId: input.chainId,
    independenceGroup: known?.group ?? host,
    archiveCapability: input.archiveCapability ?? false,
    finalitySemantics: input.finalitySemantics ?? 'finalized',
    termsReference: known?.terms ?? `${host}-terms`,
    forensicGrade,
    logsCapability,
    deniedMethods,
    credentialStatus: input.credentialStatus ?? 'NONE',
  };
}
