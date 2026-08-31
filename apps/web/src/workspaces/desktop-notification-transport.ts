import { invoke } from '@tauri-apps/api/core';

export type DesktopNotificationRuntime = 'TAURI_NATIVE' | 'WEB_NOTIFICATION' | 'UNSUPPORTED';
export type DesktopNotificationPermission = NotificationPermission | 'unsupported';

export interface DesktopNotificationEnvironment {
  desktopToken?: string;
  notification?: typeof Notification;
}

export interface DesktopNotificationInput {
  title: string;
  body: string;
  businessKey: string;
  urgent: boolean;
}

export interface DesktopNotificationReceipt {
  transport: 'TAURI_NOTIFICATION_PLUGIN' | 'WEB_NOTIFICATION_API';
  dispatchConfirmation: 'HANDED_TO_OS_API_NOT_USER_READ_CONFIRMATION';
  businessKey: string;
}

function browserEnvironment(): DesktopNotificationEnvironment {
  return {
    ...(window.__ZEROTRACE_DESKTOP_TOKEN__ === undefined
      ? {}
      : { desktopToken: window.__ZEROTRACE_DESKTOP_TOKEN__ }),
    ...('Notification' in window ? { notification: window.Notification } : {}),
  };
}

export function detectDesktopNotificationRuntime(
  environment: DesktopNotificationEnvironment = browserEnvironment(),
): DesktopNotificationRuntime {
  if (environment.desktopToken !== undefined && environment.desktopToken.length > 0) {
    return 'TAURI_NATIVE';
  }
  return environment.notification === undefined ? 'UNSUPPORTED' : 'WEB_NOTIFICATION';
}

export function desktopNotificationPermission(
  environment: DesktopNotificationEnvironment = browserEnvironment(),
): DesktopNotificationPermission {
  const runtime = detectDesktopNotificationRuntime(environment);
  if (runtime === 'TAURI_NATIVE') return 'granted';
  if (runtime === 'UNSUPPORTED') return 'unsupported';
  return environment.notification?.permission ?? 'unsupported';
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  const environment = browserEnvironment();
  const runtime = detectDesktopNotificationRuntime(environment);
  if (runtime === 'TAURI_NATIVE') return 'granted';
  if (runtime === 'UNSUPPORTED' || environment.notification === undefined) return 'unsupported';
  return await environment.notification.requestPermission();
}

export function validateNativeNotificationReceipt(
  value: unknown,
  expectedBusinessKey: string,
): DesktopNotificationReceipt {
  if (value === null || typeof value !== 'object') throw new Error('系统提醒回执格式无效。');
  const receipt = value as Partial<DesktopNotificationReceipt>;
  if (
    receipt.transport !== 'TAURI_NOTIFICATION_PLUGIN' ||
    receipt.dispatchConfirmation !== 'HANDED_TO_OS_API_NOT_USER_READ_CONFIRMATION' ||
    receipt.businessKey !== expectedBusinessKey
  ) {
    throw new Error('系统提醒回执与当前业务键不匹配。');
  }
  return receipt as DesktopNotificationReceipt;
}

export async function dispatchDesktopNotification(
  input: DesktopNotificationInput,
): Promise<DesktopNotificationReceipt> {
  const environment = browserEnvironment();
  const runtime = detectDesktopNotificationRuntime(environment);
  if (runtime === 'TAURI_NATIVE') {
    const receipt = await invoke<unknown>('dispatch_os_notification', {
      title: input.title,
      body: input.body,
      businessKey: input.businessKey,
    });
    return validateNativeNotificationReceipt(receipt, input.businessKey);
  }
  if (runtime === 'WEB_NOTIFICATION' && environment.notification?.permission === 'granted') {
    new environment.notification(input.title, {
      body: input.body,
      tag: input.businessKey,
      requireInteraction: input.urgent,
    });
    return {
      transport: 'WEB_NOTIFICATION_API',
      dispatchConfirmation: 'HANDED_TO_OS_API_NOT_USER_READ_CONFIRMATION',
      businessKey: input.businessKey,
    };
  }
  throw new Error('桌面提醒通道未获授权或当前环境不支持。');
}
