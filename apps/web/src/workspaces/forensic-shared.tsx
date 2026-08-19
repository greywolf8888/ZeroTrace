import type { ReactNode } from 'react';

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function asString(value: unknown, fallback = '未知'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
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

export function Panel({
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

export function Inspector({
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

export function ResultBlock({ value }: { value: unknown }) {
  if (value === undefined) {
    return <p>未知 · 尚未物化。该空缺不得记为数字 0。</p>;
  }
  return <pre className="evidence-json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Field({
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

export const DEFAULT_SNAPSHOT = {
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
