import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('API configuration', () => {
  it('does not silently configure public providers when environment values are absent', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect(config.ethereumRpcUrl).toBeUndefined();
    expect(config.bitcoinEsploraUrl).toBeUndefined();
    expect(config.solanaRpcUrl).toBeUndefined();
  });

  it('tracks optional provider configuration without exposing its secret', () => {
    const config = loadConfig({ NODE_ENV: 'test', GMGN_API_KEY: 'secret-value' });
    expect(config.gmgnConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain('secret-value');
  });
});
