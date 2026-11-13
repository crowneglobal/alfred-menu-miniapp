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
  const state = { failPatch: false, patches: [], requests: [], errors: [], commentPosts: [], conversationReads: [], failComments: false, forbidConversation: false, sent: [] };
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
      if (/^\/api\/tasks\/\d+\/conversation$/.test(url.pathname)) {
        state.conversationReads.push({ path: url.pathname, query: url.search, headers: request.headers() });
        if (state.forbidConversation) return route.fulfill({ status: 403, json: { detail: 'You no longer have access to this conversation.' } });
        const taskId = Number(url.pathname.split('/')[3]); const scope = url.searchParams.get('scope');
        if (taskId !== 41) return route.fulfill({ json: { messages: [], next_cursor: null, can_comment: false, notice: 'This task has no linked Telegram conversation.', source: { kind: 'unlinked' } } });
        const message = (id, text, name = 'Mira') => ({ id, text, date: '2026-11-12T15:0' + (id % 10) + ':00Z', sender: { id: 222, name, username: 'mira' }, is_self: false, reply_to_id: null, media: null });
        const attachment = { ...message(3, 'Here is the example.'), media: { type: 'photo', name: 'Example.png', size: 68, download_url: '/api/tasks/41/conversation/3/media?scope=thread' } };
        const messages = url.searchParams.has('before_id') ? [message(1, 'Original request')] : [message(2, '<img src=x onerror=alert(1)> Keep this text literal.'), attachment, ...state.sent];
        if (scope === 'topic') messages.push(message(8, 'Another conversation in this topic.'));
        return route.fulfill({ json: { messages, next_cursor: url.searchParams.has('before_id') ? null : 2, can_comment: true, source: { kind: scope === 'topic' ? 'topic' : 'thread', chat_id: -1002167535790, root_message_id: 1, topic_id: 19854, available_scopes: ['thread','topic'], url: 'https://t.me/c/2167535790/19854/1' } } });
      }
      if (/^\/api\/tasks\/\d+\/comments$/.test(url.pathname) && request.method() === 'POST') {
        const body = request.postDataJSON(); state.commentPosts.push({ path: url.pathname, body, headers: request.headers() });
        if (state.failComments) return route.fulfill({ status: 502, json: { detail: 'Telegram did not confirm sending. Check the conversation before trying again.' } });
        const message = { id: 10 + state.sent.length, text: body.text, date: new Date().toISOString(), sender: { id: 1078092674, name: 'Darren', username: 'dro238' }, is_self: true, reply_to_id: body.reply_to_message_id || null, media: null };
        state.sent.push(message); return route.fulfill({ json: { ok: true, message } });
      }
      if (url.pathname === '/api/tasks/41/conversation/3/media') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1XcAAAAASUVORK5CYII=', 'base64') });
      const file = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
      if (['app.html', 'task-views.css', 'task-views.js', 'task-conversation.js', 'task-conversation.css', 'tray/alfred-tray.css'].includes(file)) return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: legacyMarkup && file === 'app.html' ? fs.readFileSync(path.join(root, file), 'utf8').replace(/<section id="shared-task-insights"[^>]*><\/section>/, '').replace(/<button[^>]*data-task-layout="(?:overview|gantt|timeline|workflow|dashboard)"[^>]*>[^<]*<\/button>/g, '') : fs.readFileSync(path.join(root, file), 'utf8') });
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
    await page.locator('#task-view-select').selectOption('overview');
    assert.equal(await page.locator('[data-metric="total"] strong').textContent(), '4');
    assert.equal(await page.locator('[data-metric="done"] strong').textContent(), '1');
    assert.equal(await page.locator('.week-section').first().isVisible(), false);
    await page.locator('#task-view-select').selectOption('dashboard');
    assert.equal(await page.locator('.task-dashboard-completion').textContent(), '25% complete');
    assert.equal(await page.locator('[data-metric="undated"] strong').textContent(), '1');
    await page.evaluate(() => { activeGroupFilter = 'Alfred Walf'; searchQuery = 'edit sync'; applyAllFilters(); });
    assert.equal(await page.locator('[data-metric="total"] strong').textContent(), '1');
    assert.equal(await page.locator('#group-overview').isHidden(), true);
    assert.equal(await page.locator('[data-metric="done"] strong').textContent(), '0');
    await page.locator('#task-view-select').selectOption('gantt');
    assert.deepEqual(await ids(page.locator('.task-gantt-row[data-task-id]')), ['41']);
    assert.equal(await page.locator('.task-gantt-milestone').getAttribute('aria-label').then(x => x.includes('Repair WhatsApp edit sync')), true);
    await page.locator('.task-gantt-milestone').click();
    assert.equal(await page.locator('#detail-title').textContent(), 'Repair WhatsApp edit sync');
    await page.locator('#detail-close').click();
    await page.locator('#task-view-select').selectOption('timeline');
    assert.deepEqual(await ids(page.locator('.task-timeline-day [data-task-id]')), ['41']);
    await page.evaluate(() => { activeGroupFilter = ''; searchQuery = ''; applyAllFilters(); });
    assert.deepEqual(await ids(page.locator('.task-timeline-day [data-task-id]')), ['41', '44']);
    assert.deepEqual(await ids(page.locator('.task-view-undated [data-task-id]')), ['43']);
    await page.getByRole('button', { name: 'Next month', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Next month');
    await page.keyboard.press('Enter');
    assert.deepEqual(await ids(page.locator('.task-timeline-day [data-task-id]')), ['42']);
    await page.locator('#task-view-select').selectOption('gantt');
    assert.deepEqual(await ids(page.locator('.task-gantt-row[data-task-id]')), ['42']);
    await page.getByRole('button', { name: 'Current month', exact: true }).click();
    assert.deepEqual(await ids(page.locator('.task-gantt-row[data-task-id]')), ['41', '44']);
    await page.locator('#task-view-select').selectOption('workflow');
    assert.deepEqual(await ids(page.locator('#shared-task-insights .shared-task-card')), ['41', '42', '43', '44']);
    state.failPatch = true;
    await page.locator('#shared-task-insights [data-task-id="42"] select').selectOption('done');
    await page.getByText('Could not save the task status. Your previous status is unchanged.').waitFor();
    assert.equal(await page.locator('.task-workflow-stage[data-status="todo"] [data-task-id="42"]').count(), 1);
    state.failPatch = false;
    await page.locator('#shared-task-insights [data-task-id="42"] select').selectOption('done');
    await page.locator('.task-workflow-stage[data-status="done"] [data-task-id="42"]').waitFor();
    assert.equal(state.patches.at(-1).headers['x-telegram-init-data'], 'fixture');
    await page.locator('#task-view-select').selectOption('dashboard');
    assert.equal(await page.locator('.task-dashboard-completion').textContent(), '50% complete');
    await page.locator('#task-view-select').selectOption('list');
    assert.equal(await page.locator('#list-42 .task-row[data-task-id="42"]').count(), 1);
    await page.locator('#task-view-select').selectOption('dashboard');
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
      await page.locator('#task-view-select').selectOption(view);
      assert.equal(await page.locator('#shared-task-insights').getAttribute('data-view'), view);
      assert.equal(await page.locator('button[data-task-layout="' + view + '"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, view + ' overflows phone');
      assert.equal(await page.locator('#task-layout-count').textContent(), '4');
      await page.screenshot({ animations: 'disabled', path: path.join(output, view + '-mobile.png'), fullPage: false });
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    for (const view of ['gantt', 'dashboard']) {
      await page.locator('#task-view-select').selectOption(view);
      await page.screenshot({ animations: 'disabled', path: path.join(output, view + '-desktop.png'), fullPage: false });
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
    await page.locator('#task-view-select').selectOption('board');
    assert.deepEqual(await ids(page.locator('.shared-task-card')), originalIds);
    assert.equal(await page.locator('.shared-task-lane[data-status="todo"] [data-task-id="42"]').count(), 1);
    assert.equal(await page.evaluate(() => apiStatusToKey(null)), 'todo');
    assert.equal(await page.locator('#section-41').isVisible(), false);
    await page.evaluate(() => { searchQuery = 'edit sync'; applyAllFilters(); });
    assert.deepEqual(await ids(page.locator('.shared-task-card')), ['41']);
    await page.locator('#task-view-select').selectOption('calendar');
    assert.deepEqual(await ids(page.locator('.task-calendar-event')), ['41']);
    await page.locator('#task-view-select').selectOption('list');
    assert.deepEqual(await ids(page.locator('.week-section .task-row:not(.hidden)')), ['41']);
    await page.evaluate(() => { searchQuery = ''; activeGroupFilter = 'Alfred Walf'; applyAllFilters(); });
    await page.locator('#task-view-select').selectOption('board');
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
    state.failPatch = true;
    await page.locator('#detail-status-select').selectOption('done');
    await page.locator('#detail-status-error:not([hidden])').waitFor();
    assert.equal(await page.locator('#detail-status-select').inputValue(), 'todo');
    state.failPatch = false;
    await page.locator('#detail-status-select').selectOption('done');
    await page.locator('.shared-task-lane[data-status="done"] [data-task-id="41"]').waitFor();
    assert.equal(await page.locator('#list-42 .task-row[data-task-id="41"]').count(), 1);
    await page.locator('#detail-close').click();
    assert.equal(state.patches.at(-1).headers['x-telegram-init-data'], 'fixture');
    await page.reload(); await page.waitForFunction(() => taskFeedState === 'ready');
    await page.locator('#topnav-week').click(); await page.locator('#task-view-select').selectOption('board');
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
    await page.screenshot({ animations: 'disabled', path: path.join(evidence, 'kanban-desktop.png'), fullPage: true });
    await page.locator('#task-view-select').selectOption('calendar');
    assert.equal(await page.locator('.task-calendar-undated [data-task-id="43"]').count(), 1);
    assert.equal(await page.locator('.task-calendar-event[data-task-id="42"]').count(), 0);
    await page.getByRole('button', { name: 'Next month', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Next month');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.task-calendar-event[data-task-id="42"]').count(), 1);
    await page.getByRole('button', { name: 'Current month', exact: true }).click();
    await page.screenshot({ animations: 'disabled', path: path.join(evidence, 'calendar-desktop.png'), fullPage: true });
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
    await page.locator('#task-view-select').selectOption('board');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ animations: 'disabled', path: path.join(evidence, 'kanban-mobile.png'), fullPage: true });
    await page.locator('#task-view-select').selectOption('calendar');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ animations: 'disabled', path: path.join(evidence, 'calendar-mobile.png'), fullPage: true });
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
    await page.locator('#task-view-select').selectOption('board');
    assert.equal(await page.locator('.shared-task-card').count(), 4);
    await page.locator('#task-view-select').selectOption('calendar');
    assert.equal(await page.locator('#shared-task-calendar').isVisible(), true);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test('Conversation uses authenticated Telegram data, chronological pages, attachments and confirmed own-account replies', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture();
  try {
    await page.locator('#topnav-week').click(); await page.locator('#task-view-select').selectOption('board');
    assert.equal(await page.locator('#task-view-select option').count(), 8);
    assert.equal(await page.locator('.task-layout-tabs').isVisible(), false);
    await page.locator('#shared-task-board [data-task-id="41"] .shared-task-open').click();
    await page.locator('.conversation-message[data-message-id="2"]').waitFor();
    assert.equal(await page.locator('.conversation-text img').count(), 0);
    assert.match(await page.locator('.conversation-identity').textContent(), /Posting as Darren \(@dro238\)/);
    await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
    await page.locator('.conversation-message[data-message-id="1"]').waitFor();
    assert.deepEqual(await page.locator('.conversation-message').evaluateAll(nodes => nodes.map(n => n.dataset.messageId)), ['1', '2', '3']);
    await page.getByRole('button', { name: 'Open attachment', exact: true }).click();
    await page.locator('.conversation-media img').waitFor();
    const attachmentBlob = await page.locator('.conversation-media img').getAttribute('src');
    await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh conversation"]').disabled);
    assert.equal(await page.locator('.conversation-media img').getAttribute('src'), attachmentBlob);
    await page.locator('[data-message-id="2"]').getByRole('button', { name: 'Reply to Mira', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('I can reproduce this.');
    assert.equal(state.commentPosts.length, 0);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.conversation-message.is-self').waitFor();
    assert.equal(state.commentPosts.length, 1);
    assert.equal(state.commentPosts[0].body.reply_to_message_id, 2);
    assert.equal(state.commentPosts[0].headers['x-telegram-init-data'], 'fixture');
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '');
    assert.equal(await page.locator('.conversation-message.is-self .conversation-text').textContent(), 'I can reproduce this.');
    await page.getByRole('combobox', { name: 'Conversation scope', exact: true }).selectOption('topic');
    await page.getByText('Another conversation in this topic.', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('For the whole topic.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByText('For the whole topic.', { exact: true }).waitFor();
    assert.equal(state.commentPosts.at(-1).body.scope, 'topic');
    assert.ok(state.conversationReads.every(r => r.headers['x-telegram-init-data'] === 'fixture'));
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#detail-overlay').isVisible(), false);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test('Comment failures preserve drafts, never invent history, reuse retry IDs, and clear revoked access', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture(390);
  try {
    await page.locator('#topnav-week').click(); await page.locator('#task-view-select').selectOption('board');
    await page.locator('#shared-task-board [data-task-id="41"] .shared-task-open').click();
    await page.locator('.conversation-message').first().waitFor();
    state.failComments = true;
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Retain this draft.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Telegram did not confirm' }).waitFor();
    assert.equal(await page.locator('.conversation-message.is-self').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), 'Retain this draft.');
    const id = state.commentPosts[0].body.client_request_id;
    state.failComments = false;
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.conversation-message.is-self').waitFor();
    assert.equal(state.commentPosts[1].body.client_request_id, id);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Private draft for this task.');
    await page.locator('#detail-close').click();
    await page.locator('#shared-task-board [data-task-id="42"] .shared-task-open').click();
    await page.getByText('This task has no linked Telegram conversation.', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '');
    assert.equal(await page.locator('.conversation-message').count(), 0);
    await page.locator('#detail-close').click();
    await page.locator('#shared-task-board [data-task-id="41"] .shared-task-open').click();
    await page.locator('.conversation-message').first().waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), 'Private draft for this task.');
    state.forbidConversation = true;
    await page.getByRole('button', { name: 'Refresh conversation', exact: true }).click();
    await page.getByText('You no longer have access to this conversation.', { exact: true }).waitFor();
    assert.equal(await page.locator('.conversation-message').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});

test('Minimal board and conversation remain usable on desktop and mobile', { timeout: 20000 }, async () => {
  const { browser, page, state } = await fixture(1400);
  try {
    const output = process.env.SIMPLIFY_EVIDENCE || '/Users/alfredo/.openclaw/workspace/evidence/tasks-3-simplify'; fs.mkdirSync(output, { recursive: true });
    assert.equal(await page.locator('.module-switch-word').textContent(), 'Alfred');
    await page.locator('#module-switch-toggle').click();
    assert.equal(await page.locator('.module-switch-word').textContent(), 'Alfred Bank');
    await page.locator('#module-switch-toggle').click();
    assert.equal(await page.locator('.module-switch-word').textContent(), 'Alfred');
    await page.locator('#topnav-week').click(); await page.locator('#task-view-select').selectOption('board');
    await page.evaluate(() => { activeGroupFilter = 'Alfred Walf'; applyAllFilters(); });
    assert.equal(await page.locator('.shared-task-group').count(), 0);
    assert.equal(await page.locator('.shared-task-empty').filter({ hasText: 'Nothing here.' }).count(), 0);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'kanban-desktop.png') });
    await page.locator('#shared-task-board [data-task-id="41"] .shared-task-open').click();
    await page.locator('.conversation-message').first().waitFor();
    assert.equal(await page.locator('#detail-source-link').isVisible(), false);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'conversation-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.locator('.conversation-send').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'conversation-mobile.png') });
    await page.locator('#detail-close').click();
    await page.screenshot({ animations: 'disabled', path: path.join(output, 'kanban-mobile.png') });
    await page.evaluate(() => { window.AlfredTaskConversation = undefined; openDetail(allTasks.find(row => row.dataset.taskId === '41')); });
    assert.equal(await page.locator('#detail-source-link').isVisible(), true);
    assert.deepEqual(state.errors, []);
  } finally { await browser.close(); }
});


test('Groups fits mobile and scoped WALF cards keep complete source titles', { timeout: 20000 }, async () => {
  const { browser, page } = await fixture(390);
  try {
    assert.equal(await page.locator('#topnav-departments').textContent(), 'Groups');
    assert.ok(await page.locator('#topnav-departments').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.locator('#topnav-departments').click();
    assert.equal(await page.locator('#sidebar-panel').isVisible(), true);
    await page.evaluate(() => closeSidebar());
    await page.locator('#topnav-week').click(); await page.locator('#task-view-select').selectOption('board');
    await page.evaluate(() => {
      for (const id of ['41', '44']) allTasks.find(row => row.dataset.taskId === id).querySelector('.task-name').textContent = '[WALF] Full stored title';
      applyAllFilters();
    });
    const card = page.locator('#shared-task-board [data-task-id="41"] .shared-task-open');
    assert.equal(await card.locator('.shared-task-name').textContent(), '[WALF] Full stored title');
    await page.evaluate(() => { activeGroupFilter = 'Alfred Walf'; applyAllFilters(); });
    assert.equal(await card.locator('.shared-task-name').textContent(), 'Full stored title');
    assert.equal(await card.getAttribute('aria-label'), '[WALF] Full stored title');
    await card.click(); assert.equal(await page.locator('#detail-title').textContent(), '[WALF] Full stored title');
    await page.locator('#detail-close').click();
    await page.evaluate(() => { activeGroupFilter = 'Alfred Tasks'; applyAllFilters(); });
    assert.equal(await page.locator('#shared-task-board [data-task-id="44"] .shared-task-name').textContent(), '[WALF] Full stored title');
    assert.equal(await page.evaluate(() => allTasks.find(row => row.dataset.taskId === '41').querySelector('.task-name').textContent), '[WALF] Full stored title');
  } finally { await browser.close(); }
});
