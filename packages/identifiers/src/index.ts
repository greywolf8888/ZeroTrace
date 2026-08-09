import { getAddress, isAddress } from 'viem';
import {
  Network as BitcoinNetwork,
  getAddressInfo,
  validate as validateBitcoinAddress,
} from 'bitcoin-address-validation';
import bs58 from 'bs58';

import type { Ledger, SubjectReference, SubjectType } from '@zerotrace/schemas';

export interface IdentifierHint {
  ledger?: Ledger;
  chainId?: string;
  type?: SubjectType;
}

export interface IdentifierClassification {
  query: string;
  candidates: SubjectReference[];
  rejectedReason?: string;
}

const evmHashPattern = /^0x[0-9a-fA-F]{64}$/;
const btcHashPattern = /^[0-9a-fA-F]{64}$/;
const outpointPattern = /^([0-9a-fA-F]{64}):(0|[1-9]\d*)$/;

function candidate(
  ledger: Ledger,
  chainId: string,
  type: SubjectType,
  id: string,
  normalizedId: string,
  validation: SubjectReference['validation'],
  confidence: number,
): SubjectReference {
  return { ledger, chainId, type, id, normalizedId, validation, confidence };
}

function allow(hint: IdentifierHint, ledger: Ledger, type: SubjectType): boolean {
  return (
    (hint.ledger === undefined || hint.ledger === ledger) &&
    (hint.type === undefined || hint.type === type)
  );
}

export function classifyIdentifier(
  rawQuery: string,
  hint: IdentifierHint = {},
): IdentifierClassification {
  const query = rawQuery.trim();
  const candidates: SubjectReference[] = [];

  if (query.length === 0) {
    return { query, candidates, rejectedReason: 'Identifier is empty.' };
  }

  if (isAddress(query, { strict: false }) && allow(hint, 'EVM', 'ADDRESS')) {
    const normalized = getAddress(query);
    candidates.push(
      candidate(
        'EVM',
        hint.chainId ?? 'eip155:unknown',
        'ADDRESS',
        query,
        normalized,
        'CHECKSUM_VALID',
        hint.ledger === 'EVM' ? 1 : 0.98,
      ),
    );
  }

  if (evmHashPattern.test(query) && (hint.ledger === undefined || hint.ledger === 'EVM')) {
    const chainId = hint.chainId ?? 'eip155:unknown';
    if (allow(hint, 'EVM', 'TRANSACTION')) {
      candidates.push(
        candidate('EVM', chainId, 'TRANSACTION', query, query.toLowerCase(), 'AMBIGUOUS', 0.5),
      );
    }
    if (allow(hint, 'EVM', 'BLOCK')) {
      candidates.push(
        candidate('EVM', chainId, 'BLOCK', query, query.toLowerCase(), 'AMBIGUOUS', 0.5),
      );
    }
  }

  if (validateBitcoinAddress(query, BitcoinNetwork.mainnet) && allow(hint, 'BITCOIN', 'ADDRESS')) {
    const info = getAddressInfo(query);
    candidates.push(
      candidate(
        'BITCOIN',
        'bitcoin-mainnet',
        'ADDRESS',
        query,
        info.bech32 ? query.toLowerCase() : query,
        'CHECKSUM_VALID',
        hint.ledger === 'BITCOIN' ? 1 : 0.99,
      ),
    );
  }

  const outpoint = outpointPattern.exec(query);
  if (outpoint !== null && allow(hint, 'BITCOIN', 'OUTPOINT')) {
    candidates.push(
      candidate(
        'BITCOIN',
        'bitcoin-mainnet',
        'OUTPOINT',
        query,
        query.toLowerCase(),
        'STRUCTURALLY_VALID',
        0.99,
      ),
    );
  } else if (
    btcHashPattern.test(query) &&
    (hint.ledger === undefined || hint.ledger === 'BITCOIN')
  ) {
    if (allow(hint, 'BITCOIN', 'TRANSACTION')) {
      candidates.push(
        candidate(
          'BITCOIN',
          'bitcoin-mainnet',
          'TRANSACTION',
          query,
          query.toLowerCase(),
          'AMBIGUOUS',
          0.5,
        ),
      );
    }
    if (allow(hint, 'BITCOIN', 'BLOCK')) {
      candidates.push(
        candidate(
          'BITCOIN',
          'bitcoin-mainnet',
          'BLOCK',
          query,
          query.toLowerCase(),
          'AMBIGUOUS',
          0.5,
        ),
      );
    }
  }

  if (allow(hint, 'SOLANA', 'ADDRESS')) {
    try {
      const decoded = bs58.decode(query);
      if (decoded.length === 32) {
        candidates.push(
          candidate(
            'SOLANA',
            'solana-mainnet',
            'ADDRESS',
            query,
            query,
            'STRUCTURALLY_VALID',
            hint.ledger === 'SOLANA' ? 0.75 : 0.55,
          ),
        );
      }
    } catch {
      // Not valid base58. Other ledger classifiers may still accept it.
    }
  }

  if (/^(0|[1-9]\d*)$/.test(query)) {
    if (allow(hint, 'BITCOIN', 'BLOCK')) {
      candidates.push(
        candidate(
          'BITCOIN',
          'bitcoin-mainnet',
          'BLOCK',
          query,
          query,
          'AMBIGUOUS',
          hint.ledger === 'BITCOIN' ? 0.8 : 0.4,
        ),
      );
    }
    if (allow(hint, 'SOLANA', 'BLOCK')) {
      candidates.push(
        candidate(
          'SOLANA',
          'solana-mainnet',
          'BLOCK',
          query,
          query,
          'AMBIGUOUS',
          hint.ledger === 'SOLANA' ? 0.8 : 0.4,
        ),
      );
    }
  }

  const unique = new Map(
    candidates.map((item) => [`${item.ledger}:${item.type}:${item.normalizedId}`, item]),
  );
  const result = [...unique.values()].sort((a, b) => b.confidence - a.confidence);
  return result.length === 0
    ? {
        query,
        candidates: result,
        rejectedReason: 'No supported identifier checksum or structure matched.',
      }
    : { query, candidates: result };
}
