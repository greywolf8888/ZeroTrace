import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  ClaimDeclarationParseResultSchema,
  ClaimWindowSchema,
  knownValue,
  unknownValue,
  type ClaimDeclarationDraft,
  type ClaimDeclarationParseResult,
  type ClaimExpectedAction,
  type ClaimWalletRole,
  type ClaimWindow,
  type KnowledgeValue,
} from '@zerotrace/schemas';

export const CLAIM_DECLARATION_PARSER_VERSION = 'claim-declaration-parser-v1.0.0';

const EVM_ADDRESS = /0x[0-9a-fA-F]{40}/g;

interface RoleDefinition {
  role: ClaimWalletRole;
  expectedAction: ClaimExpectedAction;
  patterns: readonly RegExp[];
  allocation: boolean;
}

const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    role: 'BUYBACK_BURN',
    expectedAction: 'BURN',
    patterns: [/回购销毁/i, /buyback[^\n]{0,32}burn/i],
    allocation: true,
  },
  {
    role: 'BUYBACK_LIQUIDITY',
    expectedAction: 'ADD_LIQUIDITY',
    patterns: [/回购加池/i, /buyback[^\n]{0,32}(?:liquidity|add\s+liquidity)/i],
    allocation: true,
  },
  {
    role: 'COMMUNITY_FUND',
    expectedAction: 'DISTRIBUTE',
    patterns: [/社区建设基金/i, /community[^\n]{0,24}fund/i],
    allocation: true,
  },
  {
    role: 'TAX_RECEIVER',
    expectedAction: 'RECEIVE',
    patterns: [/税费接收(?:总)?钱包/i, /tax[^\n]{0,24}(?:receiver|wallet)/i],
    allocation: true,
  },
  {
    role: 'PENSION_VAULT',
    expectedAction: 'LOCK',
    patterns: [/养老(?:钱包|计划|政策)/i, /pension[^\n]{0,24}(?:vault|wallet|plan)?/i],
    allocation: false,
  },
] as const;

export interface ParseEvmClaimDeclarationOptions {
  text: string;
  chainId: string;
  assetId: string;
  source: string;
  observedAt: string;
  sourceUri?: string | undefined;
  auditWindow?: ClaimWindow | undefined;
}

interface DraftSeed {
  definition: RoleDefinition;
  matchedText: string;
  addresses: string[];
  percentages: string[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function matchesRole(line: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((definition) =>
    definition.patterns.some((pattern) => pattern.test(line)),
  );
}

function percentToBps(value: string): KnowledgeValue<string> {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) return unknownValue('INVALID_INPUT', 'Declared percentage is malformed.');
  const fraction = match[2] ?? '';
  if (fraction.length > 2) {
    return unknownValue(
      'PRECISION_UNSAFE',
      'Declared percentage has more than two decimal places and cannot be represented in bps.',
    );
  }
  const bps = BigInt(match[1] ?? '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return bps > 10_000n
    ? unknownValue('INVALID_INPUT', 'Declared percentage exceeds 100%.')
    : knownValue(bps.toString());
}

function oneDeclaredValue(values: readonly string[], field: string): KnowledgeValue<string> {
  const distinct = unique(values);
  if (distinct.length === 1) return knownValue(distinct[0] ?? '');
  if (distinct.length === 0) {
    return unknownValue('INSUFFICIENT_DATA', `${field} is not explicitly declared in the text.`);
  }
  return unknownValue('CONFLICTING_SOURCES', `${field} has multiple declarations in one document.`);
}

function declaredPercentage(seed: DraftSeed): KnowledgeValue<string> {
  if (!seed.definition.allocation) {
    return unknownValue('NOT_APPLICABLE', 'This declaration is not a percentage allocation rule.');
  }
  const declared = oneDeclaredValue(seed.percentages, 'Expected allocation percentage');
  return declared.state === 'known' ? percentToBps(declared.value) : declared;
}

function scaledInteger(value: string, multiplier: bigint): string | null {
  const [whole = '', fraction = ''] = value.split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
  const scaled = numerator * multiplier;
  return scaled % denominator === 0n ? (scaled / denominator).toString() : null;
}

function pensionShareUnit(text: string): KnowledgeValue<string> {
  const match =
    /(\d+(?:\.\d+)?)\s*(万|[wW])?\s*(?:枚|个|币|tokens?)?[^\n。；;]{0,24}(?:为|=|作为)?\s*1\s*股/i.exec(
      text,
    );
  if (match === null) {
    return unknownValue('INSUFFICIENT_DATA', 'No explicit pension share-unit quantity was found.');
  }
  const multiplier = match[2] === undefined ? 1n : 10_000n;
  const normalized = scaledInteger(match[1] ?? '', multiplier);
  return normalized === null
    ? unknownValue('PRECISION_UNSAFE', 'Pension share-unit quantity is not an exact whole token.')
    : knownValue(normalized);
}

function auditWindow(value: ClaimWindow | undefined): KnowledgeValue<ClaimWindow> {
  return value === undefined
    ? unknownValue(
        'INSUFFICIENT_DATA',
        'An exact timezone-qualified audit window must be supplied before chain verification.',
      )
    : knownValue(ClaimWindowSchema.parse(value));
}

function destination(seed: DraftSeed): KnowledgeValue<string> {
  return oneDeclaredValue(seed.addresses, `${seed.definition.role} destination address`);
}

function missingFields(draft: {
  sourceAddress: KnowledgeValue<string>;
  destinationAddress: KnowledgeValue<string>;
  expectedShareBps: KnowledgeValue<string>;
  window: KnowledgeValue<ClaimWindow>;
  allocation: boolean;
}): string[] {
  return [
    ...(draft.sourceAddress.state === 'known' ? [] : ['sourceAddress']),
    ...(draft.destinationAddress.state === 'known' ? [] : ['destinationAddress']),
    ...(draft.allocation && draft.expectedShareBps.state !== 'known' ? ['expectedShareBps'] : []),
    ...(draft.window.state === 'known' ? [] : ['window']),
  ];
}

function sectionSeeds(lines: readonly string[]): DraftSeed[] {
  const sections = new Map<ClaimWalletRole, { definition: RoleDefinition; lines: string[] }>();
  let active: RoleDefinition | undefined;
  for (const line of lines) {
    const definition = matchesRole(line);
    if (definition !== undefined) active = definition;
    if (active === undefined) continue;
    const section = sections.get(active.role) ?? { definition: active, lines: [] };
    section.lines.push(line);
    sections.set(active.role, section);
  }
  return [...sections.values()].map(({ definition, lines: matchedLines }) => {
    const matchedText = matchedLines.join('\n');
    return {
      definition,
      matchedText,
      addresses: unique(
        [...matchedText.matchAll(EVM_ADDRESS)].map((match) => normalizeAddress(match[0])),
      ),
      percentages: unique(
        [...matchedText.matchAll(/(\d+(?:\.\d+)?)\s*[%％]/g)].map((match) => match[1] ?? ''),
      ).filter((value) => value.length > 0),
    };
  });
}

function claimId(documentHash: string, role: ClaimWalletRole, action: ClaimExpectedAction): string {
  return `cld_${hashPayload({ documentHash, role, action }).slice(0, 24)}`;
}

export function parseEvmClaimDeclaration(
  options: ParseEvmClaimDeclarationOptions,
): ClaimDeclarationParseResult {
  const text = options.text.trim();
  if (text.length === 0 || text.length > 100_000) {
    throw new Error('Claim declaration text must contain between 1 and 100000 characters.');
  }
  if (!/^eip155:[1-9]\d*$/.test(options.chainId)) {
    throw new Error('EVM claim declaration chainId must use eip155:<number>.');
  }
  if (
    !/^eip155:[1-9]\d*:erc20:0x[0-9a-fA-F]{40}$/.test(options.assetId) ||
    !options.assetId.startsWith(`${options.chainId}:`)
  ) {
    throw new Error(
      'Claim declaration assetId must be a canonical ERC-20 asset on the requested EVM chain.',
    );
  }
  if (options.source.trim().length === 0) throw new Error('Claim declaration source is required.');
  const window = auditWindow(options.auditWindow);
  const documentHash = hashPayload({ text, chainId: options.chainId, assetId: options.assetId });
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: options.chainId,
    kind: 'ANALYST_OBSERVATION',
    source: options.source,
    locator: `claim-declaration:${documentHash}`,
    ...(options.sourceUri === undefined ? {} : { sourceUri: options.sourceUri }),
    payload: { text, assetId: options.assetId },
    observedAt: options.observedAt,
    summary:
      'Off-chain claim declaration captured for deterministic parsing; it is not a chain fact.',
  });
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const seeds = sectionSeeds(lines);
  const taxReceiverSeed = seeds.find((seed) => seed.definition.role === 'TAX_RECEIVER');
  const taxReceiver =
    taxReceiverSeed === undefined
      ? unknownValue('INSUFFICIENT_DATA', 'Tax receiver is not declared in the text.')
      : destination(taxReceiverSeed);
  const pensionSeed = seeds.find((seed) => seed.definition.role === 'PENSION_VAULT');
  const pensionDestination =
    pensionSeed === undefined
      ? unknownValue('INSUFFICIENT_DATA', 'Pension vault is not declared in the text.')
      : destination(pensionSeed);

  const drafts: ClaimDeclarationDraft[] = seeds.map((seed) => {
    const destinationAddress = destination(seed);
    const sourceAddress =
      seed.definition.role === 'TAX_RECEIVER'
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'The text does not identify the on-chain tax source or processor.',
          )
        : seed.definition.role === 'PENSION_VAULT'
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'Member deposits do not provide one declared source address.',
            )
          : taxReceiver;
    const expectedShareBps = declaredPercentage(seed);
    const fields = missingFields({
      sourceAddress,
      destinationAddress,
      expectedShareBps,
      window,
      allocation: seed.definition.allocation,
    });
    return {
      id: claimId(documentHash, seed.definition.role, seed.definition.expectedAction),
      assetId: options.assetId,
      role: seed.definition.role,
      expectedAction: seed.definition.expectedAction,
      sourceAddress,
      destinationAddress,
      expectedShareBps,
      shareUnitTokens:
        seed.definition.role === 'PENSION_VAULT'
          ? pensionShareUnit(seed.matchedText)
          : unknownValue('NOT_APPLICABLE', 'This declaration has no pension share-unit rule.'),
      noExit:
        seed.definition.role === 'PENSION_VAULT'
          ? /不可退出|不能退出|no\s+exit/i.test(seed.matchedText)
            ? knownValue(true)
            : unknownValue('INSUFFICIENT_DATA', 'No explicit no-exit wording was found.')
          : unknownValue('NOT_APPLICABLE', 'This declaration has no pension no-exit rule.'),
      cadenceSeconds: unknownValue(
        'NOT_APPLICABLE',
        'This declaration does not define a payout action cadence.',
      ),
      window,
      matchedText: seed.matchedText,
      missingFields: fields,
      chainVerifyReadiness: fields.length === 0 ? 'READY_FOR_REVIEW' : 'INCOMPLETE',
      requiresHumanReview: true,
      claimEvidenceIds: [evidence.id],
    };
  });

  const cadenceText = pensionSeed?.matchedText ?? text;
  const cadenceMatch = /每周|每星期|weekly/i.exec(cadenceText);
  if (cadenceMatch !== null && /分红|dividend/i.test(cadenceText)) {
    const sourceAddress = pensionDestination;
    const destinationAddress = unknownValue(
      'INSUFFICIENT_DATA',
      'Dividend recipients or a distributor destination are not explicitly identified.',
    );
    const fields = missingFields({
      sourceAddress,
      destinationAddress,
      expectedShareBps: unknownValue('NOT_APPLICABLE'),
      window,
      allocation: false,
    });
    drafts.push({
      id: claimId(documentHash, 'DIVIDEND_DISTRIBUTOR', 'PAY_DIVIDEND'),
      assetId: options.assetId,
      role: 'DIVIDEND_DISTRIBUTOR',
      expectedAction: 'PAY_DIVIDEND',
      sourceAddress,
      destinationAddress,
      expectedShareBps: unknownValue(
        'NOT_APPLICABLE',
        'The dividend claim does not declare a fixed allocation percentage.',
      ),
      shareUnitTokens: unknownValue(
        'NOT_APPLICABLE',
        'Share-unit membership belongs to the pension-vault declaration.',
      ),
      noExit: unknownValue(
        'NOT_APPLICABLE',
        'No-exit membership belongs to the pension-vault declaration.',
      ),
      cadenceSeconds: knownValue('604800'),
      window,
      matchedText: pensionSeed?.matchedText ?? cadenceMatch[0],
      missingFields: fields,
      chainVerifyReadiness: 'INCOMPLETE',
      requiresHumanReview: true,
      claimEvidenceIds: [evidence.id],
    });
  }

  const assignedAddresses = new Set(
    drafts.flatMap((draft) =>
      draft.destinationAddress.state === 'known' ? [draft.destinationAddress.value] : [],
    ),
  );
  const allAddresses = unique(
    [...text.matchAll(EVM_ADDRESS)].map((match) => normalizeAddress(match[0])),
  );
  const warnings: string[] = [];
  if (drafts.length === 0) warnings.push('No supported claim-role declaration was found.');
  if (options.auditWindow === undefined && /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/.test(text)) {
    warnings.push(
      'A month/day fragment was not converted into an audit boundary without an explicit year and timezone.',
    );
  }
  const knownAllocation = drafts.filter(
    (draft) =>
      ['COMMUNITY_FUND', 'BUYBACK_BURN', 'BUYBACK_LIQUIDITY'].includes(draft.role) &&
      draft.expectedShareBps.state === 'known',
  );
  if (knownAllocation.length > 0) {
    const sum = knownAllocation.reduce(
      (total, draft) =>
        total +
        BigInt(draft.expectedShareBps.state === 'known' ? draft.expectedShareBps.value : '0'),
      0n,
    );
    if (sum !== 10_000n) {
      warnings.push(
        `Declared downstream allocation totals ${sum.toString()} bps instead of 10000.`,
      );
    }
  }
  for (const seed of seeds) {
    if (seed.addresses.length > 1) {
      warnings.push(`${seed.definition.role} contains multiple destination-address candidates.`);
    }
    if (seed.definition.allocation && seed.percentages.length > 1) {
      warnings.push(`${seed.definition.role} contains multiple percentage candidates.`);
    }
  }
  const result = {
    parserVersion: CLAIM_DECLARATION_PARSER_VERSION,
    documentHash,
    assetId: options.assetId,
    evidence,
    drafts,
    unmatchedAddresses: allAddresses.filter((address) => !assignedAddresses.has(address)),
    warnings: unique(warnings),
  };
  return ClaimDeclarationParseResultSchema.parse(result);
}
