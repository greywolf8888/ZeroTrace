import { test, expect } from '@playwright/test';

test('事实总览与实时状态分离、固定快照保持、键盘可回放且无横向溢出', async ({ page }) => {
  await page.goto('/');
  const dashboard = page.getByLabel('固定快照事实总览');
  await expect(dashboard).toContainText('任务约定报酬');
  await expect(dashboard).toContainText('任务数量口径');
  const pinned = new URL(page.url()).searchParams.get('snapshotRunId');
  expect(pinned).toBeTruthy();
  await expect(page.getByLabel('实时链状态')).toContainText('暂不可用');
  await page.getByRole('button', { name: '暂停实时刷新', exact: true }).click();
  await expect(page.getByLabel('实时链状态')).toContainText('已暂停自动刷新');
  expect(new URL(page.url()).searchParams.get('snapshotRunId')).toBe(pinned);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.locator('.orbit-dash').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  const first = dashboard.locator('.reward-chart svg [role="link"]').first();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tasks\/5042\/.+\?snapshotRunId=browser_test_only/);
  await expect(page.getByRole('region', { name: '结算结果' })).toBeVisible();
});

test('实时来源失败保留旧值说明，新快照须主动选择，不替换当前事实', async ({ page }) => {
  let failed = false;
  const snapshot = {
    chainId: '5042',
    blockNumber: '300',
    blockHash: '0x' + 'a'.repeat(64),
    observedAt: new Date().toISOString(),
    sourceSet: ['TEST_ONLY_LIVE'],
    finality: 'FINALIZED',
  };
  await page.route('**/api/v1/live', (route) =>
    route.fulfill({
      json: {
        chain: {
          state: failed ? 'provider-down' : 'fresh',
          checkedAt: new Date().toISOString(),
          observation: failed ? null : { snapshot, evidence: [] },
          lastSuccessfulObservation: failed ? { snapshot, evidence: [] } : null,
        },
        latestStored: { id: 'TEST_ONLY_NEW_SNAPSHOT', snapshot, expiresAt: '2099-01-01T00:00:00Z' },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByLabel('实时链状态')).toContainText('300');
  await expect(page.getByRole('button', { name: '查看最新快照', exact: true })).toBeVisible();
  const before = page.url();
  failed = true;
  await page.getByRole('button', { name: '刷新链观察', exact: true }).click();
  await expect(page.getByLabel('实时链状态')).toContainText('上次成功区块 300（非当前值）');
  await expect(page.getByLabel('实时链状态')).toContainText('暂不可用');
  expect(page.url()).toBe(before);
});
