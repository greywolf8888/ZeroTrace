import { describe, expect, it } from 'vitest';

import {
  assertLoadBearingQuorum,
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
});
