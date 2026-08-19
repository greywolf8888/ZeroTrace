import { type KnowledgeValue, type SubjectResponse } from '../../generated-api/client.js';
import type { SolanaTransactionSemanticsView } from './chain-views.js';
import {
  knownObject,
  StatusPill,
  formatTime,
  shortId,
  KnowledgeDisplay,
  titleCase,
} from './part-01.js';

export function SolanaTransactionIntelligencePanel({ response }: { response: SubjectResponse }) {
  if (response.subject.ledger !== 'SOLANA' || response.subject.type !== 'TRANSACTION') return null;
  const semantics = knownObject<SolanaTransactionSemanticsView>(
    response.facts.transactionSemantics,
  );
  if (semantics === undefined) return null;
  const instructions = [...semantics.outerInstructions, ...semantics.innerInstructions];
  const reconciliation = semantics.tokenFlowReconciliation;
  const launchpadObservations = response.launchpadObservations ?? [];
  const resolutionComplete =
    semantics.accountResolutionComplete.state === 'known' &&
    semantics.accountResolutionComplete.value;
  return (
    <section
      className="panel solana-transaction-intelligence"
      data-testid="solana-transaction-semantics"
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Versioned message · recorded execution effects</span>
          <h3>Solana 交易语义</h3>
        </div>
        <StatusPill status={semantics.execution} />
      </div>
      {response.durableReport === undefined ? (
        <div className="solana-report-provenance pending" data-testid="solana-report-provenance">
          <div>
            <strong>Ephemeral response</strong>
            <span>Durable PostgreSQL report storage was not available for this query.</span>
          </div>
          <StatusPill status="NOT_PERSISTED" />
        </div>
      ) : (
        <div className="solana-report-provenance" data-testid="solana-report-provenance">
          <div>
            <span className="eyebrow">Immutable transaction report</span>
            <strong>
              <code>{response.durableReport.id}</code>
            </strong>
            <span>
              Snapshot captured {formatTime(response.durableReport.capturedAt)} · result{' '}
              <code title={response.durableReport.resultHash}>
                {shortId(response.durableReport.resultHash, 10)}
              </code>
            </span>
          </div>
          <div className="solana-report-status">
            <StatusPill status={response.durableReport.replayed ? 'REPLAYED' : 'PERSISTED'} />
            <span>
              Live refresh <KnowledgeDisplay data={response.durableReport.liveRefresh} />
            </span>
          </div>
        </div>
      )}
      <div className="bitcoin-summary-grid solana-transaction-summary">
        <div>
          <span>Version</span>
          <strong>{semantics.version}</strong>
        </div>
        <div>
          <span>Fee payer</span>
          {semantics.feePayer.state === 'known' && semantics.feePayer.value !== undefined ? (
            <code title={semantics.feePayer.value}>{shortId(semantics.feePayer.value, 12)}</code>
          ) : (
            <KnowledgeDisplay data={semantics.feePayer} />
          )}
        </div>
        <div>
          <span>Signers</span>
          <strong>{semantics.signers.length}</strong>
        </div>
        <div>
          <span>Account coverage</span>
          <strong>{Math.round(semantics.accountCoverage * 100)}%</strong>
        </div>
        <div>
          <span>Recording coverage</span>
          <strong>{Math.round(semantics.recordingCoverage * 100)}%</strong>
        </div>
        <div>
          <span>Official identification</span>
          <KnowledgeDisplay data={semantics.officialProgramIdentificationCoverage} />
        </div>
        <div>
          <span>Core asset flows</span>
          <strong>{semantics.assetFlows.length}</strong>
        </div>
      </div>
      <div className="bitcoin-control-grid solana-transaction-boundaries">
        <div>
          <span>Loaded-address resolution</span>
          <StatusPill status={resolutionComplete ? 'RESOLVED' : 'INCOMPLETE'} />
          <p>
            {semantics.addressTableLookups.length} lookup table reference
            {semantics.addressTableLookups.length === 1 ? '' : 's'} ·{' '}
            {semantics.loadedWritableAccountCount} writable · {semantics.loadedReadonlyAccountCount}{' '}
            readonly loaded accounts.
          </p>
        </div>
        <div>
          <span>Inner instruction recording</span>
          <KnowledgeDisplay data={semantics.innerInstructionRecording} />
          <p>
            CPI count is preserved as Unknown when the RPC response did not record inner
            instructions.
          </p>
        </div>
        <div>
          <span>Token balance recording</span>
          <KnowledgeDisplay data={semantics.tokenBalanceRecording} />
          <p>An absent pre/post token record is 从未被强制写成原子零.</p>
        </div>
        <div>
          <span>Execution error</span>
          <KnowledgeDisplay data={semantics.executionError} />
          <p>Failed execution remains Evidence and is not treated as a missing transaction.</p>
        </div>
      </div>
      <div className="table-scroll solana-account-table">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Source</th>
              <th>Access</th>
              <th>Lamport delta</th>
            </tr>
          </thead>
          <tbody>
            {semantics.accounts.map((account) => (
              <tr key={`${account.index}:${account.address}`}>
                <td>
                  <code title={account.address}>
                    #{account.index} · {shortId(account.address, 10)}
                  </code>
                </td>
                <td>{titleCase(account.source)}</td>
                <td>
                  {[
                    account.feePayer ? 'Fee payer' : undefined,
                    account.signer ? 'Signer' : undefined,
                    account.writable ? 'Writable' : 'Readonly',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </td>
                <td>
                  <KnowledgeDisplay data={account.balanceDeltaLamports} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-scroll solana-instruction-table">
        <table>
          <thead>
            <tr>
              <th>Instruction</th>
              <th>Program</th>
              <th>Accounts</th>
              <th>Semantic</th>
              <th>Stack</th>
            </tr>
          </thead>
          <tbody>
            {instructions.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No compiled instructions were present in this transaction message.
                </td>
              </tr>
            ) : (
              instructions.map((instruction) => (
                <tr key={instruction.path}>
                  <td>{instruction.path}</td>
                  <td>
                    {instruction.programId.state === 'known' &&
                    instruction.programId.value !== undefined ? (
                      <code title={instruction.programId.value}>
                        {shortId(instruction.programId.value, 10)}
                      </code>
                    ) : (
                      <KnowledgeDisplay data={instruction.programId} />
                    )}
                  </td>
                  <td>
                    {instruction.programSemantic.state === 'known' &&
                    instruction.programSemantic.value !== undefined ? (
                      <span>
                        {titleCase(instruction.programSemantic.value.programFamily)} ·{' '}
                        {instruction.programSemantic.value.instructionName}
                      </span>
                    ) : (
                      <KnowledgeDisplay data={instruction.programSemantic} />
                    )}
                  </td>
                  <td>
                    {instruction.accounts.state === 'known' &&
                    instruction.accounts.value !== undefined ? (
                      `${instruction.accounts.value.length} resolved`
                    ) : (
                      <KnowledgeDisplay data={instruction.accounts} />
                    )}
                  </td>
                  <td>
                    <KnowledgeDisplay data={instruction.stackHeight} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="solana-launchpad-panel" data-testid="solana-launchpad-decoder">
        <div className="panel-header compact-header">
          <div>
            <span className="eyebrow">
              已钉扎 official program IDs · raw discriminator evidence
            </span>
            <h4>Solana 发射台解码器</h4>
          </div>
          <StatusPill status={launchpadObservations.length > 0 ? 'OBSERVED' : 'NOT_OBSERVED'} />
        </div>
        {launchpadObservations.length === 0 ? (
          <p className="empty-cell">
            No pinned Pump, PumpSwap, or Raydium LaunchLab instruction was observed. The decoder
            does not infer a launch mechanism from an unknown program or from a web page.
          </p>
        ) : (
          <div className="table-scroll solana-launchpad-table">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Instruction</th>
                  <th>Execution</th>
                  <th>Arguments</th>
                  <th>Coverage</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {launchpadObservations.map((observation) => (
                  <tr key={observation.id}>
                    <td>
                      <strong>{observation.platform}</strong>
                      <small title={observation.programId}>
                        {shortId(observation.programId, 10)}
                      </small>
                    </td>
                    <td>
                      <strong>{observation.instructionName}</strong>
                      <small>
                        {observation.instructionPath} · {observation.instructionVersion}
                      </small>
                    </td>
                    <td>
                      <StatusPill status={observation.execution} />
                    </td>
                    <td>
                      {observation.decodedArguments.length === 0 ? (
                        <span>None decoded</span>
                      ) : (
                        observation.decodedArguments.map((argument) => (
                          <small key={argument.name}>
                            {argument.name}={argument.value}
                          </small>
                        ))
                      )}
                    </td>
                    <td>
                      <span>accounts {Math.round(observation.accountCoverage * 100)}%</span>
                      <small>args {Math.round(observation.argumentCoverage * 100)}%</small>
                    </td>
                    <td>
                      {observation.decodeWarnings.length === 0 ? (
                        <span>None</span>
                      ) : (
                        observation.decodeWarnings.map((warning) => (
                          <small key={warning}>{warning}</small>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="solana-launchpad-boundary">
          Decoder version and Evidence remain visible in the report; no signing, broadcast, quote,
          swap, or ownership merge is enabled.
        </p>
      </div>
      <div className="solana-flow-audit" data-testid="solana-asset-flow-audit">
        <div className="panel-header compact-header">
          <div>
            <span className="eyebrow">
              Instruction intent · owner resolution · exact atomic check
            </span>
            <h4>核心资产流审计</h4>
          </div>
          <StatusPill status={reconciliation.status} />
        </div>
        <div className="bitcoin-summary-grid solana-flow-summary">
          <div>
            <span>Flow coverage</span>
            <KnowledgeDisplay data={semantics.assetFlowCoverage} />
          </div>
          <div>
            <span>Balance match</span>
            <strong>
              {reconciliation.matchedIdentityCount}/{reconciliation.expectedIdentityCount}
            </strong>
          </div>
          <div>
            <span>Unknown identities</span>
            <strong>{reconciliation.unknownIdentityCount}</strong>
          </div>
          <div>
            <span>Allowed atomic error</span>
            <strong>{reconciliation.recommendedMaxRelativeError}%</strong>
          </div>
          <div>
            <span>已观测 relative error</span>
            {reconciliation.observedRelativeError.state === 'known' &&
            reconciliation.observedRelativeError.value !== undefined ? (
              <strong>{(reconciliation.observedRelativeError.value * 100).toFixed(6)}%</strong>
            ) : (
              <KnowledgeDisplay data={reconciliation.observedRelativeError} />
            )}
          </div>
        </div>
        <p>{reconciliation.detail}</p>
      </div>
      <div className="table-scroll solana-asset-flow-table">
        <table>
          <thead>
            <tr>
              <th>Instruction</th>
              <th>Application</th>
              <th>Asset</th>
              <th>Source owner</th>
              <th>Destination owner</th>
              <th>Gross amount</th>
              <th>Expected fee / recipient</th>
            </tr>
          </thead>
          <tbody>
            {semantics.assetFlows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No supported System/SPL core asset-flow instruction was decoded. This is not a
                  claim that the transaction had zero economic effect.
                </td>
              </tr>
            ) : (
              semantics.assetFlows.map((flow) => (
                <tr key={flow.id}>
                  <td>
                    <strong>{flow.instructionName}</strong>
                    <small>{flow.instructionPath}</small>
                  </td>
                  <td>
                    <StatusPill status={flow.application} />
                  </td>
                  <td>{titleCase(flow.assetKind)}</td>
                  <td>
                    <KnowledgeDisplay data={flow.sourceOwner} />
                    {flow.sourceAccount.state === 'known' &&
                      flow.sourceAccount.value !== undefined && (
                        <small title={flow.sourceAccount.value}>
                          account {shortId(flow.sourceAccount.value, 8)}
                        </small>
                      )}
                  </td>
                  <td>
                    <KnowledgeDisplay data={flow.destinationOwner} />
                    {flow.destinationAccount.state === 'known' &&
                      flow.destinationAccount.value !== undefined && (
                        <small title={flow.destinationAccount.value}>
                          account {shortId(flow.destinationAccount.value, 8)}
                        </small>
                      )}
                  </td>
                  <td>
                    <KnowledgeDisplay data={flow.amount} />
                    <small>atomic units</small>
                  </td>
                  <td>
                    <KnowledgeDisplay data={flow.expectedFeeAmount} />
                    <span> / </span>
                    <KnowledgeDisplay data={flow.expectedRecipientAmount} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="table-scroll solana-token-change-table">
        <table>
          <thead>
            <tr>
              <th>Token account</th>
              <th>Mint</th>
              <th>Pre</th>
              <th>Post</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {semantics.tokenBalanceChanges.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  {semantics.tokenBalanceRecording.state === 'known'
                    ? 'No token balance identities were recorded for this transaction.'
                    : 'Token balance recording is unavailable; no zero balance is inferred.'}
                </td>
              </tr>
            ) : (
              semantics.tokenBalanceChanges.map((change) => (
                <tr key={`${change.accountIndex}:${change.mint}`}>
                  <td>
                    {change.account.state === 'known' && change.account.value !== undefined ? (
                      <code title={change.account.value}>{shortId(change.account.value, 10)}</code>
                    ) : (
                      <KnowledgeDisplay data={change.account} />
                    )}
                  </td>
                  <td>
                    <code title={change.mint}>{shortId(change.mint, 10)}</code>
                  </td>
                  <td>
                    <KnowledgeDisplay data={change.preAmount} />
                  </td>
                  <td>
                    <KnowledgeDisplay data={change.postAmount} />
                  </td>
                  <td>
                    <KnowledgeDisplay data={change.deltaAmount} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="snapshot-strip">
        <span>
          <b>Outer instructions</b> {semantics.outerInstructions.length}
        </span>
        <span>
          <b>CPI</b> <KnowledgeDisplay data={semantics.cpiCount} />
        </span>
        <span>
          <b>Compute units</b> <KnowledgeDisplay data={semantics.computeUnitsConsumed} />
        </span>
        <span>
          <b>Logs</b> <KnowledgeDisplay data={semantics.logCount} />
        </span>
      </div>
    </section>
  );
}

export function TokenAmountKnowledge({ data }: { data: KnowledgeValue<{ decimal: string }> }) {
  if (data.state === 'known' && data.value !== undefined) {
    return <span className="knowledge-known">{data.value.decimal}</span>;
  }
  return <KnowledgeDisplay data={data} />;
}
