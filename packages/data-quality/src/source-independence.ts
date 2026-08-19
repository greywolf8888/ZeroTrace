import { unknownValue, type KnowledgeValue } from '@zerotrace/schemas';

export const SOURCE_OPERATOR_REGISTRY_VERSION = 'source-operator-registry-v1';

export interface SourceOperatorRegistryEntry {
  operatorId: string;
  operatorName: string;
  hostnames: readonly string[];
  officialSource: string;
  registryObservedAt: string;
  registryRevision: string;
}

export interface SourceOperatorMatch {
  sourceId: string;
  hostname: string;
  operatorId: string;
  operatorName: string;
  officialSource: string;
  registryObservedAt: string;
  registryRevision: string;
}

export interface SourceOperatorResolution {
  matches: SourceOperatorMatch[];
  unresolvedSources: string[];
  distinctOperatorIds: string[];
  independence: KnowledgeValue<boolean>;
}

export const BSC_SOURCE_OPERATOR_REGISTRY: readonly SourceOperatorRegistryEntry[] = Object.freeze([
  Object.freeze({
    operatorId: 'alchemy',
    operatorName: 'Alchemy',
    hostnames: Object.freeze(['bnb-mainnet.g.alchemy.com']),
    officialSource: 'https://www.alchemy.com/docs/reference/node-supported-chains',
    registryObservedAt: '2026-08-11T00:00:00.000Z',
    registryRevision: 'alchemy-bnb-chain-api@2026-08-11',
  }),
  Object.freeze({
    operatorId: 'nodereal',
    operatorName: 'NodeReal',
    hostnames: Object.freeze(['bsc.nodereal.io']),
    officialSource:
      'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/',
    registryObservedAt: '2026-08-15T00:00:00.000Z',
    registryRevision: 'bnb-chain-bsc-json-rpc-endpoints@2026-08-15',
  }),
  Object.freeze({
    operatorId: 'bnb-chain',
    operatorName: 'BNB Chain',
    hostnames: Object.freeze(['bsc-dataseed.bnbchain.org', 'bsc-dataseed-public.bnbchain.org']),
    officialSource:
      'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/',
    registryObservedAt: '2026-08-11T00:00:00.000Z',
    registryRevision: 'bnb-chain-bsc-json-rpc-endpoints@2026-08-11',
  }),
]);

function sourceHostname(sourceId: string): string | undefined {
  const match = /^[^@]+@([^#]+)(?:#\d+)?$/.exec(sourceId);
  if (match === null) return undefined;
  const hostname = match[1]?.toLowerCase();
  if (hostname === undefined || hostname.length === 0) return undefined;
  try {
    const parsed = new URL(`https://${hostname}`);
    return parsed.hostname === hostname ? hostname : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSourceOperators(
  sourceIds: readonly string[],
  registry: readonly SourceOperatorRegistryEntry[] = BSC_SOURCE_OPERATOR_REGISTRY,
): SourceOperatorResolution {
  const normalizedSources = [...new Set(sourceIds)].sort();
  const hostOwners = new Map<string, SourceOperatorRegistryEntry>();
  for (const entry of registry) {
    for (const hostname of entry.hostnames) {
      const normalizedHostname = hostname.toLowerCase();
      if (hostOwners.has(normalizedHostname)) {
        throw new Error(`Source operator registry assigns ${normalizedHostname} more than once.`);
      }
      hostOwners.set(normalizedHostname, entry);
    }
  }

  const matches: SourceOperatorMatch[] = [];
  const unresolvedSources: string[] = [];
  for (const sourceId of normalizedSources) {
    const hostname = sourceHostname(sourceId);
    const entry = hostname === undefined ? undefined : hostOwners.get(hostname);
    if (hostname === undefined || entry === undefined) {
      unresolvedSources.push(sourceId);
      continue;
    }
    matches.push({
      sourceId,
      hostname,
      operatorId: entry.operatorId,
      operatorName: entry.operatorName,
      officialSource: entry.officialSource,
      registryObservedAt: entry.registryObservedAt,
      registryRevision: entry.registryRevision,
    });
  }

  const distinctOperatorIds = [...new Set(matches.map((match) => match.operatorId))].sort();
  const independence: KnowledgeValue<boolean> =
    normalizedSources.length < 2
      ? unknownValue('INSUFFICIENT_DATA', 'At least two observation sources are required.')
      : unresolvedSources.length > 0
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'Every observation source requires an official operator-registry match.',
          )
        : distinctOperatorIds.length >= 2
          ? { state: 'known', value: true }
          : { state: 'known', value: false };

  return { matches, unresolvedSources, distinctOperatorIds, independence };
}
