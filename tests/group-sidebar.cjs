const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');

const html = fs.readFileSync(__dirname + '/../app.html', 'utf8');
const groupName = 'Alfred Tasks Webapp Design & UI | ALF';
const tasks = [
  { id: 1, task: 'Build selected group view', status: 'In Progress', assignee: 'dro238', assignee_id: 1078092674, group_name: groupName },
  { id: 2, task: 'Repair missing group titles', status: 'Stuck', assignee: 'dro238', assignee_id: 1078092674, group_name: groupName },
  { id: 3, task: 'Previous selected task', status: 'Done', assignee: 'dro238', assignee_id: 1078092674, group_name: groupName },
  { id: 4, task: 'Another group task', status: 'In Progress', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Rocstars Strategy & Goals' },
];

test('full group names open a filtered summary view', { timeout: 20000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === 'https://miniapp.test' && url.pathname === '/') {
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      if (url.hostname === 'telegram.org' && url.pathname === '/js/telegram-web-app.js') {
        return route.fulfill({
          contentType: 'application/javascript',
          body: `window.Telegram={WebApp:{initData:'fixture',initDataUnsafe:{user:{id:1078092674,first_name:'Darren',username:'dro238'}},viewportHeight:844,viewportStableHeight:844,colorScheme:'light',themeParams:{},isFullscreen:false,safeAreaInset:{},contentSafeAreaInset:{},ready(){},expand(){},requestFullscreen(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},BackButton:{onClick(){},show(){},hide(){}}}};`,
        });
      }
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('sortable')) {
        return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable={create(){return {}}};' });
      }
      if (url.origin === 'https://miniapp.test' && url.pathname === '/api/tasks') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ tasks, total: tasks.length, next_cursor: null, can_view_all: true }),
        });
      }
      if (url.hostname === 'alfred.ai' || url.hostname === 'banking.crowne-cards.com') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      }
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto('https://miniapp.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof taskFeedState !== 'undefined' && taskFeedState === 'ready');

    await page.locator('#header-sidebar-button').click();
    const names = await page.locator('#sidebar-body .sidebar-group-name').allTextContents();
    assert.ok(names.includes(groupName));
    assert.equal(names.some(name => /^\u2026\d{4}$/.test(name)), false);
    const style = await page.locator('#sidebar-body .sidebar-group-name').filter({ hasText: groupName }).evaluate(node => ({
      whiteSpace: getComputedStyle(node).whiteSpace,
      overflow: getComputedStyle(node).overflow,
    }));
    assert.deepEqual(style, { whiteSpace: 'normal', overflow: 'visible' });

    await page.locator('#sidebar-body .sidebar-group-name').filter({ hasText: groupName }).click();
    assert.equal(await page.locator('#group-overview').isVisible(), true);
    assert.equal(await page.locator('#group-overview-title').innerText(), groupName);
    assert.equal(await page.locator('#group-overview-total').innerText(), '3');
    assert.equal(await page.locator('#group-overview-stuck').innerText(), '1');
    assert.equal(await page.locator('#group-overview-progress').innerText(), '1');
    assert.equal(await page.locator('#group-overview-done').innerText(), '1');
    const visible = await page.locator('#today-view .today-task-row .task-name').allTextContents();
    assert.deepEqual(visible.sort(), ['Build selected group view', 'Repair missing group titles'].sort());
    await context.close();
  } finally {
    await browser.close();
  }
});
