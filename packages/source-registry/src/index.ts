export interface SourceOperator {
  operatorId: string;
  endpointId: string;
  chainId: string;
  independenceGroup: string;
  archiveCapability: boolean;
  finalitySemantics: string;
  termsReference: string;
}

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
];

export function independenceGroupForHost(hostname: string): string {
  const host = hostname.toLowerCase();
  for (const item of HOST_GROUPS) {
    if (host === item.match || host.endsWith(`.${item.match}`)) return item.group;
  }
  return host;
}

export function operatorFromEndpoint(input: {
  endpointId: string;
  chainId: string;
  archiveCapability?: boolean;
  finalitySemantics?: string;
}): SourceOperator {
  const host = new URL(input.endpointId).hostname.toLowerCase();
  const known = HOST_GROUPS.find((item) => host === item.match || host.endsWith(`.${item.match}`));
  return {
    operatorId: known?.operatorId ?? host,
    endpointId: input.endpointId,
    chainId: input.chainId,
    independenceGroup: known?.group ?? host,
    archiveCapability: input.archiveCapability ?? false,
    finalitySemantics: input.finalitySemantics ?? 'finalized',
    termsReference: known?.terms ?? `${host}-terms`,
  };
}
