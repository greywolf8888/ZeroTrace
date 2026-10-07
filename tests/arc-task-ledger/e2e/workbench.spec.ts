import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('arc-ui-language', 'zh'));
});
const adapter = '0x73c617e808ed5c7ca41413dfc6ee940ddcbb0b8d';
const path = (id: string, report = false) =>
  `/tasks/5042/${adapter}/${id}${report ? '/report' : ''}?snapshotRunId=browser_test_only`;

test('资金边→精确检查器→原始支持记录；键盘和手机视图联动', async ({ page }) => {
  await page.goto(path('19'));
  const body = await (
    await page.request.get(`/api/v1/jobs/5042/${adapter}/19?snapshotRunId=browser_test_only`)
  ).json();
  const reward = body.result.flows.find((f: { kind: string }) => f.kind === 'REWARD');
  if (test.info().project.name === 'arc-mobile')
    await page.getByRole('button', { name: '资金流', exact: true }).click();
  const edge = page.locator(`[data-flow-id="${reward.id}"]`);
  await edge.focus();
  await edge.press('Enter');
  const inspector = page.getByRole('complementary', { name: '资金记录检查器' });
  await expect(inspector).toContainText('工作者 · 奖励');
  await expect(inspector).toContainText('0.99 USDC');
  for (const id of reward.evidenceIds) await expect(inspector).toContainText(id);
  await inspector.getByRole('button', { name: '打开这些支持记录' }).click();
  for (const id of reward.evidenceIds)
    await expect(page.locator(`[id="evidence-${id}"]`)).toHaveAttribute('open', '');
  await expect(page.locator(`[id="evidence-${reward.evidenceIds[0]}"] pre`)).toContainText(
    'transactionHash',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('R1/R2/R3 服务器→详情→报告→consumer同快照金额及限定范围', async ({ page }) => {
  for (const [id, key, expected] of [
    ['19', 'outstanding', '未知：暂无法核验'],
    ['109', 'poster_timeout', '0.5 USDC'],
    ['110', 'worker_claimed', '0.99 USDC'],
  ]) {
    for (const url of [
      path(id!),
      path(id!, true),
      `/consumer?jobId=${id}&snapshotRunId=browser_test_only`,
    ]) {
      await page.goto(url);
      await expect(page.locator(`[data-metric="${key}"]`)).toContainText(expected!);
    }
  }
});

test('补证无法定位明确反馈；重新查询队列不会扫描或暗换快照', async ({ page }) => {
  await page.goto(path('8'));
  await page.getByRole('button', { name: '申请本任务有界补证' }).click();
  await expect(page.getByRole('status').filter({ hasText: '尚不能定位' })).toBeVisible();
  await page.getByRole('button', { name: '查询补证队列状态' }).click();
  await expect(page.getByText('查证结果：仍缺少可定位的证据')).toBeVisible();
  await expect(page.getByText('未启动新的扫描。')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('snapshotRunId')).toBe('browser_test_only');
});

test('固定快照任务导航和角色切换沿用同一服务器金额', async ({ page }) => {
  await page.goto(path('109'));
  const mobile = test.info().project.name === 'arc-mobile';
  await page
    .getByLabel(mobile ? '手机收款角色' : '查看收款角色', { exact: true })
    .selectOption('POSTER');
  await expect(page.locator('[data-metric="poster_timeout"]')).toContainText('0.5 USDC');
  await expect(page.locator('[data-metric="worker_timeout"]')).toHaveCount(0);
  if (!mobile) {
    await page
      .getByRole('navigation', { name: '固定快照任务列表' })
      .getByRole('button', { name: /^任务 #19/ })
      .click();
    await expect(page.getByRole('heading', { name: '任务 #19', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('snapshotRunId')).toBe('browser_test_only');
  }
});

test('1440、1280与手机实际截图；状态、长地址与200%缩放不裁切', async ({ page }) => {
  const sizes =
    test.info().project.name === 'arc-mobile'
      ? [[390, 844]]
      : [
          [1440, 900],
          [1280, 800],
        ];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width: width!, height: height! });
    for (const id of ['19', '104', '8', '108']) {
      await page.goto(path(id));
      await expect(page.getByRole('region', { name: '结算结果' })).toBeVisible();
      if (id === '19' && width! >= 1280) {
        const graph = await page.locator('.flow-graph').boundingBox();
        expect(graph).not.toBeNull();
        expect(graph!.y + graph!.height).toBeLessThanOrEqual(height!);
      }
      await page.screenshot({
        path: `.agent-state/arc-task-ledger/neon-ui-20261006/ui-${id}-${width}x${height}.png`,
        fullPage: false,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.goto(path('19'));
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
