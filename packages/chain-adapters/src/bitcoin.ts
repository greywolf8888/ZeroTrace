import { hashPayload } from '@zerotrace/evidence';
import {
  ChainAnchorReadSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type BitcoinSnapshotSchema,
  type ChainAnchorRead,
  type ProviderCapability,
  type ProviderHealth,
} from '@zerotrace/schemas';
import type { z } from 'zod';

import { ProviderError, toProviderError } from './errors.js';
import {
  getRestJsonSourced,
  getRestTextSourced,
  type RestTransport,
  type TransportObservation,
} from './transport.js';

export type BitcoinSnapshot = z.infer<typeof BitcoinSnapshotSchema>;

export interface BitcoinTransactionStatus {
  confirmed: boolean;
  blockHeight?: string;
  blockHash?: string;
  blockTime?: string;
}

export interface BitcoinTransactionOutput {
  valueSats: string;
  scriptPubKey: string;
  scriptType: string;
  address?: string;
  raw: Readonly<Record<string, unknown>>;
}

export interface BitcoinTransactionInput {
  coinbase: boolean;
  previousTxid?: string;
  previousVout?: string;
  sequence: string;
  scriptSig: string;
  scriptSigAsm: string;
  innerRedeemScriptAsm?: string;
  innerWitnessScriptAsm?: string;
  witness: readonly string[];
  previousOutput?: BitcoinTransactionOutput;
  raw: Readonly<Record<string, unknown>>;
}

export interface BitcoinTransactionRecord {
  txid: string;
  version: number;
  locktime: string;
  size: string;
  weight: string;
  feeSats: string;
  inputCount: number;
  inputs: readonly BitcoinTransactionInput[];
  outputs: readonly BitcoinTransactionOutput[];
  status: BitcoinTransactionStatus;
  raw: Readonly<Record<string, unknown>>;
}

export interface BitcoinOutspendRecord {
  spent: boolean;
  spendingTxid?: string;
  spendingVin?: string;
  status?: BitcoinTransactionStatus;
  raw: Readonly<Record<string, unknown>>;
}

export interface BitcoinAddressUtxo {
  txid: string;
  vout: string;
  valueSats: string;
  status: BitcoinTransactionStatus;
  raw: Readonly<Record<string, unknown>>;
}

const BITCOIN_CAPABILITIES: ProviderCapability[] = [
  'CURRENT_STATE',
  'BLOCK',
  'TRANSACTION',
  'MEMPOOL',
  'UTXO',
];

export interface EsploraAddressStats {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

export interface BitcoinAdapterConfig {
  id: string;
  adapterVersion?: string;
}

function requireHeight(value: string): string {
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block height.');
  }
  return trimmed;
}

function requireBlockHash(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block hash.');
  }
  return trimmed.toLowerCase();
}

function requirePosition(value: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', 'Bitcoin block position must be unsigned decimal.');
  }
  return value;
}

function requireSafeBlockHeight(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block height.');
  }
  return String(value);
}

function requireSafeUnsignedInteger(value: unknown, field: string): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('INVALID_RESPONSE', `Esplora returned an invalid ${field}.`);
  }
  return String(value);
}

function requireSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Esplora returned an invalid ${field}.`);
  }
  return value;
}

function requireUint32(value: unknown, field: string): string {
  const parsed = requireSafeUnsignedInteger(value, field);
  if (BigInt(parsed) > 0xffff_ffffn) {
    throw new ProviderError('INVALID_RESPONSE', `Esplora returned an out-of-range ${field}.`);
  }
  return parsed;
}

function requireHex(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Esplora returned an invalid ${field}.`);
  }
  return value.toLowerCase();
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Esplora returned an invalid ${field}.`);
  }
  return value as Record<string, unknown>;
}

function requireTxid(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ProviderError('INVALID_RESPONSE', `Esplora returned an invalid ${field}.`);
  }
  return requireBlockHash(value);
}

function parseTransactionStatus(value: unknown): BitcoinTransactionStatus {
  const status = requireRecord(value, 'transaction status');
  if (typeof status.confirmed !== 'boolean') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora transaction status is missing confirmed state.',
    );
  }
  if (!status.confirmed) return { confirmed: false };
  const blockTime = requireSafeUnsignedInteger(status.block_time, 'transaction block time');
  return {
    confirmed: true,
    blockHeight: requireSafeBlockHeight(status.block_height),
    blockHash: requireTxid(status.block_hash, 'transaction block hash'),
    blockTime,
  };
}

function parseTransactionOutput(value: unknown): BitcoinTransactionOutput {
  const output = requireRecord(value, 'transaction output');
  if (typeof output.scriptpubkey_type !== 'string' || output.scriptpubkey_type.length === 0) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid output script type.');
  }
  if (
    output.scriptpubkey_address !== undefined &&
    typeof output.scriptpubkey_address !== 'string'
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid output address.');
  }
  return {
    valueSats: requireSafeUnsignedInteger(output.value, 'output value'),
    scriptPubKey: requireHex(output.scriptpubkey, 'output script'),
    scriptType: output.scriptpubkey_type,
    ...(output.scriptpubkey_address === undefined ? {} : { address: output.scriptpubkey_address }),
    raw: output,
  };
}

function parseTransactionInput(value: unknown): BitcoinTransactionInput {
  const input = requireRecord(value, 'transaction input');
  if (typeof input.is_coinbase !== 'boolean') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora transaction input is missing coinbase state.',
    );
  }
  if (typeof input.scriptsig_asm !== 'string') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora transaction input has invalid scriptSig ASM.',
    );
  }
  if (input.witness !== undefined && !Array.isArray(input.witness)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora transaction input has invalid witness data.',
    );
  }
  for (const field of ['inner_redeemscript_asm', 'inner_witnessscript_asm'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `Esplora transaction input has invalid ${field}.`,
      );
    }
  }
  const witness = (input.witness ?? []).map((item, index) =>
    requireHex(item, `input witness item ${index}`),
  );
  const shared = {
    coinbase: input.is_coinbase,
    sequence: requireUint32(input.sequence, 'input sequence'),
    scriptSig: requireHex(input.scriptsig, 'input scriptSig'),
    scriptSigAsm: input.scriptsig_asm,
    ...(typeof input.inner_redeemscript_asm === 'string'
      ? { innerRedeemScriptAsm: input.inner_redeemscript_asm }
      : {}),
    ...(typeof input.inner_witnessscript_asm === 'string'
      ? { innerWitnessScriptAsm: input.inner_witnessscript_asm }
      : {}),
    witness,
    raw: input,
  };
  if (input.is_coinbase) return shared;
  if (input.prevout === null || input.prevout === undefined) {
    throw new ProviderError('INVALID_RESPONSE', 'Non-coinbase Bitcoin input is missing prevout.');
  }
  const previousOutput = parseTransactionOutput(input.prevout);
  if (/^v(?:0|1)_/.test(previousOutput.scriptType) && witness.length === 0) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Native SegWit or Taproot input is missing witness data.',
    );
  }
  return {
    ...shared,
    previousTxid: requireTxid(input.txid, 'input previous transaction id'),
    previousVout: requireUint32(input.vout, 'input previous output index'),
    previousOutput,
  };
}

function parseTransaction(value: unknown, expectedTxid: string): BitcoinTransactionRecord {
  const transaction = requireRecord(value, 'transaction');
  const txid = requireTxid(transaction.txid, 'transaction id');
  if (txid !== expectedTxid.toLowerCase()) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora transaction identity does not match the requested txid.',
    );
  }
  if (!Array.isArray(transaction.vin) || !Array.isArray(transaction.vout)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora transaction inputs or outputs are invalid.',
    );
  }
  const inputs = transaction.vin.map(parseTransactionInput);
  return {
    txid,
    version: requireSafeInteger(transaction.version, 'transaction version'),
    locktime: requireSafeUnsignedInteger(transaction.locktime, 'transaction locktime'),
    size: requireSafeUnsignedInteger(transaction.size, 'transaction size'),
    weight: requireSafeUnsignedInteger(transaction.weight, 'transaction weight'),
    feeSats: requireSafeUnsignedInteger(transaction.fee, 'transaction fee'),
    inputCount: inputs.length,
    inputs,
    outputs: transaction.vout.map(parseTransactionOutput),
    status: parseTransactionStatus(transaction.status),
    raw: transaction,
  };
}

function parseAddressUtxos(value: unknown): BitcoinAddressUtxo[] {
  if (!Array.isArray(value) || value.length > 100_000) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora returned an invalid or excessive UTXO set.',
    );
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const utxo = requireRecord(item, `address UTXO ${index}`);
    const txid = requireTxid(utxo.txid, `address UTXO ${index} transaction id`);
    const vout = requireUint32(utxo.vout, `address UTXO ${index} output index`);
    const outpoint = `${txid}:${vout}`;
    if (seen.has(outpoint)) {
      throw new ProviderError('INVALID_RESPONSE', 'Esplora returned a duplicate address UTXO.');
    }
    seen.add(outpoint);
    return {
      txid,
      vout,
      valueSats: requireSafeUnsignedInteger(utxo.value, `address UTXO ${index} value`),
      status: parseTransactionStatus(utxo.status),
      raw: utxo,
    };
  });
}

function parseOutspend(value: unknown): BitcoinOutspendRecord {
  const outspend = requireRecord(value, 'output spend status');
  if (typeof outspend.spent !== 'boolean') {
    throw new ProviderError('INVALID_RESPONSE', 'Esplora output spend state is invalid.');
  }
  if (!outspend.spent) return { spent: false, raw: outspend };
  return {
    spent: true,
    spendingTxid: requireTxid(outspend.txid, 'spending transaction id'),
    spendingVin: requireSafeUnsignedInteger(outspend.vin, 'spending input index'),
    status: parseTransactionStatus(outspend.status),
    raw: outspend,
  };
}

function parseAddressStats(value: unknown, expectedAddress: string): EsploraAddressStats {
  const response = requireRecord(value, 'address statistics');
  if (response.address !== expectedAddress) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Esplora address identity does not match the requested address.',
    );
  }
  const parseStats = (raw: unknown, field: string): EsploraAddressStats['chain_stats'] => {
    const stats = requireRecord(raw, field);
    const numeric = (name: keyof EsploraAddressStats['chain_stats']) =>
      Number(requireSafeUnsignedInteger(stats[name], `${field} ${name}`));
    return {
      funded_txo_count: numeric('funded_txo_count'),
      funded_txo_sum: numeric('funded_txo_sum'),
      spent_txo_count: numeric('spent_txo_count'),
      spent_txo_sum: numeric('spent_txo_sum'),
      tx_count: numeric('tx_count'),
    };
  };
  return {
    address: expectedAddress,
    chain_stats: parseStats(response.chain_stats, 'chain statistics'),
    mempool_stats: parseStats(response.mempool_stats, 'mempool statistics'),
  };
}

function sourceSet(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

export class BitcoinUtxoLedgerAdapter {
  readonly ledger = 'BITCOIN' as const;
  readonly config: BitcoinAdapterConfig;
  readonly #transport: RestTransport;

  constructor(config: BitcoinAdapterConfig, transport: RestTransport) {
    this.config = config;
    this.#transport = transport;
  }

  get sourceId(): string {
    return this.#transport.lastEndpointId ?? this.#transport.endpointId;
  }

  async getAddress(address: string): Promise<EsploraAddressStats> {
    return (await this.getAddressObservation(address)).value;
  }

  async getAddressObservation(address: string): Promise<TransportObservation<EsploraAddressStats>> {
    const observation = await getRestJsonSourced<unknown>(
      this.#transport,
      `/address/${encodeURIComponent(address)}`,
    );
    return { ...observation, value: parseAddressStats(observation.value, address) };
  }

  async getAddressUtxos(address: string): Promise<readonly BitcoinAddressUtxo[]> {
    return (await this.getAddressUtxosObservation(address)).value;
  }

  async getAddressUtxosObservation(
    address: string,
  ): Promise<TransportObservation<readonly BitcoinAddressUtxo[]>> {
    const observation = await getRestJsonSourced<unknown>(
      this.#transport,
      `/address/${encodeURIComponent(address)}/utxo`,
      { cacheMode: 'bypass' },
    );
    return { ...observation, value: parseAddressUtxos(observation.value) };
  }

  async getTransaction(txid: string): Promise<BitcoinTransactionRecord> {
    return (await this.getTransactionObservation(txid)).value;
  }

  async getTransactionObservation(
    txid: string,
  ): Promise<TransportObservation<BitcoinTransactionRecord>> {
    const normalizedTxid = requireTxid(txid, 'requested transaction id');
    const observation = await getRestJsonSourced<unknown>(
      this.#transport,
      `/tx/${encodeURIComponent(normalizedTxid)}`,
    );
    return { ...observation, value: parseTransaction(observation.value, normalizedTxid) };
  }

  getOutspend(txid: string, vout: number): Promise<BitcoinOutspendRecord> {
    return this.getOutspendObservation(txid, vout).then((observation) => observation.value);
  }

  async getOutspendObservation(
    txid: string,
    vout: number,
  ): Promise<TransportObservation<BitcoinOutspendRecord>> {
    const normalizedTxid = requireTxid(txid, 'requested transaction id');
    if (!Number.isSafeInteger(vout) || vout < 0) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Bitcoin vout must be a non-negative safe integer.',
      );
    }
    const observation = await getRestJsonSourced<unknown>(
      this.#transport,
      `/tx/${encodeURIComponent(normalizedTxid)}/outspend/${vout}`,
    );
    return { ...observation, value: parseOutspend(observation.value) };
  }

  async probe(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const height = requireHeight(
        await this.#transport.getText('/blocks/tip/height', { cacheMode: 'bypass' }),
      );
      return {
        id: this.config.id,
        ledger: 'BITCOIN',
        status: 'UP',
        capabilities: BITCOIN_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: checkedAt,
        head: knownValue(height),
        lag: unknownValue('NOT_QUERIED', 'No trusted comparison head is configured.'),
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
      };
    } catch (error) {
      const providerError = toProviderError(error);
      return {
        id: this.config.id,
        ledger: 'BITCOIN',
        status: providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'DOWN',
        capabilities: BITCOIN_CAPABILITIES,
        checkedAt,
        latencyMs: Math.round(performance.now() - started),
        lastSuccessAt: null,
        head: unavailableValue(
          providerError.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_DOWN',
          providerError.message,
        ),
        lag: unavailableValue('PROVIDER_DOWN'),
        errorCode: providerError.code,
        errorDetail: providerError.message,
        ...(this.#transport.diagnostics === undefined
          ? {}
          : { transport: this.#transport.diagnostics() }),
      };
    }
  }

  async #readAnchorAt(
    height: string,
    initialSourceIds: readonly string[] = [],
  ): Promise<ChainAnchorRead> {
    requirePosition(height);
    const hashObservation = await getRestTextSourced(
      this.#transport,
      `/block-height/${encodeURIComponent(height)}`,
      { cacheMode: 'bypass' },
    );
    const blockHash = requireBlockHash(hashObservation.value);
    const blockObservation = await getRestJsonSourced<unknown>(
      this.#transport,
      `/block/${encodeURIComponent(blockHash)}`,
      { cacheMode: 'bypass' },
    );
    if (
      typeof blockObservation.value !== 'object' ||
      blockObservation.value === null ||
      Array.isArray(blockObservation.value)
    ) {
      throw new ProviderError('INVALID_RESPONSE', 'Esplora returned an invalid block record.');
    }
    const block = blockObservation.value as Record<string, unknown>;
    if (typeof block.id !== 'string' || requireBlockHash(block.id) !== blockHash) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Esplora block identity does not match its hash.',
      );
    }
    if (requireSafeBlockHeight(block.height) !== height) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Esplora block record does not match the requested height.',
      );
    }
    const numericHeight = BigInt(height);
    let previousBlockHash: string | undefined;
    if (numericHeight > 0n) {
      if (typeof block.previousblockhash !== 'string') {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Esplora block record is missing its previous block hash.',
        );
      }
      previousBlockHash = requireBlockHash(block.previousblockhash);
    }
    const sourceIds = sourceSet([
      ...initialSourceIds,
      hashObservation.endpointId,
      blockObservation.endpointId,
    ]);
    const observedAt = new Date().toISOString();
    const snapshot: BitcoinSnapshot = {
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      height,
      blockHash,
      ...(previousBlockHash === undefined ? {} : { previousBlockHash }),
      finality: 'best-chain',
      capturedAt: observedAt,
      providerVersions: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, 'esplora-http'])),
      adapterVersions: { bitcoin: this.config.adapterVersion ?? '0.1.0' },
      configHash: hashPayload({
        id: this.config.id,
        chainId: 'bitcoin-mainnet',
        sourceIds,
      }),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
    return ChainAnchorReadSchema.parse({
      anchor: {
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        position: height,
        hash: blockHash,
        ...(previousBlockHash === undefined
          ? {}
          : {
              parentPosition: (numericHeight - 1n).toString(),
              parentHash: previousBlockHash,
            }),
        finality: 'best-chain',
        source: sourceIds.join('|'),
        observedAt,
      },
      snapshot,
      payload: { height, resolvedHash: blockHash, block },
    });
  }

  async readHeadAnchor(): Promise<ChainAnchorRead> {
    const heightObservation = await getRestTextSourced(this.#transport, '/blocks/tip/height', {
      cacheMode: 'bypass',
    });
    const height = requireHeight(heightObservation.value);
    return this.#readAnchorAt(height, [heightObservation.endpointId]);
  }

  async readAnchorAt(position: string): Promise<ChainAnchorRead> {
    return this.#readAnchorAt(requirePosition(position));
  }

  async readAnchorByHash(hash: string): Promise<ChainAnchorRead> {
    const normalizedHash = requireBlockHash(hash);
    const blockObservation = await getRestJsonSourced<unknown>(
      this.#transport,
      `/block/${encodeURIComponent(normalizedHash)}`,
      { cacheMode: 'bypass' },
    );
    const block = requireRecord(blockObservation.value, 'block record');
    if (requireBlockHash(String(block.id)) !== normalizedHash) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Esplora block identity does not match its hash.',
      );
    }
    const height = requireSafeBlockHeight(block.height);
    const anchor = await this.#readAnchorAt(height, [blockObservation.endpointId]);
    if (anchor.anchor.hash !== normalizedHash) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Requested Bitcoin block is not the best-chain block at its reported height.',
      );
    }
    return anchor;
  }

  async createSnapshot(): Promise<BitcoinSnapshot> {
    return (await this.readHeadAnchor()).snapshot as BitcoinSnapshot;
  }
}
