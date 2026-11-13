const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
const root = path.resolve(__dirname, '..');
const evidence = process.env.EVIDENCE_DIR || '/Users/alfredo/.openclaw/workspace/evidence/overnight-1A/tasks-shared-views';
const sdk = `window.Telegram={WebApp:{initData:'fixture',initDataUnsafe:{user:{id:1078092674,first_name:'Darren',username:'dro238'}},viewportHeight:844,viewportStableHeight:844,colorScheme:'light',themeParams:{},isFullscreen:false,safeAreaInset:{},contentSafeAreaInset:{},ready(){},expand(){},requestFullscreen(){},isVersionAtLeast(){return true},setHeaderColor(){},setBackgroundColor(){},onEvent(){},BackButton:{onClick(){},show(){},hide(){}}}};`;
const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
async function fixture(width = 1200, legacyMarkup = false) {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const now = new Date(); const later = new Date(now.getFullYear(), now.getMonth() + 2, 15);
  const tasks = [
    { id: 41, task: 'Repair WhatsApp edit sync', status: 'Stuck', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Alfred Walf', due_date: dateKey(now), source_url: 'https://t.me/c/2167535790/1/999' },
    { id: 42, task: 'Sort conversations by recent activity', status: 'To do', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Alfred Walf', due_date: dateKey(later) },
    { id: 43, task: 'Keep completed request history', status: 'Done', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Alfred Walf' },
    { id: 44, task: 'Review task views', status: 'In Progress', assignee: 'dro238', assignee_id: 1078092674, group_name: 'Alfred Tasks', due_date: dateKey(now), source_url: 'javascript:alert(1)' },
    { id: 45, task: 'Another owner private task', status: 'Stuck', assignee: 'Fiorella', assignee_id: 6623841750, group_name: 'Alfred Walf' },
  ];
  const state = { failPatch: false, patches: [], requests: [], errors: [] };
  await context.addInitScript(() => { localStorage.setItem('alfred-dark-mode', 'false'); localStorage.setItem('alfred-rocstar-goals', '[{"id":"saved-goal","name":"Existing goal","status":"progress"}]'); });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: sdk });
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable={create(element,options){element._sortableOptions=options;return{destroy(){},option(){}}}};' });
    if (url.origin === 'https://miniapp.test') {
      if (url.pathname === '/api/tasks' && request.method() === 'GET') { state.requests.push(request.url()); return route.fulfill({ json: { tasks, total: tasks.length, next_cursor: null, can_view_all: true } }); }
      if (/^\/api\/tasks\/\d+\/state$/.test(url.pathname) && request.method() === 'PATCH') {
        const body = request.postDataJSON(); state.patches.push({ path: url.pathname, body, headers: request.headers() });
        if (state.failPatch) return route.fulfill({ status: 500, json: { detail: 'Fixture failure' } });
        tasks.find(task => task.id === Number(url.pathname.split('/')[3])).status = body.status;
        return route.fulfill({ json: { ok: true } });
      }
      const file = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
      if (['app.html', 'task-views.css', 'task-views.js', 'tray/alfred-tray.css'].includes(file)) return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: legacyMarkup && file === 'app.html' ? fs.readFileSync(path.join(root, file), 'utf8').replace(/<section id="shared-task-insights"[^>]*><\/section>/, '').replace(/<button[^>]*data-task-layout="(?:overview|gantt|timeline|workflow|dashboard)"[^>]*>[^<]*<\/button>/g, '') : fs.readFileSync(path.join(root, file), 'utf8') });
    }
    if (url.hostname === 'alfred.ai') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(3000);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.goto('https://miniapp.test/');
  await page.waitForFunction(() => typeof taskFeedState !== 'undefined' && taskFeedState === 'ready');
  return { browser, page, state, tasks, now, later };
}
const ids = async locator => (await locator.evaluateAll(items => items.map(item => item.dataset.taskId))).sort();

test('All eight task views share filters, real due dates, guarded status saves and existing task details', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture();
  try {
    await page.locator('#topnav-week').click();
    assert.equal(await page.locator('button[data-task-layout]').count(), 8);
    await page.locator('button[data-task-layout="overview"]').click();
    assert.equal(await page.locator('[data-metric="total"] strong').textContent(), '4');
    assert.equal(await page.locator('[data-metric="done"] strong').textContent(), '1');
    assert.equal(await page.locator('.week-section').first().isVisible(), false);
    await page.locator('button[data-task-layout="dashboard"]').click();
    assert.equal(await page.locator('.task-dashboard-completion').textContent(), '25% complete');
    assert.equal(await page.locator('[data-metric="undated"] strong').textContent(), '1');
    await page.evaluate(() => { activeGroupFilter = 'Alfred Walf'; searchQuery = 'edit sync'; applyAllFilters(); });
    assert.equal(await page.locator('[data-metric="total"] strong').textContent(), '1');
    assert.equal(await page.locator('#group-overview').isHidden(), true);
    assert.equal(await page.locator('[data-metric="done"] strong').textContent(), '0');
    await page.locator('button[data-task-layout="gantt"]').click();
    assert.deepEqual(await ids(page.locator('.task-gantt-row[data-task-id]')), ['41']);
    assert.equal(await page.locator('.task-gantt-milestone').getAttribute('aria-label').then(x => x.includes('Repair WhatsApp edit sync')), true);
    await page.locator('.task-gantt-milestone').click();
    assert.equal(await page.locator('#detail-title').textContent(), 'Repair WhatsApp edit sync');
    await page.locator('#detail-close').click();
    await page.locator('button[data-task-layout="timeline"]').click();
    assert.deepEqual(await ids(page.locator('.task-timeline-day [data-task-id]')), ['41']);
    await page.evaluate(() => { activeGroupFilter = ''; searchQuery = ''; applyAllFilters(); });
    assert.deepEqual(await ids(page.locator('.task-timeline-day [data-task-id]')), ['41', '44']);
    assert.deepEqual(await ids(page.locator('.task-view-undated [data-task-id]')), ['43']);
    await page.getByRole('button', { name: 'Next month', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Next month');
    await page.keyboard.press('Enter');
    assert.deepEqual(await ids(page.locator('.task-timeline-day [data-task-id]')), ['42']);
    await page.locator('button[data-task-layout="gantt"]').click();
    assert.deepEqual(await ids(page.locator('.task-gantt-row[data-task-id]')), ['42']);
    await page.getByRole('button', { name: 'Current month', exact: true }).click();
    assert.deepEqual(await ids(page.locator('.task-gantt-row[data-task-id]')), ['41', '44']);
    await page.locator('button[data-task-layout="workflow"]').click();
    assert.deepEqual(await ids(page.locator('#shared-task-insights .shared-task-card')), ['41', '42', '43', '44']);
    state.failPatch = true;
    await page.locator('#shared-task-insights [data-task-id="42"] select').selectOption('done');
    await page.getByText('Could not save the task status. Your previous status is unchanged.').waitFor();
    assert.equal(await page.locator('.task-workflow-stage[data-status="todo"] [data-task-id="42"]').count(), 1);
    state.failPatch = false;
    await page.locator('#shared-task-insights [data-task-id="42"] select').selectOption('done');
    await page.locator('.task-workflow-stage[data-status="done"] [data-task-id="42"]').waitFor();
    assert.equal(state.patches.at(-1).headers['x-telegram-init-data'], 'fixture');
    await page.locator('button[data-task-layout="dashboard"]').click();
    assert.equal(await page.locator('.task-dashboard-completion').textContent(), '50% complete');
    await page.locator('button[data-task-layout="list"]').click();
    assert.equal(await page.locator('#list-42 .task-row[data-task-id="42"]').count(), 1);
    await page.locator('button[data-task-layout="dashboard"]').click();
    await page.evaluate(() => { searchQuery = 'zero matching tasks'; applyAllFilters(); });
    assert.equal(await page.locator('[data-metric="total"] strong').textContent(), '0');
    assert.equal(await page.locator('.task-dashboard-completion').textContent(), '0% complete');
    await page.evaluate(() => { taskFeedState = 'error'; AlfredTaskViews.render(); });
    assert.equal(await page.locator('#shared-task-insights').innerText().then(x => x.includes('Task feed unavailable.')), true);
    assert.equal(await page.locator('[data-metric]').count(), 0);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test('New task views fit phones and leave Home and Today intact', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture(390);
  try {
    await page.locator('#topnav-week').click();
    const output = path.join(evidence, 'eight-views'); fs.mkdirSync(output, { recursive: true });
    for (const view of ['overview', 'gantt', 'timeline', 'workflow', 'dashboard']) {
      await page.locator('button[data-task-layout="' + view + '"]').click();
      assert.equal(await page.locator('#shared-task-insights').getAttribute('data-view'), view);
      assert.equal(await page.locator('button[data-task-layout="' + view + '"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, view + ' overflows phone');
      assert.equal(await page.locator('#task-layout-count').textContent(), '4 tasks');
      await page.screenshot({ path: path.join(output, view + '-mobile.png'), fullPage: false });
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    for (const view of ['gantt', 'dashboard']) {
      await page.locator('button[data-task-layout="' + view + '"]').click();
      await page.screenshot({ path: path.join(output, view + '-desktop.png'), fullPage: false });
    }
    await page.locator('#topnav-home').click();
    assert.equal(await page.locator('#shared-task-insights').isHidden(), true);
    assert.equal(await page.locator('#home-dashboard').isVisible(), true);
    await page.locator('#topnav-pending').click();
    assert.equal(await page.locator('#shared-task-insights').isHidden(), true);
    assert.equal(await page.locator('#today-view').isVisible(), true);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test('List, Kanban and Calendar share authenticated tasks and filters; state saves persist or stay unchanged', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture();
  try {
    assert.equal(await page.locator('#home-dashboard').isVisible(), true);
    assert.equal(await page.locator('#task-layout-toolbar').isHidden(), true);
    await page.locator('#topnav-week').click();
    const originalIds = await ids(page.locator('.week-section .task-row:not(.hidden)'));
    assert.deepEqual(originalIds, ['41', '42', '43', '44']);
    await page.locator('button[data-task-layout="board"]').click();
    assert.deepEqual(await ids(page.locator('.shared-task-card')), originalIds);
    assert.equal(await page.locator('.shared-task-lane[data-status="todo"] [data-task-id="42"]').count(), 1);
    assert.equal(await page.evaluate(() => apiStatusToKey(null)), 'todo');
    assert.equal(await page.locator('#section-41').isVisible(), false);
    await page.evaluate(() => { searchQuery = 'edit sync'; applyAllFilters(); });
    assert.deepEqual(await ids(page.locator('.shared-task-card')), ['41']);
    await page.locator('button[data-task-layout="calendar"]').click();
    assert.deepEqual(await ids(page.locator('.task-calendar-event')), ['41']);
    await page.locator('button[data-task-layout="list"]').click();
    assert.deepEqual(await ids(page.locator('.week-section .task-row:not(.hidden)')), ['41']);
    await page.evaluate(() => { searchQuery = ''; activeGroupFilter = 'Alfred Walf'; applyAllFilters(); });
    await page.locator('button[data-task-layout="board"]').click();
    assert.deepEqual(await ids(page.locator('.shared-task-card')), ['41', '42', '43']);
    state.failPatch = true;
    await page.locator('.shared-task-card[data-task-id="41"] select').selectOption('done');
    await page.getByText('Could not save the task status. Your previous status is unchanged.').waitFor();
    assert.equal(await page.locator('.shared-task-lane[data-status="stuck"] [data-task-id="41"]').count(), 1);
    state.failPatch = false;
    await page.locator('.shared-task-card[data-task-id="41"] select').selectOption('progress');
    await page.locator('.shared-task-lane[data-status="progress"] [data-task-id="41"]').waitFor();
    await page.locator('.shared-task-card[data-task-id="41"] select').selectOption('todo');
    await page.locator('.shared-task-lane[data-status="todo"] [data-task-id="41"]').waitFor();
    assert.equal(state.patches.at(-1).body.status, 'To do');
    await page.locator('.shared-task-card[data-task-id="41"] .shared-task-open').click();
    assert.equal(await page.locator('#detail-title').textContent(), 'Repair WhatsApp edit sync');
    assert.equal(await page.locator('#detail-source-link').getAttribute('href'), 'https://t.me/c/2167535790/1/999');
    assert.equal(await page.locator('#detail-due').isDisabled(), true);
    await page.locator('#detail-status-pills [data-s="done"]').click();
    await page.locator('.shared-task-lane[data-status="done"] [data-task-id="41"]').waitFor();
    assert.equal(await page.locator('#list-42 .task-row[data-task-id="41"]').count(), 1);
    await page.locator('#detail-close').click();
    assert.equal(state.patches.at(-1).headers['x-telegram-init-data'], 'fixture');
    await page.reload(); await page.waitForFunction(() => taskFeedState === 'ready');
    await page.locator('#topnav-week').click(); await page.locator('button[data-task-layout="board"]').click();
    assert.equal(await page.locator('.shared-task-lane[data-status="done"] [data-task-id="41"]').count(), 1);
    // Drag uses exactly the same persisted status route, never mutates a local goal.
    await page.evaluate(async () => {
      const source = document.querySelector('.shared-task-lane[data-status="done"] .shared-task-lane-cards');
      const target = document.querySelector('.shared-task-lane[data-status="progress"] .shared-task-lane-cards');
      await source._sortableOptions.onEnd({ item: source.querySelector('[data-task-id="41"]'), to: target });
    });
    assert.equal(await page.locator('.shared-task-lane[data-status="progress"] [data-task-id="41"]').count(), 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('alfred-rocstar-goals'))[0].name), 'Existing goal');
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'kanban-desktop.png'), fullPage: true });
    await page.locator('button[data-task-layout="calendar"]').click();
    assert.equal(await page.locator('.task-calendar-undated [data-task-id="43"]').count(), 1);
    assert.equal(await page.locator('.task-calendar-event[data-task-id="42"]').count(), 0);
    await page.getByRole('button', { name: 'Next month', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Next month');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.task-calendar-event[data-task-id="42"]').count(), 1);
    await page.getByRole('button', { name: 'Current month', exact: true }).click();
    await page.screenshot({ path: path.join(evidence, 'calendar-desktop.png'), fullPage: true });
    await page.locator('.task-calendar-event[data-task-id="44"]').click();
    assert.equal(await page.locator('#detail-title').textContent(), 'Review task views');
    assert.equal(await page.locator('#detail-source-link').isHidden(), true);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test('Shared task views fit phone layout and keep Today, Home and old goals separate', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture(390);
  try {
    await page.locator('#topnav-week').click();
    await page.locator('button[data-task-layout="board"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'kanban-mobile.png'), fullPage: true });
    await page.locator('button[data-task-layout="calendar"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(evidence, 'calendar-mobile.png'), fullPage: true });
    await page.locator('#topnav-pending').click();
    assert.equal(await page.locator('#shared-task-calendar').isHidden(), true);
    assert.equal(await page.locator('#today-view').isVisible(), true);
    await page.locator('#topnav-home').click();
    assert.equal(await page.locator('#task-layout-toolbar').isHidden(), true);
    assert.equal(await page.locator('#home-dashboard').isVisible(), true);
    await page.evaluate(() => { openCreateFlow(); });
    assert.equal(await page.locator('#new-task-status').inputValue(), 'todo');
    await page.evaluate(() => closeModal());
    await page.evaluate(() => document.getElementById('tab-board').click());
    assert.equal(await page.locator('#shared-task-board').isHidden(), true);
    assert.equal(await page.locator('#board-view .board-card-name').textContent(), 'Existing goal');
    await page.evaluate(() => openCreateFlow());
    assert.equal(await page.locator('#new-task-status').inputValue(), 'progress');
    assert.equal(await page.locator('#new-task-status option[value="todo"]').isDisabled(), true);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

 test('Refreshed assets remain compatible with cached three-view mini app HTML', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture(390, true);
  try {
    await page.locator('#topnav-week').click();
    await page.locator('button[data-task-layout="board"]').click();
    assert.equal(await page.locator('.shared-task-card').count(), 4);
    await page.locator('button[data-task-layout="calendar"]').click();
    assert.equal(await page.locator('#shared-task-calendar').isVisible(), true);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});
