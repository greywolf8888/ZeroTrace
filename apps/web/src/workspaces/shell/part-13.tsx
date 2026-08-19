import { api, type SolanaControlSurfaceResponse } from '../../generated-api/client.js';
import { useState } from 'react';
import {
  StatusPill,
  MetricTile,
  titleCase,
  KnowledgeDisplay,
  shortId,
  formatTime,
} from './part-01.js';

export function SolanaControlRightsWorkspace() {
  const [subject, setSubject] = useState('So11111111111111111111111111111111111111112');
  const [result, setResult] = useState<SolanaControlSurfaceResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const validSubject = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(subject);

  async function load(mode: 'inspect' | 'replay') {
    if (!validSubject) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(
        mode === 'inspect'
          ? await api.inspectSolanaControlSurface(subject)
          : await api.latestSolanaControlSurface(subject),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Solana control request failed.');
    } finally {
      setBusy(false);
    }
  }

  const record = result?.record;
  const report = record?.report;
  const knownCoverage =
    report?.coverage.filter((item) => item.observed.state === 'known').length ?? 0;
  const coverageCount = report?.coverage.length ?? 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Finalized slot · atomic account set · official decoders</span>
          <h1>Solana 系统管理</h1>
          <p>
            检查 SPL Token, Token-2022, classic multisig, and loader-v3 upgrade authority without
            reducing an unavailable authority or unsupported Squads state to zero.
          </p>
        </div>
        <StatusPill status="READ_ONLY" />
      </div>
      <section className="panel subject-panel quote-panel" aria-labelledby="solana-control-heading">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Solana mainnet</span>
            <h3 id="solana-control-heading">控制面检查</h3>
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
          <label htmlFor="solana-control-subject">账户或程序地址</label>
          <input
            id="solana-control-subject"
            spellCheck={false}
            value={subject}
            onChange={(event) => setSubject(event.target.value.trim())}
            placeholder="Base58 公钥"
          />
          <div className="control-actions">
            <button className="primary-button" type="submit" disabled={busy || !validSubject}>
              {busy ? '检查中…' : '检查并持久化'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !validSubject}
              onClick={() => void load('replay')}
            >
              Replay latest
            </button>
          </div>
        </form>
        <p className="quote-note">
          Solana RPC exposes current account state, not arbitrary historical account state. The
          inspected subject and direct authority accounts are therefore read atomically at one
          finalized response slot and anchored to that exact block.
        </p>
        {error === undefined ? null : <p className="inline-error">{error}</p>}
      </section>

      {record === undefined || report === undefined ? null : (
        <>
          <section className="panel" aria-labelledby="solana-control-result-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Immutable report {record.id}</span>
                <h3 id="solana-control-result-heading">已观测 account surface</h3>
              </div>
              <StatusPill status="SINGLE_SOURCE" />
            </div>
            <div className="metric-grid compact-grid">
              <MetricTile
                label="Account kind"
                value={
                  report.accountKind.state === 'known'
                    ? titleCase(String(report.accountKind.value))
                    : 'Unknown'
                }
                detail="Owner program and exact byte layout"
                state={report.accountKind.state === 'stale' ? 'unknown' : report.accountKind.state}
              />
              <MetricTile
                label="Direct rights"
                value={String(report.rights.length)}
                detail="Positive point-in-time authority Evidence"
                state="known"
              />
              <MetricTile
                label="Token extensions"
                value={String(report.extensions.length)}
                detail="Complete decoded Token-2022 TLV list"
                state="known"
              />
              <MetricTile
                label="Domain coverage"
                value={`${knownCoverage}/${coverageCount}`}
                detail={`${Math.round(report.metadata.dataCoverage * 100)}% point-in-time coverage`}
                state={knownCoverage === coverageCount ? 'known' : 'unknown'}
              />
            </div>
            <div className="fact-grid">
              <div className="fact-row">
                <span>Owner program</span>
                <KnowledgeDisplay data={report.ownerProgram} />
              </div>
              <div className="fact-row">
                <span>Executable</span>
                <KnowledgeDisplay data={report.executable} />
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
            {report.mint.state === 'known' ? (
              <div className="fact-grid">
                <div className="fact-row">
                  <span>Token program</span>
                  <span>{titleCase(report.mint.value?.tokenProgram ?? 'Unknown')}</span>
                </div>
                <div className="fact-row">
                  <span>Supply</span>
                  <code>{report.mint.value?.supply ?? 'Unknown'}</code>
                </div>
                <div className="fact-row">
                  <span>Mint authority</span>
                  <KnowledgeDisplay
                    data={
                      report.mint.value?.mintAuthority ?? {
                        state: 'unknown',
                        reason: 'INVALID_RESPONSE',
                      }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Freeze authority</span>
                  <KnowledgeDisplay
                    data={
                      report.mint.value?.freezeAuthority ?? {
                        state: 'unknown',
                        reason: 'INVALID_RESPONSE',
                      }
                    }
                  />
                </div>
              </div>
            ) : null}
            {report.program.state === 'known' ? (
              <div className="fact-grid">
                <div className="fact-row">
                  <span>ProgramData</span>
                  <KnowledgeDisplay
                    data={
                      report.program.value?.programDataAddress ?? {
                        state: 'unknown',
                        reason: 'INVALID_RESPONSE',
                      }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Upgrade authority</span>
                  <KnowledgeDisplay
                    data={
                      report.program.value?.upgradeAuthority ?? {
                        state: 'unknown',
                        reason: 'INVALID_RESPONSE',
                      }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Immutable</span>
                  <KnowledgeDisplay
                    data={
                      report.program.value?.immutable ?? {
                        state: 'unknown',
                        reason: 'INVALID_RESPONSE',
                      }
                    }
                  />
                </div>
                <div className="fact-row">
                  <span>Deployment slot</span>
                  <KnowledgeDisplay
                    data={
                      report.program.value?.deploymentSlot ?? {
                        state: 'unknown',
                        reason: 'INVALID_RESPONSE',
                      }
                    }
                  />
                </div>
              </div>
            ) : null}
            <div className="snapshot-strip">
              <span>
                <b>Slot</b> {record.snapshotSlot}
              </span>
              <span>
                <b>Blockhash</b> <code>{shortId(record.snapshotHash, 16)}</code>
              </span>
              <span>
                <b>Sources</b> {record.sourceSet.join(', ')}
              </span>
              <span>
                <b>Captured</b> {formatTime(record.capturedAt)}
              </span>
            </div>
          </section>

          <section className="panel" aria-labelledby="solana-extension-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Token-2022 behavior surface</span>
                <h3 id="solana-extension-heading">已解码扩展</h3>
              </div>
              <span className="snapshot-badge">{report.extensions.length} present</span>
            </div>
            {report.extensions.length === 0 ? (
              <div className="empty-state compact-empty">
                <strong>No Token-2022 extension was present for this account.</strong>
                <span>
                  For non-token subjects, extension domains remain explicitly not applicable.
                </span>
              </div>
            ) : (
              <div className="claim-draft-list">
                {report.extensions.map((extension) => (
                  <article className="claim-draft-card" key={extension.extensionType}>
                    <div className="claim-draft-heading">
                      <h4>{titleCase(extension.extensionType)}</h4>
                      <span className="snapshot-badge">DECODED</span>
                    </div>
                    <p className="panel-copy">
                      Authorities:{' '}
                      {extension.authorities.length === 0
                        ? 'None configured'
                        : extension.authorities
                            .map((item) => `${titleCase(item.role)} ${shortId(item.address, 10)}`)
                            .join(' · ')}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="solana-right-list-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Positive Evidence only</span>
                <h3 id="solana-right-list-heading">直接控制权</h3>
              </div>
              <span className="snapshot-badge">Point in time</span>
            </div>
            {report.rights.length === 0 ? (
              <div className="empty-state compact-empty">
                <strong>No direct right was positively established.</strong>
                <span>Coverage gaps below prevent this from becoming a global absence claim.</span>
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
                    </div>
                    <p className="panel-copy">{controlRight.constraints.join(' ')}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="solana-control-coverage-heading">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Known false is not Unknown</span>
                <h3 id="solana-control-coverage-heading">覆盖矩阵</h3>
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
