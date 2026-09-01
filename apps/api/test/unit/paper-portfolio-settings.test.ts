import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config.js';
import {
  loadPaperPortfolioSettings,
  resolvePaperPortfolioConfigPath,
} from '../../src/paper-portfolio-settings.js';

function document() {
  return {
    version: 'V11.0',
    budget_meaning: '每条链独立的模拟总本金。',
    accounts: [
      {
        id: 'paper-sol-main',
        chain: 'SOLANA',
        native_symbol: 'SOL',
        native_decimals: 9,
        initial_native: '1',
        initial_atomic: '1000000000',
      },
      {
        id: 'paper-bsc-main',
        chain: 'BSC',
        native_symbol: 'BNB',
        native_decimals: 18,
        initial_native: '1',
        initial_atomic: '1000000000000000000',
      },
    ],
    position_policy: {
      target_position_bps: 500,
      max_single_position_bps: 1_000,
      max_controller_group_bps: 1_500,
      max_narrative_group_bps: 2_500,
      max_total_invested_bps: 6_000,
      min_uncommitted_cash_bps: 1_500,
      min_gas_reserve_bps: 500,
      opaque_token_stress_loss_bps: 10_000,
    },
    wallet_link: {
      default: 'PAPER_ONLY',
      linking_never_changes_capital: true,
      no_automatic_chain_bridging: true,
    },
    warning: '仅为模拟研究。',
  };
}

describe('版本化模拟设置', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function load(value: unknown) {
    const directory = mkdtempSync(join(tmpdir(), 'zerotrace-paper-settings-'));
    directories.push(directory);
    const path = join(directory, 'paper.json');
    writeFileSync(path, JSON.stringify(value), 'utf8');
    return loadPaperPortfolioSettings({ paperPortfolioConfigPath: path } as AppConfig);
  }

  it('将版本化文件映射为严格的只读客户端设置', () => {
    expect(load(document())).toMatchObject({
      version: 'V11.0',
      walletMode: 'PAPER_ONLY',
      automaticChainBridging: false,
      policy: { targetPositionBps: 500 },
    });
  });

  it('拒绝链面额冲突和不满足资金约束的策略', () => {
    const denominationConflict = document();
    denominationConflict.accounts[1]!.native_symbol = 'SOL';
    denominationConflict.accounts[1]!.native_decimals = 9;
    expect(() => load(denominationConflict)).toThrow('PAPER_PORTFOLIO_CHAIN_DENOMINATION_CONFLICT');

    const policyConflict = document();
    policyConflict.position_policy.target_position_bps = 2_000;
    policyConflict.position_policy.max_single_position_bps = 1_000;
    expect(() => load(policyConflict)).toThrow('PAPER_POLICY_CONSTRAINT_INVALID');
  });

  it('从开发子目录和便携发布目录回溯解析版本化配置', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zerotrace-paper-layout-'));
    directories.push(directory);
    const configDirectory = join(directory, 'config');
    const nestedWorkingDirectory = join(directory, 'apps', 'api');
    const portableDirectory = join(directory, 'release');
    const path = join(configDirectory, 'paper_portfolios.json');
    mkdirSync(configDirectory, { recursive: true });
    mkdirSync(nestedWorkingDirectory, { recursive: true });
    mkdirSync(portableDirectory, { recursive: true });
    writeFileSync(path, JSON.stringify(document()), 'utf8');

    expect(
      resolvePaperPortfolioConfigPath(
        { paperPortfolioConfigPath: 'config/paper_portfolios.json' } as AppConfig,
        {
          workingDirectory: nestedWorkingDirectory,
          executablePath: join(portableDirectory, 'zerotrace-api.exe'),
        },
      ),
    ).toBe(path);
  });
});
