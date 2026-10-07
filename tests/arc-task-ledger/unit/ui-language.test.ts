import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  initialLanguage,
  translateText,
  LANGUAGE_KEY,
} from '../../../apps/arc-task-ledger-web/src/i18n.js';
import { checkValue } from '../../../apps/arc-task-ledger-web/src/VerificationReport.js';
import type { SettlementCheck } from '../../../packages/arc-task-ledger/src/verifier-core.js';
import {
  verifierLabel,
  verifierLabels,
} from '../../../apps/arc-task-ledger-web/src/verifier-labels.js';
afterEach(() => vi.unstubAllGlobals());
describe('界面语言边界与准确金额展示', () => {
  it('无偏好、无效偏好及存储不可用时均默认英文，只有明确中文偏好使用中文', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        expect(key).toBe(LANGUAGE_KEY);
        return null;
      },
    });
    expect(initialLanguage()).toBe('en');
    vi.stubGlobal('localStorage', { getItem: () => 'invalid' });
    expect(initialLanguage()).toBe('en');
    vi.stubGlobal('localStorage', { getItem: () => 'zh' });
    expect(initialLanguage()).toBe('zh');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Error('blocked');
      },
    });
    expect(initialLanguage()).toBe('en');
  });
  it('源标识及非文本对象保留；界面文案按全局语言选择', () => {
    const raw = { state: '未知', hash: '0xabc' };
    expect(translateText(raw, 'en')).toBe(raw);
    expect(translateText('任务列表', 'en')).toBe('Task list');
    expect(translateText('任务列表', 'zh')).toBe('任务列表');
    expect(translateText('0xabc', 'en')).toBe('0xabc');
  });
  it('核验金额保留18位精度，范围及零值保持准确，缺失不转零', () => {
    const c = { code: 'AMOUNT' } as SettlementCheck;
    expect(checkValue(c, '98743570043781435381')).toBe('98.743570043781435381 USDC');
    expect(checkValue(c, { min: '1', max: '2' })).toBe(
      '0.000000000000000001 – 0.000000000000000002 USDC',
    );
    expect(checkValue(c, '0')).toBe('0 USDC');
    expect(checkValue(c, null)).toBe('Not specified');
  });
  it('报告结论、检查、资金类型与镜像状态直接按语言显示，未知代码保持原样', () => {
    expect(verifierLabel('MATCHED', 'en')).toBe('Matched');
    expect(verifierLabel('MISMATCHED', 'en')).toBe('Mismatched');
    expect(verifierLabel('INCONCLUSIVE', 'en')).toBe('Inconclusive');
    expect(verifierLabel('UNSUPPORTED', 'en')).toBe('Unsupported');
    for (const code of Object.keys(verifierLabels)) {
      expect(verifierLabel(code, 'en')).not.toMatch(/[\u3400-\u9fff]/u);
      expect(verifierLabel(code, 'zh')).toMatch(/[\u3400-\u9fff]/u);
    }
    expect(verifierLabel('future-protocol-code', 'en')).toBe('future-protocol-code');
    expect(verifierLabel('future-protocol-code', 'zh')).toBe('future-protocol-code');
  });
});
