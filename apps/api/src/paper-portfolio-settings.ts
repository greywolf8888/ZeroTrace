import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

import { createPaperExperiment } from '@zerotrace/asset-ledger';

import type { AppConfig } from './config.js';

const SettingsSchema = z
  .object({
    version: z.string().min(1),
    budget_meaning: z.string().min(1),
    accounts: z
      .array(
        z
          .object({
            id: z.string().min(1),
            chain: z.enum(['BSC', 'SOLANA']),
            native_symbol: z.enum(['BNB', 'SOL']),
            native_decimals: z.union([z.literal(18), z.literal(9)]),
            initial_native: z.string().min(1),
            initial_atomic: z.string().regex(/^[1-9]\d*$/),
          })
          .strict(),
      )
      .min(2),
    position_policy: z
      .object({
        target_position_bps: z.number().int().min(0).max(10_000),
        max_single_position_bps: z.number().int().min(0).max(10_000),
        max_controller_group_bps: z.number().int().min(0).max(10_000),
        max_narrative_group_bps: z.number().int().min(0).max(10_000),
        max_total_invested_bps: z.number().int().min(0).max(10_000),
        min_uncommitted_cash_bps: z.number().int().min(0).max(10_000),
        min_gas_reserve_bps: z.number().int().min(0).max(10_000),
        opaque_token_stress_loss_bps: z.literal(10_000),
      })
      .passthrough(),
    wallet_link: z
      .object({
        default: z.literal('PAPER_ONLY'),
        linking_never_changes_capital: z.literal(true),
        no_automatic_chain_bridging: z.literal(true),
      })
      .passthrough(),
    warning: z.string().min(1),
  })
  .passthrough();

export interface PaperPortfolioSettings {
  version: string;
  budgetMeaning: string;
  accounts: Array<{
    id: string;
    chain: 'BSC' | 'SOLANA';
    nativeSymbol: 'BNB' | 'SOL';
    nativeDecimals: 18 | 9;
    initialNative: string;
    initialAtomic: string;
  }>;
  policy: {
    version: string;
    targetPositionBps: number;
    maxSinglePositionBps: number;
    maxControllerGroupBps: number;
    maxNarrativeGroupBps: number;
    maxTotalInvestedBps: number;
    minimumUncommittedCashBps: number;
    minimumFeeReserveBps: number;
    opaqueTokenStressLossBps: 10_000;
  };
  walletMode: 'PAPER_ONLY';
  linkingNeverChangesCapital: true;
  automaticChainBridging: false;
  warning: string;
  source: { kind: 'VERSIONED_LOCAL_CONFIG'; reference: 'paper_portfolios.json' };
}

const DEFAULT_PORTFOLIO_CONFIG = 'config/paper_portfolios.json';

export interface PaperPortfolioPathContext {
  workingDirectory?: string;
  executablePath?: string;
}

function ancestorCandidates(base: string, relativePath: string): string[] {
  const candidates: string[] = [];
  let current = resolve(base);
  for (;;) {
    candidates.push(resolve(current, relativePath));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidates;
}

export function resolvePaperPortfolioConfigPath(
  config: AppConfig,
  context: PaperPortfolioPathContext = {},
): string {
  const configured = config.paperPortfolioConfigPath ?? DEFAULT_PORTFOLIO_CONFIG;
  if (isAbsolute(configured)) return configured;

  const workingDirectory = context.workingDirectory ?? process.cwd();
  const executableDirectory = dirname(context.executablePath ?? process.execPath);
  const candidates = [
    ...ancestorCandidates(workingDirectory, configured),
    ...ancestorCandidates(executableDirectory, configured),
  ];
  const existing = [...new Set(candidates)].find((candidate) => existsSync(candidate));
  return existing ?? resolve(workingDirectory, configured);
}

export function loadPaperPortfolioSettings(config: AppConfig): PaperPortfolioSettings {
  const path = resolvePaperPortfolioConfigPath(config);
  const parsed = SettingsSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const policy = {
    version: parsed.version,
    targetPositionBps: parsed.position_policy.target_position_bps,
    maxSinglePositionBps: parsed.position_policy.max_single_position_bps,
    maxControllerGroupBps: parsed.position_policy.max_controller_group_bps,
    maxNarrativeGroupBps: parsed.position_policy.max_narrative_group_bps,
    maxTotalInvestedBps: parsed.position_policy.max_total_invested_bps,
    minimumUncommittedCashBps: parsed.position_policy.min_uncommitted_cash_bps,
    minimumFeeReserveBps: parsed.position_policy.min_gas_reserve_bps,
    opaqueTokenStressLossBps: parsed.position_policy.opaque_token_stress_loss_bps,
  };
  const chains = new Set(parsed.accounts.map((account) => account.chain));
  if (chains.size !== 2 || !chains.has('BSC') || !chains.has('SOLANA')) {
    throw new Error('PAPER_PORTFOLIO_BOTH_CHAINS_REQUIRED');
  }
  for (const account of parsed.accounts) {
    if (
      (account.chain === 'BSC' &&
        (account.native_symbol !== 'BNB' || account.native_decimals !== 18)) ||
      (account.chain === 'SOLANA' &&
        (account.native_symbol !== 'SOL' || account.native_decimals !== 9))
    ) {
      throw new Error('PAPER_PORTFOLIO_CHAIN_DENOMINATION_CONFLICT');
    }
    createPaperExperiment({
      name: account.id,
      chain: account.chain,
      initialPrincipalAtomic: account.initial_atomic,
      policy,
      createdAt: '2000-01-01T00:00:00.000Z',
    });
  }
  return {
    version: parsed.version,
    budgetMeaning: parsed.budget_meaning,
    accounts: parsed.accounts.map((account) => ({
      id: account.id,
      chain: account.chain,
      nativeSymbol: account.native_symbol,
      nativeDecimals: account.native_decimals,
      initialNative: account.initial_native,
      initialAtomic: account.initial_atomic,
    })),
    policy,
    walletMode: parsed.wallet_link.default,
    linkingNeverChangesCapital: parsed.wallet_link.linking_never_changes_capital,
    automaticChainBridging: false,
    warning: parsed.warning,
    source: { kind: 'VERSIONED_LOCAL_CONFIG', reference: 'paper_portfolios.json' },
  };
}
