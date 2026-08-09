import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('API configuration', () => {
  it('does not silently configure public providers when environment values are absent', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect(config.ethereumRpcUrl).toBeUndefined();
    expect(config.ethereumRpcUrls).toEqual([]);
    expect(config.bscRpcUrls).toEqual([]);
    expect(config.bitcoinEsploraUrl).toBeUndefined();
    expect(config.bitcoinEsploraUrls).toEqual([]);
    expect(config.solanaRpcUrl).toBeUndefined();
    expect(config.solanaRpcUrls).toEqual([]);
  });

  it('tracks optional provider configuration without exposing its secret', () => {
    const config = loadConfig({ NODE_ENV: 'test', GMGN_API_KEY: 'secret-value' });
    expect(config.gmgnConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain('secret-value');
  });

  it('derives the official Ethereum endpoint from an Alchemy key', () => {
    const config = loadConfig({ NODE_ENV: 'test', ALCHEMY_API_KEY: 'test-key-do-not-use' });
    expect(config.ethereumRpcUrls).toEqual([
      'https://eth-mainnet.g.alchemy.com/v2/test-key-do-not-use',
    ]);
    expect(config.ethereumRpcUrl).toBe(config.ethereumRpcUrls[0]);
  });

  it('expands the Alchemy placeholder only when a key exists', () => {
    const template = 'https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}';
    expect(loadConfig({ NODE_ENV: 'test', ETH_RPC_URL: template }).ethereumRpcUrls).toEqual([]);
    expect(
      loadConfig({
        NODE_ENV: 'test',
        ETH_RPC_URL: template,
        ALCHEMY_API_KEY: 'test-key-do-not-use',
      }).ethereumRpcUrls,
    ).toEqual(['https://eth-mainnet.g.alchemy.com/v2/test-key-do-not-use']);
  });

  it('normalizes aliases, preserves fallback order, and removes duplicate endpoints', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      BSC_RPC_URL: 'https://bsc-one.example',
      EVM_BSC_RPC_URLS: 'https://bsc-two.example, https://bsc-one.example',
      BTC_ESPLORA_URL: 'https://bitcoin.example/api',
      SOLANA_RPC_URLS: 'https://solana-one.example,https://solana-two.example',
      SQD_PORTAL_URL: 'https://portal.sqd.dev',
    });

    expect(config.bscRpcUrls).toEqual(['https://bsc-two.example', 'https://bsc-one.example']);
    expect(config.bitcoinEsploraUrls).toEqual(['https://bitcoin.example/api']);
    expect(config.solanaRpcUrls).toEqual([
      'https://solana-one.example',
      'https://solana-two.example',
    ]);
    expect(config.sqdPortalUrl).toBe('https://portal.sqd.dev');
  });

  it('rejects invalid provider URLs without echoing their value', () => {
    const invalid = 'file:///sensitive-provider-value';
    expect(() => loadConfig({ NODE_ENV: 'test', BSC_RPC_URL: invalid })).toThrow(
      'BSC RPC must contain valid HTTP(S) provider URLs.',
    );
    try {
      loadConfig({ NODE_ENV: 'test', BSC_RPC_URL: invalid });
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-provider-value');
    }
  });

  it('accepts only a PostgreSQL connection URL without echoing invalid input', () => {
    expect(
      loadConfig({
        NODE_ENV: 'test',
        POSTGRES_URL: 'postgresql://zerotrace:test@postgres:5432/zerotrace',
      }).postgresUrl,
    ).toBe('postgresql://zerotrace:test@postgres:5432/zerotrace');

    const invalid = 'https://database.example/sensitive-database-value';
    expect(() => loadConfig({ NODE_ENV: 'test', POSTGRES_URL: invalid })).toThrow(
      'POSTGRES_URL must be a valid PostgreSQL connection URL.',
    );
    try {
      loadConfig({ NODE_ENV: 'test', POSTGRES_URL: invalid });
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-database-value');
    }
  });
});
