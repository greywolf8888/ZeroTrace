import { confirmHiddenAffiliate, confirmRetail } from '@zerotrace/identity-intelligence';
import type { RoleFeatureVector } from '@zerotrace/schemas';
import type { IndexedTransfer } from '@zerotrace/local-index';

import { normalizeAddress } from './rpc.js';
import type { AddressRoleObservation } from './types.js';

export const DEFAULT_SERVICE_HUBS = new Set([
  '0x10ed43c718714eb63d5aa57b78b54704e256024e',
  '0xca143ce32fe78f1f7019d7d551a6402fc5350c73',
  '0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0',
]);

function emptyFeatures(): RoleFeatureVector {
  return {
    insiderAccessScore: 0,
    commonControlScore: 0,
    coordinationScore: 0,
    benefitReturnScore: 0,
    independenceScore: 0,
    serviceHubScore: 0,
    marketMakerScore: 0,
    botScore: 0,
    forbiddenSingleFactors: [],
    positiveIndependenceEvidence: false,
  };
}

export function extractAddressFeatures(input: {
  address: string;
  transfers: readonly IndexedTransfer[];
  deployer?: string;
  originBlock?: bigint;
  serviceHubs?: ReadonlySet<string>;
}): RoleFeatureVector {
  const address = normalizeAddress(input.address);
  const hubs = input.serviceHubs ?? DEFAULT_SERVICE_HUBS;
  const features = emptyFeatures();
  if (hubs.has(address)) {
    features.serviceHubScore = 100;
    return features;
  }
  const related = input.transfers.filter((item) => item.from === address || item.to === address);
  if (related.length === 0) return features;

  const firstIn = related.find((item) => item.to === address);
  const deployer = input.deployer;
  const fromDeployer =
    deployer !== undefined &&
    related.some((item) => item.to === address && item.from === normalizeAddress(deployer));
  if (
    input.originBlock !== undefined &&
    firstIn !== undefined &&
    firstIn.blockNumber <= input.originBlock + 50n
  ) {
    features.forbiddenSingleFactors = ['early'];
    features.insiderAccessScore = 10;
  }
  if (fromDeployer) {
    features.commonControlScore = 35;
    features.insiderAccessScore = Math.max(features.insiderAccessScore, 25);
  }
  const counterparties = new Set(
    related.map((item) => (item.from === address ? item.to : item.from)),
  );
  if (
    counterparties.size >= 3 &&
    !fromDeployer &&
    !features.forbiddenSingleFactors.includes('early')
  ) {
    features.independenceScore = 55;
    features.positiveIndependenceEvidence = true;
  }
  if (related.length >= 8 && counterparties.size <= 2) {
    features.botScore = 40;
  }
  return features;
}

export function observeRoles(input: {
  holders: readonly { address: string; amountAtomic: string }[];
  transfers: readonly IndexedTransfer[];
  deployer?: string;
  originBlock?: bigint;
}): AddressRoleObservation[] {
  return input.holders.map((holder) => {
    const features = extractAddressFeatures({
      address: holder.address,
      transfers: input.transfers,
      ...(input.deployer === undefined ? {} : { deployer: input.deployer }),
      ...(input.originBlock === undefined ? {} : { originBlock: input.originBlock }),
    });
    const serviceHub = features.serviceHubScore >= 50;
    return {
      address: holder.address,
      features,
      hiddenConfirmed: confirmHiddenAffiliate(features),
      retailConfirmed: confirmRetail(features, serviceHub),
    };
  });
}
