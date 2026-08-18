import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function lineCount(relPath: string): number {
  const text = readFileSync(join(root, relPath), 'utf8');
  return text.split(/\r?\n/).length;
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

const appTsx = lineCount('apps/web/src/App.tsx');
const apiApp = lineCount('apps/api/src/app.ts');
const schemaIndex = lineCount('packages/schemas/src/index.ts');
const apiClient = readFileSync(join(root, 'apps/web/src/api.ts'), 'utf8');
const handwritten =
  /export\s+interface\s+/.test(apiClient) ||
  /export\s+type\s+\w+\s*=/.test(
    apiClient.replace(/export \* from '.\/generated-api\/client.js';/, ''),
  );

const failures: string[] = [];
if (cycles.length > 0)
  failures.push(`package_dependency_cycles=${cycles.length}\n${cycles.join('\n')}`);
if (appTsx > 300) failures.push(`apps_web_App_tsx_lines=${appTsx} (limit 300)`);
if (apiApp > 250) failures.push(`apps_api_app_ts_lines=${apiApp} (limit 250)`);
if (schemaIndex > 200) failures.push(`schemas_root_index_lines=${schemaIndex} (limit 200)`);
if (handwritten) failures.push('handwritten_web_api_contracts != 0');

if (failures.length > 0) {
  process.stderr.write(`architecture-check failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify(
    {
      package_dependency_cycles: 0,
      apps_web_App_tsx_lines: appTsx,
      apps_api_app_ts_lines: apiApp,
      schemas_root_index_lines: schemaIndex,
      handwritten_web_api_contracts: 0,
      packages: [...graph.keys()].length,
      checkedFrom: relative(root, root),
    },
    null,
    2,
  ) + '\n',
);
