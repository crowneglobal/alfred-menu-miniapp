// Local fixture only: no request reaches a live service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
const root = path.resolve(__dirname, '..');
const sdk = `window.Telegram={WebApp:{initData:'fixture',initDataUnsafe:{user:{id:1078092674,first_name:'Darren',username:'dro238'}},viewportHeight:844,viewportStableHeight:844,colorScheme:'light',themeParams:{},isFullscreen:false,safeAreaInset:{},contentSafeAreaInset:{},ready(){},expand(){},requestFullscreen(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},BackButton:{onClick(){},show(){},hide(){}}}};`;

test('Saved tasks show at once, one request refreshes them, and Banking waits its turn', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-mock-keychain', '--no-first-run'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const tasks = [
      { id: 41, task: 'First saved task', status: 'In Progress', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Alfred Tasks' },
      { id: 42, task: 'Second saved task', status: 'To do', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Alfred Tasks' },
    ];
    const state = { feed: [], banking: [], hold: null, errors: [] };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: sdk });
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable={create(){return{destroy(){},option(){}}}};' });
      if (url.hostname === 'alfred.ai') { state.banking.push(Date.now()); return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }); }
      if (url.origin !== 'https://miniapp.test') return route.abort();
      if (url.pathname === '/api/tasks') {
        state.feed.push({ url, at: Date.now() });
        if (state.hold) await state.hold;
        return route.fulfill({ json: { tasks, total: tasks.length, next_cursor: null, can_view_all: true } });
      }
      const file = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
      if (!fs.existsSync(path.join(root, file))) return route.abort();
      return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, file)) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', error => state.errors.push(error.message));
    const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('.week-section .task-row[data-task-id] .task-name')).map(node => node.textContent));

    // First open: nothing saved yet, one request asks for the largest page the server allows.
    await page.goto('https://miniapp.test/');
    await page.waitForFunction(() => taskFeedState === 'ready');
    assert.equal(state.feed.length, 1);
    assert.equal(state.feed[0].url.searchParams.get('limit'), '500');
    assert.deepEqual(await rows(), ['First saved task', 'Second saved task']);
    // Banking has not been asked for while tasks were loading; it follows shortly after.
    assert.equal(state.banking.length ? state.banking[0] >= state.feed[0].at + 1000 : true, true);
    await page.waitForFunction(() => document.getElementById('banking-frame').getAttribute('src') === 'https://alfred.ai/banking/users/sign_in');

    // Second open: the server is held, yet the saved rows are already on screen with editing locked.
    let release; state.hold = new Promise(resolve => { release = resolve; });
    tasks[1].task = 'Second task renamed'; tasks.push({ id: 43, task: 'Brand new task', status: 'To do', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Alfred Tasks' });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.week-section .task-row[data-task-id]').length === 2);
    assert.equal(await page.evaluate(() => taskFeedState), 'loading');
    assert.deepEqual(await rows(), ['First saved task', 'Second saved task']);
    assert.equal(await page.evaluate(() => document.getElementById('banking-frame').hasAttribute('src')), false);
    // Opening Banking loads it straight away without waiting for tasks.
    await page.evaluate(() => switchSection('banking', { remember: false }));
    assert.equal(await page.evaluate(() => document.getElementById('banking-frame').getAttribute('src')), 'https://alfred.ai/banking/users/sign_in');
    await page.evaluate(() => switchSection('planning', { remember: false }));
    release(); state.hold = null;
    await page.waitForFunction(() => taskFeedState === 'ready');
    assert.deepEqual((await rows()).sort(), ['Brand new task', 'First saved task', 'Second task renamed']);

    // Third open while the server fails: saved rows stay, with the error and Retry visible.
    await context.unroute('**/*');
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: sdk });
      if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable={create(){return{destroy(){},option(){}}}};' });
      if (url.hostname === 'alfred.ai') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      if (url.pathname === '/api/tasks') return route.fulfill({ status: 500, json: { detail: 'Fixture failure' } });
      const file = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
      if (url.origin !== 'https://miniapp.test' || !fs.existsSync(path.join(root, file))) return route.abort();
      return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, file)) });
    });
    await page.reload();
    await page.waitForFunction(() => taskFeedState === 'error');
    assert.equal((await rows()).length, 3);
    assert.equal(await page.evaluate(() => document.getElementById('task-feed-retry').hidden), false);
    assert.deepEqual(state.errors, []);
  } finally {
    await browser.close();
  }
});
