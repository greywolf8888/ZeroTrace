import type {
  SolanaCompiledInstruction,
  SolanaTokenBalanceRecord,
  SolanaTransactionRecord,
} from '@zerotrace/chain-adapters';
import {
  SolanaTransactionSemanticsSchema,
  knownValue,
  unknownValue,
  type KnowledgeValue,
  type JsonValue,
  type SolanaInstructionObservation,
  type SolanaTokenBalanceChange,
  type SolanaTransactionAccount,
  type SolanaTransactionSemantics,
} from '@zerotrace/schemas';

export const SOLANA_TRANSACTION_SEMANTICS_MODEL_VERSION = 'solana-transaction-semantics-v1.0.0';

function unresolvedAddress(index: number): KnowledgeValue<string> {
  return unknownValue(
    'INSUFFICIENT_DATA',
    `Account index ${index} requires loaded-address metadata that was not recorded by the provider.`,
  );
}

function optionalAddress(value: string | undefined, side: 'pre' | 'post'): KnowledgeValue<string> {
  return value === undefined
    ? unknownValue('INSUFFICIENT_DATA', `The ${side}-transaction token owner was not recorded.`)
    : knownValue(value);
}

function resolveInstruction(options: {
  instruction: SolanaCompiledInstruction;
  outerIndex: number;
  innerIndex?: number;
  resolvedAddresses: readonly string[];
}): SolanaInstructionObservation {
  const programId = options.resolvedAddresses[options.instruction.programIdIndex];
  const accountAddresses = options.instruction.accounts.map(
    (index) => options.resolvedAddresses[index],
  );
  const completeAccounts = accountAddresses.every(
    (address): address is string => address !== undefined,
  );
  return {
    path:
      options.innerIndex === undefined
        ? `outer:${options.outerIndex}`
        : `outer:${options.outerIndex}/inner:${options.innerIndex}`,
    outerIndex: options.outerIndex,
    innerIndex:
      options.innerIndex === undefined
        ? unknownValue('NOT_APPLICABLE', 'This is an outer instruction.')
        : knownValue(options.innerIndex),
    stackHeight:
      options.instruction.stackHeight === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'The RPC response did not record stack height.')
        : knownValue(options.instruction.stackHeight),
    programIdIndex: options.instruction.programIdIndex,
    programId:
      programId === undefined
        ? unresolvedAddress(options.instruction.programIdIndex)
        : knownValue(programId),
    accountIndexes: options.instruction.accounts,
    accounts: completeAccounts
      ? knownValue(accountAddresses)
      : unknownValue(
          'INSUFFICIENT_DATA',
          'At least one compiled account index depends on unrecorded loaded addresses.',
        ),
    dataBase58: options.instruction.data,
  };
}

function accountRows(
  transaction: SolanaTransactionRecord,
  resolvedAddresses: readonly string[],
): SolanaTransactionAccount[] {
  const staticCount = transaction.staticAccountKeys.length;
  const signedWritableEnd =
    transaction.header.numRequiredSignatures - transaction.header.numReadonlySignedAccounts;
  const unsignedWritableEnd = staticCount - transaction.header.numReadonlyUnsignedAccounts;
  const loadedWritableEnd = staticCount + (transaction.loadedAddresses?.writable.length ?? 0);
  return resolvedAddresses.map((address, index) => {
    const signer = index < transaction.header.numRequiredSignatures;
    const writable =
      index < staticCount
        ? signer
          ? index < signedWritableEnd
          : index < unsignedWritableEnd
        : index < loadedWritableEnd;
    const pre = transaction.preBalances?.[index];
    const post = transaction.postBalances?.[index];
    return {
      index,
      address,
      source:
        index < staticCount
          ? 'STATIC'
          : index < loadedWritableEnd
            ? 'LOOKUP_WRITABLE'
            : 'LOOKUP_READONLY',
      signer,
      writable,
      feePayer: index === 0,
      preBalanceLamports:
        pre === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Pre-transaction lamport balance was not recorded.')
          : knownValue(pre),
      postBalanceLamports:
        post === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'Post-transaction lamport balance was not recorded.')
          : knownValue(post),
      balanceDeltaLamports:
        pre === undefined || post === undefined
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'Both pre/post lamport balances are required for an exact delta.',
            )
          : knownValue((BigInt(post) - BigInt(pre)).toString()),
    };
  });
}

function balanceIdentity(balance: SolanaTokenBalanceRecord): string {
  return `${balance.accountIndex}:${balance.mint}`;
}

function tokenBalanceRecordingCoverage(transaction: SolanaTransactionRecord): number {
  if (transaction.preTokenBalances === undefined || transaction.postTokenBalances === undefined) {
    return 0;
  }
  const preIdentities = new Set(transaction.preTokenBalances.map(balanceIdentity));
  const postIdentities = new Set(transaction.postTokenBalances.map(balanceIdentity));
  const identities = new Set([...preIdentities, ...postIdentities]);
  if (identities.size === 0) return 1;
  const paired = [...identities].filter(
    (identity) => preIdentities.has(identity) && postIdentities.has(identity),
  ).length;
  return paired / identities.size;
}

function tokenBalanceChanges(
  transaction: SolanaTransactionRecord,
  resolvedAddresses: readonly string[],
): SolanaTokenBalanceChange[] {
  if (transaction.preTokenBalances === undefined || transaction.postTokenBalances === undefined) {
    return [];
  }
  const pre = new Map(
    transaction.preTokenBalances.map((balance) => [balanceIdentity(balance), balance]),
  );
  const post = new Map(
    transaction.postTokenBalances.map((balance) => [balanceIdentity(balance), balance]),
  );
  return [...new Set([...pre.keys(), ...post.keys()])]
    .map((identity) => {
      const before = pre.get(identity);
      const after = post.get(identity);
      const observed = before ?? after!;
      const account = resolvedAddresses[observed.accountIndex];
      const decimalsAgree =
        before === undefined || after === undefined || before.decimals === after.decimals;
      const programIds = [
        ...new Set([before?.programId, after?.programId].filter(Boolean)),
      ] as string[];
      return {
        accountIndex: observed.accountIndex,
        account:
          account === undefined ? unresolvedAddress(observed.accountIndex) : knownValue(account),
        mint: observed.mint,
        ownerBefore: optionalAddress(before?.owner, 'pre'),
        ownerAfter: optionalAddress(after?.owner, 'post'),
        programId:
          programIds.length === 1
            ? knownValue(programIds[0]!)
            : programIds.length === 0
              ? unknownValue('INSUFFICIENT_DATA', 'The token program ID was not recorded.')
              : unknownValue(
                  'CONFLICTING_SOURCES',
                  'Pre/post token balance records disagree on the token program ID.',
                ),
        decimals: decimalsAgree
          ? knownValue((before ?? after!).decimals)
          : unknownValue(
              'CONFLICTING_SOURCES',
              'Pre/post token balance records disagree on mint decimals.',
            ),
        preAmount:
          before === undefined
            ? unknownValue(
                'INSUFFICIENT_DATA',
                'This account/mint identity is absent from recorded pre-token balances; zero is not assumed.',
              )
            : knownValue(before.amount),
        postAmount:
          after === undefined
            ? unknownValue(
                'INSUFFICIENT_DATA',
                'This account/mint identity is absent from recorded post-token balances; zero is not assumed.',
              )
            : knownValue(after.amount),
        deltaAmount:
          before === undefined || after === undefined || !decimalsAgree
            ? unknownValue(
                'INSUFFICIENT_DATA',
                'A token delta requires matching recorded pre/post balances and decimals.',
              )
            : knownValue((BigInt(after.amount) - BigInt(before.amount)).toString()),
      };
    })
    .sort(
      (left, right) =>
        left.accountIndex - right.accountIndex || left.mint.localeCompare(right.mint),
    );
}

export function analyzeSolanaTransactionSemantics(
  transaction: SolanaTransactionRecord,
): SolanaTransactionSemantics {
  const loadedWritable = transaction.loadedAddresses?.writable ?? [];
  const loadedReadonly = transaction.loadedAddresses?.readonly ?? [];
  const resolvedAddresses = [
    ...transaction.staticAccountKeys,
    ...loadedWritable,
    ...loadedReadonly,
  ];
  const expectedLoadedCount = transaction.addressTableLookups.reduce(
    (count, lookup) => count + lookup.writableIndexes.length + lookup.readonlyIndexes.length,
    0,
  );
  const expectedAccountCount = transaction.staticAccountKeys.length + expectedLoadedCount;
  const accountResolutionComplete =
    transaction.addressTableLookups.length === 0 || transaction.loadedAddresses !== undefined;
  const recordingDimensions = [
    transaction.success === undefined ? 0 : 1,
    transaction.preBalances !== undefined && transaction.postBalances !== undefined ? 1 : 0,
    transaction.innerInstructions === undefined ? 0 : 1,
    tokenBalanceRecordingCoverage(transaction),
    transaction.logMessages === undefined ? 0 : 1,
    transaction.computeUnitsConsumed === undefined ? 0 : 1,
  ];
  const recordingCoverage =
    recordingDimensions.reduce((total, value) => total + value, 0) / recordingDimensions.length;
  const outerInstructions = transaction.instructions.map((instruction, outerIndex) =>
    resolveInstruction({ instruction, outerIndex, resolvedAddresses }),
  );
  const innerInstructions =
    transaction.innerInstructions?.flatMap((group) =>
      group.instructions.map((instruction, innerIndex) =>
        resolveInstruction({
          instruction,
          outerIndex: group.index,
          innerIndex,
          resolvedAddresses,
        }),
      ),
    ) ?? [];
  const programIds = [...outerInstructions, ...innerInstructions]
    .flatMap((instruction) =>
      instruction.programId.state === 'known' ? [instruction.programId.value] : [],
    )
    .filter((address, index, values) => values.indexOf(address) === index)
    .sort((left, right) => left.localeCompare(right));

  return SolanaTransactionSemanticsSchema.parse({
    signature: transaction.signature,
    version: transaction.version,
    recentBlockhash: transaction.recentBlockhash,
    execution:
      transaction.success === undefined
        ? 'METADATA_UNAVAILABLE'
        : transaction.success
          ? 'SUCCESS'
          : 'FAILED',
    executionError:
      transaction.success === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'Transaction metadata was not returned.')
        : transaction.success
          ? unknownValue('NOT_APPLICABLE', 'The transaction succeeded.')
          : transaction.executionError === undefined
            ? unknownValue('INSUFFICIENT_DATA', 'The failed transaction has no decoded error.')
            : knownValue(transaction.executionError as JsonValue),
    feePayer: knownValue(transaction.staticAccountKeys[0]!),
    signers: transaction.staticAccountKeys.slice(0, transaction.header.numRequiredSignatures),
    requiredSignatureCount: transaction.header.numRequiredSignatures,
    staticAccountCount: transaction.staticAccountKeys.length,
    loadedWritableAccountCount: loadedWritable.length,
    loadedReadonlyAccountCount: loadedReadonly.length,
    accountResolutionComplete: accountResolutionComplete
      ? knownValue(true)
      : unknownValue(
          'INSUFFICIENT_DATA',
          'The v0 message uses address-table lookups but loaded-address metadata is absent.',
        ),
    accountCoverage:
      expectedAccountCount === 0 ? 0 : resolvedAddresses.length / expectedAccountCount,
    recordingCoverage,
    accounts: accountRows(transaction, resolvedAddresses),
    addressTableLookups: transaction.addressTableLookups,
    outerInstructions,
    innerInstructionRecording:
      transaction.innerInstructions === undefined
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'Inner-instruction recording was unavailable for this transaction.',
          )
        : knownValue(true),
    innerInstructions,
    cpiCount:
      transaction.innerInstructions === undefined
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'CPI count is Unknown without inner-instruction recording.',
          )
        : knownValue(innerInstructions.length),
    programIds,
    tokenBalanceRecording:
      transaction.preTokenBalances === undefined || transaction.postTokenBalances === undefined
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'Pre/post token-balance recording was unavailable for this transaction.',
          )
        : knownValue(true),
    tokenBalanceChanges: tokenBalanceChanges(transaction, resolvedAddresses),
    computeUnitsConsumed:
      transaction.computeUnitsConsumed === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'Compute-unit consumption was not recorded.')
        : knownValue(transaction.computeUnitsConsumed),
    logRecording:
      transaction.logMessages === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'Program log recording was unavailable.')
        : knownValue(true),
    logCount:
      transaction.logMessages === undefined
        ? unknownValue('INSUFFICIENT_DATA', 'Program log count is Unknown without recording.')
        : knownValue(transaction.logMessages.length),
    modelVersion: SOLANA_TRANSACTION_SEMANTICS_MODEL_VERSION,
  });
}
