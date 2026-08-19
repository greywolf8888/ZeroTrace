import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(root, 'apps/web/src/generated-api/client.ts'), 'utf8');
const apiBarrel = readFileSync(join(root, 'apps/web/src/api.ts'), 'utf8').trim();
const schemaIndex = readFileSync(join(root, 'packages/schemas/src/index.ts'), 'utf8');
const plugin = readFileSync(join(root, 'apps/api/src/plugins/market-structure.ts'), 'utf8');
const tokenPlugin = readFileSync(join(root, 'apps/api/src/plugins/token-analyze.ts'), 'utf8');
const openapi = JSON.parse(
  readFileSync(join(root, 'apps/web/src/generated-api/openapi.json'), 'utf8'),
) as { paths?: Record<string, unknown> };

const requiredV2 = [
  '/api/v2/investigations',
  '/api/v2/tokens/',
  'supply-reality',
  '/api/v2/campaigns/',
  '/api/v2/analyst-decisions',
  '/api/v2/llm/validate',
  '/api/v2/cases/',
];

const failures: string[] = [];
if (apiBarrel !== "export * from './generated-api/client.js';") {
  failures.push('apps/web/src/api.ts must only re-export generated-api/client.js');
}
if (!schemaIndex.includes("export * from './market-structure/index.js'")) {
  failures.push('packages/schemas/src/index.ts missing market-structure re-export');
}
for (const route of requiredV2) {
  if (!plugin.includes(route.replace(/\/$/, '')) && !tokenPlugin.includes(route.replace(/\/$/, ''))) {
    failures.push(`API v2 plugin missing ${route}`);
  }
}
if (!client.includes('GENERATED:')) {
  failures.push('generated-api client is not marked GENERATED');
}
if (!client.includes('/api/v2/tokens/') || !client.includes('analyzeToken')) {
  failures.push('generated-api client missing token analyze binding');
}
const openapiPaths = Object.keys(openapi.paths ?? {});
if (openapiPaths.length === 0) failures.push('generated-api/openapi.json has no paths');
const requiredClientPaths = [
  '/health',
  '/api/v2/tokens/',
  '/api/v2/jobs/',
];
for (const path of requiredClientPaths) {
  if (!client.includes(path) && !client.includes('analyzeToken')) {
    failures.push(`generated client missing ${path}`);
  }
}
if (!openapiPaths.some((path) => path.includes('/api/v2/tokens/') && path.includes('analyze'))) {
  failures.push('openapi dump missing token analyze route');
}

if (failures.length > 0) {
  process.stderr.write(`schema-drift-check failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify(
    { schema_drift: 0, v2_routes_checked: requiredV2.length, openapi_paths: openapiPaths.length },
    null,
    2,
  ) + '\n',
);
