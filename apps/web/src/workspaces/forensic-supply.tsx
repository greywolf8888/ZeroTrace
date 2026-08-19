import { useState, type FormEvent } from 'react';
import {
  DEFAULT_SNAPSHOT,
  Field,
  Inspector,
  Panel,
  ResultBlock,
  asRecord,
  asString,
  requestJson,
} from './forensic-shared.js';

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
            <details className="developer-debug">
              <summary>开发者调试 · 供应单元格 JSON（普通分析员请用 Token 盘面分析）</summary>
              <label htmlFor="supply-cells">
                供应单元格 JSON
                <textarea
                  id="supply-cells"
                  value={cells}
                  onChange={(event) => setCells(event.target.value)}
                  rows={12}
                />
              </label>
            </details>
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
