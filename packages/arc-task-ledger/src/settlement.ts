import { hashPayload } from '@zerotrace/evidence';
import { DEPLOYMENT } from './config.js';
import { decodeReceipt, protocolAtoms } from './protocol.js';
import {
  RULE_VERSION,
  amount,
  known,
  unknown,
  type Knowledge,
  type RawMeta,
  type ProtocolEvent,
  type Receipt,
  type SettlementLeg,
  type PendingAccount,
} from './types.js';

export function settlement(
  meta: RawMeta,
  receipts: { receipt: Receipt; evidenceIds: string[] }[],
  configuration?: { feeBps: Knowledge<string>; feeRecipient: string },
): {
  legs: SettlementLeg[];
  cashState: string;
  events: ProtocolEvent[];
  gas: { transactionHash: string; amount: ReturnType<typeof amount> }[];
} {
  const legs: SettlementLeg[] = [];
  const timeline: ProtocolEvent[] = [];
  const gas: { transactionHash: string; amount: ReturnType<typeof amount> }[] = [];
  for (const { receipt, evidenceIds } of receipts) {
    const parsed = decodeReceipt(receipt, evidenceIds);
    const events = parsed.events.filter((e) => e.jobId === meta.jobId);
    if (events.length === 0) continue;
    timeline.push(...events);
    gas.push({
      transactionHash: receipt.transactionHash,
      amount: amount(
        known(
          (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString(),
          evidenceIds,
        ),
      ),
    });
    const jobs = new Set(parsed.events.flatMap((e) => (e.jobId === undefined ? [] : [e.jobId])));
    const requests: {
      role: SettlementLeg['role'];
      kind: SettlementLeg['kind'];
      from: string;
      payee: string;
      expected: Knowledge<string>;
    }[] = [];
    const add = (
      role: SettlementLeg['role'],
      kind: SettlementLeg['kind'],
      from: string,
      payee: string,
      atoms: string | undefined,
    ) =>
      requests.push({
        role,
        kind,
        from: from.toLowerCase(),
        payee: payee.toLowerCase(),
        expected:
          atoms === undefined ? unknown('无法核验该资金段应分配金额。') : known(atoms, evidenceIds),
      });
    const named = (name: string) => events.find((e) => e.name === name);
    const incoming = parsed.movements.filter(
      (m) => m.from === DEPLOYMENT.escrow && m.to === DEPLOYMENT.adapter,
    );
    const fee = named('ProtocolFeePaid');
    if (named('BountyCreated'))
      add('ADAPTER', 'DEPOSIT', meta.poster, DEPLOYMENT.adapter, protocolAtoms(meta.reward));
    if (named('BountyTaken'))
      add(
        'ESCROW',
        'ESCROW_TRANSIT',
        DEPLOYMENT.adapter,
        DEPLOYMENT.escrow,
        protocolAtoms(meta.reward),
      );
    for (const e of events) {
      if (e.name === 'WorkerBondPosted')
        add(
          'ADAPTER',
          'BOND_DEPOSIT',
          String(e.args.worker),
          DEPLOYMENT.adapter,
          protocolAtoms(String(e.args.amount)),
        );
      if (e.name === 'WorkerBondRefunded')
        add(
          'WORKER',
          'BOND_RETURN',
          DEPLOYMENT.adapter,
          String(e.args.worker),
          protocolAtoms(String(e.args.amount)),
        );
      if (e.name === 'WorkerBondForfeited')
        add(
          'POSTER',
          'BOND_FORFEIT',
          DEPLOYMENT.adapter,
          String(e.args.poster),
          protocolAtoms(String(e.args.amount)),
        );
    }
    if (fee)
      add(
        'PROTOCOL',
        'FEE',
        DEPLOYMENT.adapter,
        String(fee.args.recipient),
        protocolAtoms(String(fee.args.amount)),
      );
    const timeout = named('ArbitratorTimeoutClaimed');
    const external = named('ExternalRefundReconciled');
    if (timeout) {
      add(
        'POSTER',
        'TIMEOUT_SHARE',
        DEPLOYMENT.adapter,
        meta.poster,
        protocolAtoms(String(timeout.args.posterAmount)),
      );
      add(
        'WORKER',
        'TIMEOUT_SHARE',
        DEPLOYMENT.adapter,
        meta.assignedProvider,
        protocolAtoms(String(timeout.args.providerAmount)),
      );
    } else if (external) {
      add(
        'POSTER',
        'REFUND',
        DEPLOYMENT.adapter,
        String(external.args.poster),
        protocolAtoms(String(external.args.posterAmount)),
      );
      add(
        'WORKER',
        'REWARD',
        DEPLOYMENT.adapter,
        String(external.args.worker),
        protocolAtoms(String(external.args.workerAmount)),
      );
    } else if (named('BountyCompleted') || named('DisputeResolved')?.args.payProvider === true) {
      const distributable = incoming.length === 1 ? BigInt(incoming[0]!.atomic) : undefined;
      const provenFee =
        distributable !== undefined &&
        configuration?.feeBps.state === 'known' &&
        distributable % 10n ** 12n === 0n
          ? (((distributable / 10n ** 12n) * BigInt(configuration.feeBps.value)) / 10000n) *
            10n ** 12n
          : undefined;
      const feeAtoms = fee
        ? BigInt(protocolAtoms(String(fee.args.amount)))
        : provenFee === 0n
          ? 0n
          : undefined;
      if (!fee)
        add(
          'PROTOCOL',
          'FEE',
          DEPLOYMENT.adapter,
          configuration?.feeRecipient ?? '0x0000000000000000000000000000000000000000',
          feeAtoms?.toString(),
        );
      const net =
        distributable !== undefined &&
        feeAtoms !== undefined &&
        distributable >= feeAtoms &&
        (provenFee === undefined || provenFee === feeAtoms)
          ? (distributable - feeAtoms).toString()
          : undefined;
      add('WORKER', 'REWARD', DEPLOYMENT.adapter, meta.assignedProvider, net);
    } else if (
      named('BountyCancelled') ||
      named('BountyExpired') ||
      named('RejectionFinalized') ||
      named('DisputeResolved')?.args.payProvider === false
    ) {
      add('POSTER', 'REFUND', DEPLOYMENT.adapter, meta.poster, protocolAtoms(meta.reward));
    }
    const parked = events.filter((e) => e.name === 'PayoutParked');
    const consumed = new Set<string>();
    for (const [index, request] of requests.entries()) {
      const peers = requests.filter((r) => r.payee === request.payee && r.from === request.from);
      const expectedValue = request.expected.state === 'known' ? request.expected.value : undefined;
      const candidates =
        expectedValue !== undefined
          ? parsed.movements.filter(
              (m) =>
                m.from === request.from &&
                m.to === request.payee &&
                m.atomic === expectedValue &&
                !consumed.has(m.id),
            )
          : [];
      const parkedCandidates =
        expectedValue !== undefined
          ? parked.filter(
              (e) =>
                String(e.args.payee).toLowerCase() === request.payee &&
                protocolAtoms(String(e.args.amount)) === expectedValue,
            )
          : [];
      const ambiguous =
        jobs.size !== 1 ||
        peers.length !== 1 ||
        candidates.length > 1 ||
        parkedCandidates.length > 1 ||
        (candidates.length === 1 && parkedCandidates.length === 1);
      const usable = !ambiguous && parsed.normalization === 'complete';
      let observed: Knowledge<string> = unknown(
        ambiguous
          ? '同一交易存在任务或角色歧义，禁止重复消费资金证据。'
          : '缺少可唯一归属的系统资金转移。',
      );
      let parkedAmount: Knowledge<string> = unknown('未核验是否进入待领取余额。');
      let attribution: SettlementLeg['attribution'] = ambiguous
        ? 'AMBIGUOUS'
        : 'UNIQUE_EVENT_SEGMENT';
      const obligationIds: string[] = [];
      if (expectedValue === '0' && parsed.normalization === 'complete' && jobs.size === 1) {
        observed =
          candidates.length > 0 || parkedCandidates.length > 0
            ? { state: 'conflict', reason: '协议零分配路径不应产生该支付或停放。', evidenceIds }
            : known('0', evidenceIds);
        parkedAmount = known('0', evidenceIds);
        attribution = 'ZERO_ALLOCATION';
      }
      if (usable && expectedValue !== '0' && candidates.length === 1) {
        observed = known(candidates[0]!.atomic, evidenceIds);
        parkedAmount = known('0', evidenceIds);
        consumed.add(candidates[0]!.id);
        attribution = 'DIRECT';
      }
      if (usable && expectedValue !== '0' && parkedCandidates.length === 1) {
        observed = known('0', evidenceIds);
        parkedAmount = known(protocolAtoms(String(parkedCandidates[0]!.args.amount)), evidenceIds);
        obligationIds.push(parkedObligationId(parkedCandidates[0]!));
      }
      if (parsed.normalization === 'conflict')
        observed = { state: 'conflict', reason: '回执或系统/代币资金事件冲突。', evidenceIds };
      legs.push({
        id: `leg_${hashPayload({ tx: receipt.transactionHash, jobId: meta.jobId, index, rule: RULE_VERSION }).slice(0, 24)}`,
        from: request.from,
        role: request.role,
        kind: request.kind,
        payee: request.payee,
        expectedAmount: amount(request.expected),
        observedAmount: amount(observed),
        parkedAmount: amount(parkedAmount),
        attribution,
        obligationIds,
        evidenceIds,
        ruleVersion: RULE_VERSION,
      });
    }
  }
  const payout = legs.filter(
    (l) => !['DEPOSIT', 'BOND_DEPOSIT', 'ESCROW_TRANSIT'].includes(l.kind),
  );
  const conflict = legs.some((l) => l.observedAmount.atomic.state === 'conflict');
  const direct = payout.some(
    (l) => l.observedAmount.atomic.state === 'known' && BigInt(l.observedAmount.atomic.value) > 0n,
  );
  const parked = payout.some(
    (l) => l.parkedAmount.atomic.state === 'known' && BigInt(l.parkedAmount.atomic.value) > 0n,
  );
  const uncertain = legs.some(
    (l) => l.observedAmount.atomic.state !== 'known' || l.expectedAmount.atomic.state !== 'known',
  );
  const terminal = timeline.some((e) =>
    [
      'BountyCompleted',
      'DisputeResolved',
      'BountyCancelled',
      'BountyExpired',
      'RejectionFinalized',
      'ArbitratorTimeoutClaimed',
      'ExternalRefundReconciled',
    ].includes(e.name),
  );
  const cashState = conflict
    ? 'CONFLICT'
    : uncertain
      ? 'UNKNOWN'
      : direct && parked
        ? 'PARTIAL'
        : parked
          ? 'PARKED'
          : direct
            ? terminal
              ? 'CONFIRMED_DIRECT'
              : 'UNKNOWN'
            : terminal &&
                payout.length > 0 &&
                payout.every((l) => l.attribution === 'ZERO_ALLOCATION')
              ? 'NOT_APPLICABLE'
              : 'NONE_OBSERVED';
  const unique = new Map(timeline.map((e) => [e.id, e]));
  return {
    legs,
    cashState,
    events: [...unique.values()].sort((a, b) =>
      BigInt(a.blockNumber) === BigInt(b.blockNumber)
        ? Number(BigInt(a.logIndex) - BigInt(b.logIndex))
        : BigInt(a.blockNumber) < BigInt(b.blockNumber)
          ? -1
          : 1,
    ),
    gas,
  };
}

export const parkedObligationId = (event: ProtocolEvent): string =>
  `obligation_${hashPayload({ chain: '5042', adapter: DEPLOYMENT.adapter, transactionHash: event.transactionHash, logIndex: event.logIndex, payee: String(event.args.payee).toLowerCase() }).slice(0, 32)}`;

export function sequenceCleared(
  legs: SettlementLeg[],
  cashState: string,
  accounts: PendingAccount[],
): boolean {
  const parked = legs.filter(
    (l) => l.parkedAmount.atomic.state === 'known' && BigInt(l.parkedAmount.atomic.value) > 0n,
  );
  return (
    parked.length > 0 &&
    legs.some((l) => ['REWARD', 'REFUND', 'TIMEOUT_SHARE'].includes(l.kind)) &&
    !['UNKNOWN', 'CONFLICT'].includes(cashState) &&
    parked.every(
      (leg) =>
        leg.obligationIds.length > 0 &&
        leg.obligationIds.every((id) =>
          accounts.some(
            (a) =>
              a.payee === leg.payee &&
              a.history === 'complete' &&
              a.obligations.some((o) => o.id === id && o.status === 'CLEARED_SEQUENCE'),
          ),
        ),
    )
  );
}

export function accountPending(
  payee: string,
  balance: Knowledge<string>,
  receipts: { receipt: Receipt; evidenceIds: string[] }[],
  completeHistory: boolean,
  verifiedOpening: Knowledge<string>,
): PendingAccount {
  let running = verifiedOpening.state === 'known' ? BigInt(verifiedOpening.value) : undefined;
  const outstanding: PendingAccount['obligations'] = [];
  const obligations: PendingAccount['obligations'] = [];
  const seenEvents = new Set<string>();
  const withdrawals: PendingAccount['withdrawals'] = [];
  const allEvidence = new Set<string>();
  let valid = completeHistory && running !== undefined;
  if (receipts.some((r) => r.receipt.transactionIndex === undefined)) valid = false;
  const sorted = [...receipts].sort((a, b) =>
    BigInt(a.receipt.blockNumber) === BigInt(b.receipt.blockNumber)
      ? Number(
          BigInt(a.receipt.transactionIndex ?? '0') - BigInt(b.receipt.transactionIndex ?? '0'),
        )
      : BigInt(a.receipt.blockNumber) < BigInt(b.receipt.blockNumber)
        ? -1
        : 1,
  );
  for (const { receipt, evidenceIds } of sorted) {
    const parsed = decodeReceipt(receipt, evidenceIds);
    for (const e of parsed.events) {
      if (String(e.args.payee).toLowerCase() !== payee.toLowerCase()) continue;
      if (seenEvents.has(e.id)) continue;
      seenEvents.add(e.id);
      if (parsed.normalization !== 'complete') valid = false;
      e.evidenceIds.forEach((id) => allEvidence.add(id));
      if (e.name === 'PayoutParked') {
        if (running !== undefined) running += BigInt(protocolAtoms(String(e.args.amount)));
        if (e.jobId) {
          const obligation: PendingAccount['obligations'][number] = {
            id: parkedObligationId(e),
            jobId: e.jobId,
            transactionHash: e.transactionHash,
            logIndex: e.logIndex,
            amount: amount(known(protocolAtoms(String(e.args.amount)), evidenceIds)),
            status: 'OUTSTANDING',
          };
          obligations.push(obligation);
          outstanding.push(obligation);
        }
      }
      if (e.name === 'WithdrawalClaimed') {
        const atoms = protocolAtoms(String(e.args.amount));
        const transfer = parsed.movements.filter(
          (m) =>
            m.from === DEPLOYMENT.adapter && m.to === payee.toLowerCase() && m.atomic === atoms,
        );
        const claims = parsed.events.filter(
          (x) =>
            x.name === 'WithdrawalClaimed' &&
            String(x.args.payee).toLowerCase() === payee.toLowerCase(),
        );
        const confirmed =
          parsed.normalization === 'complete' && transfer.length === 1 && claims.length === 1;
        withdrawals.push({
          transactionHash: receipt.transactionHash,
          amount: amount(
            confirmed ? known(atoms, evidenceIds) : unknown('提现事件缺少唯一系统转移核验。'),
          ),
          attribution: 'ACCOUNT_ONLY',
          evidenceIds,
          eventId: e.id,
          obligationIds: [],
        });
        if (!confirmed || running === undefined || running !== BigInt(atoms)) {
          valid = false;
          running = undefined;
        } else {
          if (valid) {
            withdrawals.at(-1)!.obligationIds = outstanding.map((o) => o.id);
            outstanding.forEach((o) => {
              o.status = 'CLEARED_SEQUENCE';
              o.clearedBy = e.id;
            });
          }
          outstanding.length = 0;
          running = 0n;
        }
      }
    }
  }
  if (balance.state !== 'known' || running === undefined || running.toString() !== balance.value)
    valid = false;
  if (!valid) {
    obligations.forEach((o) => {
      o.status = 'UNVERIFIED';
      delete o.clearedBy;
    });
    withdrawals.forEach((w) => {
      w.obligationIds = [];
    });
  }
  const jobIds = [...new Set(obligations.map((o) => o.jobId))];
  return {
    payee: payee.toLowerCase(),
    balance: amount(balance),
    history: valid ? 'complete' : 'partial',
    withdrawals,
    obligations,
    sequenceDerivedJobIds: valid
      ? jobIds.filter((id) =>
          obligations.filter((o) => o.jobId === id).every((o) => o.status === 'CLEARED_SEQUENCE'),
        )
      : [],
    evidenceIds: [...allEvidence],
  };
}
