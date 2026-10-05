import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim())
  throw new Error('请从干净提交导出；保留原工作副本改动，并使用独立干净检出。');
const argument = process.argv.indexOf('--out');
const target = path.resolve(
  root,
  argument < 0 ? 'dist-public/arc-task-ledger' : process.argv[argument + 1],
);
if (!target.startsWith(path.join(root, 'dist-public') + path.sep))
  throw new Error('导出目标必须位于本仓库 dist-public 内。');
if (fs.existsSync(target))
  throw new Error('导出目标已存在；使用 --out 选择新的候选目录，避免覆盖。');
fs.mkdirSync(target, { recursive: true });
const copied = [];
function copy(relative) {
  const source = path.join(root, relative);
  const destination = path.join(target, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('导出拒绝符号链接。');
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(source))
      if (
        ![
          'dist',
          '.types',
          'node_modules',
          'playwright-report',
          'test-results',
          'coverage',
          'output',
        ].includes(name) &&
        (relative.startsWith('tests/') ||
          (!['test-fixtures', 'fixtures'].includes(name) &&
            !name.endsWith('.test.ts') &&
            !name.endsWith('.test.tsx')))
      )
        copy(path.posix.join(relative, name));
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    copied.push(relative);
  }
}
for (const relative of [
  'packages/schemas/src',
  'packages/schemas/package.json',
  'packages/schemas/tsconfig.json',
  'packages/evidence/src',
  'packages/evidence/package.json',
  'packages/evidence/tsconfig.json',
  'packages/chain-adapters/src/transport.ts',
  'packages/chain-adapters/src/security.ts',
  'packages/chain-adapters/src/errors.ts',
  'packages/chain-adapters/package.json',
  'packages/chain-adapters/tsconfig.json',
  'packages/arc-task-ledger',
  'apps/arc-task-ledger-api',
  'apps/arc-task-ledger-web',
  'tests/arc-task-ledger',
  'examples/arc-task-ledger',
  'infra/arc-task-ledger',
  'infra/northflank',
  'scripts/arc-task-ledger-live.ts',
  'scripts/arc-receipt-current.ts',
  'scripts/arc-window-evidence.ts',
  'scripts/northflank-deploy.mjs',
  'scripts/northflank-orchestrate.mjs',
  'docs/arc-task-ledger/README.md',
  'docs/arc-task-ledger/DEPLOYMENT.md',
  'docs/arc-task-ledger/NORTHFLANK_DEPLOYMENT.md',
  'docs/arc-task-ledger/openapi.json',
  'docs/arc-task-ledger/REPAIR_ACCEPTANCE.md',
  'docs/arc-task-ledger/CONTINUOUS_ACCEPTANCE.md',
  'docs/arc-task-ledger/PUBLICATION_READINESS.md',
  'docs/arc-task-ledger/validation',
  'docs/arc-task-ledger/UPSTREAM_LICENSE.txt',
  'LICENSE',
  'eslint.config.mjs',
])
  copy(relative);
const write = (relative, value) => {
  fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
  fs.writeFileSync(
    path.join(target, relative),
    typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
  );
};
const original = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const names = ['schemas', 'evidence', 'chain-adapters', 'arc-task-ledger'];
const devNames = [
  '@types/node',
  'typescript',
  'tsx',
  'vitest',
  '@playwright/test',
  'eslint',
  '@eslint/js',
  'eslint-plugin-react-hooks',
  'globals',
  'typescript-eslint',
  'prettier',
  'license-checker-rseidelsohn',
];
write('package.json', {
  name: 'arc-task-ledger-release',
  version: '1.1.0',
  private: true,
  type: 'module',
  license: 'Apache-2.0',
  engines: original.engines,
  workspaces: ['packages/*', 'apps/*'],
  scripts: {
    'arc:build': original.scripts['arc:build'],
    'arc:migrate': original.scripts['arc:migrate'],
    'arc:worker': original.scripts['arc:worker'],
    'arc:test:unit': original.scripts['arc:test:unit'],
    'arc:test:integration': original.scripts['arc:test:integration'],
    'arc:test:e2e': original.scripts['arc:test:e2e'],
    'arc:test:live': original.scripts['arc:test:live'],
    'arc:start': 'npm run start -w @zerotrace/arc-task-ledger-api',
    lint: 'eslint . --max-warnings=0',
    'license:check': original.scripts['license:check'],
  },
  devDependencies: Object.fromEntries(
    devNames.map((name) => [name, original.devDependencies[name]]),
  ),
});
const base = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.base.json'), 'utf8'));
base.compilerOptions.paths = Object.fromEntries(
  names.map((name) => [
    `@zerotrace/${name}`,
    [`./packages/${name}/src/${name === 'chain-adapters' ? 'transport' : 'index'}.ts`],
  ]),
);
write('tsconfig.base.json', base);
write('tsconfig.json', {
  extends: './tsconfig.base.json',
  files: [],
  references: [
    ...names.map((name) => ({ path: `./packages/${name}` })),
    { path: './apps/arc-task-ledger-api' },
    { path: './apps/arc-task-ledger-web' },
  ],
});
for (const name of names) {
  const relative = `packages/${name}/package.json`;
  const manifest = JSON.parse(fs.readFileSync(path.join(target, relative), 'utf8'));
  manifest.license = 'Apache-2.0';
  write(relative, manifest);
}
const chain = JSON.parse(
  fs.readFileSync(path.join(target, 'packages/chain-adapters/package.json'), 'utf8'),
);
chain.main = 'dist/transport.js';
chain.types = 'dist/transport.d.ts';
chain.dependencies = { '@zerotrace/evidence': '*' };
chain.exports['.'] = { types: './dist/transport.d.ts', default: './dist/transport.js' };
write('packages/chain-adapters/package.json', chain);
write('packages/chain-adapters/tsconfig.json', {
  extends: '../../tsconfig.base.json',
  compilerOptions: { rootDir: 'src', outDir: 'dist', tsBuildInfoFile: 'dist/.tsbuildinfo' },
  include: ['src/**/*.ts'],
  references: [{ path: '../evidence' }],
});
write(
  'vitest.config.ts',
  `import {defineConfig} from 'vitest/config';import {fileURLToPath} from 'node:url';export default defineConfig({resolve:{alias:{'@zerotrace/chain-adapters/transport':fileURLToPath(new URL('./packages/chain-adapters/src/transport.ts',import.meta.url)),'@zerotrace/chain-adapters/security':fileURLToPath(new URL('./packages/chain-adapters/src/security.ts',import.meta.url)),${names.map((name) => `'@zerotrace/${name}':fileURLToPath(new URL('./packages/${name}/src/${name === 'chain-adapters' ? 'transport' : 'index'}.ts',import.meta.url))`).join(',')}}},test:{testTimeout:15000,hookTimeout:15000,exclude:['**/node_modules/**','**/dist/**','**/tests/**/e2e/**']}});\n`,
);
write(
  '.dockerignore',
  fs.readFileSync(path.join(root, 'infra/arc-task-ledger/.dockerignore'), 'utf8'),
);
write(
  'README.md',
  '# Arc 任务证据组件\n\n独立候选源码包。参见 docs/arc-task-ledger/README.md 与验收记录。没有公开部署、主网生产门禁或上游采用声明。\n',
);
write(
  'docs/arc-task-ledger/FINAL_ACCEPTANCE.md',
  '# 独立候选边界\n\n此目录是本地导出，不表示已经公开部署。实际本地测试与生产主网状态以原工作副本同版本的验收收据为准。当前状态与主网案例见随包脱敏验收记录；定点区块不代表完整历史，不得将测试样例作为主网记录。\n',
);
// 导出后的 Compose 只能从自身根目录构建，不能再次寻找原仓库的 dist-public。
const composeRelative = 'infra/arc-task-ledger/compose.yaml';
write(
  composeRelative,
  fs
    .readFileSync(path.join(target, composeRelative), 'utf8')
    .replaceAll('context: ../../dist-public/arc-task-ledger', 'context: ../..'),
);
write(
  'NOTICE',
  'ZeroTrace Arc Task Ledger\n原创组件及所选 ZeroTrace 核心使用 Apache-2.0。\nArcBounty 部署 ABI/接口来自 MIT 项目 Sofiia7/ARC，版权声明见 docs/arc-task-ledger/UPSTREAM_LICENSE.txt。\nchain-adapters 导出仅保留原 transport/security/errors 源文件，未复制上游资金操作实现。\n',
);
// 保留原锁定版本，只抽取此导出的依赖闭包，不从 registry 再选择版本。
const originalLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const rootManifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
const locked = {
  name: rootManifest.name,
  version: rootManifest.version,
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: rootManifest.name,
      version: rootManifest.version,
      license: rootManifest.license,
      workspaces: rootManifest.workspaces,
      devDependencies: rootManifest.devDependencies,
      engines: rootManifest.engines,
    },
  },
};
const pending = [];
for (const folder of ['packages', 'apps'])
  for (const name of fs.readdirSync(path.join(target, folder))) {
    const rel = `${folder}/${name}`;
    const manifest = JSON.parse(fs.readFileSync(path.join(target, rel, 'package.json'), 'utf8'));
    locked.packages[rel] = {
      ...originalLock.packages[rel],
      version: manifest.version,
      license: manifest.license,
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
    };
    locked.packages[`node_modules/${manifest.name}`] = { resolved: rel, link: true };
    pending.push(rel);
  }
pending.push('');
function resolve(start, name) {
  let dir = start;
  for (;;) {
    const key = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (originalLock.packages[key]) return key;
    if (!dir) break;
    const parent = path.posix.dirname(dir);
    dir = parent === '.' ? '' : parent;
  }
  return undefined;
}
const walked = new Set();
while (pending.length) {
  const rel = pending.shift();
  if (walked.has(rel)) continue;
  walked.add(rel);
  const entry = locked.packages[rel];
  if (entry.link) {
    if (!locked.packages[entry.resolved]) throw new Error('导出依赖引用了范围外的私有 workspace。');
    pending.push(entry.resolved);
    continue;
  }
  const deps = {
    ...entry.dependencies,
    ...entry.optionalDependencies,
    ...entry.peerDependencies,
    ...(rel === '' || rel.startsWith('apps/') || rel.startsWith('packages/')
      ? entry.devDependencies
      : {}),
  };
  for (const name of Object.keys(deps)) {
    const key = resolve(rel, name);
    if (!key) {
      if (entry.optionalDependencies?.[name] || entry.peerDependencies?.[name]) continue;
      throw new Error(`缺少锁定依赖 ${rel}:${name}`);
    }
    if (!locked.packages[key]) {
      locked.packages[key] = originalLock.packages[key];
      pending.push(key);
    }
  }
}
// dev 标记按导出依赖图重新计算，不能继承原全平台的生产可达性。
const production = new Set();
const productionQueue = Object.keys(locked.packages).filter(
  (rel) => rel.startsWith('apps/') || rel.startsWith('packages/'),
);
while (productionQueue.length) {
  const rel = productionQueue.shift();
  if (production.has(rel)) continue;
  production.add(rel);
  const entry = locked.packages[rel];
  if (entry.link) {
    productionQueue.push(entry.resolved);
    continue;
  }
  const deps = {
    ...entry.dependencies,
    ...entry.optionalDependencies,
    ...Object.fromEntries(
      Object.entries(entry.peerDependencies ?? {}).filter(
        ([name]) => !entry.peerDependenciesMeta?.[name]?.optional,
      ),
    ),
  };
  for (const name of Object.keys(deps)) {
    const key = resolve(rel, name);
    if (key && locked.packages[key]) productionQueue.push(key);
  }
}
for (const [rel, entry] of Object.entries(locked.packages)) {
  delete entry.devOptional;
  if (rel && !production.has(rel)) entry.dev = true;
  else delete entry.dev;
}
write('package-lock.json', locked);
const generated = [
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'tsconfig.json',
  'vitest.config.ts',
  '.dockerignore',
  'README.md',
  'NOTICE',
  'docs/arc-task-ledger/FINAL_ACCEPTANCE.md',
];
const files = [...new Set([...copied, ...generated])].sort().map((relative) => ({
  path: relative,
  sha256: crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(target, relative)))
    .digest('hex'),
}));
write('release-manifest.json', {
  schemaVersion: 'atl-public-export-v1',
  sourceCommit,
  version: '1.1.0',
  published: false,
  privateHistoryIncluded: false,
  files,
});
console.info(
  `候选导出完成：${target}，${files.length} 个已列明源码文件；需独立安装与构建后再判定可复现。`,
);
