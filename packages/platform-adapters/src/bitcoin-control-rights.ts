import { fromBech32, toOutputScript } from 'bitcoinjs-lib/src/address';
import { hash160, sha256 } from 'bitcoinjs-lib/src/crypto';
import { bitcoin } from 'bitcoinjs-lib/src/networks';
import {
  OPS,
  decompile,
  isCanonicalPubKey,
  number as scriptNumber,
} from 'bitcoinjs-lib/src/script';

import {
  ProviderError,
  type BitcoinTransactionInput,
  type BitcoinTransactionOutput,
} from '@zerotrace/chain-adapters';
import {
  BitcoinScriptControlAnalysisSchema,
  knownValue,
  unknownValue,
  type BitcoinMultisigObservation,
  type BitcoinScriptClass,
  type BitcoinScriptControlAnalysis,
  type BitcoinTimelock,
} from '@zerotrace/schemas';

export const BITCOIN_SCRIPT_CONTROL_MODEL_VERSION = 'bitcoin-script-control-v1.0.0';

const SCRIPT_TYPE_BY_CLASS: Readonly<Record<BitcoinScriptClass, string>> = {
  P2PKH: 'p2pkh',
  P2SH: 'p2sh',
  P2WPKH: 'v0_p2wpkh',
  P2WSH: 'v0_p2wsh',
  P2TR: 'v1_p2tr',
  BARE_MULTISIG: 'multisig',
  OP_RETURN: 'op_return',
  OTHER_SCRIPT: 'other',
};

const HASH_PREDICATE_OPS = new Set<number>([
  OPS.OP_RIPEMD160,
  OPS.OP_SHA1,
  OPS.OP_SHA256,
  OPS.OP_HASH160,
  OPS.OP_HASH256,
]);

type ScriptChunk = number | Uint8Array;

function bytes(hex: string, field: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    throw new ProviderError('INVALID_RESPONSE', `Invalid ${field} hex.`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function chunks(script: Uint8Array, field: string): ScriptChunk[] {
  const parsed = decompile(script);
  if (parsed === null) {
    throw new ProviderError('INVALID_RESPONSE', `Bitcoin ${field} cannot be decompiled.`);
  }
  return parsed;
}

function opcodeNumber(value: ScriptChunk | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    if (value === OPS.OP_0) return 0;
    if (value === OPS.OP_1NEGATE) return -1;
    if (value >= OPS.OP_1 && value <= OPS.OP_16) return value - OPS.OP_1 + 1;
    return undefined;
  }
  try {
    return scriptNumber.decode(value, 5, true);
  } catch {
    return undefined;
  }
}

function classifyScript(script: Uint8Array): BitcoinScriptClass {
  if (
    script.length === 25 &&
    script[0] === OPS.OP_DUP &&
    script[1] === OPS.OP_HASH160 &&
    script[2] === 20 &&
    script[23] === OPS.OP_EQUALVERIFY &&
    script[24] === OPS.OP_CHECKSIG
  ) {
    return 'P2PKH';
  }
  if (
    script.length === 23 &&
    script[0] === OPS.OP_HASH160 &&
    script[1] === 20 &&
    script[22] === OPS.OP_EQUAL
  ) {
    return 'P2SH';
  }
  if (script.length === 22 && script[0] === OPS.OP_0 && script[1] === 20) return 'P2WPKH';
  if (script.length === 34 && script[0] === OPS.OP_0 && script[1] === 32) return 'P2WSH';
  if (script.length === 34 && script[0] === OPS.OP_1 && script[1] === 32) return 'P2TR';
  if (script[0] === OPS.OP_RETURN) return 'OP_RETURN';
  if (decodeMultisig(script, true) !== undefined) return 'BARE_MULTISIG';
  return 'OTHER_SCRIPT';
}

function decodeMultisig(
  script: Uint8Array,
  requireWholeScript: boolean,
): BitcoinMultisigObservation | undefined {
  const parsed = chunks(script, 'script');
  const matches: BitcoinMultisigObservation[] = [];
  for (let start = 0; start <= parsed.length - 4; start += 1) {
    const threshold = opcodeNumber(parsed[start]);
    if (threshold === undefined || threshold < 1 || threshold > 20) continue;
    for (let signerCount = threshold; signerCount <= 20; signerCount += 1) {
      const countIndex = start + signerCount + 1;
      const checkIndex = countIndex + 1;
      if (checkIndex >= parsed.length) break;
      const declaredSignerCount = opcodeNumber(parsed[countIndex]);
      const check = parsed[checkIndex];
      const publicKeys = parsed.slice(start + 1, countIndex);
      if (
        declaredSignerCount !== signerCount ||
        (check !== OPS.OP_CHECKMULTISIG && check !== OPS.OP_CHECKMULTISIGVERIFY) ||
        publicKeys.some((item) => typeof item === 'number' || !isCanonicalPubKey(item)) ||
        (requireWholeScript && (start !== 0 || checkIndex !== parsed.length - 1))
      ) {
        continue;
      }
      matches.push({
        threshold,
        signerCount,
        publicKeyFingerprints: publicKeys.map((item) => hex(sha256(item as Uint8Array))),
      });
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function timelocks(script: Uint8Array): {
  absolute: BitcoinTimelock[];
  relative: BitcoinTimelock[];
} {
  const parsed = chunks(script, 'script');
  const absolute: BitcoinTimelock[] = [];
  const relative: BitcoinTimelock[] = [];
  for (let index = 1; index < parsed.length; index += 1) {
    const opcode = parsed[index];
    if (opcode !== OPS.OP_CHECKLOCKTIMEVERIFY && opcode !== OPS.OP_CHECKSEQUENCEVERIFY) continue;
    const encoded = opcodeNumber(parsed[index - 1]);
    if (encoded === undefined || encoded < 0 || !Number.isSafeInteger(encoded)) continue;
    if (opcode === OPS.OP_CHECKLOCKTIMEVERIFY) {
      absolute.push({
        kind: encoded < 500_000_000 ? 'ABSOLUTE_HEIGHT' : 'ABSOLUTE_TIME',
        value: String(encoded),
        encodedValue: String(encoded),
        detail:
          encoded < 500_000_000
            ? 'CHECKLOCKTIMEVERIFY block-height threshold.'
            : 'CHECKLOCKTIMEVERIFY Unix-time threshold.',
      });
      continue;
    }
    if (encoded > 0xffff_ffff || (encoded & 0x8000_0000) !== 0) continue;
    const relativeValue = encoded & 0xffff;
    const timeBased = (encoded & 0x0040_0000) !== 0;
    relative.push({
      kind: timeBased ? 'RELATIVE_TIME' : 'RELATIVE_BLOCKS',
      value: String(timeBased ? relativeValue * 512 : relativeValue),
      encodedValue: String(encoded),
      detail: timeBased
        ? 'CHECKSEQUENCEVERIFY relative time in 512-second units.'
        : 'CHECKSEQUENCEVERIFY relative block threshold.',
    });
  }
  return { absolute, relative };
}

function hasHashPredicate(script: Uint8Array): boolean {
  return chunks(script, 'script').some(
    (item) => typeof item === 'number' && HASH_PREDICATE_OPS.has(item),
  );
}

function verifyAddress(output: BitcoinTransactionOutput, script: Uint8Array) {
  if (output.address === undefined) {
    return unknownValue('NOT_APPLICABLE', 'Output has no standard address representation.');
  }
  let addressScript: Uint8Array;
  try {
    try {
      const decoded = fromBech32(output.address);
      if (decoded.prefix !== bitcoin.bech32 || decoded.version < 0 || decoded.version > 16) {
        throw new TypeError('wrong network or witness version');
      }
      addressScript = Uint8Array.from([
        decoded.version === 0 ? OPS.OP_0 : OPS.OP_1 - 1 + decoded.version,
        decoded.data.length,
        ...decoded.data,
      ]);
    } catch {
      addressScript = toOutputScript(output.address, bitcoin);
    }
  } catch (error) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Esplora returned an invalid Bitcoin mainnet address: ${error instanceof Error ? error.message : 'decode failed'}.`,
    );
  }
  if (!equalBytes(addressScript, script)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Bitcoin output address does not commit to the returned scriptPubKey.',
    );
  }
  return knownValue(true);
}

function standardAnalysis(
  output: BitcoinTransactionOutput,
  script: Uint8Array,
  scriptClass: 'P2PKH' | 'P2WPKH' | 'BARE_MULTISIG' | 'OP_RETURN' | 'OTHER_SCRIPT',
): BitcoinScriptControlAnalysis {
  const multisig = decodeMultisig(script, true);
  const locks = timelocks(script);
  const signatureRequirement =
    scriptClass === 'P2PKH' || scriptClass === 'P2WPKH'
      ? knownValue('SINGLE_KEY' as const)
      : scriptClass === 'BARE_MULTISIG'
        ? knownValue('MULTISIG' as const)
        : scriptClass === 'OP_RETURN'
          ? knownValue('PROVABLY_UNSPENDABLE' as const)
          : knownValue('ARBITRARY_SCRIPT' as const);
  return BitcoinScriptControlAnalysisSchema.parse({
    scriptClass,
    scriptPubKey: output.scriptPubKey,
    addressMatch: verifyAddress(output, script),
    spendConditionVisibility:
      scriptClass === 'OTHER_SCRIPT' ? 'UNSUPPORTED_SCRIPT' : 'FULLY_VISIBLE',
    signatureRequirement,
    multisig:
      multisig === undefined
        ? unknownValue('NOT_APPLICABLE', 'No exact legacy CHECKMULTISIG template was observed.')
        : knownValue(multisig),
    absoluteTimelocks: locks.absolute,
    relativeTimelocks: locks.relative,
    hashPredicatePresent: knownValue(scriptClass === 'P2WPKH' ? true : hasHashPredicate(script)),
    taprootSpendPath: unknownValue('NOT_APPLICABLE', 'Output is not Taproot.'),
    revealedScript: knownValue(output.scriptPubKey),
    controllerIdentity: unknownValue(
      'INSUFFICIENT_DATA',
      'Script keys and hashes do not prove the real-world controlling entity.',
    ),
    scriptConditionsComplete:
      scriptClass === 'OTHER_SCRIPT'
        ? unknownValue('UNSUPPORTED', 'Custom script semantics are only partially decoded.')
        : knownValue(true),
    modelVersion: BITCOIN_SCRIPT_CONTROL_MODEL_VERSION,
  });
}

function committedScriptAnalysis(
  output: BitcoinTransactionOutput,
  outputScript: Uint8Array,
  scriptClass: 'P2SH' | 'P2WSH',
  spendingInput: BitcoinTransactionInput | undefined,
): BitcoinScriptControlAnalysis {
  const addressMatch = verifyAddress(output, outputScript);
  if (spendingInput === undefined) {
    return BitcoinScriptControlAnalysisSchema.parse({
      scriptClass,
      scriptPubKey: output.scriptPubKey,
      addressMatch,
      spendConditionVisibility: 'HASH_COMMITTED_HIDDEN',
      signatureRequirement: unknownValue(
        'INSUFFICIENT_DATA',
        'The committed spend script has not been revealed by a spending input.',
      ),
      multisig: unknownValue('INSUFFICIENT_DATA', 'The committed script is still hidden.'),
      absoluteTimelocks: [],
      relativeTimelocks: [],
      hashPredicatePresent: unknownValue(
        'INSUFFICIENT_DATA',
        'The committed script is still hidden.',
      ),
      taprootSpendPath: unknownValue('NOT_APPLICABLE', 'Output is not Taproot.'),
      revealedScript: unknownValue('INSUFFICIENT_DATA', 'No spending input revealed the script.'),
      controllerIdentity: unknownValue(
        'INSUFFICIENT_DATA',
        'A script commitment cannot identify the controlling entity.',
      ),
      scriptConditionsComplete: unknownValue(
        'INSUFFICIENT_DATA',
        'Spend conditions remain hidden until a valid reveal is observed.',
      ),
      modelVersion: BITCOIN_SCRIPT_CONTROL_MODEL_VERSION,
    });
  }

  let revealed: Uint8Array;
  if (scriptClass === 'P2SH') {
    const scriptSigChunks = chunks(bytes(spendingInput.scriptSig, 'scriptSig'), 'scriptSig');
    const redeemScript = scriptSigChunks.at(-1);
    if (!(redeemScript instanceof Uint8Array)) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Spent P2SH input does not reveal a redeem script.',
      );
    }
    if (!equalBytes(hash160(redeemScript), outputScript.slice(2, 22))) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'P2SH redeem script does not match its HASH160 commitment.',
      );
    }
    const redeemClass = classifyScript(redeemScript);
    if (redeemClass === 'P2WPKH') {
      revealed = redeemScript;
    } else if (redeemClass === 'P2WSH') {
      const witnessScriptHex = spendingInput.witness.at(-1);
      if (witnessScriptHex === undefined) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Nested P2WSH input is missing its witness script.',
        );
      }
      revealed = bytes(witnessScriptHex, 'witness script');
      if (!equalBytes(sha256(revealed), redeemScript.slice(2, 34))) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Nested P2WSH script does not match its SHA256 commitment.',
        );
      }
    } else {
      revealed = redeemScript;
    }
  } else {
    const witnessScriptHex = spendingInput.witness.at(-1);
    if (witnessScriptHex === undefined) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Spent P2WSH input is missing its witness script.',
      );
    }
    revealed = bytes(witnessScriptHex, 'witness script');
    if (!equalBytes(sha256(revealed), outputScript.slice(2, 34))) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'P2WSH script does not match its SHA256 commitment.',
      );
    }
  }

  const revealedClass = classifyScript(revealed);
  const multisig = decodeMultisig(revealed, false);
  const locks = timelocks(revealed);
  const signatureRequirement =
    revealedClass === 'P2PKH' || revealedClass === 'P2WPKH'
      ? knownValue('SINGLE_KEY' as const)
      : multisig === undefined
        ? knownValue('ARBITRARY_SCRIPT' as const)
        : knownValue('MULTISIG' as const);
  return BitcoinScriptControlAnalysisSchema.parse({
    scriptClass,
    scriptPubKey: output.scriptPubKey,
    addressMatch,
    spendConditionVisibility: 'REVEALED_AND_COMMITMENT_VERIFIED',
    signatureRequirement,
    multisig:
      multisig === undefined
        ? unknownValue('NOT_APPLICABLE', 'The revealed script is not exact legacy multisig.')
        : knownValue(multisig),
    absoluteTimelocks: locks.absolute,
    relativeTimelocks: locks.relative,
    hashPredicatePresent:
      revealedClass === 'P2WPKH' ? knownValue(true) : knownValue(hasHashPredicate(revealed)),
    taprootSpendPath: unknownValue('NOT_APPLICABLE', 'Output is not Taproot.'),
    revealedScript: knownValue(hex(revealed)),
    controllerIdentity: unknownValue(
      'INSUFFICIENT_DATA',
      'A verified script reveals spend conditions, not the real-world controlling entity.',
    ),
    scriptConditionsComplete:
      revealedClass === 'OTHER_SCRIPT'
        ? unknownValue('UNSUPPORTED', 'Custom script semantics are only partially decoded.')
        : knownValue(true),
    modelVersion: BITCOIN_SCRIPT_CONTROL_MODEL_VERSION,
  });
}

function taprootAnalysis(
  output: BitcoinTransactionOutput,
  outputScript: Uint8Array,
  spendingInput: BitcoinTransactionInput | undefined,
): BitcoinScriptControlAnalysis {
  const base = {
    scriptClass: 'P2TR' as const,
    scriptPubKey: output.scriptPubKey,
    addressMatch: verifyAddress(output, outputScript),
    multisig: unknownValue(
      'INSUFFICIENT_DATA' as const,
      'Taproot key aggregation and script thresholds are not recoverable from the output key alone.',
    ),
    controllerIdentity: unknownValue(
      'INSUFFICIENT_DATA' as const,
      'A Taproot output key does not identify the real-world controlling entity.',
    ),
    modelVersion: BITCOIN_SCRIPT_CONTROL_MODEL_VERSION,
  };
  if (spendingInput === undefined) {
    return BitcoinScriptControlAnalysisSchema.parse({
      ...base,
      spendConditionVisibility: 'TAPROOT_OUTPUT_KEY_ONLY',
      signatureRequirement: knownValue('KEY_OR_SCRIPT'),
      absoluteTimelocks: [],
      relativeTimelocks: [],
      hashPredicatePresent: unknownValue(
        'INSUFFICIENT_DATA',
        'The committed Taproot script tree is not visible from the output key.',
      ),
      taprootSpendPath: unknownValue('INSUFFICIENT_DATA', 'No spending witness was observed.'),
      revealedScript: unknownValue('INSUFFICIENT_DATA', 'No Taproot script path was revealed.'),
      scriptConditionsComplete: unknownValue(
        'INSUFFICIENT_DATA',
        'The internal key and optional script tree remain hidden.',
      ),
    });
  }
  const witness = spendingInput.witness.map((item) => bytes(item, 'Taproot witness item'));
  if (witness.length > 0 && witness.at(-1)?.[0] === 0x50) witness.pop();
  if (witness.length === 0) {
    throw new ProviderError('INVALID_RESPONSE', 'Spent Taproot input has no spend witness.');
  }
  if (witness.length === 1) {
    return BitcoinScriptControlAnalysisSchema.parse({
      ...base,
      spendConditionVisibility: 'TAPROOT_SPEND_OBSERVED',
      signatureRequirement: knownValue('SINGLE_KEY'),
      absoluteTimelocks: [],
      relativeTimelocks: [],
      hashPredicatePresent: unknownValue(
        'INSUFFICIENT_DATA',
        'A key-path spend does not disclose the optional Taproot script tree.',
      ),
      taprootSpendPath: knownValue('KEY_PATH'),
      revealedScript: unknownValue('NOT_APPLICABLE', 'Key-path spend used no script leaf.'),
      scriptConditionsComplete: unknownValue(
        'INSUFFICIENT_DATA',
        'A key-path spend does not disclose whether alternative script paths exist.',
      ),
    });
  }
  const controlBlock = witness.at(-1) as Uint8Array;
  const revealed = witness.at(-2) as Uint8Array;
  if (controlBlock.length < 33 || (controlBlock.length - 33) % 32 !== 0) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'Taproot script-path control block has invalid length.',
    );
  }
  const locks = timelocks(revealed);
  return BitcoinScriptControlAnalysisSchema.parse({
    ...base,
    spendConditionVisibility: 'TAPROOT_SPEND_OBSERVED',
    signatureRequirement: unknownValue(
      'UNSUPPORTED',
      'Tapscript signature threshold analysis is not implemented in this model version.',
    ),
    absoluteTimelocks: locks.absolute,
    relativeTimelocks: locks.relative,
    hashPredicatePresent: knownValue(hasHashPredicate(revealed)),
    taprootSpendPath: knownValue('SCRIPT_PATH'),
    revealedScript: knownValue(hex(revealed)),
    scriptConditionsComplete: unknownValue(
      'INSUFFICIENT_DATA',
      'The revealed leaf is observable, but the full Taproot tree and output-key commitment are not reconstructed.',
    ),
  });
}

export function analyzeBitcoinScriptControl(
  output: BitcoinTransactionOutput,
  spendingInput?: BitcoinTransactionInput,
): BitcoinScriptControlAnalysis {
  const script = bytes(output.scriptPubKey, 'scriptPubKey');
  const scriptClass = classifyScript(script);
  const expectedType = SCRIPT_TYPE_BY_CLASS[scriptClass];
  if (output.scriptType !== expectedType) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Esplora script type ${output.scriptType} conflicts with decoded class ${scriptClass}.`,
    );
  }
  if (scriptClass === 'P2SH' || scriptClass === 'P2WSH') {
    return committedScriptAnalysis(output, script, scriptClass, spendingInput);
  }
  if (scriptClass === 'P2TR') return taprootAnalysis(output, script, spendingInput);
  return standardAnalysis(output, script, scriptClass);
}
