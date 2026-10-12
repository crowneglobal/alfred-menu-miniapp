#!/usr/bin/env node
'use strict';

// Local regression fixtures only. Uses the official Telegram SDK, intercepts
// every request, and blocks writes except explicitly mocked status PATCH tests.
// No request reaches a live service. This does not verify a physical client.
// A separate URL assertion is essential: Playwright routing can otherwise mask
// the mixed-content failure that an HTTPS mini app gets with an HTTP API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const htmlPath = process.env.MINIAPP_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const apiBase = html.match(/const\s+API_BASE\s*=\s*(['"])(.*?)\1/)?.[2];
// Chromium blocks HTTP fetches before the routing callback. Use a secure local
// fixture host for behavioral tests; the transport test below reads the original
// source and fails independently if the real API is insecure.
const fixtureHtml = html.replace(/const\s+API_BASE\s*=\s*(['"])(.*?)\1/, "const API_BASE = 'https://task-feed-fixture.test'");
const sdk = fs.readFileSync(process.env.TG_SDK_PATH || '/tmp/telegram-web-app-safe-area-20261011.js', 'utf8');
const evidenceDir = process.env.EVIDENCE_DIR || '/tmp/miniapp-task-feed-evidence-20261011';
const origin = 'https://miniapp.test';
const darrenGroup = 'Alfred & Darren Chat';
const fioGroup = 'Fiorella & Alfred Chat';
const user = { id: 1078092674, first_name: 'Darren', last_name: 'Roberts', username: 'dro238' };
const fixtures = [
  { id: 1, task: 'Darren username task', status: 'In Progress', assignee: 'dro238', group_name: darrenGroup },
  { id: 2, task: 'Darren prefixed username task', status: 'In Progress', assignee: '@Dro238', group_name: fioGroup },
  { id: 3, task: 'Darren first name task', status: 'Stuck', assignee: 'Darren', group_name: fioGroup },
  { id: 4, task: 'Fiorella task', status: 'In Progress', assignee: 'Fiorella', group_name: fioGroup },
  { id: 5, task: 'Alfred task', status: 'In Progress', assignee: 'Alfred', group_name: darrenGroup },
  { id: 6, task: 'Darren completed task', status: 'Done', assignee: '@dro238', group_name: fioGroup },
  { id: 7, task: 'Darren full name task', status: 'Stuck', assignee: 'Darren Roberts', group_name: darrenGroup },
];
const sorted = values => [...values].sort();
const envelope = (tasks = fixtures, fields = {}) => ({ tasks, next_cursor: null, total: tasks.length, can_view_all: true, ...fields });
fs.mkdirSync(evidenceDir, { recursive: true });

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function settledFeed(page) {
  await page.waitForFunction(() => typeof taskFeedState !== 'undefined' && taskFeedState !== 'loading');
  await settle(page);
}

async function createApp(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: !!options.hasTouch });
  const page = await context.newPage();
  page.setDefaultTimeout(2000);
  const errors = [];
  const mutations = [];
  const apiRequests = [];
  const apiHeaders = [];
  const patchRequests = [];
  const heldRoutes = new Map();
  let callCount = 0;
  const responses = options.responses || [{ status: 200, body: envelope() }];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(({ ignoreAbort, observerMode }) => {
    localStorage.setItem('alfred-dark-mode', 'false');
    window.TelegramWebviewProxy = { postEvent() {} };
    if (observerMode === 'unavailable') window.IntersectionObserver = undefined;
    if (observerMode === 'held') {
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
    if (ignoreAbort) {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (url, config = {}) => nativeFetch(url, { ...config, signal: undefined });
    }
  }, { ignoreAbort: !!options.ignoreAbort, observerMode: options.observerMode });
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'X-Telegram-Init-Data, Content-Type',
    'Access-Control-Allow-Methods': options.patchResponses ? 'GET, OPTIONS, PATCH' : 'GET, OPTIONS',
  };
  async function fulfill(route, response) {
    await route.fulfill({
      status: response.status || 200,
      contentType: 'application/json',
      body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
      headers: cors,
    });
  }
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS' && url.pathname.startsWith('/api/tasks')) {
      return route.fulfill({ status: 204, headers: cors });
    }
    if (request.method() === 'PATCH' && options.patchResponses && url.hostname === 'task-feed-fixture.test' && /^\/api\/tasks\/\d+\/state$/.test(url.pathname)) {
      patchRequests.push({ url: request.url(), headers: await request.allHeaders(), body: request.postDataJSON() });
      const response = options.patchResponses[Math.min(patchRequests.length - 1, options.patchResponses.length - 1)];
      if (response.hold) {
        heldRoutes.set(response.hold, { route, response });
        return;
      }
      return fulfill(route, response);
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      mutations.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.origin === origin && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixtureHtml });
    if (url.hostname === 'telegram.org' && url.pathname === '/js/telegram-web-app.js') {
      return route.fulfill({ contentType: 'application/javascript', body: sdk });
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('sortable')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable = { create() { return { option() {}, destroy() {} }; } };' });
    }
    if (url.pathname.endsWith('/api/tasks')) {
      apiRequests.push(request.url());
      const headers = await request.allHeaders();
      apiHeaders.push(headers);
      callCount++;
      const response = options.respond
        ? await options.respond({ url, headers, call: callCount })
        : responses[Math.min(callCount - 1, responses.length - 1)];
      if (response.hold || (options.holdFirst && callCount === 1)) {
        heldRoutes.set(response.hold || 'first', { route, response });
        return;
      }
      return fulfill(route, response);
    }
    if (url.hostname === 'banking.crowne-cards.com') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local bank fixture</title>' });
    }
    return route.abort('blockedbyclient');
  });
  const params = new URLSearchParams({
    tgWebAppVersion: '8.0', tgWebAppPlatform: 'ios',
    tgWebAppData: new URLSearchParams({ user: JSON.stringify(options.user || user) }).toString(),
  });
  await page.goto(`${origin}/#${params}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  if (!options.holdFirst) await settledFeed(page);
  return {
    context, page, errors, mutations, apiRequests, apiHeaders, patchRequests,
    async release(key = 'first') {
      const held = heldRoutes.get(key);
      assert.ok(held, `API request ${key} is pending`);
      await fulfill(held.route, held.response);
      heldRoutes.delete(key);
      await settle(page);
    },
  };
}

async function names(page, today = true) {
  const selector = today ? '#today-view .today-task-row .task-name' : '.week-section .task-row:not(.hidden) .task-name';
  return sorted(await page.locator(selector).allTextContents());
}

async function expectedNames(page, ids, today = true) {
  const expected = sorted(fixtures.filter(task => ids.includes(task.id)).map(task => task.task));
  await settledFeed(page);
  assert.deepEqual(await names(page, today), expected, 'Visible tasks reflect the active filters');
}

async function selectGroup(page, group) {
  await page.locator('#header-sidebar-button').click();
  await page.locator('#sidebar-body .sidebar-group-name').filter({ hasText: new RegExp('^' + group + '$') }).click();
  await settle(page);
}

async function assertStatus(page, pattern, retry) {
  const status = page.locator('#task-feed-status');
  assert.equal(await status.isVisible(), true, 'Feed status is visible in the active view');
  assert.match(await status.innerText(), pattern);
  assert.equal(await page.locator('#task-feed-retry').isVisible(), retry, 'Retry visibility matches feed state');
  const box = await status.boundingBox();
  assert.ok(box.y < page.viewportSize().height - 80, 'Feed status appears above the bottom navigation');
}

async function main() {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
  });
  const results = [];
  async function test(name, callback, options) {
    let app;
    try {
      app = await createApp(browser, options);
      await callback(app);
      assert.deepEqual(app.errors, [], 'No uncaught application errors');
      assert.deepEqual(app.mutations, [], 'No writes leave the page');
      results.push({ name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
      console.error(`FAIL ${name}: ${error.message}`);
      if (app) await app.page.screenshot({ path: path.join(evidenceDir, `${name}-failure.png`) });
    } finally {
      if (app) await app.context.close();
    }
  }

  await test('api-url-is-https', async app => {
    assert.ok(apiBase, 'The production API base can be verified');
    assert.equal(new URL(apiBase, origin).protocol, 'https:', 'Production feed must use HTTPS');
    assert.ok(app.apiRequests.length > 0, 'The feed attempts a request');
    assert.ok(app.apiRequests.every(url => new URL(url).protocol === 'https:'), 'Every feed request must use HTTPS');
    assert.equal(/const\s+API_BASE\s*=\s*['"]http:\/\//.test(html), false, 'Do not let route interception hide mixed content');
  });

  await test('today-me-matches-telegram-identity', async ({ page }) => {
    assert.equal(await page.locator('#today-view').isVisible(), true);
    await expectedNames(page, [1, 2, 3, 7]);
  });

  await test('today-task-opens-before-observer-callback', async ({ page }) => {
    const name = page.locator('#today-view .task-name').filter({ hasText: /^Darren username task$/ });
    await name.click();
    const editor = page.getByRole('textbox', { name: 'Edit task name' });
    assert.equal(await editor.inputValue(), 'Darren username task');
    await editor.press('Escape');
    await name.locator('..').locator('..').locator('.badge').click();
    assert.equal(await page.locator('#detail-overlay').isVisible(), true);
    assert.equal(await page.locator('#detail-title').innerText(), 'Darren username task');
  }, { observerMode: 'held' });

  for (const [observerMode, gesture] of [['held', 'click'], ['held', 'tap'], ['unavailable', 'click']]) {
    await test(`first-status-${gesture}-works-with-observer-${observerMode}`, async ({ page, patchRequests }) => {
      await page.locator('#topnav-week').click();
      const row = page.locator('.week-section .task-row[data-task-id="1"]');
      await row.locator('.badge')[gesture]();
      await page.waitForFunction(() => document.querySelector('[data-task-id="1"]').dataset.status === 'done');
      assert.equal(patchRequests.length, 1, 'The first tap saves once even without a visibility callback');
      assert.equal(await row.locator('.badge').innerText(), 'Done');
    }, { observerMode, hasTouch: gesture === 'tap', patchResponses: [{ status: 200, body: { ok: true } }] });
  }

  await test('today-all-updates-immediately', async ({ page }) => {
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await expectedNames(page, [1, 2, 3, 4, 5, 7]);
    await page.locator('.assignee-tab[data-assignee="me"]').click();
    await expectedNames(page, [1, 2, 3, 7]);
  });

  await test('sidebar-uses-api-group-names', async ({ page }) => {
    await page.locator('#header-sidebar-button').click();
    const groups = await page.locator('#sidebar-body .sidebar-group-name').allTextContents();
    assert.ok(groups.includes(fioGroup), 'Source group name can be selected');
    assert.ok(groups.includes(darrenGroup), 'Second source group name can be selected');
    assert.equal(groups.includes('Fio & Alfred'), false, 'No fabricated alias that cannot match API rows');
  });

  await test('today-all-and-me-respect-selected-group', async ({ page }) => {
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await selectGroup(page, fioGroup);
    await expectedNames(page, [2, 3, 4]);
    await page.locator('.assignee-tab[data-assignee="me"]').click();
    await expectedNames(page, [2, 3]);
    await selectGroup(page, darrenGroup);
    await expectedNames(page, [1, 7]);
    await selectGroup(page, 'All Groups');
    await expectedNames(page, [1, 2, 3, 7]);
  });

  await test('me-uses-the-active-telegram-account', async ({ page }) => {
    await expectedNames(page, [4]);
    await page.locator('#topnav-week').click();
    await expectedNames(page, [4], false);
  }, { user: { id: 6623841750, first_name: 'Fiorella', username: 'fio_fixture' } });

  await test('me-matches-stable-telegram-user-id', async ({ page }) => {
    assert.deepEqual(await names(page), ['Renamed assignee task']);
    await page.locator('#topnav-week').click();
    assert.deepEqual(await names(page, false), ['Renamed assignee task']);
  }, { responses: [{ status: 200, body: envelope([
    { id: 8, task: 'Renamed assignee task', status: 'In Progress', assignee: 'Renamed Account', assignee_id: user.id, group_name: fioGroup },
  ]) }] });

  await test('week-me-and-all-use-same-filter-rules', async ({ page }) => {
    await page.locator('#topnav-week').click();
    await expectedNames(page, [1, 2, 3, 6, 7], false);
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await selectGroup(page, fioGroup);
    await expectedNames(page, [2, 3, 4, 6], false);
    await page.locator('#topnav-pending').click();
    await expectedNames(page, [2, 3, 4]);
  });

  await test('today-rebuilds-after-filter-state-change', async ({ page }) => {
    // Exercise the common filter pipeline directly. The UI's search and status
    // buttons switch to Week, but no Today renderer may keep stale filter state.
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await page.evaluate(() => { activeStatus = 'stuck'; applyAllFilters(); });
    await expectedNames(page, [3, 7]);
    await page.evaluate(() => { searchQuery = 'first name'; applyAllFilters(); });
    await expectedNames(page, [3]);
    await page.evaluate(() => { searchQuery = ''; activeStatus = 'pending'; applyAllFilters(); });
    await expectedNames(page, [1, 2, 3, 4, 5, 7]);
  });

  await test('loading-visible-in-today-and-week', async app => {
    await assertStatus(app.page, /loading/i, false);
    await app.page.locator('#topnav-week').click();
    await assertStatus(app.page, /loading/i, false);
    await app.release();
    await expectedNames(app.page, [1, 2, 3, 6, 7], false);
    assert.equal(await app.page.locator('#task-feed-status').isVisible(), false);
  }, { holdFirst: true });

  await test('http-500-visible-with-retry-in-both-views', async ({ page }) => {
    await assertStatus(page, /could not load|unable to load|failed/i, true);
    await page.locator('#topnav-week').click();
    await assertStatus(page, /could not load|unable to load|failed/i, true);
  }, { responses: [{ status: 500, body: envelope() }] });

  await test('malformed-response-is-an-error', async ({ page }) => {
    await assertStatus(page, /could not load|unable to load|failed/i, true);
  }, { responses: [{ status: 200, body: { error: 'fixture object, not task array' } }] });

  await test('invalid-json-is-an-error', async ({ page }) => {
    await assertStatus(page, /could not load|unable to load|failed/i, true);
  }, { responses: [{ status: 200, body: 'invalid JSON fixture' }] });

  await test('empty-feed-has-explanation-in-both-views', async ({ page }) => {
    await assertStatus(page, /no .*tasks|no tasks/i, false);
    await page.locator('#topnav-week').click();
    await assertStatus(page, /no .*tasks|no tasks/i, false);
  }, { responses: [{ status: 200, body: envelope([]) }] });

  await test('empty-selected-filter-has-explanation', async ({ page }) => {
    await expectedNames(page, []);
    await assertStatus(page, /no .*tasks|no tasks/i, false);
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await settledFeed(page);
    assert.equal(await page.locator('#task-feed-status').isVisible(), false);
    await expectedNames(page, [1, 2, 3, 4, 5, 7]);
  }, { user: { id: 999999, first_name: 'Nobody', username: 'nobody_fixture' } });

  await test('retry-renders-once-and-preserves-filter', async ({ page, apiRequests }) => {
    await assertStatus(page, /could not load|unable to load|failed/i, true);
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await settledFeed(page);
    await assertStatus(page, /could not load|unable to load|failed/i, true);
    await page.locator('#task-feed-retry').click();
    await page.waitForFunction(() => document.querySelectorAll('.week-section .task-row').length > 0);
    await expectedNames(page, [1, 2, 3, 4, 5, 7]);
    assert.equal(await page.locator('.week-section .task-row').count(), fixtures.length, 'Each task is inserted once');
    assert.equal(await page.locator('#task-feed-status').isVisible(), false);
    assert.equal(apiRequests.length, 3, 'The scope change and retry each make one further read');
    // A successful refresh is still idempotent; it must not append duplicates.
    await page.evaluate(() => loadTasks());
    await settle(page);
    await expectedNames(page, [1, 2, 3, 4, 5, 7]);
    assert.equal(await page.locator('.week-section .task-row').count(), fixtures.length);
  }, { responses: [
    { status: 500, body: { error: 'temporary fixture failure' } },
    { status: 500, body: { error: 'temporary fixture failure' } },
    { status: 200, body: envelope() },
  ] });

  await test('authenticated-scope-request-contract', async ({ page, apiRequests, apiHeaders }) => {
    const parsed = new URL(apiRequests[0]);
    assert.equal(parsed.searchParams.get('scope'), 'me');
    assert.equal(parsed.searchParams.get('limit'), '200');
    const initData = await page.evaluate(() => Telegram.WebApp.initData);
    assert.ok(initData, 'Official SDK exposes fixture launch data');
    assert.equal(apiHeaders[0]['x-telegram-init-data'], initData, 'Feed request carries launch data for backend validation');
  });

  await test('assignee-tabs-refetch-the-correct-server-scope', async ({ page, apiRequests }) => {
    assert.equal(await page.locator('.week-section .task-row').count(), 5);
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await expectedNames(page, [1, 2, 3, 4, 5, 7]);
    assert.equal(await page.locator('.week-section .task-row').count(), 7);
    await page.locator('.assignee-tab[data-assignee="me"]').click();
    await expectedNames(page, [1, 2, 3, 7]);
    assert.equal(await page.locator('.week-section .task-row').count(), 5);
    assert.deepEqual(apiRequests.map(url => new URL(url).searchParams.get('scope')), ['me', 'all', 'me']);
  }, { respond: ({ url }) => ({
    status: 200,
    body: envelope(url.searchParams.get('scope') === 'all' ? fixtures : fixtures.filter(task => [1, 2, 3, 6, 7].includes(task.id))),
  }) });

  const latestTasks = Array.from({ length: 200 }, (_, index) => ({
    id: 300 - index, task: `Recent Darren task ${index + 1}`, status: 'In Progress', assignee: 'Darren', group_name: darrenGroup,
  }));
  const olderTask = { id: 100, task: 'Older Darren task', status: 'In Progress', assignee: '@dro238', group_name: fioGroup };
  await test('pagination-shows-tasks-older-than-first-200', async ({ page, apiRequests, apiHeaders }) => {
    assert.equal(await page.locator('.week-section .task-row').count(), 201, 'All pages merge without duplicate IDs');
    assert.ok((await names(page)).includes('Older Darren task'), 'Older task beyond first page is visible');
    assert.equal(apiRequests.length, 2);
    assert.equal(new URL(apiRequests[1]).searchParams.get('before_id'), '101');
    assert.equal(new URL(apiRequests[1]).searchParams.get('scope'), 'me');
    assert.ok(apiHeaders.every(headers => headers['x-telegram-init-data']), 'Every page remains authenticated');
  }, { responses: [
    { status: 200, body: envelope(latestTasks, { next_cursor: 101, total: 201 }) },
    { status: 200, body: envelope([latestTasks[199], olderTask], { total: 201 }) },
  ] });

  await test('later-page-http-error-keeps-previous-feed-with-error', async ({ page, apiRequests }) => {
    await expectedNames(page, [1, 2, 3, 7]);
    await page.evaluate(() => loadTasks());
    await assertStatus(page, /could not load|unable to load|failed/i, true);
    await expectedNames(page, [1, 2, 3, 7]);
    assert.equal(await page.locator('.week-section .task-row').count(), fixtures.length, 'Failed refresh does not replace valid rows with a partial page');
    assert.equal(apiRequests.length, 3);
  }, { responses: [
    { status: 200, body: envelope() },
    { status: 200, body: envelope([fixtures[0]], { next_cursor: 1, total: 7 }) },
    { status: 500, body: { error: 'later page failed' } },
  ] });

  await test('later-page-malformed-response-is-not-false-empty', async ({ page }) => {
    await assertStatus(page, /could not load|unable to load|failed/i, true);
    assert.equal(await page.locator('.week-section .task-row').count(), 0, 'Partial first page is not presented as complete');
  }, { responses: [
    { status: 200, body: envelope([fixtures[0]], { next_cursor: 1, total: 7 }) },
    { status: 200, body: { tasks: 'invalid page fixture', next_cursor: null } },
  ] });

  await test('repeated-page-cursor-stops-with-error', async ({ page, apiRequests }) => {
    await assertStatus(page, /could not load|unable to load|failed/i, true);
    assert.equal(apiRequests.length, 2, 'A repeated cursor cannot loop forever');
  }, { responses: [
    { status: 200, body: envelope([fixtures[0]], { next_cursor: 1, total: 7 }) },
  ] });

  await test('latest-scope-response-wins-race', async app => {
    const { page, apiRequests } = app;
    await page.locator('.assignee-tab[data-assignee="all"]').click();
    await settle(page);
    await assertStatus(page, /loading/i, false);
    await page.locator('.assignee-tab[data-assignee="me"]').click();
    await settledFeed(page);
    assert.deepEqual(await names(page), ['Latest Me task']);
    await app.release('stale-all');
    await settledFeed(page);
    assert.deepEqual(await names(page), ['Latest Me task'], 'An older request cannot replace the newest scope data');
    assert.equal(await page.evaluate(() => taskFeedCanViewAll), true, 'An older request cannot replace the newest scope capabilities');
    assert.deepEqual(apiRequests.map(url => new URL(url).searchParams.get('scope')), ['me', 'all', 'me']);
  }, {
    ignoreAbort: true,
    respond: ({ call }) => call === 1
      ? { status: 200, body: envelope() }
      : call === 2
        ? { status: 200, hold: 'stale-all', body: envelope(fixtures, { can_view_all: false }) }
        : { status: 200, body: envelope([
          { id: 90, task: 'Latest Me task', status: 'In Progress', assignee: 'Darren', group_name: darrenGroup },
        ]) },
  });

  await test('unauthorized-all-scope-is-disabled', async ({ page, apiRequests }) => {
    const all = page.locator('.assignee-tab[data-assignee="all"]');
    assert.equal(await all.isDisabled(), true);
    await all.evaluate(button => button.click());
    await settle(page);
    assert.equal(apiRequests.length, 1, 'Disabled All control cannot request unauthorized scope');
    assert.equal(new URL(apiRequests[0]).searchParams.get('scope'), 'me');
  }, { responses: [{ status: 200, body: envelope(fixtures, { can_view_all: false }) }] });

  await test('rejected-status-save-keeps-previous-status', async ({ page, patchRequests }) => {
    await page.locator('#topnav-week').click();
    const row = page.locator('.week-section .task-row[data-task-id="1"]');
    const badge = row.locator('.badge');
    for (const status of [409, 401]) {
      await badge.click();
      await page.waitForFunction(() => !document.querySelector('[data-task-id="1"] .badge').dataset.saving);
      assert.equal(await row.getAttribute('data-status'), 'progress', `HTTP ${status} keeps the previous status`);
      assert.equal(await badge.innerText(), 'In Progress');
      assert.equal(await page.locator('#task-save-error').isVisible(), true);
      assert.match(await page.locator('#task-save-error').innerText(), /could not save.*previous status is unchanged/i);
    }
    assert.equal(patchRequests.length, 2);
    assert.ok(patchRequests.every(request => request.headers['x-telegram-init-data']), 'Status saves carry launch data');
    assert.ok(patchRequests.every(request => request.body.status === 'Done'), 'Retries still attempt the same transition');
  }, { patchResponses: [
    { status: 409, body: { error: 'workflow guard fixture' } },
    { status: 401, body: { error: 'expired launch fixture' } },
  ] });

  await test('status-save-waits-for-success-and-blocks-repeat-clicks', async app => {
    const { page, patchRequests } = app;
    await page.locator('#topnav-week').click();
    const row = page.locator('.week-section .task-row[data-task-id="1"]');
    const badge = row.locator('.badge');
    await badge.click();
    await badge.click();
    await settle(page);
    assert.equal(patchRequests.length, 1, 'Repeated taps while pending send only one PATCH');
    assert.equal(await row.getAttribute('data-status'), 'progress', 'Pending request does not claim a status change');
    assert.equal(await badge.innerText(), 'In Progress');
    await app.release('status-save');
    await page.waitForFunction(() => document.querySelector('[data-task-id="1"]').dataset.status === 'done');
    assert.equal(await badge.innerText(), 'Done');
    assert.equal(await badge.getAttribute('data-saving'), null);
    assert.equal(await page.locator('#task-save-error').isVisible(), false);
    assert.deepEqual(patchRequests[0].body, { status: 'Done' });
  }, { patchResponses: [{ status: 200, hold: 'status-save', body: { ok: true } }] });

  await browser.close();
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify({ htmlPath, fixtures: fixtures.length, results }, null, 2) + '\n');
  const failures = results.filter(result => !result.passed).length;
  console.log(`${results.length - failures}/${results.length} passed`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
