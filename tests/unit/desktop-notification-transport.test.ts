import { describe, expect, it } from 'vitest';

import {
  desktopNotificationPermission,
  detectDesktopNotificationRuntime,
  validateNativeNotificationReceipt,
} from '../../apps/web/src/workspaces/desktop-notification-transport.js';

describe('desktop notification transport boundary', () => {
  it('routes the packaged desktop through the native Tauri command', () => {
    const environment = { desktopToken: 'local-desktop-token' };
    expect(detectDesktopNotificationRuntime(environment)).toBe('TAURI_NATIVE');
    expect(desktopNotificationPermission(environment)).toBe('granted');
  });

  it('keeps the browser Web Notification fallback distinct', () => {
    const notification = { permission: 'denied' } as typeof Notification;
    const environment = { notification };
    expect(detectDesktopNotificationRuntime(environment)).toBe('WEB_NOTIFICATION');
    expect(desktopNotificationPermission(environment)).toBe('denied');
    expect(detectDesktopNotificationRuntime({})).toBe('UNSUPPORTED');
  });

  it('rejects a forged or cross-business native receipt', () => {
    expect(() =>
      validateNativeNotificationReceipt(
        {
          transport: 'TAURI_NOTIFICATION_PLUGIN',
          dispatchConfirmation: 'HANDED_TO_OS_API_NOT_USER_READ_CONFIRMATION',
          businessKey: 'other-key',
        },
        'expected-key',
      ),
    ).toThrow('系统提醒回执与当前业务键不匹配。');
  });
});
