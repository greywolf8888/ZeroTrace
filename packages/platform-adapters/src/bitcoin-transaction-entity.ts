import { ProviderError, type BitcoinTransactionRecord } from '@zerotrace/chain-adapters';
import {
  BitcoinTransactionEntityAnalysisSchema,
  knownValue,
  unknownValue,
  type BitcoinChangeCandidate,
  type BitcoinClusteringSuppressionReason,
  type BitcoinEqualOutputGroup,
  type BitcoinTransactionEntityAnalysis,
  type BitcoinTransactionPattern,
} from '@zerotrace/schemas';

export const BITCOIN_TRANSACTION_ENTITY_MODEL_VERSION = 'bitcoin-transaction-entity-v1.0.0';

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function decimalRatio(numerator: bigint, denominator: bigint, scale = 8): string {
  if (denominator <= 0n) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Bitcoin transaction virtual size must be positive.',
    );
  }
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  if (remainder === 0n) return whole.toString();
  let fraction = '';
  for (let index = 0; index < scale && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  return `${whole}.${fraction.replace(/0+$/, '')}`;
}

function equalOutputGroups(transaction: BitcoinTransactionRecord): BitcoinEqualOutputGroup[] {
  const byValue = new Map<string, number[]>();
  transaction.outputs.forEach((output, vout) => {
    if (output.scriptType === 'op_return') return;
    const positions = byValue.get(output.valueSats) ?? [];
    positions.push(vout);
    byValue.set(output.valueSats, positions);
  });
  return [...byValue.entries()]
    .filter(([, vouts]) => vouts.length >= 2)
    .map(([valueSats, vouts]) => ({ valueSats, outputCount: vouts.length, vouts }))
    .sort((left, right) => {
      const valueOrder = BigInt(left.valueSats) - BigInt(right.valueSats);
      return valueOrder < 0n ? -1 : valueOrder > 0n ? 1 : left.vouts[0]! - right.vouts[0]!;
    });
}

function transactionPattern(options: {
  coinbase: boolean;
  completeInputAddressCoverage: boolean;
  inputCount: number;
  distinctInputAddressCount: number;
  spendableOutputCount: number;
  equalGroups: readonly BitcoinEqualOutputGroup[];
}): BitcoinTransactionPattern {
  if (options.coinbase) return 'NOT_APPLICABLE';
  if (!options.completeInputAddressCoverage) return 'INCOMPLETE_INPUT_CONTEXT';
  if (
    options.inputCount >= 3 &&
    options.distinctInputAddressCount >= 3 &&
    options.equalGroups.some((group) => group.outputCount >= 3)
  ) {
    return 'EQUAL_OUTPUT_COINJOIN_LIKE';
  }
  if (
    options.spendableOutputCount >= 10 &&
    options.spendableOutputCount >= options.inputCount * 2
  ) {
    return 'FANOUT_OR_BATCHING_RISK';
  }
  return 'NO_STRONG_PATTERN_OBSERVED';
}

function changeCandidates(options: {
  transaction: BitcoinTransactionRecord;
  coinbase: boolean;
  inputAddresses: readonly string[];
  equalGroups: readonly BitcoinEqualOutputGroup[];
}): BitcoinChangeCandidate[] {
  if (options.coinbase) return [];
  const inputScriptTypes = unique(
    options.transaction.inputs.flatMap((input) =>
      input.previousOutput === undefined ? [] : [input.previousOutput.scriptType],
    ),
  );
  const spendableOutputCount = options.transaction.outputs.filter(
    (output) => output.scriptType !== 'op_return',
  ).length;
  if (inputScriptTypes.length !== 1 || spendableOutputCount < 2) return [];
  const inputAddressSet = new Set(options.inputAddresses);
  const repeatedValues = new Set(options.equalGroups.map((group) => group.valueSats));
  return options.transaction.outputs.flatMap((output, vout) => {
    if (
      output.scriptType === 'op_return' ||
      output.scriptType !== inputScriptTypes[0] ||
      output.address === undefined ||
      inputAddressSet.has(output.address) ||
      repeatedValues.has(output.valueSats)
    ) {
      return [];
    }
    return [
      {
        vout,
        valueSats: output.valueSats,
        scriptType: output.scriptType,
        address: knownValue(output.address),
        signals: [
          'INPUT_SCRIPT_TYPE_MATCH' as const,
          'UNIQUE_OUTPUT_VALUE' as const,
          'INPUT_ADDRESS_NOT_REUSED' as const,
        ],
      },
    ];
  });
}

export function analyzeBitcoinTransactionEntity(
  transaction: BitcoinTransactionRecord,
): BitcoinTransactionEntityAnalysis {
  if (transaction.inputs.length === 0 || transaction.outputs.length === 0) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Bitcoin transaction entity analysis requires at least one input and one output.',
    );
  }
  const coinbaseInputs = transaction.inputs.filter((input) => input.coinbase);
  const coinbase = coinbaseInputs.length > 0;
  if (
    (coinbase && (transaction.inputs.length !== 1 || coinbaseInputs.length !== 1)) ||
    transaction.inputCount !== transaction.inputs.length
  ) {
    throw new ProviderError('INVALID_RESPONSE', 'Bitcoin transaction input structure is invalid.');
  }

  const nonCoinbaseInputs = transaction.inputs.filter((input) => !input.coinbase);
  const observedInputAddresses = nonCoinbaseInputs.flatMap((input) =>
    input.previousOutput?.address === undefined ? [] : [input.previousOutput.address],
  );
  const inputAddresses = unique(observedInputAddresses);
  const outputAddresses = unique(
    transaction.outputs.flatMap((output) => (output.address === undefined ? [] : [output.address])),
  );
  const completeInputAddressCoverage =
    coinbase || observedInputAddresses.length === nonCoinbaseInputs.length;
  const inputAddressCoverage =
    nonCoinbaseInputs.length === 0 ? 1 : observedInputAddresses.length / nonCoinbaseInputs.length;
  const outputValue = transaction.outputs.reduce(
    (sum, output) => sum + BigInt(output.valueSats),
    0n,
  );
  const completeInputValueCoverage =
    coinbase || nonCoinbaseInputs.every((input) => input.previousOutput?.valueSats !== undefined);
  const inputValue =
    coinbase || !completeInputValueCoverage
      ? undefined
      : nonCoinbaseInputs.reduce((sum, input) => sum + BigInt(input.previousOutput!.valueSats), 0n);
  const fee = BigInt(transaction.feeSats);
  const weight = BigInt(transaction.weight);
  if (weight <= 0n) {
    throw new ProviderError('INVALID_RESPONSE', 'Bitcoin transaction weight must be positive.');
  }
  const virtualSize = (weight + 3n) / 4n;
  const equalGroups = equalOutputGroups(transaction);
  const spendableOutputCount = transaction.outputs.filter(
    (output) => output.scriptType !== 'op_return',
  ).length;
  const structuralPattern = transactionPattern({
    coinbase,
    completeInputAddressCoverage,
    inputCount: transaction.inputs.length,
    distinctInputAddressCount: inputAddresses.length,
    spendableOutputCount,
    equalGroups,
  });
  const commonInputObserved = completeInputAddressCoverage && inputAddresses.length >= 2;
  const inputAddressSet = new Set(inputAddresses);
  const addressReuseOutputVouts = transaction.outputs.flatMap((output, vout) =>
    output.address !== undefined && inputAddressSet.has(output.address) ? [vout] : [],
  );
  const boundedChangeCandidates = changeCandidates({
    transaction,
    coinbase,
    inputAddresses,
    equalGroups,
  });
  const candidates =
    structuralPattern === 'NO_STRONG_PATTERN_OBSERVED' ? boundedChangeCandidates : [];
  const suppressionReasons: BitcoinClusteringSuppressionReason[] = [];
  if (structuralPattern === 'EQUAL_OUTPUT_COINJOIN_LIKE') {
    suppressionReasons.push('COINJOIN_EQUAL_OUTPUT_PATTERN');
  }
  if (!coinbase && transaction.inputs.length >= 2) {
    suppressionReasons.push('PAYJOIN_NOT_EXCLUDABLE');
  }
  if (structuralPattern === 'FANOUT_OR_BATCHING_RISK') {
    suppressionReasons.push('FANOUT_OR_BATCHING_PATTERN');
  }
  if (commonInputObserved) {
    suppressionReasons.push('SERVICE_ATTRIBUTION_UNQUERIED');
  }
  if (!completeInputAddressCoverage) {
    suppressionReasons.push('INCOMPLETE_PREVOUT_ADDRESS_COVERAGE');
  }

  return BitcoinTransactionEntityAnalysisSchema.parse({
    txid: transaction.txid,
    coinbase,
    inputCount: transaction.inputs.length,
    outputCount: transaction.outputs.length,
    inputAddressCoverage,
    inputAddresses,
    outputAddresses,
    inputValueSats: coinbase
      ? unknownValue('NOT_APPLICABLE', 'Coinbase inputs do not spend previous outputs.')
      : inputValue === undefined
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'At least one input prevout value is unavailable; input total is not zero.',
          )
        : knownValue(inputValue.toString()),
    outputValueSats: outputValue.toString(),
    feeSats: transaction.feeSats,
    feeReconciles: coinbase
      ? unknownValue('NOT_APPLICABLE', 'Coinbase subsidy accounting is outside fee reconciliation.')
      : inputValue === undefined
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'At least one input prevout value is unavailable; fee reconciliation is not zero-filled.',
          )
        : knownValue(inputValue - outputValue === fee),
    virtualSizeBytes: virtualSize.toString(),
    feeRateSatPerVbyte: knownValue(decimalRatio(fee, virtualSize)),
    equalOutputGroups: equalGroups,
    structuralPattern,
    payjoinContaminationRisk:
      coinbase || transaction.inputs.length < 2
        ? unknownValue('NOT_APPLICABLE', 'Payjoin requires multiple transaction participants.')
        : unknownValue(
            'INSUFFICIENT_DATA',
            'A final transaction does not carry BIP78 negotiation provenance; Payjoin cannot be excluded from common-input analysis.',
          ),
    serviceClusterRisk: unknownValue(
      'NOT_QUERIED',
      'Exchange, mixer, custodian and service-cluster labels require a separate versioned attribution source.',
    ),
    addressReuseOutputVouts,
    commonInputHeuristic: completeInputAddressCoverage
      ? knownValue(commonInputObserved)
      : unknownValue(
          'INSUFFICIENT_DATA',
          'At least one input prevout has no address representation.',
        ),
    commonInputOwnershipCandidate: commonInputObserved
      ? knownValue(inputAddresses)
      : unknownValue(
          completeInputAddressCoverage ? 'NOT_APPLICABLE' : 'INSUFFICIENT_DATA',
          completeInputAddressCoverage
            ? 'Fewer than two distinct input addresses were observed.'
            : 'Input address coverage is incomplete.',
        ),
    automaticOwnershipMergeAllowed: false,
    suppressionReasons,
    changeCandidates: candidates,
    selectedChangeOutput: coinbase
      ? unknownValue('NOT_APPLICABLE', 'Coinbase transactions do not contain sender change.')
      : structuralPattern !== 'NO_STRONG_PATTERN_OBSERVED'
        ? unknownValue(
            'PRECISION_UNSAFE',
            'CoinJoin-like, fanout/batching, or incomplete input context suppresses change-candidate attribution before scoring.',
          )
        : candidates.length === 0
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'No output satisfied the bounded script-type candidate filter.',
            )
          : unknownValue(
              'PRECISION_UNSAFE',
              'Script-type and output-value structure produce candidates, not a safe change attribution; address history and Payjoin/service screening are still required.',
            ),
    ownershipConclusion:
      coinbase || transaction.inputs.length < 2
        ? unknownValue('NOT_APPLICABLE', 'No multi-input ownership relationship is present.')
        : unknownValue(
            'PRECISION_UNSAFE',
            'Common-input structure is candidate Evidence only. CoinJoin, Payjoin, service and custody contamination prevent an automatic entity merge.',
          ),
    externalAttribution: unknownValue(
      'NOT_QUERIED',
      'No versioned external address or cluster attribution source was queried.',
    ),
    modelVersion: BITCOIN_TRANSACTION_ENTITY_MODEL_VERSION,
  });
}
