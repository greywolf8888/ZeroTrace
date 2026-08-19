import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) files.push(full);
  }
  return files;
}

function lineCount(relPath: string): number {
  return readFileSync(join(root, relPath), 'utf8').split(/\r?\n/).length;
}

function readJson(relPath: string): { name?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8')) as {
    name?: string;
    dependencies?: Record<string, string>;
  };
}

function packageDirs(base: string): string[] {
  return readdirSync(join(root, base))
    .map((name) => join(base, name))
    .filter((rel) => statSync(join(root, rel)).isDirectory())
    .filter((rel) => {
      try {
        statSync(join(root, rel, 'package.json'));
        return true;
      } catch {
        return false;
      }
    });
}

const graph = new Map<string, string[]>();
for (const dir of [
  ...packageDirs('packages'),
  ...packageDirs('apps'),
  ...packageDirs('services'),
]) {
  const manifest = readJson(join(dir, 'package.json'));
  if (manifest.name === undefined) continue;
  const deps = Object.keys(manifest.dependencies ?? {}).filter((name) =>
    name.startsWith('@zerotrace/'),
  );
  graph.set(manifest.name, deps);
}

const visiting = new Set<string>();
const visited = new Set<string>();
const cycles: string[] = [];

function visit(node: string, stack: string[]): void {
  if (visiting.has(node)) {
    cycles.push([...stack, node].join(' -> '));
    return;
  }
  if (visited.has(node)) return;
  visiting.add(node);
  for (const next of graph.get(node) ?? []) visit(next, [...stack, node]);
  visiting.delete(node);
  visited.add(node);
}

for (const name of graph.keys()) visit(name, []);

const failures: string[] = [];
if (cycles.length > 0)
  failures.push(`package_dependency_cycles=${cycles.length}\n${cycles.join('\n')}`);

const appTsx = lineCount('apps/web/src/App.tsx');
const appShell = lineCount('apps/web/src/app/AppShell.tsx');
const apiApp = lineCount('apps/api/src/app.ts');
const composition = lineCount('apps/api/src/create-app-impl.ts');
const schemaIndex = lineCount('packages/schemas/src/index.ts');
const legacyIndex = lineCount('packages/schemas/src/contracts/legacy-index.ts');
const apiClient = readFileSync(join(root, 'apps/web/src/api.ts'), 'utf8');
const generatedClient = readFileSync(join(root, 'apps/web/src/generated-api/client.ts'), 'utf8');
const handwritten =
  /export\s+interface\s+/.test(apiClient) ||
  /export\s+type\s+\w+\s*=/.test(
    apiClient.replace(/export \* from '.\/generated-api\/client.js';/, ''),
  );

if (appTsx > 300) failures.push(`apps_web_App_tsx_lines=${appTsx} (limit 300)`);
if (appShell > 300) failures.push(`apps_web_AppShell_tsx_lines=${appShell} (limit 300)`);
if (apiApp > 250) failures.push(`apps_api_app_ts_lines=${apiApp} (limit 250)`);
if (composition > 250) failures.push(`create_app_impl_lines=${composition} (limit 250)`);
if (schemaIndex > 200) failures.push(`schemas_root_index_lines=${schemaIndex} (limit 200)`);
if (legacyIndex > 40) failures.push(`legacy_index_must_be_barrel=${legacyIndex} (limit 40)`);
if (handwritten) failures.push('handwritten_web_api_contracts != 0');
if (!generatedClient.includes('GENERATED:')) {
  failures.push('generated_api_client missing GENERATED marker');
}

const pluginDir = join(root, 'apps/api/src/plugins');
for (const name of readdirSync(pluginDir)) {
  if (!name.endsWith('.ts')) continue;
  const lines = lineCount(join('apps/api/src/plugins', name));
  if (lines > 600) failures.push(`plugin ${name} lines=${lines} (limit 600)`);
}

const skipOrdinary = [
  'node_modules',
  'dist',
  'generated-api',
  '.test.ts',
  '.test.tsx',
  'scripts/split-',
  'scripts/trim-',
  'scripts/fix-api-split',
  'scripts/patch-runtime',
];

function isOrdinary(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/');
  if (skipOrdinary.some((item) => normalized.includes(item))) return false;
  if (normalized.endsWith('.d.ts')) return false;
  return (
    normalized.startsWith('apps/api/src/') ||
    normalized.startsWith('apps/web/src/') ||
    normalized.startsWith('packages/forensic-pipeline/') ||
    normalized.startsWith('packages/workflow-core/') ||
    normalized.startsWith('packages/schemas/src/') ||
    normalized === 'packages/storage/src/durable-jobs.ts'
  );
}

function isReactContainer(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/');
  if (!normalized.endsWith('.tsx')) return false;
  if (normalized.includes('/workspaces/shell/part-')) return false;
  if (normalized.includes('/generated-api/')) return false;
  return (
    normalized.startsWith('apps/web/src/workspaces/') ||
    normalized.startsWith('apps/web/src/app/') ||
    /apps\/web\/src\/(InvestigationGraph|investigation-graph)/.test(normalized)
  );
}

for (const file of [
  ...walk(join(root, 'apps')),
  ...walk(join(root, 'packages')),
  ...walk(join(root, 'services')),
]) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const lines = lineCount(rel);
  if (isReactContainer(rel) && lines > 500) {
    failures.push(`react_container ${rel} lines=${lines} (limit 500)`);
  } else if (isOrdinary(rel) && lines > 800) {
    failures.push(`ordinary_source ${rel} lines=${lines} (limit 800)`);
  }
}

const domainExempt = new Set(['@zerotrace/storage', '@zerotrace/api', '@zerotrace/web']);
for (const dir of packageDirs('packages')) {
  const manifest = readJson(join(dir, 'package.json'));
  if (manifest.name === undefined || domainExempt.has(manifest.name)) continue;
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (rel.includes('.test.') || rel.includes('/dist/')) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    if (/\bfrom ['"]fastify['"]/.test(text)) failures.push(`domain_fastify_import ${rel}`);
    if (/\bfrom ['"]react['"]/.test(text) || /\bfrom ['"]react\//.test(text)) {
      failures.push(`domain_react_import ${rel}`);
    }
    if (manifest.name !== '@zerotrace/storage' && /\bfrom ['"]pg['"]/.test(text)) {
      failures.push(`domain_pg_import ${rel}`);
    }
    if (/\bprocess\.env\b/.test(text) && !rel.endsWith('config.ts')) {
      failures.push(`domain_process_env ${rel}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`architecture-check failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify(
    {
      package_dependency_cycles: 0,
      apps_web_App_tsx_lines: appTsx,
      apps_web_AppShell_tsx_lines: appShell,
      apps_api_app_ts_lines: apiApp,
      create_app_impl_lines: composition,
      schemas_root_index_lines: schemaIndex,
      handwritten_web_api_contracts: 0,
      generated_client_marked: true,
      packages: [...graph.keys()].length,
      checkedFrom: relative(root, root),
    },
    null,
    2,
  ) + '\n',
);
