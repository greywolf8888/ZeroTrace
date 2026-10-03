import { test, expect } from '@playwright/test';
test('列表、详情、原始证据与导出闭环', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Arc 任务证据台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '任务 #8', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '任务 #8', exact: true }).click();
  await expect(page.getByRole('heading', { name: '任务 #8', exact: true })).toBeVisible();
  await expect(page.getByText('当前历史不足，暂无法核验资金腿。')).toBeVisible();
  await page.getByRole('button', { name: '查看原始证据', exact: true }).click();
  await page.getByText(/^证据 ev_/).click();
  await expect(
    page.locator('pre').filter({ hasText: 'window.__unsafeExecuted' }).last(),
  ).toContainText('<script>');
  expect(await page.evaluate(() => Reflect.get(window, '__unsafeExecuted'))).toBeUndefined();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出证据 JSON' }).click();
  expect((await download).suggestedFilename()).toBe('arc-task-8.json');
  await page.screenshot({
    path: `.agent-state/arc-task-ledger/evidence/detail-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('固定快照分页、筛选、错误与覆盖', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '任务 #8', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: '任务 #112', exact: true })).toBeVisible();
  await page.getByLabel('角色地址筛选').fill('0x1111111111111111111111111111111111111111');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('button', { name: '任务 #8', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看覆盖与来源' }).click();
  await expect(page.getByRole('heading', { name: '数据覆盖与运行状态' })).toBeVisible();
  await expect(
    page.getByText('完整当前状态不表示完整历史；存储回放不表示实时在线核验。'),
  ).toBeVisible();
  await page.getByLabel('角色地址筛选').fill('invalid');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('地址格式不合法');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `.agent-state/arc-task-ledger/evidence/list-${test.info().project.name}.png`,
    fullPage: true,
  });
});
