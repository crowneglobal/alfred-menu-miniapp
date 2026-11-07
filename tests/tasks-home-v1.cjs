const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');

const html = fs.readFileSync(process.env.MINIAPP_HTML || __dirname + '/../app.html', 'utf8');
const tasks = [
  { id: 11, task: 'Repair missing group titles', status: 'Stuck', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Operations', due_date: new Date().toISOString().slice(0, 10) },
  { id: 10, task: 'Build selected group view', status: 'In Progress', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Revenue' },
  { id: 9, task: 'Review banking launch', status: 'In Progress', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Legal' },
  { id: 8, task: 'Previous completed task', status: 'Done', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Operations' },
];

test('Tasks V1 home uses live task data without removed headings', { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === 'https://miniapp.test' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:'fixture',initDataUnsafe:{user:{id:1078092674,first_name:'Darren',username:'dro238'}},viewportHeight:844,viewportStableHeight:844,colorScheme:'light',themeParams:{},isFullscreen:false,safeAreaInset:{},contentSafeAreaInset:{},ready(){},expand(){},requestFullscreen(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},BackButton:{onClick(){},show(){},hide(){}}}};` });
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable={create(){return {}}};' });
      if (url.origin === 'https://miniapp.test' && url.pathname === '/api/tasks') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tasks, total: tasks.length, next_cursor: null, can_view_all: true }) });
      if (url.hostname === 'alfred.ai') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto('https://miniapp.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof taskFeedState !== 'undefined' && taskFeedState === 'ready');

    assert.equal(await page.locator('#topnav-home').getAttribute('class').then(value => value.includes('active')), true);
    assert.equal(await page.locator('#home-dashboard').isVisible(), true);
    assert.equal(await page.locator('#home-due-count').innerText(), '1');
    assert.equal(await page.locator('#home-stuck-count').innerText(), '1');
    assert.equal(await page.locator('#home-done-count').innerText(), '1');
    assert.deepEqual(await page.locator('.home-department-name').allTextContents(), ['Operations', 'Legal', 'Revenue']);
    assert.deepEqual(await page.locator('.home-task-name').allTextContents(), ['Repair missing group titles', 'Build selected group view', 'Review banking launch']);
    for (const removed of ['Your Work', '42 open tasks', 'Priority Tasks']) assert.equal(await page.getByText(removed, { exact: true }).count(), 0);
    assert.equal(await page.locator('#tray-actions').isVisible(), true);
    assert.equal(await page.locator('#tray-sort-trigger').innerText(), '⇅ Newest first⌄');
    assert.equal(await page.locator('#tray-new-task').innerText(), 'Add task');
    assert.match(await page.locator('#home-date-week-bar').innerText(), /^[A-Z][a-z]{2} \d{1,2} \| W\d{1,2}$/);

    if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
});
