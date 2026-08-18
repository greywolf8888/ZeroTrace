import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(join(root, 'apps/web/src/generated-api/client.ts'), 'utf8');
const apiBarrel = readFileSync(join(root, 'apps/web/src/api.ts'), 'utf8').trim();
const schemaIndex = readFileSync(join(root, 'packages/schemas/src/index.ts'), 'utf8');
const plugin = readFileSync(join(root, 'apps/api/src/plugins/market-structure.ts'), 'utf8');

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
  if (!plugin.includes(route.replace(/\/$/, ''))) failures.push(`API v2 plugin missing ${route}`);
}
if (!client.includes('export interface KnowledgeValue')) {
  failures.push('generated-api client missing KnowledgeValue contract');
}

if (failures.length > 0) {
  process.stderr.write(`schema-drift-check failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({ schema_drift: 0, v2_routes_checked: requiredV2.length }, null, 2) + '\n',
);
