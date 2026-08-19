import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith('.ts')) files.push(full);
  }
  return files;
}

const paths = new Map();
for (const file of walk(join(root, 'apps/api/src'))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(
    /\bapp\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g,
  )) {
    const method = match[1].toUpperCase();
    const path = match[2];
    const key = `${method} ${path}`;
    paths.set(key, { method, path });
  }
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'ZeroTrace Read-only Intelligence API',
    version: '0.1.0',
    description: 'Generated from Fastify route registrations. Read-only; no broadcasting.',
  },
  paths: Object.fromEntries(
    [...paths.values()].map((item) => [
      item.path,
      {
        [item.method.toLowerCase()]: {
          operationId: `${item.method}_${item.path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
          tags: [item.path.startsWith('/api/v2') ? 'analysis' : 'intelligence'],
        },
      },
    ]),
  ),
};

const out = join(root, 'apps/web/src/generated-api/openapi.json');
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${paths.size} operations`);
