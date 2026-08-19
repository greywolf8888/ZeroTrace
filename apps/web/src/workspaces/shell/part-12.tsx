import { api, type EvmControlSurfaceResponse } from '../../generated-api/client.js';
import { useState } from 'react';
import {
  StatusPill,
  MetricTile,
  titleCase,
  KnowledgeDisplay,
  shortId,
  formatTime,
} from './part-01.js';
import { SolanaControlRightsWorkspace } from './part-13.js';

export function ControlRightsWorkspace() {
  const [ledger, setLedger] = useState<'EVM' | 'SOLANA'>('EVM');
  return (
    <>
      <section className="panel subject-panel" aria-labelledby="control-ledger-heading">
        <div className="panel-header">
          <div>
            <span className="eyebrow">One workspace · ledger-specific semantics</span>
            <h3 id="control-ledger-heading">选择控制域</h3>
          </div>
          <StatusPill status="READ_ONLY" />
        </div>
        <label htmlFor="control-ledger">Ledger</label>
        <select
          id="control-ledger"
          value={ledger}
          onChange={(event) => setLedger(event.target.value as 'EVM' | 'SOLANA')}
        >
          <option value="EVM">EVM</option>
          <option value="SOLANA">Solana</option>
        </select>
        <p className="panel-copy">
          Each ledger keeps its native authority model. A label or address resemblance never merges
          controllers across chains.
        </p>
      </section>
      {ledger === 'EVM' ? <EvmControlRightsWorkspace /> : <SolanaControlRightsWorkspace />}
    </>
  );
}

export function EvmControlRightsWorkspace() {
  const [subjectAddress, setSubjectAddress] = useState('');
  const [blockNumber, setBlockNumber] = useState('');
  const [result, setResult] = useState<EvmControlSurfaceResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validAddress = /^0x[0-9a-fA-F]{40}$/.test(subjectAddress);
  const validBlock = blockNumber === '' || /^(0|[1-9]\d*)$/.test(blockNumber);

  async function load(mode: 'inspect' | 'replay') {
    if (!validAddress || !validBlock) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(
        mode === 'inspect'
          ? await api.inspectControlSurface(subjectAddress, blockNumber)
          : await api.latestControlSurface(subjectAddress),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Control surface request failed.');
    } finally {
      setBusy(false);
    }
  }

  const record = result?.record;
  const report = record?.report;
  const logicCode = report?.logicCode ?? {
    state: 'unknown' as const,
    reason: 'NOT_QUERIED',
    detail: 'This legacy report predates recursive logic-code inspection.',
  };
  const verifiedSource = report?.verifiedSource ?? {
    state: 'unknown' as const,
    reason: 'NOT_QUERIED',
    detail: 'This legacy report predates exact verified-source inspection.',
  };
  const declaredCapabilities = report?.declaredCapabilities ?? [];
  const knownCoverage =
    report?.coverage.filter((item) => item.observed.state === 'known').length ?? 0;
  const coverageCount = report?.coverage.length ?? 0;
  const ownerIsZero =
    report?.ownerAddress.state === 'known' &&
    report.ownerAddress.value === '0x0000000000000000000000000000000000000000';

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Canonical Snapshot · Evidence · explicit Unknown</span>
          <h1>EVM 系统管理</h1>
          <p>
            检查 standard proxy, owner, and registered Safe control paths without treating an
            unqueried role as absent. Reports are immutable and replay without provider access.
          </p>
        </div>
        <StatusPill status="READ_ONLY" />
      </div>
      <section
        className="panel subject-panel quote-panel"
        aria-labelledby="control-inspect-heading"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">BNB Smart Chain · eip155:56</span>
            <h3 id="control-inspect-heading">控制面检查</h3>
          </div>
          <span className="snapshot-badge">无签名、无广播</span>
        </div>
        <form
          className="quote-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load('inspect');
          }}
        >
          <label htmlFor="control-subject">Contract address</label>
          <input
            id="control-subject"
            spellCheck={false}
            value={subjectAddress}
            onChange={(event) => setSubjectAddress(event.target.value.trim())}
            placeholder="0x…"
          />
          <label htmlFor="control-block">终局区块（可选）</label>
          <input
            id="control-block"
            inputMode="numeric"
            spellCheck={false}
            value={blockNumber}
            onChange={(event) => setBlockNumber(event.target.value.trim())}
            placeholder="留空则使用公共终局头"
          />
          <div className="control-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={busy || !validAddress || !validBlock}
            >
              {busy ? '检查中…' : '检查并持久化'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !validAddress}
              onClick={() => void load('replay')}
            >
              Replay latest
            </button>
          </div>
        </form>
        <p className="quote-note">
          Current coverage: exact ERC-1167 runtime, EIP-1967 implementation/admin/beacon slots,
          Snapshot-bound recursive logic bytecode, ERC-173-shaped owner(), allowlisted Safe
          owner/threshold state, and optional Sourcify V2 exact-source provenance. A declared ABI
          capability never becomes a current right without controller Evidence.
        </p>
        {error === undefined ? null : <p className="inline-error">{error}</p>}
      </section>

      {record === undefined || report === undefined ? null : (
        <>
          <section className="panel" aria-labelledby="control-result-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Immutable report {record.id}</span>
                <h3 id="control-result-heading">已观测 control surface</h3>
              </div>
              <StatusPill
                status={
                  report.sourceIndependence.state === 'known' &&
                  report.sourceIndependence.value === true
                    ? 'VERIFIED_INDEPENDENT'
                    : 'INCONCLUSIVE_SOURCE_INDEPENDENCE'
                }
              />
            </div>
            <div className="metric-grid compact-grid">
              <MetricTile
                label="Contract shape"
                value={
                  report.contractKind.state === 'known'
                    ? titleCase(String(report.contractKind.value))
                    : 'Unknown'
                }
                detail="Exact runtime and standard-slot classification"
                state={
                  report.contractKind.state === 'stale' ? 'unknown' : report.contractKind.state
                }
              />
              <MetricTile
                label="Direct rights"
                value={String(report.rights.length)}
                detail="Only rights with positive point-in-time Evidence"
                state="known"
              />
              <MetricTile
                label="Domain coverage"
                value={`${knownCoverage}/${coverageCount}`}
                detail={`${Math.round(report.metadata.dataCoverage * 100)}% usable point-in-time coverage`}
                state={knownCoverage === coverageCount ? 'known' : 'unknown'}
              />
              <MetricTile
                label="History coverage"
                value={`${Math.round(report.metadata.historyCoverage * 100)}%`}
                detail="No activation or revocation history inferred"
                state={report.metadata.historyCoverage === 1 ? 'known' : 'unknown'}
              />
              <MetricTile
                label="Verified logic source"
                value={
                  verifiedSource.state === 'known'
                    ? (verifiedSource.value?.contractName ?? 'Unknown')
                    : 'Unknown'
                }
                detail={
                  verifiedSource.state === 'known'
                    ? `Exact bytecode · ${verifiedSource.value?.compilerVersion ?? 'compiler unknown'}`
                    : 'No exact Snapshot-bound source provenance'
                }
                state={verifiedSource.state === 'stale' ? 'unknown' : verifiedSource.state}
              />
            </div>
            <div className="fact-grid">
              <div className="fact-row">
                <span>Implementation</span>
                <KnowledgeDisplay data={report.implementationAddress} />
              </div>
              <div className="fact-row">
                <span>Proxy admin</span>
                <KnowledgeDisplay data={report.proxyAdminAddress} />
              </div>
              <div className="fact-row">
                <span>Beacon</span>
                <KnowledgeDisplay data={report.beaconAddress} />
              </div>
              <div className="fact-row">
                <span>owner()</span>
                <KnowledgeDisplay data={report.ownerAddress} />
              </div>
              <div className="fact-row">
                <span>Logic bytecode</span>
                {logicCode.state === 'known' ? (
                  <span>
                    {titleCase(logicCode.value?.relation ?? 'UNKNOWN')} ·{' '}
                    {logicCode.value?.runtimeBytecodeBytes.toLocaleString() ?? '?'} bytes ·{' '}
                    <code>{shortId(logicCode.value?.runtimeBytecodeHash ?? '', 16)}</code>
                  </span>
                ) : (
                  <KnowledgeDisplay data={logicCode} />
                )}
              </div>
              <div className="fact-row">
                <span>Source agreement</span>
                <KnowledgeDisplay data={report.sourceAgreement} />
              </div>
              <div className="fact-row">
                <span>Source independence</span>
                <KnowledgeDisplay data={report.sourceIndependence} />
              </div>
            </div>
            {ownerIsZero ? (
              <div className="alert alert-warning">
                <strong>owner() returned the zero address</strong>
                <span>
                  No OWNER right is emitted. This does not prove mint, tax, blacklist, router,
                  treasury, LP, or other custom controls are absent.
                </span>
              </div>
            ) : null}
            <div className="snapshot-strip">
              <span>
                <b>Snapshot</b> {record.snapshotBlock}
              </span>
              <span>
                <b>Block hash</b> <code>{shortId(record.snapshotHash, 16)}</code>
              </span>
              <span>
                <b>Sources</b> {record.sourceSet.join(', ')}
              </span>
              <span>
                <b>Captured</b> {formatTime(record.capturedAt)}
              </span>
            </div>
          </section>

          <section className="panel" aria-labelledby="declared-capabilities-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Verified declaration ≠ effective authority</span>
                <h3 id="declared-capabilities-heading">已声明可变表面</h3>
              </div>
              <span className="snapshot-badge">
                {declaredCapabilities.length} classified capabilities
              </span>
            </div>
            {verifiedSource.state === 'known' ? (
              <div className="fact-grid">
                <div className="fact-row">
                  <span>Source contract</span>
                  <a href={verifiedSource.value?.sourceUri} target="_blank" rel="noreferrer">
                    {verifiedSource.value?.contractName ?? 'Verified source'}
                  </a>
                </div>
                <div className="fact-row">
                  <span>Runtime match</span>
                  <StatusPill status="EXACT_BYTECODE_MATCH" />
                </div>
                <div className="fact-row">
                  <span>ABI functions</span>
                  <span>{verifiedSource.value?.abiFunctionCount ?? '?'}</span>
                </div>
                <div className="fact-row">
                  <span>Verified at</span>
                  <span>
                    {verifiedSource.value?.verifiedAt === undefined
                      ? 'Unknown'
                      : formatTime(verifiedSource.value.verifiedAt)}
                  </span>
                </div>
              </div>
            ) : (
              <KnowledgeDisplay data={verifiedSource} />
            )}
            {declaredCapabilities.length === 0 ? (
              <div className="empty-state compact-empty">
                <strong>No mutation capability was classified from exact verified ABI.</strong>
                <span>This does not prove custom fallback or unverified behavior absent.</span>
              </div>
            ) : (
              <div className="claim-draft-list">
                {declaredCapabilities.map((capability) => (
                  <article className="claim-draft-card" key={capability.rightType}>
                    <div className="claim-draft-heading">
                      <h4>{titleCase(capability.rightType)}</h4>
                      <span className="snapshot-badge">DECLARED_ONLY</span>
                    </div>
                    <p className="panel-copy">
                      <code>{capability.functionSignatures.join(', ')}</code>
                    </p>
                    <p className="panel-copy">{capability.detail}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="control-right-list-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Positive Evidence only</span>
                <h3 id="control-right-list-heading">直接控制权</h3>
              </div>
              <span className="snapshot-badge">Point in time</span>
            </div>
            {report.rights.length === 0 ? (
              <div className="empty-state compact-empty">
                <strong>No direct right was positively established by this adapter set.</strong>
                <span>
                  Review the coverage table; this is not a proof that all control is absent.
                </span>
              </div>
            ) : (
              <div className="claim-draft-list">
                {report.rights.map((controlRight) => (
                  <article className="claim-draft-card" key={controlRight.id}>
                    <div className="claim-draft-heading">
                      <div>
                        <span className="eyebrow">{controlRight.id}</span>
                        <h4>{titleCase(controlRight.rightType)}</h4>
                      </div>
                      <KnowledgeDisplay data={controlRight.threshold} />
                    </div>
                    <div className="fact-grid">
                      <div className="fact-row">
                        <span>Controller</span>
                        <code>{controlRight.controller}</code>
                      </div>
                      <div className="fact-row">
                        <span>Scope</span>
                        <span>{controlRight.scope}</span>
                      </div>
                      <div className="fact-row">
                        <span>Active from</span>
                        <KnowledgeDisplay data={controlRight.activeFrom} />
                      </div>
                      <div className="fact-row">
                        <span>Active to</span>
                        <KnowledgeDisplay data={controlRight.activeTo} />
                      </div>
                    </div>
                    <p className="panel-copy">{controlRight.constraints.join(' ')}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="control-coverage-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Known false is not Unknown</span>
                <h3 id="control-coverage-heading">覆盖矩阵</h3>
              </div>
              <code>{record.terminalEvidenceId}</code>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>State</th>
                    <th>Evidence</th>
                    <th>Interpretation</th>
                  </tr>
                </thead>
                <tbody>
                  {report.coverage.map((item) => (
                    <tr key={item.domain}>
                      <td>{titleCase(item.domain)}</td>
                      <td>
                        {item.observed.state === 'known' ? (
                          <StatusPill status={item.observed.value ? 'OBSERVED' : 'NOT_OBSERVED'} />
                        ) : (
                          <KnowledgeDisplay data={item.observed} />
                        )}
                      </td>
                      <td>{item.evidenceIds.length}</td>
                      <td>{item.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
