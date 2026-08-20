import { describe, expect, it } from 'vitest';

import {
  assertLoadBearingQuorum,
  endpointRefFromUrl,
  independentOperatorCount,
  operatorFromEndpoint,
  sameGroupIsNotIndependent,
} from './index.js';

const bnb = {
  operatorId: 'bnbchain-public',
  endpointId: 'https://bsc-dataseed.bnbchain.org',
  chainId: 'eip155:56',
  independenceGroup: 'bnbchain',
  archiveCapability: false,
  finalitySemantics: 'finalized',
  termsReference: 'bnbchain-docs',
};

const bnbAlt = {
  ...bnb,
  endpointId: 'https://bsc-dataseed-public.bnbchain.org',
};

const nodereal = {
  operatorId: 'nodereal-public',
  endpointId: 'https://bsc.nodereal.io',
  chainId: 'eip155:56',
  independenceGroup: 'nodereal',
  archiveCapability: false,
  finalitySemantics: 'finalized',
  termsReference: 'nodereal-docs',
};

describe('source operator registry', () => {
  it('does not treat two URLs in one independence group as quorum', () => {
    expect(sameGroupIsNotIndependent(bnb, bnbAlt)).toBe(true);
    expect(independentOperatorCount([bnb, bnbAlt])).toBe(1);
    expect(() => assertLoadBearingQuorum([bnb, bnbAlt])).toThrow(/independent operators/);
  });

  it('accepts BNB Chain and NodeReal as two groups', () => {
    expect(independentOperatorCount([bnb, nodereal])).toBe(2);
    expect(() => assertLoadBearingQuorum([bnb, nodereal])).not.toThrow();
  });

  it('maps public BSC hosts to distinct independence groups', () => {
    const left = operatorFromEndpoint({
      endpointId: 'https://bsc-dataseed.bnbchain.org',
      chainId: 'eip155:56',
    });
    const right = operatorFromEndpoint({
      endpointId: 'https://bsc.nodereal.io',
      chainId: 'eip155:56',
    });
    expect(left.independenceGroup).toBe('bnbchain');
    expect(right.independenceGroup).toBe('nodereal');
    expect(independentOperatorCount([left, right])).toBe(2);
  });

  it('denies eth_getLogs on official BNB public dataseed and the default public pool', () => {
    const dataseed = operatorFromEndpoint({
      endpointId: 'https://bsc-dataseed.bnbchain.org',
      chainId: 'eip155:56',
    });
    const ankr = operatorFromEndpoint({
      endpointId: 'https://rpc.ankr.com/bsc',
      chainId: 'eip155:56',
    });
    expect(dataseed.deniedMethods).toContain('eth_getLogs');
    expect(ankr.logsCapability).toBe('denied');
    expect(dataseed.forensicGrade).toBe('PUBLIC_NO_SLA');
  });

  it('keeps static RPC paths in endpoint refs but strips secret-length segments', () => {
    expect(endpointRefFromUrl('https://rpc.ankr.com/bsc')).toBe('https://rpc.ankr.com/bsc');
    expect(endpointRefFromUrl('https://bsc-mainnet.nodereal.io/v1/super-secret-key-value')).toBe(
      'https://bsc-mainnet.nodereal.io/v1',
    );
  });
});
