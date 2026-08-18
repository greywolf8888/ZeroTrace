import { useState, type FormEvent, type ReactNode } from 'react';

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown, fallback = '未知'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = asRecord(asRecord(payload).error);
    throw new Error(asString(error.message, `请求失败 ${response.status}`));
  }
  return payload;
}

function Panel({
  eyebrow,
  title,
  children,
  note,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        {note === undefined ? null : <span className="snapshot-badge">{note}</span>}
      </div>
      {children}
    </article>
  );
}

function Inspector({
  title,
  formula,
  evidence,
  snapshot,
  coverage,
  replay,
  counter,
}: {
  title: string;
  formula: string;
  evidence: string;
  snapshot?: string;
  coverage?: string;
  replay?: string;
  counter?: string;
}) {
  return (
    <aside className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">计算与证据检查器</span>
          <h3>{title}</h3>
        </div>
      </div>
      <p>{formula}</p>
      <p>断言类别：事实 / 派生事实 / 模型假设 / 分析员认定 必须分开标注。</p>
      <p>证据闭包：{evidence}</p>
      <p>快照：{snapshot ?? '未知 · 尚未绑定'}</p>
      <p>覆盖率：{coverage ?? '未知 · 未查询'}</p>
      <p>反证：{counter ?? '字段存在；当前未提供反证条目。'}</p>
      <p>回放：{replay ?? '未知 · 尚未物化'}</p>
      <p>模型未校准时只显示证据分，不显示概率。</p>
    </aside>
  );
}

function ResultBlock({ value }: { value: unknown }) {
  if (value === undefined) {
    return <p>未知 · 尚未物化。该空缺不得记为数字 0。</p>;
  }
  return <pre className="evidence-json">{JSON.stringify(value, null, 2)}</pre>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = `forensic-${label}`;
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

const DEFAULT_SNAPSHOT = {
  ledger: 'EVM',
  chainId: 'eip155:56',
  blockNumber: '1',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized',
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: 'local-input' },
  adapterVersions: { evm: 'local-input' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

export function SupplyRealityWorkspace() {
  const [chainId, setChainId] = useState('eip155:56');
  const [token, setToken] = useState(`0x${'c'.repeat(40)}`);
  const [protocol, setProtocol] = useState('');
  const [mint, setMint] = useState('');
  const [burn, setBurn] = useState('0');
  const [registry, setRegistry] = useState(`ev_${'2'.repeat(24)}`);
  const [terminal, setTerminal] = useState(`ev_${'3'.repeat(24)}`);
  const [cells, setCells] = useState(
    JSON.stringify(
      [
        {
          id: 'cel_aaaaaaaaaaaaaaaaaaaaaaaa',
          token: { ledger: 'EVM', chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` },
          snapshot: DEFAULT_SNAPSHOT,
          amountAtomic: '',
          owner: 'controller',
          custodyType: 'WALLET',
          economicController: 'CONFIRMED_CONTROLLER',
          liquidityStatus: 'SELLABLE_NOW',
          roleAssessmentIds: [],
          lotIds: [],
          evidenceIds: [`ev_${'1'.repeat(24)}`],
        },
      ],
      null,
      2,
    ),
  );
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const parsedCells = JSON.parse(cells) as unknown[];
      const envelope = await requestJson(
        `/api/v2/tokens/EVM/${encodeURIComponent(chainId)}/${encodeURIComponent(token)}/supply-reality`,
        {
          method: 'POST',
          body: JSON.stringify({
            snapshot: { ...DEFAULT_SNAPSHOT, chainId },
            protocolSupplyAtomic: protocol,
            historicalMintAtomic: mint,
            historicalBurnAtomic: burn,
            burnAlreadyReflectedInSupply: true,
            originCoverageComplete: false,
            registryEvidenceId: registry,
            terminalEvidenceId: terminal,
            cells: parsedCells,
          }),
        },
      );
      setResult(envelope);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '供应现实物化失败。');
    } finally {
      setBusy(false);
    }
  };

  const payload = asRecord(asRecord(result).payload);
  const conservation = asRecord(payload.conservation);
  const executable = asRecord(payload.executable);
  const envelope = asRecord(result);
  const snapshot = asRecord(envelope.snapshot);

  return (
    <section className="two-column">
      <div>
        <Panel eyebrow="供应立方体" title="供应现实" note="同一数量只计入一次">
          <p>
            销毁若已反映在协议供应中，不再次扣除。匹配跨链表示去重。未知差额单独成格，不得用 0
            填补。
          </p>
          <form onSubmit={submit} className="forensic-form">
            <Field label="链标识" value={chainId} onChange={setChainId} />
            <Field label="Token" value={token} onChange={setToken} />
            <Field
              label="协议供应（原子单位）"
              value={protocol}
              onChange={setProtocol}
              placeholder="未知则不要填 0"
            />
            <Field label="历史铸造" value={mint} onChange={setMint} />
            <Field label="历史销毁" value={burn} onChange={setBurn} />
            <Field label="登记证据" value={registry} onChange={setRegistry} />
            <Field label="终端证据" value={terminal} onChange={setTerminal} />
            <label htmlFor="supply-cells">
              供应单元格 JSON
              <textarea
                id="supply-cells"
                value={cells}
                onChange={(event) => setCells(event.target.value)}
                rows={12}
              />
            </label>
            <button type="submit" disabled={busy || protocol.length === 0}>
              {busy ? '物化中' : '物化供应现实'}
            </button>
          </form>
          {error === undefined ? null : <p className="knowledge-unknown">{error}</p>}
          <dl className="forensic-metrics">
            <div>
              <dt>协议供应</dt>
              <dd>{asString(conservation.protocolSupplyAtomic, '未知 · 尚未物化')}</dd>
            </div>
            <div>
              <dt>可解释供应</dt>
              <dd>{asString(conservation.explainedSupplyAtomic, '未知 · 尚未物化')}</dd>
            </div>
            <div>
              <dt>未知差额</dt>
              <dd>{asString(conservation.unknownDifferenceAtomic, '未知 · 尚未物化')}</dd>
            </div>
            <div>
              <dt>当前可执行卖出</dt>
              <dd>{asString(executable.sellableNowAtomic, '未知 · 尚未物化')}</dd>
            </div>
            <div>
              <dt>守恒</dt>
              <dd>
                {conservation.identityHolds === true
                  ? '成立'
                  : conservation.identityHolds === false
                    ? '不成立'
                    : '未知'}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
      <Inspector
        title="协议供应守恒"
        formula="协议供应 = 可解释单元格之和 + 明确未知差额；已反映销毁不再扣。"
        evidence={JSON.stringify(envelope.evidenceClosure ?? '未知')}
        snapshot={asString(snapshot.blockHash, '未知 · 尚未绑定')}
        coverage={JSON.stringify(envelope.coverage ?? '未知')}
        replay={asString(asRecord(envelope.replayRef).command)}
        counter="供应守恒的反证为重复计数、桥接双计或销毁双扣。"
      />
    </section>
  );
}

export function CapitalWorkspace() {
  const [campaignId, setCampaignId] = useState(`mcc_${'a'.repeat(24)}`);
  const [entries, setEntries] = useState(
    JSON.stringify(
      [
        {
          id: 'cle_aaaaaaaaaaaaaaaaaaaaaaaa',
          campaignId: `mcc_${'a'.repeat(24)}`,
          debit: 'TOKEN_INVENTORY',
          credit: 'TOKEN_INVENTORY',
          amountU: { state: 'known', value: '0' },
          amountAtomic: '10',
          asset: { ledger: 'EVM', chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` },
          lotIds: [],
          internalTransfer: true,
          evidenceIds: [`ev_${'1'.repeat(24)}`],
        },
      ],
      null,
      2,
    ),
  );
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setResult(
        await requestJson(`/api/v2/campaigns/${encodeURIComponent(campaignId)}/profit`, {
          method: 'POST',
          body: JSON.stringify({ lots: [], entries: JSON.parse(entries) as unknown[] }),
        }),
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '资金回流计算失败。');
    }
  };

  const profit = asRecord(asRecord(result).profit);
  return (
    <section className="two-column">
      <Panel eyebrow="跨资产路径" title="资金回流" note="CEX 边界 ≠ 出售">
        <p>
          CEX 转入只表示到达交易所边界，不等于已出售。未匹配跨链保持为边界。内部转账利润为确定的 0。
        </p>
        <form onSubmit={submit} className="forensic-form">
          <Field label="活动标识" value={campaignId} onChange={setCampaignId} />
          <label htmlFor="capital-entries">
            分录 JSON
            <textarea
              id="capital-entries"
              value={entries}
              onChange={(event) => setEntries(event.target.value)}
              rows={14}
            />
          </label>
          <button type="submit">计算回流与损益</button>
        </form>
        {error === undefined ? null : <p className="knowledge-unknown">{error}</p>}
        <ResultBlock value={result} />
      </Panel>
      <Inspector
        title="批次与场所边界"
        formula="内部转账借贷相等；CEX 记入场所边界；已实现净利润 = 毛收入 + 费用收入 - 批次成本 - 执行成本。"
        evidence={JSON.stringify(profit.evidenceIds ?? '待绑定')}
        counter="将 CEX 充值记为出售是反证路径。"
      />
    </section>
  );
}

export function ProfitWorkspace() {
  const [campaignId, setCampaignId] = useState(`mcc_${'a'.repeat(24)}`);
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setResult(
        await requestJson(`/api/v2/campaigns/${encodeURIComponent(campaignId)}/profit`, {
          method: 'POST',
          body: JSON.stringify({
            lots: [],
            entries: [
              {
                id: 'cle_bbbbbbbbbbbbbbbbbbbbbbbb',
                campaignId,
                debit: 'TOKEN_INVENTORY',
                credit: 'TOKEN_INVENTORY',
                amountU: { state: 'known', value: '0' },
                amountAtomic: '1',
                asset: { ledger: 'EVM', chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` },
                lotIds: [],
                internalTransfer: true,
                evidenceIds: [`ev_${'1'.repeat(24)}`],
              },
            ],
          }),
        }),
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '活动损益计算失败。');
    }
  };

  const profit = asRecord(asRecord(result).profit);
  const realized = asRecord(profit.realizedNetProfitU);
  return (
    <section className="two-column">
      <Panel eyebrow="双重记账" title="活动损益">
        <p>
          内部转账借贷相等且利润为确定的 0。已实现净利润 = 毛收入 + 费用收入 - 批次成本 -
          执行成本。未实现损益在缺少可兑现仿真时保持未知。
        </p>
        <form onSubmit={submit} className="forensic-form">
          <Field label="活动标识" value={campaignId} onChange={setCampaignId} />
          <button type="submit">用内部转账分录重算损益</button>
        </form>
        {error === undefined ? null : <p className="knowledge-unknown">{error}</p>}
        <p>
          已实现净利润：
          {realized.state === 'known' ? asString(realized.value) : '未知 · 尚未计算'}
        </p>
        <ResultBlock value={result} />
      </Panel>
      <Inspector
        title="活动级庄家损益"
        formula="只在销售分录与批次成本同时已知时计算净利润。"
        evidence="绑定 Lot、分录与 Evidence ID"
        counter="内部转账不得产生利润。"
      />
    </section>
  );
}

export function EvidenceWorkspace() {
  const [investigationId, setInvestigationId] = useState(`inv_${'a'.repeat(24)}`);
  const [chainId, setChainId] = useState('eip155:56');
  const [token, setToken] = useState(`0x${'c'.repeat(40)}`);
  const [replay, setReplay] = useState<unknown>();
  const [latest, setLatest] = useState<unknown>();
  const [error, setError] = useState<string>();

  const runReplay = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setReplay(
        await requestJson(`/api/v2/investigations/${encodeURIComponent(investigationId)}/replay`, {
          method: 'POST',
          body: '{}',
        }),
      );
      setLatest(
        await requestJson(
          `/api/v2/tokens/EVM/${encodeURIComponent(chainId)}/${encodeURIComponent(token)}/market-structure/latest`,
        ),
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '回放失败。');
    }
  };

  return (
    <section className="two-column">
      <Panel eyebrow="不可变账本" title="证据账本" note="只读回放">
        <p>
          每个发现可回放到原始交易、日志、指令、账户状态与快照。进程内报告在无 PostgreSQL
          时仍可回放。
        </p>
        <form onSubmit={runReplay} className="forensic-form">
          <Field label="调查标识" value={investigationId} onChange={setInvestigationId} />
          <Field label="链标识" value={chainId} onChange={setChainId} />
          <Field label="Token" value={token} onChange={setToken} />
          <button type="submit">回放并加载最新报告</button>
        </form>
        {error === undefined ? null : <p className="knowledge-unknown">{error}</p>}
        <h4>回放结果</h4>
        <ResultBlock value={replay} />
        <h4>最新盘面报告</h4>
        <ResultBlock value={latest} />
      </Panel>
      <Inspector
        title="证据闭包"
        formula="ReportEnvelope.evidenceClosure 必须非空，且每条 Evidence 可定位。"
        evidence="ev_* 与快照哈希"
        replay="POST /api/v2/investigations/:id/replay"
      />
    </section>
  );
}

export function AnalystWorkspace() {
  const [rationale, setRationale] = useState('');
  const [investigationId, setInvestigationId] = useState(`inv_${'a'.repeat(24)}`);
  const [decision, setDecision] = useState<unknown>();
  const [exported, setExported] = useState<unknown>();
  const [llmText, setLlmText] = useState('');
  const [llmResult, setLlmResult] = useState<string>();
  const [error, setError] = useState<string>();

  const onDecision = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const created = await requestJson('/api/v2/analyst-decisions', {
        method: 'POST',
        body: JSON.stringify({
          investigationId,
          actor: 'local-analyst',
          role: 'ANALYST',
          action: 'ACCEPT',
          disposition: 'ACCEPTED',
          rationale,
          evidenceIds: [`ev_${'1'.repeat(24)}`],
          createdAt: new Date().toISOString(),
        }),
      });
      setDecision(created);
      const pack = await requestJson('/api/v2/cases/export', {
        method: 'POST',
        body: JSON.stringify({
          investigationId,
          findings: [],
          limitations: ['法律结论必须由分析员明确写出。', '链上只读，不嵌入密钥。'],
          createdAt: new Date().toISOString(),
        }),
      });
      setExported(pack);
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'zerotrace-case.json';
      link.click();
      URL.revokeObjectURL(url);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '认定失败。');
    }
  };

  const onLlm = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await requestJson('/api/v2/llm/validate', {
        method: 'POST',
        body: JSON.stringify({
          taskType: 'CASE_NARRATIVE',
          knownEvidenceIds: [`ev_${'1'.repeat(24)}`],
          userUntrustedText: llmText,
          output: {
            narrative: llmText,
            evidenceIds: [`ev_${'1'.repeat(24)}`],
            uncertainty: ['模型不得产生链上事实'],
            unsupportedClaims: [],
            suggestedQueries: [],
          },
        }),
      });
      setLlmResult('结构化输出已通过只读校验。');
    } catch (cause) {
      setLlmResult(cause instanceof Error ? cause.message : 'LLM 校验拒绝。');
    }
  };

  return (
    <section className="two-column">
      <Panel eyebrow="人工认定" title="分析员工作台">
        <p>
          认定生成新版本，不覆盖历史报告。法律结论必须由分析员明确写出。LLM 不得替代确定性计算。
        </p>
        <form onSubmit={onDecision} className="forensic-form">
          <Field label="调查标识" value={investigationId} onChange={setInvestigationId} />
          <label htmlFor="analyst-rationale">
            认定理由
            <textarea
              id="analyst-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              rows={6}
              required
            />
          </label>
          <button type="submit">提交认定并导出中文案件包</button>
        </form>
        {error === undefined ? null : <p className="knowledge-unknown">{error}</p>}
        <h4>认定记录</h4>
        <ResultBlock value={decision} />
        <h4>案件包清单</h4>
        <ResultBlock value={asRecord(exported).manifest ?? exported} />
        <form onSubmit={onLlm} className="forensic-form">
          <label htmlFor="llm-text">
            LLM 叙述（只读校验）
            <textarea
              id="llm-text"
              value={llmText}
              onChange={(event) => setLlmText(event.target.value)}
              rows={4}
            />
          </label>
          <button type="submit">校验 LLM 输出</button>
        </form>
        {llmResult === undefined ? null : <p>{llmResult}</p>}
      </Panel>
      <Inspector
        title="分析员认定"
        formula="AnalystDecision 内容寻址；nextStateHash 绑定新状态，不覆盖旧报告。"
        evidence="至少一条 Evidence ID"
        counter="无证据的法律结论会被 LLM 网关拒绝。"
      />
    </section>
  );
}
