import type { Language } from './i18n.js';

// Translate semantic codes directly. Do not translate fixed report facts or raw evidence.
export const verifierLabels: Record<string, { zh: string; en: string }> = {
  MATCHED: { zh: '匹配', en: 'Matched' },
  MISMATCHED: { zh: '不匹配', en: 'Mismatched' },
  INCONCLUSIVE: { zh: '未知', en: 'Inconclusive' },
  UNSUPPORTED: { zh: '暂不支持', en: 'Unsupported' },
  PASS: { zh: '通过', en: 'Pass' },
  FAIL: { zh: '不符合', en: 'Fail' },
  UNKNOWN: { zh: '未知', en: 'Unknown' },
  NOT_APPLICABLE: { zh: '不适用', en: 'Not applicable' },
  CHAIN: { zh: '网络', en: 'Network' },
  ACQUISITION: { zh: '链数据读取', en: 'Chain data acquisition' },
  TX_SUCCESS: { zh: '交易成功状态', en: 'Transaction success' },
  TRANSACTION_SUCCESS: { zh: '交易成功状态', en: 'Transaction success' },
  SELECTION: { zh: '选定资金转移', en: 'Selected movements' },
  PAYMENT_MOVEMENT: { zh: '可作为付款的资金转移', en: 'Payment movement type' },
  PAYEE: { zh: '收款人', en: 'Payee' },
  PAYER: { zh: '资金付款人', en: 'Movement payer' },
  MOVEMENT_PAYER: { zh: '资金付款人', en: 'Movement payer' },
  AMOUNT: { zh: '金额', en: 'Amount' },
  NOT_BEFORE: { zh: '最早时间', en: 'Not before' },
  DEADLINE: { zh: '截止时间', en: 'Deadline' },
  TRANSFER: { zh: '转移', en: 'Transfer' },
  MINT: { zh: '增发', en: 'Mint' },
  BURN: { zh: '销毁', en: 'Burn' },
  ZERO: { zh: '零值事件', en: 'Zero-value event' },
  SELF: { zh: '自转移', en: 'Self-transfer' },
  NATIVE: { zh: '原生接口', en: 'Native interface' },
  ERC20_MIRRORED: { zh: 'ERC-20镜像接口', en: 'ERC-20 mirrored interface' },
  AMBIGUOUS: { zh: '接口关系不明确', en: 'Ambiguous interface relationship' },
  matched: { zh: '镜像一致', en: 'Mirror matched' },
  absent: { zh: '未观察到镜像', en: 'Mirror not observed' },
  ambiguous: { zh: '镜像匹配不唯一', en: 'Mirror match ambiguous' },
  native_only: { zh: '仅原生接口', en: 'Native interface only' },
  missing: { zh: '镜像缺失', en: 'Mirror missing' },
  conflict: { zh: '镜像冲突', en: 'Mirror conflict' },
};

export function verifierLabel(code: string, language: Language): string {
  return verifierLabels[code]?.[language] ?? code;
}
