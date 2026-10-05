import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NorthflankClient, apiCreationPayload } from './northflank-deploy.mjs';

const project = 'arctrace';
const branch = 'deploy/arc-task-ledger-northflank';
const names = new Set(['atl-api', 'atl-web', 'atl-postgres', 'atl-migrate', 'atl-sync']);
export function assertScope(resources, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('必须指定完整的托管源码提交。');
  if (resources.some((r) => !names.has(r.id)))
    throw new Error('专用项目存在范围外资源，停止修改。');
}
export function hostedCurrentVerified(coverage) {
  return Boolean(
    coverage?.lastSuccessfulSync &&
    coverage.coverage?.currentState?.state === 'known' &&
    coverage.coverage.currentState.value === 'complete' &&
    coverage.coverage?.deploymentVerification?.state === 'known' &&
    coverage.coverage.deploymentVerification.value === 'complete',
  );
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const mode = process.argv[2] ?? 'status';
  if (!['apply', 'status', 'sync', 'restart', 'schedule'].includes(mode))
    throw new Error('模式不合法。');
  const token =
    process.env.NORTHFLANK_API_TOKEN ??
    fs.readFileSync(process.env.NORTHFLANK_TOKEN_FILE, 'utf8').trim();
  const client = new NorthflankClient(token);
  const sha = process.env.NORTHFLANK_SOURCE_SHA;
  const root = path.resolve(process.env.NORTHFLANK_STATE_DIR ?? '.agent-state/arc-northflank');
  if (!root.startsWith(path.resolve('.agent-state') + path.sep))
    throw new Error('运行状态必须保存在本工作目录的私有 .agent-state 内。');
  fs.mkdirSync(root, { recursive: true });
  const stateFile = path.join(root, 'orchestration.private.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  const journal = [];
  const request = async (endpoint, method = 'GET', body) => {
    const response = await client.request(endpoint, { method, body });
    const record = { at: new Date().toISOString(), endpoint, method, resourceId: response.data.id };
    journal.push(record);
    fs.appendFileSync(path.join(root, 'commands.jsonl'), JSON.stringify(record) + '\n');
    return response.data;
  };
  const p = `/v1/projects/${project}`;
  const inventory = async () => {
    const services = await client.list(p + '/services', 'services');
    const addons = await client.list(p + '/addons', 'addons');
    const jobs = await client.list(p + '/jobs', 'jobs');
    assertScope([...services, ...addons, ...jobs], sha);
    return { services, addons, jobs };
  };
  let resources = await inventory();
  if (mode === 'status') {
    console.log(
      JSON.stringify({
        project,
        sourceSha: sha,
        resources: Object.fromEntries(
          Object.entries(resources).map(([kind, items]) => [
            kind,
            items.map((r) => ({ id: r.id, status: r.status })),
          ]),
        ),
      }),
    );
    return;
  }
  if (!process.argv.includes('--sandbox-confirmed-by-user'))
    throw new Error('仅在用户已明确确认免费 Sandbox 和零新增支出的授权下执行。');
  if (state.sourceSha && state.sourceSha !== sha)
    throw new Error('先完成版本切换核对，再更新状态提交；稳定游标和数据库密钥必须保留。');
  state.sourceSha = sha;
  save();
  const pin = { id: 'atl-api', branch };
  const runOnce = async (job, key) => {
    state.runs ??= {};
    let runId = state.runs[key]?.id;
    if (!runId && state.runs[key]?.posting) {
      const runs = await client.list(p + `/jobs/${job}/runs`, 'runs');
      const newRuns = runs.filter((r) => !state.runs[key].before.includes(r.id));
      if (newRuns.length !== 1) throw new Error('任务写入结果待核对，禁止重复触发。');
      runId = newRuns[0].id;
      state.runs[key] = { id: runId };
      save();
    }
    if (!runId) {
      const before = await client.list(p + `/jobs/${job}/runs`, 'runs');
      state.runs[key] = { posting: true, before: before.map((r) => r.id) };
      save();
      const result = await request(p + `/jobs/${job}/runs`, 'POST', {});
      runId = result.id;
      state.runs[key] = { id: runId };
      save();
    }
    for (let i = 0; i < 36; i++) {
      const run = await request(p + `/jobs/${job}/runs/${runId}`);
      if (run.status === 'SUCCESS') return run;
      if (run.status === 'FAILED')
        throw new Error(`任务 ${job} 失败，保留记录后修复并使用新的运行标识。`);
      await sleep(10000);
    }
    throw new Error('任务仍在执行；重入时继续查询已有运行，不重复触发。');
  };
  const publicRead = async (suffix) => {
    const web = await request(p + '/services/atl-web');
    const port = web.ports.find((item) => item.name === 'web' && item.public);
    if (!port?.dns?.endsWith('.code.run')) throw new Error('平台尚未返回公开 HTTPS 域名。');
    const response = await fetch(`https://${port.dns}${suffix}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTPS 实际验收失败：${response.status}`);
    return response.json();
  };
  if (mode === 'restart') {
    const before = await publicRead('/api/v1/jobs?limit=1');
    const api = await request(p + '/services/atl-api');
    if (api.deployment?.internal?.deployedSHA !== sha)
      throw new Error('实际部署提交与验收目标不同。');
    await request(p + '/services/atl-api/restart', 'POST', {});
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      try {
        await publicRead('/api/readyz');
        const cursor = before.nextCursor;
        const suffix = cursor
          ? `/api/v1/jobs?limit=1&cursor=${encodeURIComponent(cursor)}`
          : '/api/v1/jobs?limit=1';
        const after = await publicRead(suffix);
        if (before.snapshotRunId !== after.snapshotRunId) throw new Error('重启后快照身份不同。');
        console.log(
          JSON.stringify({ status: 'API_RESTART_VALIDATED', snapshotRunId: after.snapshotRunId }),
        );
        return;
      } catch (error) {
        if (i === 23) throw error;
      }
    }
  }
  if (mode === 'schedule') {
    const coverage = await publicRead('/api/v1/coverage');
    if (!hostedCurrentVerified(coverage))
      throw new Error('主网当前状态尚未核验，保持定时任务暂停。');
    await request(p + '/jobs/atl-sync', 'PATCH', {
      settings: {
        cron: {
          schedule: '*/10 * * * *',
          suspended: false,
          concurrencyPolicy: 'forbid',
        },
      },
    });
    console.log(JSON.stringify({ status: 'CRON_CONFIGURED_ACTUAL_TRIGGER_NOT_YET_VALIDATED' }));
    return;
  }
  if (mode === 'sync') {
    const job = await request(p + '/jobs/atl-sync');
    if (
      job.deployment?.internal?.buildId &&
      state.apiBuildId &&
      job.deployment.internal.buildId !== state.apiBuildId
    )
      throw new Error('采集镜像与版本记录不符。');
    const run = await runOnce('atl-sync', process.env.NORTHFLANK_RUN_KEY ?? 'manual-sync');
    await publicRead('/api/v1/jobs?limit=1');
    console.log(JSON.stringify({ status: 'HOSTED_SYNC_VALIDATED', runId: run.id }));
    return;
  }
  if (resources.jobs.length && (!state.cursor || !state.readerPassword))
    throw new Error('既有部署必须复用已保存的稳定游标和只读数据库密钥，禁止重新生成。');
  if (resources.jobs.some((r) => r.id === 'atl-sync'))
    await request(p + '/jobs/atl-sync', 'PATCH', {
      settings: {
        cron: {
          schedule: '*/10 * * * *',
          suspended: true,
          concurrencyPolicy: 'forbid',
        },
      },
    });
  // 创建结果未知时不重发；下一次以资源清单核对。仅创建声明的五个免费规格资源。
  if (!resources.services.some((r) => r.id === 'atl-api'))
    await request(p + '/services/combined', 'POST', apiCreationPayload());
  if (!resources.addons.some((r) => r.id === 'atl-postgres'))
    await request(p + '/addons', 'POST', {
      name: 'atl-postgres',
      type: 'postgresql',
      version: '16',
      billing: {
        deploymentPlan: 'nf-compute-20',
        storage: 4096,
        replicas: 1,
        diskAutoscaling: { enabled: false },
        zonalRedundancy: { type: 'disabled' },
      },
      tlsEnabled: true,
      externalAccessEnabled: false,
      vpcAccessible: false,
      backupSchedules: [],
    });
  const ensureBuild = async (id) => {
    const list = await client.list(p + `/services/${id}/build`, 'builds');
    const build = list.find((b) => b.sha === sha && b.status === 'SUCCESS');
    if (build) return build.id;
    const pending = list.find((b) => b.sha === sha && !b.concluded);
    if (!pending && !state.buildRequested?.[id]) {
      state.buildRequested ??= {};
      state.buildRequested[id] = true;
      save();
      await request(p + `/services/${id}/build`, 'POST', { sha });
    }
    throw new Error('指定提交正在构建；重入后核验同一提交与构建 ID。');
  };
  pin.buildId = await ensureBuild('atl-api');
  state.apiBuildId = pin.buildId;
  save();
  const addon = await request(p + '/addons/atl-postgres');
  if (addon.status !== 'running') throw new Error('数据库仍在启动，重入后继续。');
  const addonConfig = addon.spec?.config;
  if (
    addon.spec?.type !== 'postgresql' ||
    addonConfig?.versionTag !== '16' ||
    addonConfig?.deployment?.planId !== 'nf-compute-20' ||
    addonConfig?.deployment?.storageSize !== 4096 ||
    addonConfig?.deployment?.replicas !== 1 ||
    addonConfig?.networking?.tlsEnabled !== true ||
    addonConfig?.networking?.externalAccessEnabled !== false ||
    addonConfig?.networking?.vpcAccessible !== false
  )
    throw new Error('实际数据库规格或私有 TLS 边界不符，停止配置凭据。');
  const credentials = await request(p + '/addons/atl-postgres/credentials');
  const uri = (value) => {
    const url = new URL(value);
    url.searchParams.set('sslmode', 'verify-full');
    return url;
  };
  const worker = uri(credentials.envs.POSTGRES_URI);
  state.cursor ??= crypto.randomBytes(32).toString('hex');
  state.readerPassword ??= crypto.randomBytes(32).toString('hex');
  state.requestPassword ??= crypto.randomBytes(32).toString('hex');
  save();
  const apiUri = new URL(worker);
  apiUri.username = 'atl_api_reader';
  apiUri.password = state.readerPassword;
  const requestUri = new URL(worker);
  requestUri.username = 'atl_evidence_requester';
  requestUri.password = state.requestPassword;
  const registered = JSON.parse(
    fs.readFileSync(
      new URL('../packages/arc-task-ledger/src/deployment.json', import.meta.url),
      'utf8',
    ),
  );
  const defaultSource = registered.rpcCandidates.find(
    (source) => source.alias === registered.defaultRpcAlias,
  );
  const rpcUrl = process.env.ARC_RPC_URL ?? defaultSource?.url;
  if (!rpcUrl) throw new Error('默认 RPC 来源未登记。');
  const rpcSource = registered.rpcCandidates.find(
    (source) => new URL(source.url).origin === new URL(rpcUrl).origin,
  );
  if (!rpcSource) throw new Error('托管 RPC 来源不在登记范围内。');
  const runtime = {
    ARC_DATABASE_URL: worker.href,
    ARC_CURSOR_SECRET: state.cursor,
    ARC_API_HOST: '0.0.0.0',
    ARC_API_PORT: '8087',
    ARC_INTERNAL_API_HOST: 'atl-api',
    ARC_INTERNAL_API_PORT: '8087',
    ARC_RPC_URL: rpcUrl,
    ARC_PROVIDER_ALIAS: rpcSource.alias,
    ARC_MAX_JOBS: '1000',
    ARC_SCAN_BLOCK_BUDGET: '2000',
    ARC_RECENT_BLOCK_BUDGET: '2000',
    ARC_PROOF_BLOCK_BUDGET: '2000',
    ARC_HISTORY_FROM_BLOCK: process.env.ARC_HISTORY_FROM_BLOCK ?? '23388428',
    ARC_EVIDENCE_BLOCKS: process.env.ARC_EVIDENCE_BLOCKS ?? '23388428,23465819,23466663,23508410',
  };
  const migrationEnv = {
    ...runtime,
    ARC_DATABASE_URL: uri(credentials.envs.POSTGRES_URI_ADMIN).href,
    ARC_WORKER_DB_ROLE: credentials.secrets.USERNAME,
    ARC_READER_DB_ROLE: 'atl_api_reader',
    ARC_READER_DB_PASSWORD: state.readerPassword,
    ARC_REQUEST_DB_PASSWORD: state.requestPassword,
  };
  const bootstrap = fs.readFileSync('infra/northflank/migration-bootstrap.mjs');
  const command = `node --input-type=module -e 'const r=await fetch("http://atl-api:8087/readyz",{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error("API 数据库未就绪");await import("./apps/arc-task-ledger-api/dist/worker.js");'`;
  for (const [id, env, cmd] of [
    ['atl-migrate', migrationEnv, 'node infra/northflank/migration-bootstrap.mjs'],
    ['atl-sync', runtime, command],
  ]) {
    const files =
      id === 'atl-migrate'
        ? {
            '/app/infra/northflank/migration-bootstrap.mjs': {
              data: bootstrap.toString('base64'),
              encoding: 'base64',
            },
          }
        : {};
    if (!resources.jobs.some((r) => r.id === id))
      await request(p + '/jobs', 'POST', {
        name: id,
        billing: { deploymentPlan: 'nf-compute-10' },
        deployment: { internal: pin, docker: { configType: 'customCommand', customCommand: cmd } },
        runtimeEnvironment: env,
        runtimeFiles: files,
        settings: {
          backoffLimit: 0,
          runOnSourceChange: 'never',
          activeDeadlineSeconds: 240,
          cron: { schedule: '*/10 * * * *', suspended: true, concurrencyPolicy: 'forbid' },
        },
      });
    else {
      await request(p + `/jobs/${id}`, 'PATCH', { runtimeEnvironment: env, runtimeFiles: files });
      await request(p + `/jobs/${id}/deployment`, 'POST', {
        internal: pin,
        docker: { configType: 'customCommand', customCommand: cmd },
      });
    }
  }
  await runOnce('atl-migrate', 'migration');
  await request(p + '/services/atl-api/deployment', 'POST', {
    internal: pin,
    docker: { configType: 'default' },
  });
  await request(p + '/services/combined/atl-api', 'PATCH', {
    runtimeEnvironment: {
      ARC_DATABASE_URL: apiUri.href,
      ARC_REQUEST_DATABASE_URL: requestUri.href,
      ARC_CURSOR_SECRET: state.cursor,
      ARC_API_HOST: '0.0.0.0',
      ARC_API_PORT: '8087',
    },
    deployment: { instances: 1 },
    disabledCI: true,
  });
  await runOnce('atl-sync', 'first-sync');
  if (!resources.services.some((r) => r.id === 'atl-web')) {
    const web = apiCreationPayload();
    web.name = 'atl-web';
    web.buildConfiguration.dockerfileTarget = 'web';
    web.ports = [{ name: 'web', internalPort: 8080, protocol: 'HTTP', public: true }];
    web.runtimeEnvironment = { ARC_INTERNAL_API_HOST: 'atl-api', ARC_INTERNAL_API_PORT: '8087' };
    web.healthChecks = [
      {
        protocol: 'HTTP',
        type: 'readinessProbe',
        path: '/',
        port: 8080,
        initialDelaySeconds: 5,
        periodSeconds: 10,
        timeoutSeconds: 3,
        failureThreshold: 3,
        successThreshold: 1,
      },
    ];
    await request(p + '/services/combined', 'POST', web);
  }
  state.webBuildId = await ensureBuild('atl-web');
  save();
  await request(p + '/services/atl-web/deployment', 'POST', {
    internal: { id: 'atl-web', branch, buildId: state.webBuildId },
    docker: { configType: 'default' },
  });
  await request(p + '/services/combined/atl-web', 'PATCH', {
    deployment: { instances: 1 },
    disabledCI: true,
    runtimeEnvironment: { ARC_INTERNAL_API_HOST: 'atl-api', ARC_INTERNAL_API_PORT: '8087' },
  });
  resources = await inventory();
  console.log(
    JSON.stringify({
      status: 'RESOURCES_CONFIGURED_REQUIRE_HTTPS_RESTART_CRON_ACCEPTANCE',
      project,
      sourceSha: sha,
      resources: Object.values(resources)
        .flat()
        .map((r) => r.id),
      commands: journal.length,
    }),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error('托管操作未完成；保留私有运行记录，核对后重入。');
    process.exitCode = 1;
  });
