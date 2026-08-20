import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createJsonRpcTransport,
  defaultBscPublicCatalog,
  ProviderCapabilityProbe,
  ProviderRegistry,
  ProviderScheduler,
  type BoundEndpoint,
} from '@zerotrace/provider-plane';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = defaultBscPublicCatalog();
const bindings: BoundEndpoint[] = catalog.map((item) => ({
  providerId: item.providerId,
  operatorId: item.operatorId,
  endpointRef: item.endpointRef,
  fetchUrl: item.endpointRef,
  authType: 'none',
}));
const scheduler = new ProviderScheduler(new ProviderRegistry(catalog));
const transport = createJsonRpcTransport({
  bindings,
  records: catalog,
  timeoutMs: 8_000,
  scheduler,
});
const probe = new ProviderCapabilityProbe({
  async call(binding, method, params) {
    const started = Date.now();
    const result = await transport.call(binding.providerId, method, params);
    return {
      ...result,
      timeoutMsObserved: Date.now() - started,
    };
  },
});

const snapshots = [];
for (const binding of bindings) {
  const record = catalog.find((item) => item.providerId === binding.providerId);
  snapshots.push(
    await probe.snapshot(binding, {
      chainId: 'eip155:56',
      timeoutMs: record?.timeoutMs ?? 8_000,
      maxResponseBytes: record?.maxResponseBytes ?? 2_000_000,
      logsPolicyDenied: true,
      traceConfigured:
        process.env.BSC_TRACE_RPC_URL !== undefined && process.env.BSC_TRACE_RPC_URL !== '',
    }),
  );
}

const outDir = join(root, 'docs/terminal-market-structure');
mkdirSync(outDir, { recursive: true });
const document = {
  schemaVersion: 'zerotrace-provider-capability-v1',
  probedAt: new Date().toISOString(),
  note: '配置声明不能代替探测。公共池 getLogs 按策略记 POLICY_DENIED，不是探测成功。',
  snapshots,
};
writeFileSync(
  join(outDir, 'provider-capability-snapshot.json'),
  `${JSON.stringify(document, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ providers: snapshots.length, chainIdOk: snapshots.filter((item) => item.chainIdOk).length }, null, 2)}\n`,
);
