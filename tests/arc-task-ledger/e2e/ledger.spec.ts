import { test, expect } from '@playwright/test';
test('声明窗口、连续水位和缺口显示，不冒充部署全历史', async ({ page }) => {
  await page.goto('/');
  await page.getByText('高级：连续历史范围与覆盖缺口', { exact: true }).click();
  const range = page.getByRole('region', { name: '连续历史范围' });
  await expect(range).toContainText('21153191–21153193');
  await expect(range).toContainText('连续核验至 21153192');
  await expect(range).toContainText('未核验区间 21153193–21153193');
  await expect(range).toContainText('窗口之前的历史未覆盖');
  await expect(page.getByText('本地测试样例，不是主网证据。')).toBeVisible();
});
test('正向资金展示：奖励、待领取、争议胜诉、零分配与原始回执', async ({ page }) => {
  for (const [id, state] of [
    ['19', '已核验直接转移'],
    ['104', '部分直接转移，部分待领取'],
    ['105', '裁定工作者胜'],
    ['106', '外部退款已协调'],
  ]) {
    await page.goto('/');
    await expect(page.getByText('本地测试样例，不是主网证据。')).toBeVisible();
    await page.getByRole('button', { name: `任务 #${id}`, exact: true }).click();
    await expect(page.getByText(state).first()).toBeVisible();
    const funds = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '资金分配明细' }) });
    if (id === '106') {
      await expect(funds).toContainText('应分配：0 USDC');
      await expect(funds).toContainText('已核验零分配');
      await expect(funds).toContainText('观察到转移：1 USDC');
    } else {
      await expect(funds).toContainText('工作者 · 奖励');
      await expect(funds).toContainText(
        id === '104' ? '曾转入待领取：0.99 USDC' : '观察到转移：0.99 USDC',
      );
    }
    await page.getByText('证据与高级信息', { exact: true }).click();
    await page.getByRole('button', { name: '查看原始证据', exact: true }).click();
    await page.getByText(/^证据 ev_/).click();
    await expect(page.locator('pre').filter({ hasText: 'transactionHash' }).last()).toContainText(
      'logs',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
test('列表、详情、原始证据与导出闭环', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Arc 任务证据台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '任务 #8', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '任务 #8', exact: true }).click();
  await expect(page.getByRole('heading', { name: '任务 #8', exact: true })).toBeVisible();
  await expect(page.getByText('当前历史不足，暂无法核验资金分配。')).toBeVisible();
  await page.getByText('证据与高级信息', { exact: true }).click();
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
  await expect(page.getByText('数据覆盖与运行状态', { exact: true })).toBeVisible();
  await expect(
    page.getByText('完整当前状态不表示完整历史；存储回放不表示实时在线核验。'),
  ).toBeVisible();
  await page.getByLabel('角色地址筛选').fill('invalid');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('输入不受支持');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `.agent-state/arc-task-ledger/evidence/list-${test.info().project.name}.png`,
    fullPage: true,
  });
});
