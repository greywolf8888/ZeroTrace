import { hashPayload } from '@zerotrace/evidence';
import { DEPLOYMENT } from './config.js';
import type { ArcReader } from './reader.js';
import type { LedgerRepository } from './storage.js';
import { lifecycle, protocolAtoms, ruleMetadata } from './protocol.js';
import { accountPending, settlement, sequenceCleared } from './settlement.js';
import {
  LedgerError,
  RULE_VERSION,
  ZERO_ADDRESS,
  amount,
  known,
  unknown,
  emptyCoverage,
  type Snapshot,
  type Receipt,
  type StoredEvidence,
  type SnapshotRun,
  type RawMeta,
  type JobDetail,
  type PendingAccount,
  type HistoryRange,
  decimal,
} from './types.js';

async function readWindow(
  reader: ArcReader,
  snapshot: Snapshot,
  from: string,
  to: string,
  observations: StoredEvidence[],
  receipts: { receipt: Receipt; observationId: string }[],
  store?: LedgerRepository,
) {
  const before = await reader.block(to);
  const logs = await reader.logs(from, to);
  const segmentEvidence = reader.observe(
    { from: from, to: to, logs, anchor: before },
    snapshot,
    `eth_getLogs:${from}-${to}`,
    '受控区间完整日志请求与锚点。',
  );
  observations.push(segmentEvidence);
  const hashes = [...new Set(logs.map((l) => l.transactionHash))];
  for (const tx of hashes) {
    const cached = await store?.cachedReceipt?.(tx, reader.transport.endpointId);
    const receipt =
      cached?.receipt ?? (await reader.read<Receipt | null>('eth_getTransactionReceipt', [tx]));
    if (
      !receipt ||
      receipt.transactionHash !== tx ||
      receipt.status !== '0x1' ||
      !Array.isArray(receipt.logs)
    )
      throw new LedgerError('RECEIPT_UNAVAILABLE', '关联回执缺失或格式无效。');
    const log = logs.find((l) => l.transactionHash === tx)!;
    if (
      receipt.blockHash !== log.blockHash ||
      BigInt(receipt.blockNumber) !== BigInt(log.blockNumber) ||
      (await reader.block(BigInt(receipt.blockNumber).toString())).hash !== receipt.blockHash
    )
      throw new LedgerError('SOURCE_CONFLICT', '回执与日志/区块锚点冲突。', 409);
    for (const observed of logs.filter((l) => l.transactionHash === tx))
      if (
        !receipt.logs.some(
          (l) =>
            BigInt(l.logIndex) === BigInt(observed.logIndex) &&
            l.address.toLowerCase() === observed.address.toLowerCase() &&
            l.data === observed.data &&
            JSON.stringify(l.topics) === JSON.stringify(observed.topics),
        )
      )
        throw new LedgerError('RECEIPT_CONFLICT', '回执未包含查询返回的完整协议日志。', 409);
    const evidence =
      cached?.evidence ??
      reader.observe(
        receipt,
        snapshot,
        `eth_getTransactionReceipt:${tx}`,
        '协议交易完整原始回执。',
      );
    observations.push(evidence);
    receipts.push({ receipt, observationId: evidence.id });
  }
  if ((await reader.block(to)).hash !== before.hash)
    throw new LedgerError('SOURCE_CONFLICT', '日志窗口锚点变化。', 409);
  return { before, logs };
}

export async function captureEvidenceBlocks(
  reader: ArcReader,
  store: LedgerRepository,
  snapshot: Snapshot,
  blocks: string[],
) {
  if (blocks.length > 10)
    throw new LedgerError('EVIDENCE_BLOCK_LIMIT', '定点回执核验最多10个区块。', 400);
  for (const height of [...new Set(blocks)]) {
    if (
      !/^(0|[1-9]\d*)$/.test(height) ||
      BigInt(height) < BigInt(DEPLOYMENT.verifiedDeploymentBlock) ||
      BigInt(height) > BigInt(snapshot.blockNumber)
    )
      throw new LedgerError('INVALID_RANGE', '定点历史区块不在已部署到固定快照的范围。', 400);
    const anchor = await reader.block(height);
    const cached = await store.capturedBlock?.(height, reader.transport.endpointId);
    if (cached) {
      if (cached.hash !== anchor.hash)
        throw new LedgerError('SOURCE_CONFLICT', '已最终确认定点区块摘要变化，停止缓存复用。', 409);
      continue;
    }
    // 历史代码与当前代码分别验证，当前状态不代替历史部署版本。
    await reader.verifyDeployment({ ...snapshot, blockNumber: height, blockHash: anchor.hash });
    const checkpoint = await store.checkpoint(
      DEPLOYMENT.adapter,
      (BigInt(DEPLOYMENT.verifiedDeploymentBlock) - 1n).toString(),
    );
    const observations: StoredEvidence[] = [];
    const receipts: { receipt: Receipt; observationId: string }[] = [];
    const { before, logs } = await readWindow(
      reader,
      snapshot,
      height,
      height,
      observations,
      receipts,
      store,
    );
    await store.saveSegment({
      deployment: DEPLOYMENT.adapter,
      from: height,
      to: height,
      status: 'complete',
      document: {
        scope: 'selected-block-only',
        ruleVersion: RULE_VERSION,
        snapshot,
        anchor: before,
        count: logs.length,
        evidenceIds: observations.map((e) => e.id),
      },
      observations,
      receipts,
      expectedVersion: checkpoint.version,
    });
  }
}

export async function scanHistory(
  reader: ArcReader,
  store: LedgerRepository,
  snapshot: Snapshot,
  budget: string,
  historyFromBlock = DEPLOYMENT.verifiedDeploymentBlock,
): Promise<{ head: string; errors: string[]; historyRange: HistoryRange }> {
  const opening = BigInt(decimal(historyFromBlock));
  if (
    opening < BigInt(DEPLOYMENT.verifiedDeploymentBlock) ||
    opening > BigInt(snapshot.blockNumber)
  )
    throw new LedgerError('INVALID_RANGE', '声明历史窗口不在部署到固定目标范围。', 400);
  const checkpointKey = historyCheckpointKey(historyFromBlock);
  let checkpoint = await store.checkpoint(checkpointKey, (opening - 1n).toString());
  if (BigInt(checkpoint.head) < opening - 1n)
    throw new LedgerError('CHECKPOINT_CONFLICT', '连续检查点低于声明窗口起点。', 409);
  let from = BigInt(checkpoint.head) + 1n;
  let remaining = BigInt(budget);
  let window = reader.logWindowLimit;
  const errors: string[] = [];
  while (from <= BigInt(snapshot.blockNumber) && remaining > 0n) {
    const size = [window, remaining, BigInt(snapshot.blockNumber) - from + 1n].reduce((a, b) =>
      a < b ? a : b,
    );
    const to = from + size - 1n;
    const observations: StoredEvidence[] = [];
    const receipts: { receipt: Receipt; observationId: string }[] = [];
    try {
      const { before, logs } = await readWindow(
        reader,
        snapshot,
        from.toString(),
        to.toString(),
        observations,
        receipts,
        store,
      );
      checkpoint = await store.saveSegment({
        deployment: DEPLOYMENT.adapter,
        checkpointKey,
        from: from.toString(),
        to: to.toString(),
        status: 'complete',
        document: {
          filter: { adapter: DEPLOYMENT.adapter },
          scopeFromBlock: historyFromBlock,
          snapshot,
          anchor: before,
          evidenceIds: observations.map((e) => e.id),
          count: logs.length,
        },
        observations,
        receipts,
        expectedVersion: checkpoint.version,
      });
      remaining -= size;
      from = to + 1n;
    } catch (error) {
      if (error instanceof LedgerError && error.status === 409) {
        await store.saveSegment({
          deployment: DEPLOYMENT.adapter,
          checkpointKey,
          from: from.toString(),
          to: to.toString(),
          status: 'conflict',
          document: { code: error.code, snapshot },
          observations,
          receipts: [],
          expectedVersion: checkpoint.version,
        });
        throw error;
      }
      const failure = error as { code?: string; statusCode?: number; message?: string };
      const rangeLimited =
        failure.statusCode === 413 ||
        failure.code === 'LOG_PAGE_CAP' ||
        (failure.code === 'RPC_ERROR' &&
          /range|too many|limit|response size/i.test(failure.message ?? ''));
      if (rangeLimited && window > 1n) {
        window /= 2n;
        continue;
      }
      await store.saveSegment({
        deployment: DEPLOYMENT.adapter,
        checkpointKey,
        from: from.toString(),
        to: to.toString(),
        status: 'partial',
        document: {
          code: failure.code ?? 'SOURCE_UNAVAILABLE',
          providerAlias: reader.transport.endpointId,
          snapshot,
        },
        observations,
        receipts: [],
        expectedVersion: checkpoint.version,
      });
      errors.push(`历史区间 ${from}-${to} 无法核验，连续水位保留。`);
      break;
    }
  }
  if (BigInt(checkpoint.head) < BigInt(snapshot.blockNumber))
    errors.push(`历史仅连续核验至 ${checkpoint.head}；未覆盖至当前状态区块。`);
  const head =
    BigInt(checkpoint.head) > BigInt(snapshot.blockNumber) ? snapshot.blockNumber : checkpoint.head;
  return {
    head,
    errors,
    historyRange: {
      scope:
        historyFromBlock === DEPLOYMENT.verifiedDeploymentBlock
          ? 'DEPLOYMENT_TO_SNAPSHOT'
          : 'DECLARED_WINDOW',
      fromBlock: historyFromBlock,
      targetBlock: snapshot.blockNumber,
      contiguousThrough: head,
      checkpointKey,
      checkpointVersion: checkpoint.version,
      status: BigInt(head) >= BigInt(snapshot.blockNumber) ? 'complete' : 'partial',
      omittedPriorHistory: historyFromBlock !== DEPLOYMENT.verifiedDeploymentBlock,
      gaps:
        BigInt(head) < BigInt(snapshot.blockNumber)
          ? [
              {
                fromBlock: (BigInt(head) + 1n).toString(),
                toBlock: snapshot.blockNumber,
                reason: errors[0] ?? '声明窗口尚未连续采集完成。',
              },
            ]
          : [],
    },
  };
}

export const historyCheckpointKey = (fromBlock: string): string =>
  fromBlock === DEPLOYMENT.verifiedDeploymentBlock
    ? DEPLOYMENT.adapter
    : `${DEPLOYMENT.adapter}:from:${decimal(fromBlock)}`;

/** 最新日志和请求补证分别保留自己的连续水位，不提升全历史覆盖。 */
export async function scanPriority(
  reader: ArcReader,
  store: LedgerRepository,
  snapshot: Snapshot,
  recentBudget: string,
  proofBudget: string,
) {
  const results: Record<string, unknown> = { recentBudget, proofBudget };
  const recent = BigInt(decimal(recentBudget));
  const proof = BigInt(decimal(proofBudget));
  if (recent > 2000n || proof > 2000n)
    throw new LedgerError('CONFIG_INVALID', '单轮最新/补证预算各最多2000区块。', 400);
  const request = proof > 0n ? await store.nextEvidenceRequest?.() : undefined;
  const jobs: {
    key: string;
    from: bigint;
    target: bigint;
    budget: bigint;
    request?: typeof request;
  }[] = [];
  if (recent > 0n) {
    const target = BigInt(snapshot.blockNumber);
    const lower =
      target - recent + 1n > BigInt(DEPLOYMENT.verifiedDeploymentBlock)
        ? target - recent + 1n
        : BigInt(DEPLOYMENT.verifiedDeploymentBlock);
    const key = `${DEPLOYMENT.adapter}:recent:${RULE_VERSION}`;
    const checkpoint = await store.checkpoint(key, (lower - 1n).toString());
    jobs.push({ key, from: BigInt(checkpoint.head) + 1n, target, budget: recent });
  }
  if (request && BigInt(request.to) <= BigInt(snapshot.blockNumber))
    jobs.push({
      key: `${DEPLOYMENT.adapter}:request:${request.id}`,
      from: BigInt(request.head) + 1n,
      target: BigInt(request.to),
      budget: proof,
      request,
    });
  for (const job of jobs) {
    let cp = await store.checkpoint(job.key, (job.from - 1n).toString());
    let from = BigInt(cp.head) + 1n;
    let remaining = job.budget;
    while (from <= job.target && remaining > 0n) {
      const size = [remaining, reader.logWindowLimit, job.target - from + 1n].reduce((a, b) =>
        a < b ? a : b,
      );
      const to = from + size - 1n;
      const observations: StoredEvidence[] = [];
      const receipts: { receipt: Receipt; observationId: string }[] = [];
      try {
        const { before, logs } = await readWindow(
          reader,
          snapshot,
          from.toString(),
          to.toString(),
          observations,
          receipts,
          store,
        );
        const result = await store.saveSegment({
          deployment: DEPLOYMENT.adapter,
          checkpointKey: job.key,
          from: from.toString(),
          to: to.toString(),
          status: 'complete',
          document: {
            scope: job.request ? 'bounded-task-enrichment' : 'recent-changes',
            snapshot,
            anchor: before,
            ruleVersion: RULE_VERSION,
            count: logs.length,
          },
          observations,
          receipts,
          expectedVersion: cp.version,
          ...(job.request
            ? {
                requestUpdate: {
                  id: job.request.id,
                  head: to.toString(),
                  status: to === job.target ? ('COMPLETED' as const) : ('PENDING' as const),
                },
              }
            : {}),
        });
        results[job.request ? 'enrichment' : 'recent'] = {
          from: job.from.toString(),
          through: (BigInt(result.head) > job.target ? job.target : BigInt(result.head)).toString(),
          target: job.target.toString(),
          complete: BigInt(result.head) >= job.target,
          ...(job.request ? { requestId: job.request.id, jobId: job.request.jobId } : {}),
        };
        cp = result;
        remaining -= size;
        if (BigInt(result.head) < to) break;
        from = BigInt(result.head) + 1n;
      } catch (error) {
        const e = error as { code?: string; status?: number };
        await store.saveSegment({
          deployment: DEPLOYMENT.adapter,
          checkpointKey: job.key,
          from: from.toString(),
          to: to.toString(),
          status: e.status === 409 ? 'conflict' : 'partial',
          document: {
            scope: job.request ? 'bounded-task-enrichment' : 'recent-changes',
            snapshot,
            code: e.code ?? 'SOURCE_UNAVAILABLE',
            ruleVersion: RULE_VERSION,
          },
          observations,
          receipts: [],
          expectedVersion: cp.version,
          ...(job.request
            ? {
                requestUpdate: {
                  id: job.request.id,
                  head: cp.head,
                  status: 'FAILED' as const,
                  error: e.code ?? 'SOURCE_UNAVAILABLE',
                },
              }
            : {}),
        });
        if (e.status === 409) throw error;
        results[job.request ? 'enrichment' : 'recent'] = {
          status: 'SOURCE_UNAVAILABLE',
          head: cp.head,
          requestId: job.request?.id,
        };
        break;
      }
    }
  }
  return results;
}

export async function syncOnce(
  reader: ArcReader,
  store: LedgerRepository,
  options: {
    maxJobs: number;
    scanBudget: string;
    currentOnly?: boolean;
    evidenceBlocks?: string[];
    historyFromBlock?: string;
    snapshotBlock?: string;
    recentBudget?: string;
    proofBudget?: string;
  },
): Promise<SnapshotRun> {
  return store.withWorkerLock(async () => {
    const snapshot = await reader.anchor(options.snapshotBlock);
    await reader.verifyDeployment(snapshot);
    if (!options.currentOnly && options.historyFromBlock !== undefined) {
      const startAnchor = await reader.block(options.historyFromBlock);
      await reader.verifyDeployment({
        ...snapshot,
        blockNumber: options.historyFromBlock,
        blockHash: startAnchor.hash,
      });
    }
    const deploymentEvidence = [...reader.evidence];
    const previousRun = await store.getRun();
    const enumeration = await reader.enumerate(snapshot, options.maxJobs);
    const collection = await scanPriority(
      reader,
      store,
      snapshot,
      options.recentBudget ?? '0',
      options.proofBudget ?? '0',
    );
    if (
      previousRun &&
      BigInt(snapshot.blockNumber) >= BigInt(previousRun.snapshot.blockNumber) &&
      BigInt(enumeration.total) < BigInt(previousRun.totalExpected)
    )
      throw new LedgerError('SOURCE_CONFLICT', '同部署累计任务数回退，暂停发布新投影。', 409);
    const scan = options.currentOnly
      ? {
          head: (BigInt(DEPLOYMENT.verifiedDeploymentBlock) - 1n).toString(),
          errors: ['本轮仅采集当前状态，历史尚未核验。'],
        }
      : await scanHistory(reader, store, snapshot, options.scanBudget, options.historyFromBlock);
    if (options.evidenceBlocks?.length)
      await captureEvidenceBlocks(reader, store, snapshot, options.evidenceBlocks);
    deploymentEvidence.push(
      ...reader.evidence.filter(
        (e) =>
          [
            'deployment-receipt',
            'escrow:EIP1967-implementation',
            'eth_call:usdc',
            'eth_call:agenticCommerce',
            'eth_call:feeBps',
          ].includes(String(e.evidence.locator)) ||
          String(e.evidence.locator).startsWith('eth_getCode:'),
      ),
    );
    const receipts = await store.receiptsThrough(snapshot.blockNumber);
    const coverage = emptyCoverage();
    coverage.currentState = enumeration.errors.length === 0 ? 'complete' : 'partial';
    coverage.jobEnumeration =
      enumeration.metas.length === Number(enumeration.total) && enumeration.errors.length === 0
        ? 'complete'
        : 'partial';
    coverage.deploymentVerification = 'complete';
    coverage.sourceAgreement = 'partial';
    const historyComplete =
      BigInt(scan.head) >= BigInt(snapshot.blockNumber) &&
      (options.historyFromBlock === undefined ||
        options.historyFromBlock === DEPLOYMENT.verifiedDeploymentBlock) &&
      !options.currentOnly;
    coverage.lifecycleHistory = historyComplete ? 'complete' : 'partial';
    coverage.settlementHistory = historyComplete ? 'complete' : 'partial';
    const payees = new Set(
      enumeration.metas
        .flatMap((m) => [m.poster, m.assignedProvider])
        .filter((a) => a.toLowerCase() !== ZERO_ADDRESS)
        .map((a) => a.toLowerCase()),
    );
    const feeRecipient = String(await reader.call('feeRecipient', [], snapshot)).toLowerCase();
    const feeBps = known(
      String(await reader.call('feeBps', [], snapshot)),
      reader.evidence.slice(-1).map((e) => e.id),
    );
    payees.add(feeRecipient);
    const accounts: PendingAccount[] = [];
    for (const payee of payees) {
      try {
        const pending = protocolAtoms(
          String(await reader.call('pendingWithdrawals', [payee], snapshot)),
        );
        accounts.push(
          accountPending(
            payee,
            known(
              pending,
              reader.evidence.slice(-1).map((e) => e.id),
            ),
            receipts,
            historyComplete,
            historyComplete ? known('0') : unknown('未覆盖部署起始账户历史。'),
          ),
        );
      } catch {
        accounts.push(
          accountPending(
            payee,
            { state: 'unavailable', reason: '固定区块账户待领取读取不可用。' },
            receipts,
            false,
            unknown('开启余额未核验。'),
          ),
        );
      }
    }
    coverage.accountPendingHistory = accounts.every((a) => a.history === 'complete')
      ? 'complete'
      : 'partial';
    const jobs: JobDetail[] = enumeration.metas.map((meta: RawMeta) => {
      const cash = settlement(meta, receipts, { feeBps, feeRecipient });
      const stateEvidence = reader.evidence.filter(
        (e) =>
          e.evidence.locator === 'eth_call:getBountyMeta' &&
          (e.raw as { args?: string[] }).args?.[0] === meta.jobId,
      );
      const pendingAccounts = accounts.filter((a) =>
        [meta.poster.toLowerCase(), meta.assignedProvider.toLowerCase(), feeRecipient].includes(
          a.payee,
        ),
      );
      const accountEvidenceIds = new Set(pendingAccounts.flatMap((a) => a.evidenceIds));
      const evidence = [
        ...new Map(
          [
            ...deploymentEvidence,
            ...stateEvidence,
            ...reader.evidence.filter(
              (e) =>
                e.evidence.locator === 'eth_call:pendingWithdrawals' &&
                pendingAccounts.some((a) => (e.raw as { args?: string[] }).args?.[0] === a.payee),
            ),
            ...receipts
              .filter(
                (r) =>
                  cash.events.some((e) => e.transactionHash === r.receipt.transactionHash) ||
                  accountEvidenceIds.has(r.evidence.id),
              )
              .map((r) => r.evidence),
          ].map((e) => [e.id, e]),
        ).values(),
      ];
      const derived = sequenceCleared(cash.legs, cash.cashState, pendingAccounts);
      return {
        job: {
          jobKey: `5042:${DEPLOYMENT.adapter}:${meta.jobId}`,
          jobId: meta.jobId,
          adapter: DEPLOYMENT.adapter,
          poster: meta.poster.toLowerCase(),
          worker:
            meta.assignedProvider.toLowerCase() === ZERO_ADDRESS
              ? unknown('任务尚未指定工作者。')
              : known(
                  meta.assignedProvider.toLowerCase(),
                  stateEvidence.map((e) => e.id),
                ),
          snapshot,
          reward: amount(
            known(
              protocolAtoms(meta.reward),
              stateEvidence.map((e) => e.id),
            ),
          ),
          lifecycle: lifecycle(meta, cash.events),
          cashState: derived ? 'VERIFIED_SEQUENCE_DERIVED' : cash.cashState,
          coverage: { ...coverage },
          selfTake: meta.poster.toLowerCase() === meta.assignedProvider.toLowerCase(),
          ...ruleMetadata,
          ...('historyRange' in scan ? { historyRange: scan.historyRange } : {}),
        },
        rawState: meta,
        settlementLegs: cash.legs,
        timeline: cash.events,
        nextTimelineCursor: unknown('时间线由 API 按快照分页。'),
        evidence,
        ruleVersion: RULE_VERSION,
        pendingAccounts,
        gas: cash.gas,
        trace: 'NOT_QUERIED',
      };
    });
    if (previousRun && enumeration.errors.length > 0) {
      const freshIds = new Set(jobs.map((d) => d.job.jobId));
      for (const old of previousRun.jobs)
        if (!freshIds.has(old.job.jobId))
          jobs.push({
            ...old,
            job: {
              ...old.job,
              freshness: 'stale',
              coverage: { ...old.job.coverage, currentState: 'partial', jobEnumeration: 'partial' },
            },
          });
    }
    if ((await reader.block(snapshot.blockNumber)).hash !== snapshot.blockHash)
      throw new LedgerError('SOURCE_CONFLICT', '发布前固定锚点不一致。', 409);
    const run: SnapshotRun = {
      id: `run_${hashPayload({ ruleVersion: RULE_VERSION, snapshot, coverage, historyRange: 'historyRange' in scan ? scan.historyRange : null, metas: enumeration.metas, receipts: receipts.map((r) => r.evidence.id) }).slice(0, 32)}`,
      snapshot,
      coverage,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      jobs,
      totalExpected: enumeration.total,
      errors: [...enumeration.errors, ...scan.errors],
      mode: 'stored-replay',
      collection,
      ...('historyRange' in scan ? { historyRange: scan.historyRange } : {}),
    };
    await store.publish(run, reader.evidence);
    return run;
  });
}
