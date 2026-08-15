import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadWorkspaceEnv } from '../../src/workspace-env.js';

const testKeys: string[] = [];
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const key of testKeys.splice(0)) delete process.env[key];
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loadWorkspaceEnv', () => {
  it('loads a repository-root .env from an npm workspace cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'zerotrace-env-'));
    temporaryRoots.push(root);
    const workspace = join(root, 'apps', 'api');
    mkdirSync(workspace, { recursive: true });
    const key = `ZEROTRACE_ENV_TEST_${process.pid}_ROOT`;
    testKeys.push(key);
    writeFileSync(join(root, '.env'), `${key}=root-value\n`, 'utf8');

    loadWorkspaceEnv(workspace);

    expect(process.env[key]).toBe('root-value');
  });

  it('does not override an explicitly supplied process environment value', () => {
    const root = mkdtempSync(join(tmpdir(), 'zerotrace-env-'));
    temporaryRoots.push(root);
    const workspace = join(root, 'services', 'worker');
    mkdirSync(workspace, { recursive: true });
    const key = `ZEROTRACE_ENV_TEST_${process.pid}_EXPLICIT`;
    testKeys.push(key);
    process.env[key] = 'explicit-value';
    writeFileSync(join(root, '.env'), `${key}=file-value\n`, 'utf8');

    loadWorkspaceEnv(workspace);

    expect(process.env[key]).toBe('explicit-value');
  });

  it('uses the nearest .env without merging a parent directory file', () => {
    const root = mkdtempSync(join(tmpdir(), 'zerotrace-env-'));
    temporaryRoots.push(root);
    const workspace = join(root, 'apps', 'api');
    const nearest = join(root, 'apps');
    mkdirSync(workspace, { recursive: true });
    const nearestKey = `ZEROTRACE_ENV_TEST_${process.pid}_NEAREST`;
    const parentKey = `ZEROTRACE_ENV_TEST_${process.pid}_PARENT`;
    testKeys.push(nearestKey, parentKey);
    writeFileSync(join(nearest, '.env'), `${nearestKey}=nearest-value\n`, 'utf8');
    writeFileSync(join(root, '.env'), `${parentKey}=parent-value\n`, 'utf8');

    loadWorkspaceEnv(workspace);

    expect(process.env[nearestKey]).toBe('nearest-value');
    expect(process.env[parentKey]).toBeUndefined();
  });
});
