import {
  RAW_LEDGER_ACTION_ADAPTER_VERSION,
  canonicalActionTransactionId,
} from '@zerotrace/action-semantics';
import { defineCaptureSchedule } from '@zerotrace/capture-scheduler';
import { SQD_DATASETS, type SqdDataset } from '@zerotrace/chain-adapters';
import { ActionSemanticsTransactionCaptureParametersSchema } from '@zerotrace/schemas';

import { integer, required } from './config.js';

export interface ActionScheduleConfig {
  postgresUrl: string;
  dataset: SqdDataset;
  transactionId: string;
  blockOrSlot: string;
  at: string;
  createdAt: string;
}

interface Arguments {
  dataset?: string;
  transaction?: string;
  blockOrSlot?: string;
  at?: string;
}

function parseArguments(args: readonly string[]): Arguments {
  const parsed: Arguments = {};
  const supported = new Set(['--dataset', '--transaction', '--block-or-slot', '--at']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? '';
    if (!supported.has(argument)) throw new Error(`Unknown action schedule argument: ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--dataset') parsed.dataset = value;
    if (argument === '--transaction') parsed.transaction = value;
    if (argument === '--block-or-slot') parsed.blockOrSlot = value;
    if (argument === '--at') parsed.at = value;
  }
  return parsed;
}

function iso(value: string, field: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${field} must be an ISO date-time.`);
  return timestamp.toISOString();
}

export function loadActionScheduleConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
  now = new Date().toISOString(),
): ActionScheduleConfig {
  const parsed = parseArguments(args);
  if (!Object.hasOwn(SQD_DATASETS, parsed.dataset ?? '')) {
    throw new Error('--dataset must be a supported SQD mainnet dataset.');
  }
  const dataset = parsed.dataset as SqdDataset;
  const transactionInput = parsed.transaction?.trim();
  if (transactionInput === undefined || transactionInput === '') {
    throw new Error('--transaction is required.');
  }
  const blockOrSlot = String(
    integer(parsed.blockOrSlot, '--block-or-slot', undefined, 0, Number.MAX_SAFE_INTEGER),
  );
  const createdAt = iso(now, 'now');
  const at = iso(parsed.at ?? createdAt, '--at');
  if (Date.parse(at) < Date.parse(createdAt)) {
    throw new Error('--at may not be earlier than schedule creation.');
  }
  return {
    postgresUrl: required(env, 'POSTGRES_URL'),
    dataset,
    transactionId: canonicalActionTransactionId(SQD_DATASETS[dataset].ledger, transactionInput),
    blockOrSlot,
    at,
    createdAt,
  };
}

export function buildActionTransactionSchedule(config: ActionScheduleConfig) {
  const dataset = SQD_DATASETS[config.dataset];
  const chainId =
    dataset.ledger === 'EVM' && !dataset.chainId.startsWith('eip155:')
      ? `eip155:${dataset.chainId}`
      : dataset.chainId;
  const parameters = ActionSemanticsTransactionCaptureParametersSchema.parse({
    schemaVersion: 'action-semantics-transaction-capture-v1',
    dataset: config.dataset,
    profile: 'ledger-records',
    blockOrSlot: config.blockOrSlot,
    adapterVersion: RAW_LEDGER_ACTION_ADAPTER_VERSION,
  });
  return defineCaptureSchedule({
    captureKind: 'TRANSACTION',
    target: {
      ledger: dataset.ledger,
      chainId,
      subjectType: 'TRANSACTION',
      normalizedIdentifier: config.transactionId,
    },
    parameters,
    trigger: { type: 'ONCE', at: config.at },
    retryPolicy: {
      maxAttempts: 5,
      initialDelaySeconds: 30,
      maximumDelaySeconds: 900,
      backoffMultiplierBps: 20_000,
    },
    createdAt: config.createdAt,
  });
}
