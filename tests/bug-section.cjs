const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');

// Local fixture only: every request is intercepted, nothing reaches a live service.
const html = fs.readFileSync(process.env.MINIAPP_HTML || path.join(__dirname, '..', 'app.html'), 'utf8');
const me = { assignee: 'dro238', assignee_id: 1078092674 };
const tasks = [
  { id: 14, task: 'Login button unresponsive', status: 'Stuck', group_name: 'Operations', is_bug: true, ...me },
  { id: 13, task: 'Card stream missing', status: 'In Progress', group_name: 'Revenue', is_bug: true, ...me },
  { id: 12, task: 'Call the bank', status: 'Stuck', group_name: 'Operations', is_bug: false, ...me },
  { id: 11, task: 'Send David the file', status: 'In Progress', group_name: 'Legal', ...me },
];

test('Bug cards sit under their own header, outside the task list', { timeout: 20000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const context = await browser.newContext({ timezoneId: 'America/Costa_Rica', viewport: { width: 390, height: 844 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://miniapp.test' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.origin === 'https://miniapp.test' && url.pathname === '/tray/alfred-tray.css') return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(__dirname, '..', 'tray', 'alfred-tray.css'), 'utf8') });
      if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:'fixture',initDataUnsafe:{user:{id:1078092674,first_name:'Darren',username:'dro238'}},viewportHeight:844,viewportStableHeight:844,colorScheme:'light',themeParams:{},isFullscreen:false,safeAreaInset:{},contentSafeAreaInset:{},ready(){},expand(){},requestFullscreen(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},BackButton:{onClick(){},show(){},hide(){}}}};` });
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable={create(){return {}}};' });
      if (url.origin === 'https://miniapp.test' && url.pathname === '/api/tasks') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tasks, total: tasks.length, next_cursor: null, can_view_all: true }) });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto('https://miniapp.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof taskFeedState !== 'undefined' && taskFeedState === 'ready');

    // Home counts and lists carry no bug cards.
    assert.equal(await page.locator('#home-stuck-count').innerText(), '1');
    assert.deepEqual((await page.locator('.home-task-name').allTextContents()).sort(), ['Call the bank', 'Send David the file']);
    assert.equal(await page.locator('#section-bugs').isVisible(), false, 'Bug section stays out of Home');
    assert.equal(await page.evaluate(() => allTasks.length), 2);

    // Browse: tasks first, bugs under their own folded header.
    await page.locator('#topnav-week').click();
    assert.deepEqual(await page.locator('#list-41 .task-name').allTextContents(), ['Call the bank', 'Send David the file']);
    assert.equal(await page.locator('#section-bugs').isVisible(), true);
    assert.match((await page.locator('#section-bugs .week-label').innerText()).replace(/\s+/g, ' '), /^Bug cards · 2/);
    assert.equal(await page.locator('#section-bugs').evaluate(node => node.classList.contains('collapsed')), true);
    await page.locator('#section-bugs .week-label').click();
    assert.deepEqual(await page.locator('#list-bugs .task-name').allTextContents(), ['Login button unresponsive', 'Card stream missing']);
    const order = await page.evaluate(() => document.getElementById('section-41').compareDocumentPosition(document.getElementById('section-bugs')) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(order, 'Bug section follows the task sections');

    if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
    await context.close();
  } finally {
    await browser.close();
  }
});
