import { useState, type FormEvent } from 'react';
import { parseInput, type Registry, type Detail, value, money } from './model.js';
export interface VerifierTaskReference {
  jobId: string;
  snapshotRunId: string;
  legId: string;
  expectedPayee: string;
  expectedMovementPayer?: string;
  expectedAmountAtomic18: string;
}
export function VerifierTaskChooser({
  lang,
  onChoose,
}: {
  lang: 'zh' | 'en';
  onChoose: (task: VerifierTaskReference, transaction: string) => void;
}) {
  const [input, setInput] = useState(''),
    [detail, setDetail] = useState<Detail>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  async function get<T>(path: string): Promise<T> {
    const r = await fetch('/api' + path, { signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (!r.ok) throw Error(data.code);
    return data;
  }
  async function load(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const registry = await get<Registry>('/v1/registry');
      const parsed = parseInput(input, registry);
      if (!('jobId' in parsed)) throw Error('TASK_ID_REQUIRED');
      const d = await get<Detail>(`/v1/jobs/5042/${registry.adapter}/${parsed.jobId}`);
      setDetail(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function choose(legId: string, transaction: string) {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({
        snapshotRunId: detail.snapshotRunId,
        legId,
        transaction,
      });
      const data = await get<{ context: VerifierTaskReference }>(
        '/v1/task-conditions/' + detail.job.jobId + '?' + query,
      );
      onChoose(data.context, transaction);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="verifier-task-chooser"
      aria-label={t('ArcBounty任务条件', 'ArcBounty task conditions')}
    >
      <form onSubmit={(e) => void load(e)}>
        <label>
          {t(
            '已支持的任务编号或ArcBounty主网任务链接',
            'Supported task ID or ArcBounty mainnet task link',
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
            maxLength={300}
          />
        </label>
        <button disabled={busy} type="submit">
          {t('读取固定任务条件', 'Read fixed task conditions')}
        </button>
      </form>
      <p>
        {t(
          '沿用原任务快照、金额和证据；选择具体资金段及交易后实际重查链原件。未知不会补成0。',
          'Reuses existing task snapshots, amounts and evidence. Select a leg and transaction to requery chain originals. Unknown values stay unknown.',
        )}
      </p>
      {error && (
        <p role="alert">
          {t('任务条件暂不可用；输入已保留', 'Task conditions unavailable; input retained')}:{' '}
          {error}
        </p>
      )}
      {detail && (
        <>
          <p className="address">
            {t('固定快照', 'Fixed snapshot')}: {detail.snapshotRunId}
          </p>
          {detail.result.flows.map((f) => {
            const leg = detail.settlementLegs.find(
              (l) => l.id === f.id.replace(/:(DIRECT|PARKED|CLAIMED)$/, ''),
            );
            return (
              <article key={f.id}>
                <p>
                  {f.kind} · {t('预期金额', 'Expected amount')}:{' '}
                  {leg ? money(leg.expectedAmount) : t('未知', 'Unknown')} ·{' '}
                  {t('观察金额', 'Observed amount')}: {money(f.amount)}
                </p>
                <p className="address">
                  {f.from} → {f.to}
                </p>
                {f.transactionHashes.map((tx) => (
                  <button
                    type="button"
                    key={tx}
                    disabled={
                      busy ||
                      !leg ||
                      !['DIRECT', 'UNIQUE_EVENT_SEGMENT'].includes(leg.attribution) ||
                      value(leg.expectedAmount.atomic) === undefined
                    }
                    onClick={() => void choose(leg!.id, tx)}
                  >
                    {t('用此资金段核验', 'Verify this leg')} · {tx.slice(0, 12)}…
                  </button>
                ))}
              </article>
            );
          })}
          {!detail.result.flows.length && (
            <p>
              {t(
                '尚无有证据的任务资金段；可切换通用交易手填条件。',
                'No evidenced task leg is available. Use manual transaction conditions.',
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
