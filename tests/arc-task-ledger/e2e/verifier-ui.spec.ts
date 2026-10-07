import { test, expect } from '@playwright/test';
import { TX, WORKER } from '../fixtures/helpers.js';
test('任务条件读取失败清除旧资金段，字段错误可定位且不会发起核验', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ArcBounty task mode', exact: true }).click();
  const taskInput = page.getByLabel('Supported task ID or ArcBounty mainnet task link');
  await taskInput.fill('19');
  await page.getByRole('button', { name: 'Read fixed task conditions', exact: true }).click();
  await expect(
    page.locator('.verifier-task-chooser').getByText('Task #19', { exact: false }),
  ).toBeVisible();
  await taskInput.fill('not-a-task');
  await page.getByRole('button', { name: 'Read fixed task conditions', exact: true }).click();
  await expect(page.locator('.verifier-task-chooser').getByRole('alert')).toBeVisible();
  await expect(
    page.locator('.verifier-task-chooser').getByRole('button', { name: /Verify this leg/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Transaction verification', exact: true }).click();
  await page.getByLabel('Transaction hash or official explorer link').fill(TX);
  await page.getByRole('button', { name: 'Read transaction', exact: true }).click();
  await expect(page).toHaveURL(/report=zasv_/);
  await page.getByLabel('Expected payee', { exact: true }).fill('bad');
  await expect(page.getByLabel('Expected payee', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByText('Enter the full 0x payee address.', { exact: true })).toBeVisible();
  await page.getByLabel('Amount / minimum (USDC, up to 18 decimals)', { exact: true }).fill('1e2');
  await expect(
    page.getByText('Enter a nonnegative amount with up to 18 decimals.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Compare conditions', exact: true }),
  ).toBeDisabled();
});
test('默认英文、全局切换与跨页面刷新持久化', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Verify an Arc USDC settlement' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task list', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('link', { name: '任务列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '任务 #8', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task list', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Task #8', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task #8', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('读取、精确金额核对、不可覆盖报告、草稿提示、证据对话框及打印', async ({ page, isMobile }) => {
  await page.goto('/');
  await page.getByLabel('Transaction hash or official explorer link').fill(TX);
  await page.getByRole('button', { name: 'Read transaction', exact: true }).click();
  await expect(page).toHaveURL(/report=zasv_/);
  await page.getByLabel('Expected payee', { exact: true }).fill(WORKER);
  await page.getByLabel('Amount / minimum (USDC, up to 18 decimals)', { exact: true }).fill('1');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Compare conditions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Condition outcome: Matched' })).toBeVisible();
  const frozen = page.url();
  const exported = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export raw bundle', exact: true }).click();
  const bundlePath = await (await exported).path();
  expect(bundlePath).not.toBeNull();
  await page
    .getByLabel('Replay bundle offline (processed locally)', { exact: true })
    .setInputFiles(bundlePath!);
  await expect(
    page.getByRole('status').filter({ hasText: 'Integrity and raw recomputation passed' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Inspect selected amount evidence' }).click();
  await expect(page.getByRole('dialog').locator('pre')).toContainText('mirrorLogIds');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /Checks and evidence/ }).click();
  const amount = page
    .locator('.verification-check')
    .filter({ has: page.getByText('Amount', { exact: true }) });
  await expect(amount).toContainText('1 USDC');
  await page.getByRole('button', { name: 'Inspect evidence', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('pre')).toContainText('CHAIN');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit conditions for a new version' }).click();
  await page.getByLabel('Amount / minimum (USDC, up to 18 decimals)', { exact: true }).fill('2');
  await expect(page.getByRole('status').filter({ hasText: 'Draft changed' })).toBeVisible();
  expect(page.url()).toBe(frozen);
  if (isMobile) await expect(page.locator('.verification-flow-desktop')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.verification-check').first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.screenshot({
    path:
      '.agent-state/arc-task-ledger/ui-repair-20261007/' + test.info().project.name + '-draft.png',
    fullPage: true,
  });
});
test('公开报告权限：阅览者可导出，不能在线重查或公开分享', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByLabel('Transaction hash or official explorer link').fill(TX);
  await page.getByRole('button', { name: 'Read transaction', exact: true }).click();
  await expect(page).toHaveURL(/report=zasv_/);
  await page.getByLabel('Expected payee', { exact: true }).fill(WORKER);
  await page.getByLabel('Amount / minimum (USDC, up to 18 decimals)', { exact: true }).fill('1');
  await page.getByRole('checkbox').first().check();
  await page
    .getByLabel('Deadline (optional, UTC)', { exact: true })
    .fill(
      test.info().project.name === 'arc-mobile' ? '2030-01-01T00:00:02' : '2030-01-01T00:00:01',
    );
  await page.getByRole('button', { name: 'Compare conditions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Condition outcome: Matched' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview public sharing' }).click();
  await expect(page.getByRole('region', { name: 'Full public sharing preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm publication of this fixed version' }).click();
  await expect(page.getByText('Public', { exact: true }).first()).toBeVisible();
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto(page.url());
  await expect(other.getByRole('heading', { name: /Condition outcome:/ })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Requery chain', exact: true })).toHaveCount(0);
  await expect(
    other.getByRole('button', { name: 'Preview public sharing', exact: true }),
  ).toHaveCount(0);
  await expect(other.getByRole('link', { name: 'Export raw bundle', exact: true })).toBeVisible();
  await fresh.close();
});
