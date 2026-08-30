import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type PaperExperimentView,
  type PaperNotificationView,
} from '../generated-api/client.js';
import { zhUserMessage } from '../i18n/zh-CN.js';
import { formatTime, shortId, StatusPill } from './shell/index.js';
import { PaperEmptyState } from './paper-review-view.js';

export function PaperNotificationCenter({ experiment }: { experiment: PaperExperimentView }) {
  const [notifications, setNotifications] = useState<PaperNotificationView[]>([]);
  const [desktopPermission, setDesktopPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const page = await api.paperNotifications(experiment.id, undefined, 200);
    setNotifications(page.records);
  }, [experiment.id]);

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void refresh().catch((cause: unknown) =>
          setError(
            zhUserMessage(cause instanceof Error ? cause.message : cause, '提醒记录读取失败。'),
          ),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const dispatchDesktopNotifications = useCallback(async () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    for (let batch = 0; batch < 5; batch += 1) {
      const claimed = await api.claimPaperDesktopNotifications(experiment.id, 20);
      for (const item of claimed.records) {
        try {
          new Notification(item.record.title, {
            body: `模拟提醒 · ${item.event.chain} · ${shortId(item.event.assetId, 12)} · ${item.event.reasons
              .slice(0, 3)
              .map((reason) => reason.slice(0, 120))
              .join('；')}`,
            tag: item.record.businessKey,
            requireInteraction: item.record.urgency === 'URGENT',
          });
          await api.settlePaperDesktopNotification(experiment.id, item.record.id, {
            leaseToken: item.leaseToken,
            outcome: 'DISPATCHED',
          });
        } catch {
          await api
            .settlePaperDesktopNotification(experiment.id, item.record.id, {
              leaseToken: item.leaseToken,
              outcome: 'FAILED',
              errorCode: 'DESKTOP_NOTIFICATION_API_FAILED',
            })
            .catch(() => undefined);
        }
      }
      if (claimed.records.length < 20) break;
    }
  }, [experiment.id]);

  useEffect(() => {
    if (desktopPermission !== 'granted') return;
    let active = true;
    const run = async () => {
      try {
        await dispatchDesktopNotifications();
        if (active) await refresh();
      } catch (cause) {
        if (active) {
          setError(
            zhUserMessage(
              cause instanceof Error ? cause.message : cause,
              '桌面提醒投递暂时不可用；租约到期后会继续重试。',
            ),
          );
        }
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [desktopPermission, dispatchDesktopNotifications, refresh]);

  const enableDesktopNotifications = async () => {
    if (!('Notification' in window)) {
      setDesktopPermission('unsupported');
      return;
    }
    setDesktopPermission(await Notification.requestPermission());
  };

  const markRead = async (outboxId: string) => {
    try {
      await api.markPaperNotificationRead(experiment.id, outboxId);
      await refresh();
    } catch (cause) {
      setError(
        zhUserMessage(cause instanceof Error ? cause.message : cause, '提醒已读状态保存失败。'),
      );
    }
  };

  return (
    <section className="panel">
      <div className="paper-boundary-note">
        应用内记录与模拟动作同事务生成；桌面“已交给系统”不表示用户已查看。Webhook（网络回调）、Telegram（消息机器人）与邮件未配置时不会伪报送达。
      </div>
      <div className="paper-notification-controls">
        <span>
          桌面权限：
          {desktopPermission === 'granted'
            ? '已允许'
            : desktopPermission === 'denied'
              ? '已拒绝'
              : desktopPermission === 'unsupported'
                ? '当前环境不支持'
                : '尚未请求'}
        </span>
        {desktopPermission === 'default' ? (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void enableDesktopNotifications()}
          >
            启用桌面提醒
          </button>
        ) : null}
      </div>
      {error === undefined ? null : <div className="alert alert-warning">{error}</div>}
      <div className="paper-alert-list">
        {notifications.length === 0 ? (
          <PaperEmptyState>尚无提醒记录，或持久发件箱当前不可用。</PaperEmptyState>
        ) : (
          notifications.map(({ record, channels }) => {
            const inApp = channels.find((item) => item.channel === 'IN_APP');
            const desktop = channels.find((item) => item.channel === 'DESKTOP');
            return (
              <article key={record.id}>
                <div>
                  <strong>{record.title}</strong>
                  <span>{formatTime(record.createdAt)}</span>
                </div>
                <StatusPill status={record.urgency} />
                <span>
                  应用内：
                  {inApp === undefined
                    ? '状态不可用'
                    : inApp.readAt === null
                      ? '已投递、未读'
                      : '已读'}
                </span>
                <span>
                  桌面：
                  {desktop === undefined
                    ? '状态不可用'
                    : desktop.state === 'DISPATCHED'
                      ? '已交给系统'
                      : desktop.state === 'LEASED'
                        ? '投递中'
                        : desktop.lastErrorCode === null
                          ? '待投递'
                          : `等待重试（${desktop.lastErrorCode}）`}
                </span>
                {inApp !== undefined && inApp.readAt === null ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void markRead(record.id)}
                  >
                    标为已读
                  </button>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
