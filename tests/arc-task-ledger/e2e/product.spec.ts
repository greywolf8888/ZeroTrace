import { test, expect } from '@playwright/test';
const adapter = '0x73c617e808ed5c7ca41413dfc6ee940ddcbb0b8d';
test('首页加载期间保护输入，初始化完成后任务查询不被覆盖', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/jobs?limit=10', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByLabel('任务编号、任务链接或地址')).toBeDisabled();
  release();
  await page.getByLabel('任务编号、任务链接或地址').fill('19');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('region', { name: '结算结果' })).toContainText('0.99 USDC');
});
test('UX01/03/06/07 输入任务→真实HTTP金额→固定快照新上下文→同报告', async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByLabel('任务编号、任务链接或地址').fill('19');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page).toHaveURL(/tasks\/5042\/.*\/19\?snapshotRunId=/);
  const result = page.getByRole('region', { name: '结算结果' });
  await expect(result).toContainText('0.99 USDC');
  await expect(result).toContainText('0.01 USDC');
  await page.evaluate(() => scrollTo(0, 0));
  for (const amount of ['0.99 USDC', '0.01 USDC']) {
    const box = await result.getByText(amount, { exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  const url = page.url();
  const run = new URL(url).searchParams.get('snapshotRunId')!;
  const before = await (
    await page.request.get(`/api/v1/jobs/5042/${adapter}/19?snapshotRunId=${run}`)
  ).json();
  await page.getByRole('button', { name: '复制固定快照链接' }).click();
  await expect(page.getByText('固定快照任务链接已复制', { exact: true })).toBeVisible();
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto(url);
  await expect(other.getByRole('region', { name: '结算结果' })).toContainText('0.99 USDC');
  const after = await (
    await other.request.get(`/api/v1/jobs/5042/${adapter}/19?snapshotRunId=${run}`)
  ).json();
  expect(after.result).toEqual(before.result);
  expect(after.evidence).toEqual(before.evidence);
  await page.reload();
  await expect(result).toContainText('0.99 USDC');
  await page.getByRole('button', { name: '生成可读结算报告' }).click();
  await expect(page).toHaveURL(/19\/report\?snapshotRunId=/);
  await expect(page.getByRole('heading', { name: '结算报告 · 任务 #19' })).toBeVisible();
  await expect(result).toContainText('0.99 USDC');
  await page.getByRole('button', { name: '核对工作者已观察报酬证据' }).click();
  await expect(page.getByText(/^证据 ev_/).first()).toBeVisible();
  await page.screenshot({
    path: `.agent-state/arc-task-ledger/evidence/product-report-${test.info().project.name}.png`,
    fullPage: true,
  });
  await fresh.close();
});
test('UX02/06 角色、状态筛选及前页刷新保留固定快照', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: '任务 #112', exact: true })).toBeVisible();
  const run = new URL(page.url()).searchParams.get('snapshotRunId');
  await page.reload();
  await expect(page.getByRole('button', { name: '任务 #112', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.getByRole('button', { name: '任务 #8', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('snapshotRunId')).toBe(run);
  await page.getByLabel('角色地址筛选').fill('0x2222222222222222222222222222222222222222');
  await page.getByLabel('地址角色', { exact: true }).selectOption('worker');
  await page.getByLabel('资金状态', { exact: true }).selectOption('CONFIRMED_DIRECT');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page).toHaveURL(/role=worker/);
  await expect(page.getByRole('button', { name: '任务 #19', exact: true })).toBeVisible();
  await expect(page.getByText('查询地址的角色：工作者').first()).toBeVisible();
});
test('UX04/05 具体旧义务清偿和新奖励待领取；未知不转零、过期不暗换', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '任务 #107', exact: true }).click();
  const pending = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '具体待领取与清偿关系' }) });
  await expect(pending).toContainText('具体义务已清偿：0.5 USDC');
  await expect(pending).toContainText('已核验仍未清偿：0.99 USDC');
  await expect(page.getByRole('region', { name: '结算结果' })).toContainText('0.99 USDC');
  await page.goto(`/tasks/5042/${adapter}/8?snapshotRunId=browser_test_only`);
  await expect(page.getByRole('region', { name: '结算结果' })).toContainText('未知：暂无法核验');
  await page.goto(`/tasks/5042/${adapter}/19?snapshotRunId=expired_fixture`);
  await expect(page.getByRole('alert')).toContainText('固定快照已过期');
  expect(new URL(page.url()).searchParams.get('snapshotRunId')).toBe('expired_fixture');
});
test('UX08/09/11 真实消费者、刷新含义、非法链接及手机操作', async ({ page }) => {
  await page.goto('/consumer');
  await page.getByLabel('任务编号、任务链接或地址').fill('19');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('region', { name: '结算结果' })).toContainText('0.99 USDC');
  await expect(page.getByText('独立消费者：真实 HTTP，同一结算结果模型')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载已采集结果' })).toBeVisible();
  await page.goto('/');
  await page.getByLabel('任务编号、任务链接或地址').fill('https://evil.test/bounty/19');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('输入不受支持');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
