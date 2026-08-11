import { hashPayload } from '@zerotrace/evidence';
import {
  AnalysisSnapshotSchema,
  EvidenceSchema,
  RawChainFactSchema,
  knownValue,
  unknownValue,
  type ActionAssetDelta,
  type ActionPrimitiveKind,
  type ActionProofKind,
  type ActionSemanticCandidate,
  type ActionSemanticsReport,
  type AnalysisSnapshot,
  type Evidence,
  type KnowledgeValue,
  type RawChainFact,
} from '@zerotrace/schemas';

import {
  buildActionSemanticsReport,
  canonicalActionTransactionId,
  createActionCandidate,
  type CreateActionCandidateInput,
} from './index.js';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const EVM_WORD = /^0x[0-9a-fA-F]{64}$/;
const EVM_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BITCOIN_TXID = /^[0-9a-fA-F]{64}$/;
const SOLANA_ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const RAW_LEDGER_ACTION_ADAPTER_VERSION = 'raw-ledger-action-adapter-v0.1.0';

export interface BuildRawLedgerActionSemanticsInput {
  snapshot: AnalysisSnapshot;
  facts: readonly RawChainFact[];
  evidence: readonly Evidence[];
  dataCoverage: number;
  sourceCoverage: number;
  historyCoverage?: number;
  simulationCoverage?: number;
}

type CandidateDraft = CreateActionCandidateInput;

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return string(value, field);
}

function unsigned(value: unknown, field: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be an unsigned safe integer or decimal string.`);
    }
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be an unsigned safe integer or decimal string.`);
  }
  return BigInt(value);
}

function sourceIndex(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function position(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'EVM'
    ? snapshot.blockNumber
    : snapshot.ledger === 'BITCOIN'
      ? snapshot.height
      : snapshot.slot;
}

function snapshotHash(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
}

function sameHash(ledger: AnalysisSnapshot['ledger'], left: string, right: string): boolean {
  return ledger === 'SOLANA' ? left === right : left.toLowerCase() === right.toLowerCase();
}

function canonicalEvmAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !EVM_ADDRESS.test(value)) {
    throw new Error(`${field} must be an EVM address.`);
  }
  return value.toLowerCase();
}

function knownActor(value: string | undefined, detail: string): KnowledgeValue<string> {
  return value === undefined ? unknownValue('INSUFFICIENT_DATA', detail) : knownValue(value);
}

function validateBundle(input: BuildRawLedgerActionSemanticsInput): {
  snapshot: AnalysisSnapshot;
  facts: RawChainFact[];
  evidence: Evidence[];
  transaction: RawChainFact;
  evidenceIds: string[];
} {
  const snapshot = AnalysisSnapshotSchema.parse(input.snapshot);
  const facts = input.facts.map((item) => RawChainFactSchema.parse(item));
  const evidence = input.evidence.map((item) => EvidenceSchema.parse(item));
  if (facts.length === 0) throw new Error('Raw Action Semantics requires durable ledger facts.');
  const providers = new Set(facts.map((item) => item.provider));
  const artifacts = new Set(facts.map((item) => item.rawArtifactRef));
  const factIds = new Set(facts.map((item) => item.id));
  const factEvidenceIds = canonical(facts.map((item) => item.evidenceId));
  const evidenceIds = evidence.map((item) => item.id);
  if (
    providers.size !== 1 ||
    artifacts.size !== 1 ||
    factIds.size !== facts.length ||
    new Set(evidenceIds).size !== evidence.length ||
    factEvidenceIds.length !== evidence.length ||
    factEvidenceIds.some((id, index) => id !== [...evidenceIds].sort()[index])
  ) {
    throw new Error('Raw facts and Evidence must be unique, exact, and use one provider artifact.');
  }
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const expectedPosition = position(snapshot);
  const expectedHash = snapshotHash(snapshot);
  for (const fact of facts) {
    const item = evidenceById.get(fact.evidenceId);
    if (
      fact.ledger !== snapshot.ledger ||
      fact.chainId !== snapshot.chainId ||
      fact.blockOrSlot !== expectedPosition ||
      !sameHash(snapshot.ledger, fact.blockHash, expectedHash) ||
      fact.finality !== 'finalized' ||
      item === undefined ||
      item.ledger !== fact.ledger ||
      item.chainId !== fact.chainId ||
      item.blockOrSlot !== fact.blockOrSlot ||
      item.source !== fact.provider ||
      item.rawArtifactRef !== fact.rawArtifactRef ||
      item.observedAt !== fact.observedAt ||
      item.finality !== fact.finality ||
      item.payloadHash !== fact.payloadHash ||
      fact.payloadHash !== hashPayload(fact.payload) ||
      snapshot.providerVersions[fact.provider] === undefined
    ) {
      throw new Error('Raw fact, Evidence, and Snapshot identity must match exactly.');
    }
  }
  const transactions = facts.filter((item) => item.factType === 'TRANSACTION');
  if (transactions.length !== 1) {
    throw new Error('Raw Action Semantics requires exactly one transaction fact.');
  }
  return {
    snapshot,
    facts,
    evidence: [...evidence].sort((left, right) => left.id.localeCompare(right.id)),
    transaction: transactions[0] as RawChainFact,
    evidenceIds: factEvidenceIds,
  };
}

function evmApplication(payload: Readonly<Record<string, unknown>>): CandidateDraft['application'] {
  const status = payload.status;
  if (status === undefined || status === null) return 'UNKNOWN';
  if (status === 1 || status === '1' || status === '0x1') return 'APPLIED';
  if (status === 0 || status === '0' || status === '0x0') return 'NOT_APPLIED';
  throw new Error('EVM transaction status must be zero, one, or unavailable.');
}

function topicAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !EVM_WORD.test(value)) {
    throw new Error(`${field} must be a 32-byte EVM topic.`);
  }
  const normalized = value.toLowerCase();
  if (
    !normalized
      .slice(2, 26)
      .split('')
      .every((character) => character === '0')
  ) {
    throw new Error(`${field} must contain a canonically padded EVM address.`);
  }
  return `0x${normalized.slice(-40)}`;
}

function evmDrafts(bundle: ReturnType<typeof validateBundle>): CandidateDraft[] {
  const { snapshot, facts, transaction, evidenceIds } = bundle;
  const payload = record(transaction.payload, 'EVM transaction payload');
  const transactionId = canonicalActionTransactionId('EVM', transaction.subject);
  if (
    payload.hash !== undefined &&
    canonicalActionTransactionId('EVM', String(payload.hash)) !== transactionId
  ) {
    throw new Error('EVM transaction payload hash conflicts with its subject.');
  }
  const application = evmApplication(payload);
  const from =
    payload.from === undefined || payload.from === null
      ? undefined
      : canonicalEvmAddress(payload.from, 'EVM transaction from');
  const to =
    payload.to === undefined || payload.to === null
      ? undefined
      : canonicalEvmAddress(payload.to, 'EVM transaction to');
  const inputData = optionalString(payload.input, 'EVM transaction input');
  if (inputData !== undefined && !EVM_DATA.test(inputData)) {
    throw new Error('EVM transaction input must be canonical hexadecimal bytes.');
  }
  const common = {
    ledger: 'EVM' as const,
    chainId: snapshot.chainId,
    transactionId,
    blockOrSlot: position(snapshot),
    observedAt: transaction.observedAt,
    application,
    actor: knownActor(from, 'EVM transaction sender is unavailable.'),
  };
  const drafts: CandidateDraft[] = [];
  if (inputData !== undefined && inputData !== '0x' && to !== undefined) {
    drafts.push({
      ...common,
      proposedKind: 'CONTRACT_CALL',
      counterparties: [to],
      proofKinds:
        application === 'UNKNOWN'
          ? ['TRANSACTION_INPUT']
          : ['EXECUTION_RECEIPT', 'TRANSACTION_INPUT'],
      evidenceIds,
    });
  }
  if (payload.value !== undefined && payload.value !== null) {
    const amount = unsigned(payload.value, 'EVM transaction value');
    if (amount > 0n && to !== undefined) {
      const applied = application === 'APPLIED';
      drafts.push({
        ...common,
        proposedKind: 'TRANSFER',
        counterparties: [to],
        assetDeltas: applied
          ? [
              {
                assetId: `eip155:${snapshot.chainId}:native`,
                account: from ?? 'evm:unknown-sender',
                direction: 'DEBIT',
                amount: amount.toString(),
                evidenceIds: [transaction.evidenceId],
              },
              {
                assetId: `eip155:${snapshot.chainId}:native`,
                account: to,
                direction: 'CREDIT',
                amount: amount.toString(),
                evidenceIds: [transaction.evidenceId],
              },
            ]
          : [],
        proofKinds:
          application === 'UNKNOWN'
            ? ['TRANSACTION_INPUT']
            : ['EXECUTION_RECEIPT', 'VALUE_TRANSFER'],
        evidenceIds: [transaction.evidenceId],
      });
    }
  }
  for (const fact of facts.filter((item) => item.factType === 'LOG')) {
    const log = record(fact.payload, 'EVM log payload');
    const logTransaction = canonicalActionTransactionId(
      'EVM',
      string(log.transactionHash, 'EVM log transaction hash'),
    );
    if (logTransaction !== transactionId)
      throw new Error('EVM log belongs to another transaction.');
    if (!Array.isArray(log.topics) || log.topics.some((item) => typeof item !== 'string')) {
      throw new Error('EVM log topics must be an array of hexadecimal words.');
    }
    const topics = log.topics as string[];
    if (topics[0]?.toLowerCase() !== EVM_TRANSFER_TOPIC) continue;
    if (topics.length !== 3) {
      throw new Error('ERC-20 Transfer Evidence must contain exactly three topics.');
    }
    const data = string(log.data, 'ERC-20 Transfer data');
    if (!EVM_WORD.test(data)) throw new Error('ERC-20 Transfer data must be one uint256 word.');
    const sender = topicAddress(topics[1], 'ERC-20 Transfer from topic');
    const recipient = topicAddress(topics[2], 'ERC-20 Transfer to topic');
    const asset = canonicalEvmAddress(log.address, 'ERC-20 contract address');
    const amount = BigInt(data);
    const applied = application === 'APPLIED';
    if (application === 'NOT_APPLIED') {
      throw new Error('A failed EVM transaction cannot contain an applied Transfer log.');
    }
    drafts.push({
      ...common,
      application,
      proposedKind: 'TRANSFER',
      actor: knownValue(sender),
      counterparties: [recipient],
      assetDeltas:
        amount === 0n || !applied
          ? []
          : [
              {
                assetId: `eip155:${snapshot.chainId}:erc20:${asset}`,
                account: sender,
                direction: 'DEBIT',
                amount: amount.toString(),
                evidenceIds: [fact.evidenceId],
              },
              {
                assetId: `eip155:${snapshot.chainId}:erc20:${asset}`,
                account: recipient,
                direction: 'CREDIT',
                amount: amount.toString(),
                evidenceIds: [fact.evidenceId],
              },
            ],
      proofKinds: ['TRANSFER_LOG'],
      evidenceIds: canonical([transaction.evidenceId, fact.evidenceId]),
    });
  }
  const transactionIndex =
    payload.transactionIndex === undefined
      ? undefined
      : sourceIndex(payload.transactionIndex, 'EVM transaction index');
  for (const fact of facts.filter((item) => ['TRACE', 'STATE_DIFF'].includes(item.factType))) {
    const related = record(fact.payload, `EVM ${fact.factType} payload`);
    if (
      transactionIndex === undefined ||
      sourceIndex(related.transactionIndex, `EVM ${fact.factType} transaction index`) !==
        transactionIndex
    ) {
      throw new Error(`EVM ${fact.factType} belongs to another or unresolved transaction.`);
    }
  }
  if (
    facts.some((item) => !['TRANSACTION', 'LOG', 'TRACE', 'STATE_DIFF'].includes(item.factType))
  ) {
    throw new Error('EVM transaction bundle contains an unsupported fact type.');
  }
  return drafts;
}

function bitcoinAccount(
  address: unknown,
  script: unknown,
  fallback: string,
  field: string,
): string {
  if (typeof address === 'string' && address.length > 0) return address;
  if (typeof script === 'string' && /^(?:[0-9a-fA-F]{2})+$/.test(script)) {
    return `script:${script.toLowerCase()}`;
  }
  if (fallback.length > 0) return fallback;
  throw new Error(`${field} account identity is unavailable.`);
}

function bitcoinDrafts(bundle: ReturnType<typeof validateBundle>): CandidateDraft[] {
  const { snapshot, facts, transaction, evidenceIds } = bundle;
  const payload = record(transaction.payload, 'Bitcoin transaction payload');
  const transactionId = canonicalActionTransactionId('BITCOIN', transaction.subject);
  if (
    payload.txid !== undefined &&
    canonicalActionTransactionId('BITCOIN', String(payload.txid)) !== transactionId
  ) {
    throw new Error('Bitcoin transaction payload txid conflicts with its subject.');
  }
  const transactionIndex = sourceIndex(payload.transactionIndex, 'Bitcoin transaction index');
  const inputs = facts.filter((item) => item.factType === 'UTXO_INPUT');
  const outputs = facts.filter((item) => item.factType === 'UTXO_OUTPUT');
  if (inputs.length === 0 || outputs.length === 0) {
    throw new Error('Bitcoin Action Semantics requires the complete input and output sets.');
  }
  if (facts.some((item) => !['TRANSACTION', 'UTXO_INPUT', 'UTXO_OUTPUT'].includes(item.factType))) {
    throw new Error('Bitcoin transaction bundle contains an unsupported fact type.');
  }
  const assetId = `bitcoin:${snapshot.chainId}:native`;
  const deltas: ActionAssetDelta[] = [];
  const inputAccounts: string[] = [];
  const outputAccounts: string[] = [];
  let inputTotal = 0n;
  let outputTotal = 0n;
  let coinbaseInputs = 0;
  for (const fact of inputs) {
    const input = record(fact.payload, 'Bitcoin input payload');
    if (
      sourceIndex(input.transactionIndex, 'Bitcoin input transaction index') !== transactionIndex
    ) {
      throw new Error('Bitcoin input belongs to another transaction.');
    }
    const outpointTxid = input.txid;
    const outpointVout = input.vout;
    if (outpointTxid === null && outpointVout === null) {
      coinbaseInputs += 1;
      continue;
    }
    if (
      typeof outpointTxid !== 'string' ||
      !BITCOIN_TXID.test(outpointTxid) ||
      typeof outpointVout !== 'number' ||
      !Number.isSafeInteger(outpointVout) ||
      outpointVout < 0
    ) {
      throw new Error('Bitcoin input outpoint is invalid.');
    }
    const amount = unsigned(input.prevoutValue, 'Bitcoin prevout value');
    inputTotal += amount;
    if (amount === 0n) continue;
    const account = bitcoinAccount(
      input.prevoutScriptPubKeyAddress,
      undefined,
      `outpoint:${outpointTxid.toLowerCase()}:${outpointVout}`,
      'Bitcoin input',
    );
    inputAccounts.push(account);
    deltas.push({
      assetId,
      account,
      direction: 'DEBIT',
      amount: amount.toString(),
      evidenceIds: [fact.evidenceId],
    });
  }
  for (const fact of outputs) {
    const output = record(fact.payload, 'Bitcoin output payload');
    if (
      sourceIndex(output.transactionIndex, 'Bitcoin output transaction index') !== transactionIndex
    ) {
      throw new Error('Bitcoin output belongs to another transaction.');
    }
    const outputIndex = sourceIndex(output.outputIndex, 'Bitcoin output index');
    const amount = unsigned(output.value, 'Bitcoin output value');
    outputTotal += amount;
    if (amount === 0n) continue;
    const account = bitcoinAccount(
      output.scriptPubKeyAddress,
      output.scriptPubKeyHex,
      `output:${transactionId}:${outputIndex}`,
      'Bitcoin output',
    );
    outputAccounts.push(account);
    deltas.push({
      assetId,
      account,
      direction: 'CREDIT',
      amount: amount.toString(),
      evidenceIds: [fact.evidenceId],
    });
  }
  const coinbase = coinbaseInputs === 1 && inputTotal === 0n;
  if (coinbaseInputs > 1 || (coinbaseInputs === 1 && inputTotal > 0n)) {
    throw new Error('Bitcoin coinbase input shape is invalid.');
  }
  if (!coinbase) {
    if (inputTotal < outputTotal) throw new Error('Bitcoin outputs exceed observed prevout value.');
    const fee = inputTotal - outputTotal;
    if (fee > 0n) {
      const feeEvidenceIds = canonical([...inputs, ...outputs].map((item) => item.evidenceId));
      const feeAccount = `bitcoin:${snapshot.chainId}:miner-fee`;
      outputAccounts.push(feeAccount);
      deltas.push({
        assetId,
        account: feeAccount,
        direction: 'CREDIT',
        amount: fee.toString(),
        evidenceIds: feeEvidenceIds,
      });
    }
  }
  if (deltas.length === 0) throw new Error('Bitcoin transaction has no positive UTXO movement.');
  const actors = canonical(inputAccounts);
  return [
    {
      ledger: 'BITCOIN',
      chainId: snapshot.chainId,
      transactionId,
      blockOrSlot: position(snapshot),
      observedAt: transaction.observedAt,
      proposedKind: coinbase ? 'MINT' : 'TRANSFER',
      application: 'APPLIED',
      actor:
        actors.length === 1
          ? knownValue(actors[0] as string)
          : unknownValue(
              'PRECISION_UNSAFE',
              coinbase
                ? 'Coinbase issuance has no spending actor.'
                : 'Multiple or unavailable UTXO input owners prevent one actor assignment.',
            ),
      counterparties: canonical(outputAccounts),
      assetDeltas: deltas,
      proofKinds: ['UTXO_CONSERVATION'],
      evidenceIds,
    },
  ];
}

function solanaApplication(
  payload: Readonly<Record<string, unknown>>,
): CandidateDraft['application'] {
  if (!Object.hasOwn(payload, 'err')) return 'UNKNOWN';
  return payload.err === null ? 'APPLIED' : 'NOT_APPLIED';
}

function solanaAccount(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SOLANA_ACCOUNT.test(value)) {
    throw new Error(`${field} must be a Solana account.`);
  }
  return value;
}

function solanaAmount(value: unknown, field: string): bigint {
  return value === null || value === undefined ? 0n : unsigned(value, field);
}

function solanaDrafts(bundle: ReturnType<typeof validateBundle>): CandidateDraft[] {
  const { snapshot, facts, transaction } = bundle;
  const payload = record(transaction.payload, 'Solana transaction payload');
  const transactionId = canonicalActionTransactionId('SOLANA', transaction.subject);
  if (
    !Array.isArray(payload.signatures) ||
    payload.signatures.length === 0 ||
    payload.signatures[0] !== transactionId
  ) {
    throw new Error('Solana transaction signature conflicts with its subject.');
  }
  const transactionIndex = sourceIndex(payload.transactionIndex, 'Solana transaction index');
  const application = solanaApplication(payload);
  const feePayer =
    payload.feePayer === undefined || payload.feePayer === null
      ? undefined
      : solanaAccount(payload.feePayer, 'Solana fee payer');
  const common = {
    ledger: 'SOLANA' as const,
    chainId: snapshot.chainId,
    transactionId,
    blockOrSlot: position(snapshot),
    observedAt: transaction.observedAt,
    application,
    actor: knownActor(feePayer, 'Solana fee payer is unavailable.'),
  };
  const drafts: CandidateDraft[] = [];
  const instructions = facts.filter((item) => item.factType === 'INSTRUCTION');
  if (instructions.length > 0) {
    const programs: string[] = [];
    for (const fact of instructions) {
      const instruction = record(fact.payload, 'Solana instruction payload');
      if (
        sourceIndex(instruction.transactionIndex, 'Solana instruction transaction index') !==
        transactionIndex
      ) {
        throw new Error('Solana instruction belongs to another transaction.');
      }
      programs.push(solanaAccount(instruction.programId, 'Solana instruction program ID'));
    }
    drafts.push({
      ...common,
      proposedKind: 'CONTRACT_CALL',
      counterparties: canonical(programs),
      proofKinds:
        application === 'UNKNOWN'
          ? ['TRANSACTION_INPUT']
          : ['EXECUTION_RECEIPT', 'TRANSACTION_INPUT'],
      evidenceIds: canonical([
        transaction.evidenceId,
        ...instructions.map((item) => item.evidenceId),
      ]),
    });
  }
  const deltas: ActionAssetDelta[] = [];
  const counterparties: string[] = [];
  const nativeBalances = facts.filter((item) => item.factType === 'BALANCE');
  const nativeDeltas: ActionAssetDelta[] = [];
  let nativeDebits = 0n;
  let nativeCredits = 0n;
  for (const fact of nativeBalances) {
    const balance = record(fact.payload, 'Solana native balance payload');
    if (
      sourceIndex(balance.transactionIndex, 'Solana balance transaction index') !== transactionIndex
    ) {
      throw new Error('Solana balance belongs to another transaction.');
    }
    const account = solanaAccount(balance.account, 'Solana balance account');
    const pre = solanaAmount(balance.pre, 'Solana pre-balance');
    const post = solanaAmount(balance.post, 'Solana post-balance');
    if (pre > post) {
      const amount = pre - post;
      nativeDebits += amount;
      nativeDeltas.push({
        assetId: `solana:${snapshot.chainId}:native`,
        account,
        direction: 'DEBIT',
        amount: amount.toString(),
        evidenceIds: [fact.evidenceId],
      });
      counterparties.push(account);
    } else if (post > pre) {
      const amount = post - pre;
      nativeCredits += amount;
      nativeDeltas.push({
        assetId: `solana:${snapshot.chainId}:native`,
        account,
        direction: 'CREDIT',
        amount: amount.toString(),
        evidenceIds: [fact.evidenceId],
      });
      counterparties.push(account);
    }
  }
  const fee =
    payload.fee === undefined || payload.fee === null
      ? undefined
      : unsigned(payload.fee, 'Solana fee');
  if (nativeDeltas.length > 0) {
    if (nativeDebits < nativeCredits) {
      throw new Error('Solana native balance credits exceed observed debits.');
    }
    const residual = nativeDebits - nativeCredits;
    if (fee === undefined || residual !== fee) {
      throw new Error('Solana native balance deltas do not reconcile to the recorded fee.');
    }
    if (application !== 'NOT_APPLIED') {
      deltas.push(...nativeDeltas);
      if (fee > 0n) {
        const feeAccount = `solana:${snapshot.chainId}:validator-fee`;
        deltas.push({
          assetId: `solana:${snapshot.chainId}:native`,
          account: feeAccount,
          direction: 'CREDIT',
          amount: fee.toString(),
          evidenceIds: canonical([
            transaction.evidenceId,
            ...nativeBalances.map((item) => item.evidenceId),
          ]),
        });
        counterparties.push(feeAccount);
      }
    }
  } else if (fee !== undefined && fee > 0n) {
    throw new Error('Solana fee is not represented by materialized native balance records.');
  }
  const tokenBalances = facts.filter((item) => item.factType === 'TOKEN_BALANCE');
  for (const fact of tokenBalances) {
    const balance = record(fact.payload, 'Solana token balance payload');
    if (
      sourceIndex(balance.transactionIndex, 'Solana token balance transaction index') !==
      transactionIndex
    ) {
      throw new Error('Solana token balance belongs to another transaction.');
    }
    const account = solanaAccount(balance.account, 'Solana token account');
    const preMint = optionalString(balance.preMint, 'Solana pre-token mint');
    const postMint = optionalString(balance.postMint, 'Solana post-token mint');
    if (preMint !== undefined) solanaAccount(preMint, 'Solana pre-token mint');
    if (postMint !== undefined) solanaAccount(postMint, 'Solana post-token mint');
    if (preMint === undefined && postMint === undefined) {
      throw new Error('Solana token balance has no mint identity.');
    }
    const preAmount = solanaAmount(balance.preAmount, 'Solana pre-token amount');
    const postAmount = solanaAmount(balance.postAmount, 'Solana post-token amount');
    const preOwner =
      balance.preOwner === undefined || balance.preOwner === null
        ? account
        : solanaAccount(balance.preOwner, 'Solana pre-token owner');
    const postOwner =
      balance.postOwner === undefined || balance.postOwner === null
        ? account
        : solanaAccount(balance.postOwner, 'Solana post-token owner');
    const preAsset =
      preMint === undefined ? undefined : `solana:${snapshot.chainId}:spl:${preMint}`;
    const postAsset =
      postMint === undefined ? undefined : `solana:${snapshot.chainId}:spl:${postMint}`;
    if (preAsset === postAsset && preOwner === postOwner) {
      if (preAmount > postAmount) {
        deltas.push({
          assetId: preAsset as string,
          account: preOwner,
          direction: 'DEBIT',
          amount: (preAmount - postAmount).toString(),
          evidenceIds: [fact.evidenceId],
        });
        counterparties.push(preOwner);
      } else if (postAmount > preAmount) {
        deltas.push({
          assetId: postAsset as string,
          account: postOwner,
          direction: 'CREDIT',
          amount: (postAmount - preAmount).toString(),
          evidenceIds: [fact.evidenceId],
        });
        counterparties.push(postOwner);
      }
    } else {
      if (preAsset !== undefined && preAmount > 0n) {
        deltas.push({
          assetId: preAsset,
          account: preOwner,
          direction: 'DEBIT',
          amount: preAmount.toString(),
          evidenceIds: [fact.evidenceId],
        });
        counterparties.push(preOwner);
      }
      if (postAsset !== undefined && postAmount > 0n) {
        deltas.push({
          assetId: postAsset,
          account: postOwner,
          direction: 'CREDIT',
          amount: postAmount.toString(),
          evidenceIds: [fact.evidenceId],
        });
        counterparties.push(postOwner);
      }
    }
  }
  if (application === 'NOT_APPLIED' && deltas.length > 0) {
    throw new Error('A failed Solana transaction cannot contain applied token balance deltas.');
  }
  if (deltas.length > 0) {
    drafts.push({
      ...common,
      proposedKind: 'TRANSFER',
      counterparties: canonical(counterparties),
      assetDeltas: deltas,
      proofKinds: ['BALANCE_DELTAS'],
      evidenceIds: canonical([
        transaction.evidenceId,
        ...nativeBalances.map((item) => item.evidenceId),
        ...tokenBalances.map((item) => item.evidenceId),
      ]),
    });
  }
  for (const fact of facts.filter((item) => item.factType === 'LOG')) {
    const related = record(fact.payload, `Solana ${fact.factType} payload`);
    if (
      sourceIndex(related.transactionIndex, `Solana ${fact.factType} transaction index`) !==
      transactionIndex
    ) {
      throw new Error(`Solana ${fact.factType} belongs to another transaction.`);
    }
  }
  if (
    facts.some(
      (item) =>
        !['TRANSACTION', 'INSTRUCTION', 'LOG', 'BALANCE', 'TOKEN_BALANCE'].includes(item.factType),
    )
  ) {
    throw new Error('Solana transaction bundle contains an unsupported fact type.');
  }
  return drafts;
}

function compileCandidates(bundle: ReturnType<typeof validateBundle>): ActionSemanticCandidate[] {
  const drafts =
    bundle.snapshot.ledger === 'EVM'
      ? evmDrafts(bundle)
      : bundle.snapshot.ledger === 'BITCOIN'
        ? bitcoinDrafts(bundle)
        : solanaDrafts(bundle);
  if (drafts.length === 0) {
    throw new Error('The finalized transaction contains no supported action candidate.');
  }
  const allEvidence = bundle.evidenceIds;
  return drafts.map((draft, index) =>
    createActionCandidate({
      ...draft,
      evidenceIds: index === 0 ? allEvidence : draft.evidenceIds,
    }),
  );
}

export function buildActionSemanticsFromRawFacts(
  input: BuildRawLedgerActionSemanticsInput,
): ActionSemanticsReport {
  const bundle = validateBundle(input);
  return buildActionSemanticsReport({
    snapshot: bundle.snapshot,
    candidates: compileCandidates(bundle),
    evidence: bundle.evidence,
    dataCoverage: input.dataCoverage,
    sourceCoverage: input.sourceCoverage,
    historyCoverage: input.historyCoverage ?? 0,
    simulationCoverage: input.simulationCoverage ?? 0,
  });
}

export type { ActionPrimitiveKind, ActionProofKind };
