import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface VisualGoldenCase {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
}

interface VisualGoldenManifest {
  schemaVersion: 'zerotrace-visual-golden-v1';
  status: 'MEASURED';
  capturedAt: string;
  implementationSha: string;
  sourceFingerprint: string;
  target: string;
  cases: VisualGoldenCase[];
  notes: string[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotDirectory = join(root, 'tests', 'e2e', 'visual-golden');
const manifestPath = join(root, 'docs', 'terminal-market-structure', '视觉基线.json');
const expectedIds = [
  'provider-down-light-1366x768',
  'provider-table-dark-long',
  'workbench-dark-1920x1080',
  'workbench-dark-narrow-390x844',
  'workbench-dark-scale125-physical1920x1080',
  'workbench-light-1366x768',
  'workbench-light-scale150-physical1920x1080',
] as const;

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function trackedVisualSources(): string[] {
  const output = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--',
      'apps/web/index.html',
      'apps/web/package.json',
      'apps/web/public',
      'apps/web/src',
      'package.json',
      'package-lock.json',
      'playwright.config.ts',
      'tests/e2e/visual-golden.spec.ts',
    ],
    { cwd: root },
  ).toString('utf8');
  return output
    .split('\0')
    .filter((path) => path.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function visualSourceFingerprint(): string {
  const hash = createHash('sha256');
  hash.update('zerotrace-visual-golden-source-v1\0');
  for (const path of trackedVisualSources()) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(root, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function pngDimensions(value: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (value.length < 24 || !value.subarray(0, 8).equals(signature)) {
    throw new Error('视觉基线包含非 PNG 文件。');
  }
  return { width: value.readUInt32BE(16), height: value.readUInt32BE(20) };
}

function measuredCases(): VisualGoldenCase[] {
  if (!existsSync(snapshotDirectory)) return [];
  return readdirSync(snapshotDirectory)
    .filter((name) => name.endsWith('.png'))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const value = readFileSync(join(snapshotDirectory, name));
      const dimensions = pngDimensions(value);
      return {
        id: name.slice(0, -4),
        path: relative(root, join(snapshotDirectory, name)).replaceAll('\\', '/'),
        sha256: sha256(value),
        bytes: value.length,
        ...dimensions,
      };
    });
}

function currentGitSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString('utf8').trim();
}

function isAncestor(ancestor: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, 'HEAD'], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const cases = measuredCases();
const caseIds = cases.map((item) => item.id);
const expected = [...expectedIds].sort((left, right) => left.localeCompare(right));
const errors: string[] = [];
if (JSON.stringify(caseIds) !== JSON.stringify(expected)) {
  errors.push(`视觉案例集合不完整：expected=${expected.join(',')} actual=${caseIds.join(',')}`);
}

const candidate: VisualGoldenManifest = {
  schemaVersion: 'zerotrace-visual-golden-v1',
  status: 'MEASURED',
  capturedAt: new Date().toISOString(),
  implementationSha: currentGitSha(),
  sourceFingerprint: visualSourceFingerprint(),
  target: 'Windows Chromium / Tauri WebView 等效 CSS 视口；不替代签名清洁机原生 DPI 验收',
  cases,
  notes: [
    '覆盖浅深主题、1920×1080、1366×768、100%/125%/150% 等效像素密度、390×844 窄屏、来源故障和长数据源表。',
    '固定响应仅存在于 E2E 测试路径，不是主网事实、收益样例或生产夹具。',
  ],
};

if (process.argv.includes('--candidate')) {
  process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
} else if (!existsSync(manifestPath)) {
  errors.push('视觉基线清单不存在；先生成截图并审阅候选。');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VisualGoldenManifest;
  if (manifest.schemaVersion !== candidate.schemaVersion || manifest.status !== 'MEASURED') {
    errors.push('视觉基线 schema 或状态无效。');
  }
  if (manifest.sourceFingerprint !== candidate.sourceFingerprint) {
    errors.push('视觉基线源码指纹已过期。');
  }
  if (!isAncestor(manifest.implementationSha)) {
    errors.push('视觉基线实现提交不是当前 HEAD 的祖先。');
  }
  if (JSON.stringify(manifest.cases) !== JSON.stringify(candidate.cases)) {
    errors.push('视觉截图哈希、尺寸、字节数或案例集合与清单不一致。');
  }
}

if (errors.length > 0) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', errors }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: process.argv.includes('--candidate') ? 'MEASURED_CANDIDATE' : 'PASS',
        sourceFingerprint: candidate.sourceFingerprint,
        caseCount: cases.length,
        cases: cases.map(({ id, width, height, sha256: hash }) => ({
          id,
          width,
          height,
          sha256: hash,
        })),
      },
      null,
      2,
    )}\n`,
  );
}
