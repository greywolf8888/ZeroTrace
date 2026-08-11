import { ProviderError, type EvmLedgerAdapter } from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import { calculatePensionEntryEconomics } from '@zerotrace/rv';
import {
  AnalysisMetadataSchema,
  FlapPancakeV2PensionEntryResultSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type Evidence,
  type EvmPensionCandidateDiscovery,
  type FlapPancakeV2PensionEntryScenarioPoint,
  type FlapPancakeV2PensionEntryResult,
  type FlapPancakeV2TokenAmount,
  type KnowledgeReason,
  type KnowledgeValue,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  type FlapDeployment,
  type FlapEvidenceWriter,
} from './flap.js';
import {
  PANCAKE_V2_BSC_DEPLOYMENT,
  quoteFlapPancakeV2BuyScenarios,
  type PancakeV2Deployment,
} from './flap-market.js';

export const FLAP_PENSION_ENTRY_MODEL_VERSION = 'flap-pension-entry-economics-v0.1.0';

function canonicalAddress(value: string, field: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', `${field} is not a canonical EVM address.`, {
      cause: error,
    });
  }
}

function power10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function formatAtomic(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const scale = power10(decimals);
  const integer = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length === 0 ? integer.toString() : `${integer}.${fraction}`;
}

function amount(value: string, decimals: number): FlapPancakeV2TokenAmount {
  return { atomic: value, decimal: formatAtomic(BigInt(value), decimals) };
}

type SchemaKnowledgeValue<T> =
  | { state: 'known'; value: T }
  | { state: 'unknown'; reason: KnowledgeReason; detail?: string | undefined }
  | { state: 'unavailable'; reason: KnowledgeReason; detail?: string | undefined };

function propagate<T, R>(
  value: SchemaKnowledgeValue<T>,
  transform: (known: T) => R,
): KnowledgeValue<R> {
  if (value.state === 'known') return knownValue(transform(value.value));
  return value.state === 'unknown'
    ? unknownValue(value.reason, value.detail)
    : unavailableValue(value.reason, value.detail);
}

function uniqueEvidence(items: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const result: Evidence[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export async function quoteFlapPensionEntryScenarios(options: {
  adapter: EvmLedgerAdapter;
  token: string;
  quoteInputs: readonly string[];
  pensionWallet: string;
  behaviorReportId: string;
  behaviorResultHash: string;
  behaviorReport: EvmPensionCandidateDiscovery;
  behaviorEvidence: readonly Evidence[];
  writeEvidence: FlapEvidenceWriter;
  deployment?: FlapDeployment;
  pancakeDeployment?: PancakeV2Deployment;
  blockNumber?: string;
}): Promise<FlapPancakeV2PensionEntryResult> {
  const token = canonicalAddress(options.token, 'Pension entry token');
  const pensionWallet = canonicalAddress(options.pensionWallet, 'Pension candidate wallet');
  if (options.behaviorReport.tokenAddress !== token) {
    throw new ProviderError(
      'CHAIN_MISMATCH',
      'The pension behavior report does not belong to the requested token.',
    );
  }
  const candidate = options.behaviorReport.candidates.find(
    (item) => item.address === pensionWallet,
  );
  if (candidate === undefined) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'The selected wallet is not a candidate in the referenced pension behavior report.',
    );
  }
  const behaviorEvidenceById = new Map(options.behaviorEvidence.map((item) => [item.id, item]));
  for (const evidenceId of options.behaviorReport.metadata.evidenceIds) {
    if (!behaviorEvidenceById.has(evidenceId)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'The pension behavior report Evidence set is incomplete.',
      );
    }
  }

  const buy = await quoteFlapPancakeV2BuyScenarios({
    adapter: options.adapter,
    token,
    quoteInputs: options.quoteInputs,
    deployment: options.deployment ?? FLAP_BSC_MAINNET_DEPLOYMENT,
    pancakeDeployment: options.pancakeDeployment ?? PANCAKE_V2_BSC_DEPLOYMENT,
    writeEvidence: options.writeEvidence,
    ...(options.blockNumber === undefined ? {} : { blockNumber: options.blockNumber }),
  });
  const snapshot = buy.metadata.snapshot;
  const behaviorSnapshot = options.behaviorReport.metadata.snapshot;
  if (
    snapshot === null ||
    snapshot.ledger !== 'EVM' ||
    snapshot.chainId !== 'eip155:56' ||
    behaviorSnapshot === null ||
    behaviorSnapshot.ledger !== 'EVM' ||
    BigInt(snapshot.blockNumber) < BigInt(options.behaviorReport.toBlock) ||
    (snapshot.blockNumber === options.behaviorReport.toBlock &&
      snapshot.blockHash.toLowerCase() !== behaviorSnapshot.blockHash.toLowerCase())
  ) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Pension entry market state must be a finalized BSC Snapshot at or after the behavior report.',
    );
  }
  if (buy.market.state !== 'known') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Pension entry economics require a verified migrated Pancake V2 market.',
    );
  }

  const market = buy.market.value;
  const shareUnitAtomic = options.behaviorReport.policy.shareUnitAtomic;
  const entries: FlapPancakeV2PensionEntryScenarioPoint[] = buy.scenarios.map((buyScenario) => {
    const modeled = propagate(buyScenario.configuredTaxNetTokenOutput, (netOutput) =>
      calculatePensionEntryEconomics({
        quoteInputAtomic: buyScenario.quoteInput.atomic,
        modeledNetTokenOutputAtomic: netOutput.atomic,
        shareUnitAtomic,
      }),
    );
    const modeledAverageQuoteCostPerShare =
      modeled.state === 'known'
        ? modeled.value.modeledAverageQuoteCostPerShareAtomic === null
          ? unknownValue(
              'NOT_APPLICABLE',
              'A zero modeled token receipt has no finite average acquisition cost per share.',
            )
          : knownValue(
              amount(modeled.value.modeledAverageQuoteCostPerShareAtomic, market.quoteDecimals),
            )
        : modeled.state === 'unknown'
          ? unknownValue(modeled.reason, modeled.detail)
          : unavailableValue(modeled.reason, modeled.detail);
    return {
      buyScenario,
      modeledNetTokenOutput: buyScenario.configuredTaxNetTokenOutput,
      modeledShareEquivalent: propagate(modeled, (value) => value.modeledShareEquivalent),
      modeledWholeShares: propagate(modeled, (value) => value.modeledWholeShares),
      modeledCommittedTokenAmount: propagate(modeled, (value) =>
        amount(value.modeledCommittedTokenAtomic, market.tokenDecimals),
      ),
      modeledRemainderTokenAmount: propagate(modeled, (value) =>
        amount(value.modeledRemainderTokenAtomic, market.tokenDecimals),
      ),
      modeledQuoteCostForCommittedShares: propagate(modeled, (value) =>
        amount(value.modeledQuoteCostForCommittedSharesAtomic, market.quoteDecimals),
      ),
      modeledAverageQuoteCostPerShare,
      modeledPostDepositSpotPrice: knownValue(buyScenario.modeledPostBuySpotPrice),
      executionNetTokenOutput: buyScenario.executionNetTokenOutput,
      executionWholeShares: unknownValue(
        'NOT_QUERIED',
        'A pinned-fork pension-wallet balance delta is required before an executed share count can be reported.',
      ),
      executionPostDepositSpotPrice: unknownValue(
        'NOT_QUERIED',
        'A pinned-fork buy plus pension transfer is required to measure wallet receipt, transfer tax, swapback, and final pool reserves.',
      ),
      assumption:
        'Average-cost allocation over the configured-tax buy estimate; whole shares are floor(net tokens / observed share unit). The subsequent non-zero-address transfer is modeled as custody-only and does not mutate pool reserves.',
    };
  });

  const behavior = {
    reportId: options.behaviorReportId,
    resultHash: options.behaviorResultHash,
    wallet: pensionWallet,
    shareUnit: amount(shareUnitAtomic, market.tokenDecimals),
    fromBlock: options.behaviorReport.fromBlock,
    toBlock: options.behaviorReport.toBlock,
    snapshotHash: behaviorSnapshot.blockHash.toLowerCase(),
    observedWholeShares: candidate.observedWholeShares,
    candidateEvidenceId: candidate.evidenceId,
    reportTerminalEvidenceId: options.behaviorReport.terminalEvidenceId,
    roleAttribution: candidate.roleAttribution,
    participantExitPolicy: candidate.participantExitPolicy,
    dividendExecution: candidate.dividendExecution,
  } as const;
  const totalSupplyReduction = unknownValue(
    'NOT_QUERIED',
    'A transfer to this non-zero custody address is not itself an ERC-20 supply burn. Same-transaction totalSupply and tax-burn execution were not measured.',
  );
  const custodyIrreversible = unknownValue(
    'INSUFFICIENT_DATA',
    'Observed deposit behavior does not prove that the wallet cannot transfer tokens or that participants cannot exit through another mechanism.',
  );
  const sourceEvidenceIds = [
    buy.terminalEvidenceId,
    candidate.evidenceId,
    options.behaviorReport.terminalEvidenceId,
  ].sort();
  const terminal = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_PENSION_ENTRY_MODEL_VERSION}`,
      locator: `rv:flap-pension-entry:${token}:${pensionWallet}:${buy.scenarios
        .map((item) => item.quoteInput.atomic)
        .join(',')}@${snapshot.blockNumber}`,
      payload: {
        behavior,
        entries,
        destinationTreatment: 'NON_ZERO_CUSTODY_ADDRESS',
        totalSupplyReduction,
        custodyIrreversible,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary:
        'Pension-entry share capacity and average acquisition cost derived from a durable behavior candidate and same-Snapshot Pancake V2 buy scenarios.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
  const evidence = uniqueEvidence([...options.behaviorEvidence, ...buy.evidence, terminal]);

  return FlapPancakeV2PensionEntryResultSchema.parse({
    platform: 'flap',
    token,
    behavior,
    market: buy.market,
    entries,
    validation: buy.validation,
    destinationTreatment: 'NON_ZERO_CUSTODY_ADDRESS',
    totalSupplyReduction,
    custodyIrreversible,
    terminalEvidenceId: terminal.id,
    metadata: AnalysisMetadataSchema.parse({
      snapshot,
      dataCoverage: Math.min(
        buy.metadata.dataCoverage,
        options.behaviorReport.metadata.dataCoverage,
      ),
      sourceCoverage: Math.min(
        buy.metadata.sourceCoverage,
        options.behaviorReport.metadata.sourceCoverage,
      ),
      historyCoverage: options.behaviorReport.metadata.historyCoverage,
      simulationCoverage: buy.metadata.simulationCoverage,
      freshness: snapshot.blockTimestamp,
      sourceSet: [
        ...new Set([...buy.metadata.sourceSet, ...options.behaviorReport.metadata.sourceSet]),
      ].sort(),
      modelVersion: FLAP_PENSION_ENTRY_MODEL_VERSION,
      confidence: Math.min(buy.metadata.confidence, options.behaviorReport.metadata.confidence),
      evidenceIds: evidence.map((item) => item.id),
    }),
    evidence,
  });
}
