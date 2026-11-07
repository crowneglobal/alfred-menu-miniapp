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
    const context = await browser.newContext({ viewport: { width: Number(process.env.TEST_WIDTH || 390), height: 844 } });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === 'https://miniapp.test' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.origin === 'https://miniapp.test' && url.pathname === '/tray/alfred-tray.css') return route.fulfill({ contentType: 'text/css', body: require('fs').readFileSync(require('path').join(__dirname, '..', 'tray', 'alfred-tray.css'), 'utf8') });
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
    assert.equal(await page.locator('#tray-actions').isHidden(), true);
    assert.equal(await page.locator('.atray-pinned').isVisible(), true);
    // Shared tray (962): + creates, compact sort icon, no bottom text search or Add task button.
    assert.equal(await page.locator('#tray-sort-trigger').innerText(), '⇅');
    assert.equal(await page.locator('#tray-sort-trigger').getAttribute('title'), 'Newest first');
    assert.equal(await page.locator('#tray-new-task').count(), 0);
    assert.equal(await page.locator('#tray-search-trigger').count(), 0);
    assert.equal(await page.locator('#tray-create').innerText(), '+');
    assert.equal(await page.locator('#tray-create-menu').isHidden(), true);
    await page.locator('#tray-create').click();
    assert.equal(await page.locator('#tray-actions').isVisible(), true);
    assert.equal(await page.locator('#tray-create-menu').isVisible(), true);
    assert.deepEqual(await page.locator('#tray-create-menu button').allInnerTexts().then(items => items.map(item => item.split('\n')[0])), ['Task', 'Project', 'Goal']);
    await page.locator('#create-option-task').click();
    assert.equal(await page.locator('#modal-overlay').getAttribute('class').then(value => value.includes('open')), true);
    assert.equal(await page.locator('#create-modal-title').innerText(), 'New Task');
    await page.evaluate(() => closeModal());
    await page.evaluate(() => setTrayExpanded(false));
    await page.locator('#sheet-handle').click();
    assert.equal(await page.locator('#sheet-expanded').isVisible(), true);
    assert.equal(await page.locator('#panel-week').getAttribute('class').then(value => value.includes('open')), true);
    await page.locator('#sheet-handle').click();
    assert.equal(await page.locator('#tray-actions').isHidden(), true);
    await page.evaluate(() => setTrayExpanded(true));
    assert.equal(await page.locator('#tray-org').innerText().then(value => value.replace(/\s+/g, ' ').trim()), 'Alfred ▾');
    assert.equal(await page.locator('#assignee-tab-me').isVisible(), true);
    assert.equal(await page.locator('#profile-trigger').isVisible(), true);
    assert.equal(await page.locator('#home-date-week-bar').count(), 0);
    assert.match(await page.locator('#date-week-bar').innerText(), /^[A-Z][a-z]{2} \d{1,2} \| W\d{1,2}$/);
    const tabsBox = await page.locator('#context-tabs').boundingBox();
    const summaryBox = await page.locator('.home-summary').boundingBox();
    assert.ok(summaryBox.y - (tabsBox.y + tabsBox.height) < 28, 'Summary cards close the removed date block');

    if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
});
