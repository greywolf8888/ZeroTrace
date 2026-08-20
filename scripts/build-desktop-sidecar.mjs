import { mkdirSync } from 'node:fs';
import { arch, platform } from 'node:process';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) =>
  value.slice(1),
);
const triples = {
  'win32:x64': ['node22-win-x64', 'x86_64-pc-windows-msvc', '.exe'],
  'win32:arm64': ['node22-win-arm64', 'aarch64-pc-windows-msvc', '.exe'],
  'linux:x64': ['node22-linux-x64', 'x86_64-unknown-linux-gnu', ''],
  'darwin:x64': ['node22-macos-x64', 'x86_64-apple-darwin', ''],
  'darwin:arm64': ['node22-macos-arm64', 'aarch64-apple-darwin', ''],
};
const selected = triples[`${platform}:${arch}`];
if (selected === undefined) {
  throw new Error(`不支持的 Desktop sidecar 构建目标：${platform}/${arch}`);
}
const [pkgTarget, rustTriple, extension] = selected;
const binaryDirectory = join(root, 'apps', 'desktop', 'src-tauri', 'binaries');
mkdirSync(binaryDirectory, { recursive: true });
const output = join(binaryDirectory, `zerotrace-api-${rustTriple}${extension}`);
const sourceEntry = join(root, 'apps', 'api', 'dist', 'src', 'server.js');
const entry = join(root, 'apps', 'api', 'dist', 'desktop-server.mjs');
const esbuildCli = join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
const pkgCli = join(root, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
const bundle = spawnSync(
  process.execPath,
  [
    esbuildCli,
    sourceEntry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node22',
    `--outfile=${entry}`,
    '--log-level=warning',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (bundle.status !== 0) {
  throw new Error(`Desktop API 单文件 bundle 失败，退出码 ${bundle.status ?? 'unknown'}`);
}
const result = spawnSync(
  process.execPath,
  [
    pkgCli,
    entry,
    '--target',
    pkgTarget,
    '--output',
    output,
    '--no-bytecode',
    '--public',
    '--fallback-to-source',
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (result.status !== 0) {
  throw new Error(`Desktop API sidecar 构建失败，退出码 ${result.status ?? 'unknown'}`);
}
process.stdout.write(`Desktop API sidecar：${output}\n`);
