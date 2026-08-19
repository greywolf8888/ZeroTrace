import {
  independentOperatorCount,
  operatorFromEndpoint,
  type SourceOperator,
} from '@zerotrace/source-registry';
import {
  MemoryLocalIndex,
  type RpcResult,
  type TokenCaptureRuntime,
} from '@zerotrace/token-market-capture';

import type { AppConfig } from './config.js';

const PUBLIC_BSC = ['https://bsc-dataseed.bnbchain.org', 'https://bsc.nodereal.io'];

function uniqueUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map((item) => item.replace(/\/$/, '')))];
}

export function bscCaptureOperators(urls: readonly string[]): SourceOperator[] {
  const merged = uniqueUrls([...urls, ...PUBLIC_BSC]);
  const operators = merged.map((endpointId) =>
    operatorFromEndpoint({
      endpointId,
      chainId: 'eip155:56',
      archiveCapability: false,
      finalitySemantics: 'finalized',
    }),
  );
  const seen = new Set<string>();
  const independent: SourceOperator[] = [];
  for (const operator of operators) {
    if (seen.has(operator.independenceGroup)) continue;
    seen.add(operator.independenceGroup);
    independent.push(operator);
    if (independent.length === 2) break;
  }
  return independent;
}

export function createFetchTransport(timeoutMs: number): TokenCaptureRuntime['transport'] {
  return {
    async call(endpointId, method, params): Promise<RpcResult> {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
      try {
        const response = await fetch(endpointId, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const raw = await response.text();
        if (!response.ok) return { ok: false, result: null, raw, error: `HTTP ${response.status}` };
        const parsed = JSON.parse(raw) as { result?: unknown; error?: { message?: string } };
        if (parsed.error) {
          return { ok: false, result: null, raw, error: parsed.error.message ?? 'rpc error' };
        }
        return { ok: true, result: parsed.result, raw };
      } catch (error) {
        return {
          ok: false,
          result: null,
          raw: '',
          error: error instanceof Error ? error.message : 'fetch failed',
        };
      }
    },
  };
}

export function createTokenCaptureRuntime(config: AppConfig): TokenCaptureRuntime | undefined {
  const operators = bscCaptureOperators(config.bscRpcUrls);
  if (independentOperatorCount(operators) < 2) return undefined;
  return {
    transport: createFetchTransport(Math.max(config.requestTimeoutMs, 20_000)),
    operators,
    index: new MemoryLocalIndex(),
    logBudgetChunks: 8,
  };
}
