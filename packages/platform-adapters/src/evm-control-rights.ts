import { ProviderError, type TransportObservation } from '@zerotrace/chain-adapters';
import { canonicalJson, createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  EvmControlCoverageDomainSchema,
  EvmControlSurfaceReportSchema,
  EvmSnapshotSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisSnapshot,
  type ChainAnchorRead,
  type Evidence,
  type EvmControlCoverage,
  type EvmControlCoverageDomain,
  type EvmDeclaredCapability,
  type EvmLogicCode,
  type EvmLogicCodeRelation,
  type EvmControlRight,
  type EvmControlSurfaceReport,
  type EvmSafeControl,
  type EvmVerifiedSource,
  type KnowledgeValue,
} from '@zerotrace/schemas';
import { decodeFunctionResult, encodeFunctionData, keccak256 } from 'viem';
import type { z } from 'zod';

import { OFFICIAL_SAFE_IMPLEMENTATIONS } from './claim-evm.js';
import { attestBscSourceIndependence } from './flap-market-reconciliation.js';
import type { EvmSourceVerificationAdapter, SourcifyExactMatch } from './sourcify.js';

type EvmSnapshot = z.infer<typeof EvmSnapshotSchema>;

export const EVM_CONTROL_SURFACE_MODEL_VERSION = 'evm-control-surface-v1.1.0';

export const ERC1167_RUNTIME_PREFIX = '363d3d373d3d3d363d73';
export const ERC1167_RUNTIME_SUFFIX = '5af43d82803e903d91602b57fd5bf3';
export const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const EIP1967_ADMIN_SLOT =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
export const EIP1967_BEACON_SLOT =
  '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_WORD = `0x${'0'.repeat(64)}`;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_WORD = /^0x[0-9a-fA-F]{64}$/;

const ownerAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const beaconAbi = [
  {
    type: 'function',
    name: 'implementation',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const safeReadAbi = [
  {
    type: 'function',
    name: 'VERSION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nonce',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface EvmControlReadAdapter {
  readonly sourceId: string;
  readonly config: { chainId: number };
  createSnapshot(): Promise<EvmSnapshot>;
  readAnchorAt(position: string): Promise<ChainAnchorRead>;
  getCodeObservationAtBlockHash(
    address: string,
    blockHash: string,
  ): Promise<TransportObservation<string>>;
  getStorageObservationAtBlockHash(
    address: string,
    slot: string,
    blockHash: string,
  ): Promise<TransportObservation<string>>;
  callObservationAtBlockHash(
    to: string,
    data: string,
    blockHash: string,
  ): Promise<TransportObservation<string>>;
}

export interface EvmControlEvidenceWriter {
  (
    evidence: Evidence,
    sourceEvidenceIds?: readonly string[],
    snapshot?: AnalysisSnapshot,
  ): Promise<Evidence>;
}

interface OptionalCall {
  status: 'SUPPORTED' | 'UNSUPPORTED';
  raw?: string;
}

interface AddressSlot {
  raw: string;
  status: 'ZERO' | 'ADDRESS' | 'NON_CANONICAL';
  address?: string;
}

interface SourceControlState {
  code: string;
  codeBytes: number;
  erc1167Implementation: string | null;
  eip1967: {
    implementation: AddressSlot;
    admin: AddressSlot;
    beacon: AddressSlot;
    beaconImplementation: OptionalCall & { address?: string };
  };
  owner: OptionalCall & { address?: string };
  safe:
    | { status: 'UNSUPPORTED' }
    | { status: 'UNREGISTERED'; singleton: string; version: string }
    | ({ status: 'SUPPORTED' } & EvmSafeControl);
  logicCode:
    | null
    | (EvmLogicCode & {
        code: string;
      });
}

interface SourceObservation {
  sourceId: string;
  snapshot: EvmSnapshot;
  state: SourceControlState;
  evidence: Evidence;
}

function normalizeAddress(value: string, field: string): string {
  if (!EVM_ADDRESS.test(value)) throw new Error(`${field} must be an EVM address.`);
  return value.toLowerCase();
}

function word(value: string, field: string): string {
  if (!EVM_WORD.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `${field} must be one EVM storage word.`);
  }
  return value.toLowerCase();
}

function slotAddress(value: string, field: string): AddressSlot {
  const raw = word(value, field);
  if (raw === ZERO_WORD) return { raw, status: 'ZERO' };
  if (raw.slice(2, 26) !== '0'.repeat(24)) return { raw, status: 'NON_CANONICAL' };
  return { raw, status: 'ADDRESS', address: `0x${raw.slice(-40)}` };
}

export function detectErc1167Implementation(codeInput: string): string | null {
  const code = codeInput.toLowerCase();
  const match = new RegExp(
    `^0x${ERC1167_RUNTIME_PREFIX}([0-9a-f]{40})${ERC1167_RUNTIME_SUFFIX}$`,
  ).exec(code);
  return match?.[1] === undefined ? null : `0x${match[1]}`;
}

function callData(
  functionName: 'owner' | 'implementation' | 'VERSION' | 'getOwners' | 'getThreshold' | 'nonce',
): string {
  if (functionName === 'owner') return encodeFunctionData({ abi: ownerAbi, functionName });
  if (functionName === 'implementation') {
    return encodeFunctionData({ abi: beaconAbi, functionName });
  }
  return encodeFunctionData({ abi: safeReadAbi, functionName });
}

async function optionalCall(
  adapter: EvmControlReadAdapter,
  target: string,
  data: string,
  blockHash: string,
): Promise<OptionalCall & { endpointId?: string }> {
  try {
    const observation = await adapter.callObservationAtBlockHash(target, data, blockHash);
    return {
      status: 'SUPPORTED',
      raw: observation.value.toLowerCase(),
      endpointId: observation.endpointId,
    };
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'RPC_ERROR' && !error.retryable) {
      return { status: 'UNSUPPORTED' };
    }
    throw error;
  }
}

function decodedAddress(
  abi: typeof ownerAbi | typeof beaconAbi,
  functionName: 'owner' | 'implementation',
  call: OptionalCall,
): string | undefined {
  if (call.status !== 'SUPPORTED' || call.raw === undefined || call.raw === '0x') return undefined;
  try {
    const result = decodeFunctionResult({
      abi,
      functionName,
      data: call.raw as `0x${string}`,
    });
    return typeof result === 'string' && EVM_ADDRESS.test(result)
      ? result.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

function decodeSafe(functionName: 'VERSION' | 'getOwners' | 'getThreshold' | 'nonce', raw: string) {
  try {
    return decodeFunctionResult({
      abi: safeReadAbi,
      functionName,
      data: raw as `0x${string}`,
    });
  } catch {
    return undefined;
  }
}

async function observeSource(
  subject: string,
  adapter: EvmControlReadAdapter,
  snapshot: EvmSnapshot,
  writeEvidence: EvmControlEvidenceWriter,
): Promise<SourceObservation> {
  const endpointIds = new Set<string>();
  const codeObservation = await adapter.getCodeObservationAtBlockHash(subject, snapshot.blockHash);
  endpointIds.add(codeObservation.endpointId);
  const code = codeObservation.value.toLowerCase();
  if (!/^0x(?:[0-9a-f]{2})*$/.test(code)) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM bytecode is malformed.');
  }

  let state: SourceControlState;
  if (code === '0x') {
    state = {
      code,
      codeBytes: 0,
      erc1167Implementation: null,
      eip1967: {
        implementation: { raw: ZERO_WORD, status: 'ZERO' },
        admin: { raw: ZERO_WORD, status: 'ZERO' },
        beacon: { raw: ZERO_WORD, status: 'ZERO' },
        beaconImplementation: { status: 'UNSUPPORTED' },
      },
      owner: { status: 'UNSUPPORTED' },
      safe: { status: 'UNSUPPORTED' },
      logicCode: null,
    };
  } else {
    const [implementationObservation, adminObservation, beaconObservation, singletonObservation] =
      await Promise.all([
        adapter.getStorageObservationAtBlockHash(
          subject,
          EIP1967_IMPLEMENTATION_SLOT,
          snapshot.blockHash,
        ),
        adapter.getStorageObservationAtBlockHash(subject, EIP1967_ADMIN_SLOT, snapshot.blockHash),
        adapter.getStorageObservationAtBlockHash(subject, EIP1967_BEACON_SLOT, snapshot.blockHash),
        adapter.getStorageObservationAtBlockHash(
          subject,
          '0x' + '0'.repeat(64),
          snapshot.blockHash,
        ),
      ]);
    for (const observation of [
      implementationObservation,
      adminObservation,
      beaconObservation,
      singletonObservation,
    ]) {
      endpointIds.add(observation.endpointId);
    }
    const implementation = slotAddress(implementationObservation.value, 'EIP-1967 implementation');
    const admin = slotAddress(adminObservation.value, 'EIP-1967 admin');
    const beacon = slotAddress(beaconObservation.value, 'EIP-1967 beacon');
    let beaconImplementation: SourceControlState['eip1967']['beaconImplementation'] = {
      status: 'UNSUPPORTED',
    };
    if (
      implementation.status === 'ZERO' &&
      beacon.status === 'ADDRESS' &&
      beacon.address !== undefined
    ) {
      const call = await optionalCall(
        adapter,
        beacon.address,
        callData('implementation'),
        snapshot.blockHash,
      );
      if (call.endpointId !== undefined) endpointIds.add(call.endpointId);
      const address = decodedAddress(beaconAbi, 'implementation', call);
      beaconImplementation =
        address === undefined ? { status: 'UNSUPPORTED' } : { ...call, address };
    }

    const ownerCall = await optionalCall(adapter, subject, callData('owner'), snapshot.blockHash);
    if (ownerCall.endpointId !== undefined) endpointIds.add(ownerCall.endpointId);
    const owner = decodedAddress(ownerAbi, 'owner', ownerCall);

    const versionCall = await optionalCall(
      adapter,
      subject,
      callData('VERSION'),
      snapshot.blockHash,
    );
    if (versionCall.endpointId !== undefined) endpointIds.add(versionCall.endpointId);
    const version =
      versionCall.status === 'SUPPORTED' && versionCall.raw !== undefined
        ? decodeSafe('VERSION', versionCall.raw)
        : undefined;
    const singleton = slotAddress(singletonObservation.value, 'Safe singleton');
    let safe: SourceControlState['safe'] = { status: 'UNSUPPORTED' };
    if (
      typeof version === 'string' &&
      version.length > 0 &&
      singleton.status === 'ADDRESS' &&
      singleton.address !== undefined
    ) {
      const descriptor = OFFICIAL_SAFE_IMPLEMENTATIONS.find(
        (item) => item.address === singleton.address && item.version === version,
      );
      if (descriptor === undefined) {
        safe = { status: 'UNREGISTERED', singleton: singleton.address, version };
      } else {
        const [ownersCall, thresholdCall, nonceCall] = await Promise.all([
          optionalCall(adapter, subject, callData('getOwners'), snapshot.blockHash),
          optionalCall(adapter, subject, callData('getThreshold'), snapshot.blockHash),
          optionalCall(adapter, subject, callData('nonce'), snapshot.blockHash),
        ]);
        for (const call of [ownersCall, thresholdCall, nonceCall]) {
          if (call.endpointId !== undefined) endpointIds.add(call.endpointId);
        }
        const ownersRaw =
          ownersCall.status === 'SUPPORTED' && ownersCall.raw !== undefined
            ? decodeSafe('getOwners', ownersCall.raw)
            : undefined;
        const thresholdRaw =
          thresholdCall.status === 'SUPPORTED' && thresholdCall.raw !== undefined
            ? decodeSafe('getThreshold', thresholdCall.raw)
            : undefined;
        const nonceRaw =
          nonceCall.status === 'SUPPORTED' && nonceCall.raw !== undefined
            ? decodeSafe('nonce', nonceCall.raw)
            : undefined;
        if (
          !Array.isArray(ownersRaw) ||
          ownersRaw.length === 0 ||
          ownersRaw.length > 100 ||
          typeof thresholdRaw !== 'bigint' ||
          thresholdRaw < 1n ||
          thresholdRaw > BigInt(ownersRaw.length) ||
          typeof nonceRaw !== 'bigint' ||
          nonceRaw < 0n
        ) {
          throw new ProviderError('INVALID_RESPONSE', 'Registered Safe control state is invalid.');
        }
        const owners = ownersRaw.map((item) => normalizeAddress(String(item), 'Safe owner'));
        if (new Set(owners).size !== owners.length) {
          throw new ProviderError(
            'INVALID_RESPONSE',
            'Registered Safe owner set contains duplicates.',
          );
        }
        safe = {
          status: 'SUPPORTED',
          owners,
          threshold: thresholdRaw.toString(),
          nonce: nonceRaw.toString(),
          implementationAddress: singleton.address,
          implementationVersion: version,
        };
      }
    }

    const erc1167Implementation = detectErc1167Implementation(code);
    let logicTarget: { address: string; relation: EvmLogicCodeRelation } | undefined;
    if (safe.status === 'SUPPORTED' || safe.status === 'UNREGISTERED') {
      logicTarget = {
        address: safe.status === 'SUPPORTED' ? safe.implementationAddress : safe.singleton,
        relation: 'SAFE_SINGLETON',
      };
    } else if (erc1167Implementation !== null) {
      logicTarget = {
        address: erc1167Implementation,
        relation: 'ERC1167_IMPLEMENTATION',
      };
    } else if (implementation.address !== undefined && beacon.address === undefined) {
      logicTarget = {
        address: implementation.address,
        relation: 'EIP1967_IMPLEMENTATION',
      };
    } else if (implementation.address === undefined && beaconImplementation.address !== undefined) {
      logicTarget = {
        address: beaconImplementation.address,
        relation: 'BEACON_IMPLEMENTATION',
      };
    } else if (implementation.address === undefined && beacon.address === undefined) {
      logicTarget = { address: subject, relation: 'SUBJECT' };
    }
    let logicCode: SourceControlState['logicCode'] = null;
    if (logicTarget !== undefined) {
      const observation =
        logicTarget.address === subject
          ? codeObservation
          : await adapter.getCodeObservationAtBlockHash(logicTarget.address, snapshot.blockHash);
      endpointIds.add(observation.endpointId);
      const targetCode = observation.value.toLowerCase();
      if (!/^0x(?:[0-9a-f]{2})*$/.test(targetCode)) {
        throw new ProviderError('INVALID_RESPONSE', 'EVM logic bytecode is malformed.');
      }
      if (targetCode !== '0x') {
        logicCode = {
          ...logicTarget,
          code: targetCode,
          runtimeBytecodeHash: keccak256(targetCode as `0x${string}`),
          runtimeBytecodeBytes: (targetCode.length - 2) / 2,
        };
      }
    }

    state = {
      code,
      codeBytes: (code.length - 2) / 2,
      erc1167Implementation,
      eip1967: { implementation, admin, beacon, beaconImplementation },
      owner:
        owner === undefined
          ? { status: 'UNSUPPORTED' }
          : {
              status: 'SUPPORTED',
              ...(ownerCall.raw === undefined ? {} : { raw: ownerCall.raw }),
              address: owner,
            },
      safe,
      logicCode,
    };
  }

  if (endpointIds.size !== 1) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'One control-state observation must remain bound to one provider endpoint.',
    );
  }
  const sourceId = [...endpointIds][0];
  if (sourceId === undefined)
    throw new ProviderError('INVALID_RESPONSE', 'Provider identity is missing.');
  const evidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'CONTRACT_STATE',
      source: sourceId,
      locator: `evm-control-surface:${subject}@${snapshot.blockHash}`,
      payload: {
        modelVersion: EVM_CONTROL_SURFACE_MODEL_VERSION,
        subject,
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
        state,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary:
        'Canonical block-hash EVM subject/logic code, standard proxy slots, owner interface, and registered Safe surface observation.',
    }),
    [],
    snapshot,
  );
  return { sourceId, snapshot, state, evidence };
}

function mergedSnapshot(reads: readonly ChainAnchorRead[]): EvmSnapshot {
  const snapshots = reads.map((read) => EvmSnapshotSchema.parse(read.snapshot));
  const first = snapshots[0];
  if (first === undefined) throw new Error('At least one EVM control source is required.');
  for (const snapshot of snapshots) {
    if (
      snapshot.finality !== 'finalized' ||
      snapshot.chainId !== first.chainId ||
      snapshot.blockNumber !== first.blockNumber ||
      snapshot.blockHash.toLowerCase() !== first.blockHash.toLowerCase() ||
      snapshot.parentBlockHash?.toLowerCase() !== first.parentBlockHash?.toLowerCase() ||
      snapshot.blockTimestamp !== first.blockTimestamp
    ) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'EVM control sources disagree on the requested finalized Snapshot.',
      );
    }
  }
  const capturedAt = snapshots
    .map((snapshot) => snapshot.capturedAt)
    .sort()
    .at(-1);
  if (capturedAt === undefined) throw new Error('EVM control Snapshot capture time is missing.');
  return EvmSnapshotSchema.parse({
    ...first,
    blockHash: first.blockHash.toLowerCase(),
    ...(first.parentBlockHash === undefined
      ? {}
      : { parentBlockHash: first.parentBlockHash.toLowerCase() }),
    capturedAt,
    providerVersions: Object.assign({}, ...snapshots.map((snapshot) => snapshot.providerVersions)),
    adapterVersions: Object.assign({}, ...snapshots.map((snapshot) => snapshot.adapterVersions)),
    configHash: hashPayload({
      modelVersion: EVM_CONTROL_SURFACE_MODEL_VERSION,
      sourceConfigHashes: snapshots.map((snapshot) => snapshot.configHash).sort(),
    }),
  });
}

function coverage(
  domain: EvmControlCoverageDomain,
  observed: EvmControlCoverage['observed'],
  detail: string,
  evidenceIds: readonly string[],
): EvmControlCoverage {
  return { domain, observed, detail, evidenceIds: [...new Set(evidenceIds)].sort() };
}

function right(options: {
  snapshot: EvmSnapshot;
  subject: string;
  controller: string;
  rightType: EvmControlRight['rightType'];
  scope: string;
  threshold: KnowledgeValue<string>;
  constraints: string[];
  evidenceIds: string[];
}): EvmControlRight {
  const content = {
    chainId: options.snapshot.chainId,
    subject: options.subject,
    controller: options.controller,
    rightType: options.rightType,
    scope: options.scope,
    threshold: options.threshold,
    constraints: options.constraints,
    evidenceIds: [...new Set(options.evidenceIds)].sort(),
    activeFrom: unknownValue(
      'INSUFFICIENT_DATA',
      'Point-in-time inspection does not establish when this right became active.',
    ),
    activeTo: unknownValue(
      'INSUFFICIENT_DATA',
      'Point-in-time inspection does not establish a revocation time.',
    ),
  };
  return {
    id: `cr_${hashPayload({ ...content, snapshotHash: options.snapshot.blockHash }).slice(0, 24)}`,
    ...content,
  };
}

function reportFields(
  state: SourceControlState,
  snapshot: EvmSnapshot,
  subject: string,
  sourceEvidenceIds: string[],
): Pick<
  EvmControlSurfaceReport,
  | 'contractKind'
  | 'implementationAddress'
  | 'proxyAdminAddress'
  | 'beaconAddress'
  | 'ownerAddress'
  | 'safe'
  | 'logicCode'
  | 'rights'
  | 'coverage'
> {
  const eipImplementation = state.eip1967.implementation.address;
  const eipAdmin = state.eip1967.admin.address;
  const beacon = state.eip1967.beacon.address;
  const beaconImplementation = state.eip1967.beaconImplementation.address;
  const isEipProxy = eipImplementation !== undefined || beacon !== undefined;
  const conflictingEipProxy = eipImplementation !== undefined && beacon !== undefined;
  const contractKind =
    state.code === '0x'
      ? knownValue('EOA' as const)
      : state.safe.status === 'SUPPORTED'
        ? knownValue('SAFE_PROXY' as const)
        : state.erc1167Implementation !== null
          ? knownValue('ERC1167_MINIMAL_PROXY' as const)
          : conflictingEipProxy
            ? unknownValue(
                'INSUFFICIENT_DATA',
                'Both EIP-1967 implementation and beacon slots are non-zero.',
              )
            : eipImplementation !== undefined
              ? knownValue('EIP1967_PROXY' as const)
              : beacon !== undefined
                ? knownValue('EIP1967_BEACON_PROXY' as const)
                : knownValue('DIRECT_CONTRACT' as const);
  const implementationAddress =
    state.erc1167Implementation !== null
      ? knownValue(state.erc1167Implementation)
      : eipImplementation !== undefined
        ? knownValue(eipImplementation)
        : beaconImplementation !== undefined
          ? knownValue(beaconImplementation)
          : unknownValue(
              isEipProxy ? 'INSUFFICIENT_DATA' : 'NOT_APPLICABLE',
              isEipProxy
                ? 'The beacon implementation could not be decoded.'
                : 'No supported proxy implementation relation was observed.',
            );
  const proxyAdminAddress =
    isEipProxy && eipAdmin !== undefined
      ? knownValue(eipAdmin)
      : unknownValue(
          isEipProxy ? 'INSUFFICIENT_DATA' : 'NOT_APPLICABLE',
          isEipProxy
            ? 'The EIP-1967 admin slot is zero or non-canonical; UUPS authorization may live in logic.'
            : 'No supported EIP-1967 proxy relation was observed.',
        );
  const beaconAddress =
    beacon === undefined
      ? unknownValue('NOT_APPLICABLE', 'The EIP-1967 beacon slot is zero or non-canonical.')
      : knownValue(beacon);
  const ownerAddress =
    state.owner.status === 'SUPPORTED' && state.owner.address !== undefined
      ? knownValue(state.owner.address)
      : unknownValue(
          'UNSUPPORTED',
          'The subject does not expose a decodable ERC-173-shaped owner().',
        );
  const safe =
    state.safe.status === 'SUPPORTED'
      ? knownValue({
          owners: state.safe.owners,
          threshold: state.safe.threshold,
          nonce: state.safe.nonce,
          implementationAddress: state.safe.implementationAddress,
          implementationVersion: state.safe.implementationVersion,
        })
      : state.safe.status === 'UNREGISTERED'
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'Safe-compatible reads use an implementation outside the official registry.',
          )
        : unknownValue(
            'NOT_APPLICABLE',
            'No registered Safe-compatible control surface was observed.',
          );
  const logicCode =
    state.logicCode === null
      ? unknownValue(
          state.code === '0x' ? 'NOT_APPLICABLE' : 'INSUFFICIENT_DATA',
          state.code === '0x'
            ? 'An EOA has no runtime logic bytecode.'
            : 'A unique non-empty runtime logic target could not be established.',
        )
      : knownValue({
          address: state.logicCode.address,
          relation: state.logicCode.relation,
          runtimeBytecodeHash: state.logicCode.runtimeBytecodeHash,
          runtimeBytecodeBytes: state.logicCode.runtimeBytecodeBytes,
        });

  const rights: EvmControlRight[] = [];
  if (
    state.owner.status === 'SUPPORTED' &&
    state.owner.address !== undefined &&
    state.owner.address !== ZERO_ADDRESS
  ) {
    rights.push(
      right({
        snapshot,
        subject,
        controller: state.owner.address,
        rightType: 'OWNER',
        scope: 'ERC-173-shaped owner interface at the inspected contract address',
        threshold: knownValue('1'),
        constraints: [
          'Point-in-time interface result only; it does not imply every role or complete ownership history.',
        ],
        evidenceIds: sourceEvidenceIds,
      }),
    );
  }
  if (isEipProxy && eipAdmin !== undefined) {
    for (const rightType of ['PROXY_ADMIN', 'UPGRADE'] as const) {
      rights.push(
        right({
          snapshot,
          subject,
          controller: eipAdmin,
          rightType,
          scope: 'EIP-1967 proxy admin slot',
          threshold: knownValue('1'),
          constraints: [
            'Immediate slot controller only; if this address is a contract, its underlying control requires recursive inspection.',
          ],
          evidenceIds: sourceEvidenceIds,
        }),
      );
    }
  }
  if (state.safe.status === 'SUPPORTED') {
    for (const owner of state.safe.owners) {
      rights.push(
        right({
          snapshot,
          subject,
          controller: owner,
          rightType: 'SAFE_OWNER',
          scope: `Registered Safe ${state.safe.implementationVersion} owner set`,
          threshold: knownValue(state.safe.threshold),
          constraints: [
            `Conditional member of a ${state.safe.threshold}-of-${state.safe.owners.length} threshold; this owner does not necessarily act alone.`,
            'Enabled modules, guards, and fallback handlers are separate control paths and remain independently covered.',
          ],
          evidenceIds: sourceEvidenceIds,
        }),
      );
    }
  }
  rights.sort((left, rightItem) => left.id.localeCompare(rightItem.id));

  const observedOwner =
    state.owner.status === 'SUPPORTED' && state.owner.address !== undefined
      ? knownValue(state.owner.address !== ZERO_ADDRESS)
      : unknownValue('UNSUPPORTED', 'No decodable ERC-173-shaped owner() result.');
  const observedSafe =
    state.safe.status === 'SUPPORTED'
      ? knownValue(true)
      : state.safe.status === 'UNREGISTERED'
        ? unknownValue('INSUFFICIENT_DATA', 'Safe-compatible implementation is not registered.')
        : knownValue(false);
  const queried = sourceEvidenceIds;
  const notQueried = (domain: EvmControlCoverageDomain, detail: string) =>
    coverage(domain, unknownValue('NOT_QUERIED', detail), detail, []);
  const coverageItems: EvmControlCoverage[] = [
    coverage(
      'CONTRACT_CODE',
      knownValue(state.code !== '0x'),
      'Canonical bytecode presence.',
      queried,
    ),
    coverage(
      'LOGIC_CODE',
      state.code === '0x'
        ? knownValue(false)
        : state.logicCode === null
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'A unique non-empty runtime logic target was not established.',
            )
          : knownValue(true),
      state.logicCode === null
        ? 'No unique non-empty runtime logic bytecode was established.'
        : `${state.logicCode.relation} runtime bytecode was read at the same canonical block hash.`,
      queried,
    ),
    coverage(
      'ERC1167_IMPLEMENTATION',
      knownValue(state.erc1167Implementation !== null),
      state.erc1167Implementation === null
        ? 'Exact ERC-1167 runtime was not observed.'
        : 'Exact ERC-1167 runtime embeds a fixed implementation address.',
      queried,
    ),
    coverage(
      'EIP1967_IMPLEMENTATION',
      knownValue(eipImplementation !== undefined),
      `EIP-1967 implementation slot status: ${state.eip1967.implementation.status}.`,
      queried,
    ),
    coverage(
      'EIP1967_ADMIN',
      knownValue(eipAdmin !== undefined),
      `EIP-1967 admin slot status: ${state.eip1967.admin.status}.`,
      queried,
    ),
    coverage(
      'EIP1967_BEACON',
      knownValue(beacon !== undefined),
      `EIP-1967 beacon slot status: ${state.eip1967.beacon.status}.`,
      queried,
    ),
    coverage(
      'ERC173_OWNER',
      observedOwner,
      state.owner.address === ZERO_ADDRESS
        ? 'owner() returned the zero address; no OWNER right is emitted, but other roles remain unresolved.'
        : 'ERC-173-shaped owner() was queried at the canonical block hash.',
      queried,
    ),
    coverage(
      'SAFE_OWNERS_THRESHOLD',
      observedSafe,
      state.safe.status === 'SUPPORTED'
        ? 'Registered Safe owners, threshold, nonce, implementation and version were decoded.'
        : 'Registered Safe owner/threshold control was not established.',
      queried,
    ),
    notQueried('SAFE_MODULES', 'Safe module enumeration is not implemented in this control model.'),
    notQueried('SAFE_GUARD', 'Safe transaction and module guard extraction is not implemented.'),
    notQueried('SAFE_FALLBACK_HANDLER', 'Safe fallback-handler extraction is not implemented.'),
    coverage(
      'UPGRADE_AUTHORIZATION',
      isEipProxy && eipAdmin !== undefined
        ? knownValue(true)
        : unknownValue(
            'INSUFFICIENT_DATA',
            state.erc1167Implementation !== null
              ? 'ERC-1167 fixes the redirect address, but target-code mutability and implementation-level authorization were not recursively proven.'
              : 'No direct proxy admin was established; UUPS or custom authorization may still exist.',
          ),
      state.erc1167Implementation !== null
        ? 'ERC-1167 fixes the proxy redirect address; upgrade absence requires recursive implementation and code-history proof.'
        : 'Only standard proxy-slot authorization is covered.',
      queried,
    ),
    notQueried(
      'MINT',
      'Token-specific mint authorization requires verified ABI or role/event history.',
    ),
    notQueried('BURN', 'Token-specific privileged burn authorization requires verified semantics.'),
    notQueried('TAX_CHANGE', 'Tax mutation authorization requires protocol-specific decoding.'),
    notQueried('BLACKLIST', 'Blacklist authorization requires protocol-specific decoding.'),
    notQueried('WHITELIST', 'Whitelist authorization requires protocol-specific decoding.'),
    notQueried(
      'TRADING_SWITCH',
      'Trading-switch authorization requires protocol-specific decoding.',
    ),
    notQueried(
      'MAX_TX',
      'Max-transaction mutation authorization requires protocol-specific decoding.',
    ),
    notQueried(
      'MAX_WALLET',
      'Max-wallet mutation authorization requires protocol-specific decoding.',
    ),
    notQueried('FEE_EXEMPTION', 'Fee-exemption authorization requires protocol-specific decoding.'),
    notQueried(
      'ROUTER_CHANGE',
      'Router mutation authorization requires protocol-specific decoding.',
    ),
    notQueried(
      'TREASURY',
      'Treasury control requires protocol-specific state and custody recursion.',
    ),
    notQueried(
      'LP_POSITION',
      'LP ownership and withdrawal control require position-specific analysis.',
    ),
    notQueried(
      'MIGRATION',
      'Launchpad migration authorization requires verified semantics and current controller state.',
    ),
  ];
  coverageItems.sort((left, rightItem) => left.domain.localeCompare(rightItem.domain));
  if (coverageItems.length !== EvmControlCoverageDomainSchema.options.length) {
    throw new Error('EVM control coverage registry is incomplete.');
  }

  return {
    contractKind,
    implementationAddress,
    proxyAdminAddress,
    beaconAddress,
    ownerAddress,
    safe,
    logicCode,
    rights,
    coverage: coverageItems,
  };
}

const DECLARED_CAPABILITY_NAMES: Readonly<
  Partial<Record<EvmControlRight['rightType'], readonly string[]>>
> = Object.freeze({
  OWNER: ['renounceOwnership', 'transferOwnership'],
  PROXY_ADMIN: ['changeAdmin'],
  UPGRADE: ['upgradeTo', 'upgradeToAndCall'],
  MINT: ['mint', 'mintTo'],
  BURN: ['burn', 'burnFrom'],
  TAX_CHANGE: [
    'setBuyTaxRate',
    'setSellTaxRate',
    'setTaxProcessor',
    'setTaxRate',
    'setTaxes',
    'updateTaxRate',
  ],
  BLACKLIST: ['addToBlacklist', 'blacklist', 'removeFromBlacklist', 'setBlacklist'],
  WHITELIST: ['addToWhitelist', 'removeFromWhitelist', 'setWhitelist'],
  TRADING_SWITCH: ['disableTrading', 'enableTrading', 'openTrading', 'setTradingEnabled'],
  MAX_TX: ['setMaxTransactionAmount', 'setMaxTx', 'setMaxTxAmount'],
  MAX_WALLET: ['setMaxWallet', 'setMaxWalletAmount'],
  FEE_EXEMPTION: ['excludeFromFees', 'includeInFees', 'setFeeExempt'],
  ROUTER_CHANGE: ['setRouter', 'updateRouter'],
  TREASURY: ['setDividendContract', 'setTaxProcessor', 'setTreasury', 'updateTreasury'],
  SAFE_MODULE: ['disableModule', 'enableModule'],
  SAFE_GUARD: ['setGuard'],
  SAFE_FALLBACK_HANDLER: ['setFallbackHandler'],
  LP_POSITION: ['removeLiquidity', 'withdrawLiquidity'],
  MIGRATION: ['finalizeMigration', 'startMigration'],
});

function declaredCapabilities(
  source: EvmVerifiedSource,
  evidenceId: string,
): EvmDeclaredCapability[] {
  const byName = new Map<string, string[]>();
  for (const signature of source.mutatingFunctionSignatures) {
    const name = signature.slice(0, signature.indexOf('('));
    const signatures = byName.get(name) ?? [];
    signatures.push(signature);
    byName.set(name, signatures);
  }
  return Object.entries(DECLARED_CAPABILITY_NAMES)
    .flatMap(([rightType, names]) => {
      const signatures = [...new Set(names.flatMap((name) => byName.get(name) ?? []))].sort();
      return signatures.length === 0
        ? []
        : [
            {
              rightType: rightType as EvmControlRight['rightType'],
              functionSignatures: signatures,
              detail:
                'Exact verified ABI declares this mutation surface; declaration does not establish current authorization, reachability, or successful execution.',
              evidenceIds: [evidenceId],
            },
          ];
    })
    .sort((left, rightItem) => left.rightType.localeCompare(rightItem.rightType));
}

interface VerifiedSourceFields {
  verifiedSource: KnowledgeValue<EvmVerifiedSource>;
  declaredCapabilities: EvmDeclaredCapability[];
  evidence?: Evidence;
}

function sourceFailure(error: unknown): KnowledgeValue<EvmVerifiedSource> {
  if (error instanceof ProviderError && error.code === 'RATE_LIMITED') {
    return unavailableValue('RATE_LIMITED', 'Source-verification provider rate limit exceeded.');
  }
  return unavailableValue(
    'PROVIDER_DOWN',
    error instanceof ProviderError
      ? `Source-verification provider failed with ${error.code}.`
      : 'Source-verification provider failed.',
  );
}

async function inspectVerifiedSource(options: {
  adapter?: EvmSourceVerificationAdapter;
  chainId: number;
  state: SourceControlState;
  snapshot: EvmSnapshot;
  writeEvidence: EvmControlEvidenceWriter;
}): Promise<VerifiedSourceFields> {
  if (options.state.logicCode === null) {
    return {
      verifiedSource: unknownValue(
        options.state.code === '0x' ? 'NOT_APPLICABLE' : 'INSUFFICIENT_DATA',
        options.state.code === '0x'
          ? 'An EOA has no logic bytecode to verify.'
          : 'Source verification requires a unique non-empty logic-code target.',
      ),
      declaredCapabilities: [],
    };
  }
  if (options.adapter === undefined) {
    return {
      verifiedSource: unknownValue(
        'PROVIDER_UNCONFIGURED',
        'No exact source-verification provider is configured.',
      ),
      declaredCapabilities: [],
    };
  }
  let observation: Awaited<ReturnType<EvmSourceVerificationAdapter['verify']>>;
  try {
    observation = await options.adapter.verify(options.chainId, options.state.logicCode.address);
  } catch (error) {
    return { verifiedSource: sourceFailure(error), declaredCapabilities: [] };
  }
  const sourceEvidence = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: options.snapshot.chainId,
      kind: 'PROVIDER_OBSERVATION',
      source: observation.endpointId,
      locator: `source-verification:${options.state.logicCode.address}`,
      sourceUri: observation.value.sourceUri,
      payload: observation.value,
      observedAt: options.snapshot.capturedAt,
      blockOrSlot: options.snapshot.blockNumber,
      finality: options.snapshot.finality,
      summary:
        observation.value.status === 'EXACT_MATCH'
          ? 'Exact source-verification metadata and runtime bytecode observation.'
          : 'Source-verification provider returned no exact runtime match.',
    }),
    [],
    options.snapshot,
  );
  if (observation.value.status !== 'EXACT_MATCH') {
    return {
      verifiedSource: unknownValue('INSUFFICIENT_DATA', observation.value.detail),
      declaredCapabilities: [],
      evidence: sourceEvidence,
    };
  }
  if (
    observation.value.runtimeBytecode !== options.state.logicCode.code ||
    observation.value.runtimeBytecodeHash !== options.state.logicCode.runtimeBytecodeHash ||
    observation.value.runtimeBytecodeBytes !== options.state.logicCode.runtimeBytecodeBytes
  ) {
    return {
      verifiedSource: unknownValue(
        'CONFLICTING_SOURCES',
        'Verified-source runtime bytecode does not equal the Snapshot-bound RPC bytecode.',
      ),
      declaredCapabilities: [],
      evidence: sourceEvidence,
    };
  }
  const match = observation.value as SourcifyExactMatch;
  const verified: EvmVerifiedSource = {
    sourceId: match.sourceId,
    sourceUri: match.sourceUri,
    address: match.address,
    matchType: match.matchType,
    runtimeBytecodeHash: match.runtimeBytecodeHash,
    runtimeBytecodeBytes: match.runtimeBytecodeBytes,
    contractName: match.contractName,
    fullyQualifiedName: match.fullyQualifiedName,
    language: match.language,
    compilerVersion: match.compilerVersion,
    verifiedAt: match.verifiedAt,
    deployment: match.deployment,
    abiFunctionCount: match.abiFunctionCount,
    mutatingFunctionSignatures: match.mutatingFunctionSignatures,
  };
  return {
    verifiedSource: knownValue(verified),
    declaredCapabilities: declaredCapabilities(verified, sourceEvidence.id),
    evidence: sourceEvidence,
  };
}

const CAPABILITY_COVERAGE_DOMAIN: Readonly<
  Partial<Record<EvmControlRight['rightType'], EvmControlCoverageDomain>>
> = Object.freeze({
  UPGRADE: 'UPGRADE_AUTHORIZATION',
  MINT: 'MINT',
  BURN: 'BURN',
  TAX_CHANGE: 'TAX_CHANGE',
  BLACKLIST: 'BLACKLIST',
  WHITELIST: 'WHITELIST',
  TRADING_SWITCH: 'TRADING_SWITCH',
  MAX_TX: 'MAX_TX',
  MAX_WALLET: 'MAX_WALLET',
  FEE_EXEMPTION: 'FEE_EXEMPTION',
  ROUTER_CHANGE: 'ROUTER_CHANGE',
  TREASURY: 'TREASURY',
  SAFE_MODULE: 'SAFE_MODULES',
  SAFE_GUARD: 'SAFE_GUARD',
  SAFE_FALLBACK_HANDLER: 'SAFE_FALLBACK_HANDLER',
  LP_POSITION: 'LP_POSITION',
  MIGRATION: 'MIGRATION',
});

function applyDeclaredCapabilities(
  coverageItems: readonly EvmControlCoverage[],
  capabilities: readonly EvmDeclaredCapability[],
): EvmControlCoverage[] {
  const byDomain = new Map<EvmControlCoverageDomain, EvmDeclaredCapability[]>();
  for (const capability of capabilities) {
    const domain = CAPABILITY_COVERAGE_DOMAIN[capability.rightType];
    if (domain !== undefined) byDomain.set(domain, [...(byDomain.get(domain) ?? []), capability]);
  }
  return coverageItems.map((item) => {
    const matching = byDomain.get(item.domain);
    if (matching === undefined || item.observed.state === 'known') return item;
    const signatures = matching.flatMap((entry) => entry.functionSignatures).sort();
    return coverage(
      item.domain,
      unknownValue(
        'INSUFFICIENT_DATA',
        'A verified mutation surface exists, but its current controller and execution semantics are unresolved.',
      ),
      `Verified ABI declares ${signatures.join(', ')}; current authorization remains Unknown.`,
      matching.flatMap((entry) => entry.evidenceIds),
    );
  });
}

export async function inspectEvmControlSurface(options: {
  subject: string;
  adapters: readonly EvmControlReadAdapter[];
  writeEvidence: EvmControlEvidenceWriter;
  sourceVerificationAdapter?: EvmSourceVerificationAdapter;
  blockNumber?: string;
}): Promise<EvmControlSurfaceReport> {
  const subject = normalizeAddress(options.subject, 'control subject');
  if (options.adapters.length === 0 || options.adapters.length > 8) {
    throw new Error('EVM control inspection requires between one and eight source adapters.');
  }
  const chainId = options.adapters[0]?.config.chainId;
  if (
    chainId === undefined ||
    options.adapters.some((adapter) => adapter.config.chainId !== chainId)
  ) {
    throw new Error('EVM control source adapters must use one chain.');
  }
  let blockNumber = options.blockNumber;
  if (blockNumber === undefined) {
    const heads = await Promise.all(options.adapters.map((adapter) => adapter.createSnapshot()));
    if (heads.some((snapshot) => snapshot.finality !== 'finalized')) {
      throw new ProviderError('INVALID_RESPONSE', 'Control inspection requires finalized sources.');
    }
    blockNumber = heads
      .map((snapshot) => BigInt(snapshot.blockNumber))
      .reduce((minimum, current) => (current < minimum ? current : minimum))
      .toString();
  }
  if (!/^(0|[1-9]\d*)$/.test(blockNumber)) {
    throw new Error('EVM control block number must be an unsigned decimal string.');
  }
  const anchors = await Promise.all(
    options.adapters.map((adapter) => adapter.readAnchorAt(blockNumber)),
  );
  const snapshot = mergedSnapshot(anchors);
  const observations = await Promise.all(
    options.adapters.map((adapter) =>
      observeSource(subject, adapter, snapshot, options.writeEvidence),
    ),
  );
  const sourceIds = observations.map((item) => item.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new ProviderError('INVALID_RESPONSE', 'EVM control source identities must be unique.');
  }
  const state = observations[0]?.state;
  if (state === undefined) throw new Error('EVM control state is missing.');
  if (observations.some((item) => canonicalJson(item.state) !== canonicalJson(state))) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'EVM control sources disagree on code, proxy slots, owner, or Safe state.',
    );
  }
  const evidence = observations.map((item) => item.evidence);
  let sourceIndependence: KnowledgeValue<boolean> = unknownValue(
    'INSUFFICIENT_DATA',
    'No official operator registry is configured for this EVM chain.',
  );
  if (snapshot.chainId === 'eip155:56') {
    const independence = await attestBscSourceIndependence({
      sourceIds,
      snapshot,
      writeEvidence: options.writeEvidence,
    });
    const resolved = independence.assessment.independence;
    sourceIndependence =
      resolved.state === 'known'
        ? knownValue(resolved.value)
        : resolved.state === 'unknown'
          ? unknownValue(resolved.reason, resolved.detail)
          : unavailableValue(resolved.reason, resolved.detail);
    evidence.push(...independence.evidence);
  }
  const sourceEvidenceIds = observations.map((item) => item.evidence.id).sort();
  const verification = await inspectVerifiedSource({
    ...(options.sourceVerificationAdapter === undefined
      ? {}
      : { adapter: options.sourceVerificationAdapter }),
    chainId,
    state,
    snapshot,
    writeEvidence: options.writeEvidence,
  });
  if (verification.evidence !== undefined) evidence.push(verification.evidence);
  const baseFields = reportFields(state, snapshot, subject, sourceEvidenceIds);
  const fields = {
    ...baseFields,
    coverage: applyDeclaredCapabilities(baseFields.coverage, verification.declaredCapabilities),
  };
  const sourceAgreement = knownValue(true);
  const terminalSources = [...new Set(evidence.map((item) => item.id))].sort();
  const terminal = await options.writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: `zerotrace:${EVM_CONTROL_SURFACE_MODEL_VERSION}`,
      locator: `evm-control-surface-report:${subject}@${snapshot.blockHash}`,
      payload: {
        modelVersion: EVM_CONTROL_SURFACE_MODEL_VERSION,
        subject,
        snapshotHash: snapshot.blockHash,
        stateHash: hashPayload(state),
        sourceIds: [...sourceIds].sort(),
        sourceAgreement,
        sourceIndependence,
        logicCode: fields.logicCode,
        verifiedSource: verification.verifiedSource,
        declaredCapabilities: verification.declaredCapabilities,
        rights: fields.rights,
        coverage: fields.coverage,
      },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary:
        'Exact multi-source EVM control surface with explicit unqueried domains and no absence-by-default inference.',
      sourceEvidenceIds: terminalSources,
    }),
    terminalSources,
    snapshot,
  );
  evidence.push(terminal);
  evidence.sort((left, rightItem) => left.id.localeCompare(rightItem.id));
  const evidenceIds = evidence.map((item) => item.id);
  const knownCoverage = fields.coverage.filter((item) => item.observed.state === 'known').length;
  const independent = sourceIndependence.state === 'known' && sourceIndependence.value;
  const metadata = AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: knownCoverage / EvmControlCoverageDomainSchema.options.length,
    sourceCoverage: independent ? 1 : 0.5,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.blockTimestamp ?? snapshot.capturedAt,
    sourceSet: [
      ...new Set([
        ...sourceIds,
        ...(verification.evidence === undefined ? [] : [verification.evidence.source]),
      ]),
    ].sort(),
    modelVersion: EVM_CONTROL_SURFACE_MODEL_VERSION,
    confidence: independent ? 0.99 : sourceIds.length > 1 ? 0.85 : 0.8,
    evidenceIds,
  });
  return EvmControlSurfaceReportSchema.parse({
    ledger: 'EVM',
    chainId: snapshot.chainId,
    subject,
    ...fields,
    verifiedSource: verification.verifiedSource,
    declaredCapabilities: verification.declaredCapabilities,
    sourceAgreement,
    sourceIndependence,
    terminalEvidenceId: terminal.id,
    metadata,
    evidence,
  });
}
