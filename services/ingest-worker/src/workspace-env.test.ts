import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadWorkspaceEnv } from './workspace-env.js';

const testKeys: string[] = [];
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const key of testKeys.splice(0)) delete process.env[key];
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loadWorkspaceEnv', () => {
  it('discovers a root .env and preserves an explicit process value', () => {
    const root = mkdtempSync(join(tmpdir(), 'zerotrace-env-'));
    temporaryRoots.push(root);
    const workspace = join(root, 'services', 'ingest-worker');
    mkdirSync(workspace, { recursive: true });
    const rootKey = `ZEROTRACE_ENV_TEST_${process.pid}_INGEST_ROOT`;
    const explicitKey = `ZEROTRACE_ENV_TEST_${process.pid}_INGEST_EXPLICIT`;
    testKeys.push(rootKey, explicitKey);
    process.env[explicitKey] = 'explicit-value';
    writeFileSync(join(root, '.env'), `${rootKey}=root-value\n${explicitKey}=file-value\n`, 'utf8');

    loadWorkspaceEnv(workspace);

    expect(process.env[rootKey]).toBe('root-value');
    expect(process.env[explicitKey]).toBe('explicit-value');
  });
});
