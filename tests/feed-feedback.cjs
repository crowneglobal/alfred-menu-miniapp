#!/usr/bin/env node
'use strict';

// Feedback fixtures for the pending authenticated, paginated feed contract.
// Every resource is local or blocked; no production task data is read or changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const html = fs.readFileSync(process.env.MINIAPP_HTML || path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/const\s+API_BASE\s*=\s*(['"])(.*?)\1/, "const API_BASE = 'https://task-feed-fixture.test'");
const sdk = fs.readFileSync(process.env.TG_SDK_PATH || '/tmp/telegram-web-app-safe-area-20261011.js', 'utf8');
const evidenceDir = process.env.EVIDENCE_DIR || '/tmp/miniapp-feed-feedback-evidence-20261012';
const fixture = { id: 101, task: 'A task from the saved feed', status: 'In Progress', assignee: 'dro238', group_name: 'Local fixture' };
fs.mkdirSync(evidenceDir, { recursive: true });

async function createApp(browser, responses) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const errors = [], mutations = [];
  let requests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem('alfred-dark-mode', 'false');
    window.TelegramWebviewProxy = { postEvent() {} };
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const cors = {
      'Access-Control-Allow-Origin': 'https://miniapp.test',
      'Access-Control-Allow-Headers': 'X-Telegram-Init-Data, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (request.method() === 'OPTIONS' && url.hostname === 'task-feed-fixture.test') {
      return route.fulfill({ status: 204, headers: cors });
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      mutations.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.hostname === 'miniapp.test') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: sdk });
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('sortable')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable = { create() { return { option() {}, destroy() {} }; } };' });
    }
    if (url.hostname === 'task-feed-fixture.test') {
      const response = responses[Math.min(requests++, responses.length - 1)];
      if (response.wait) await response.wait;
      if (response.abort) return route.abort('failed');
      const body = Array.isArray(response.body)
        ? { tasks: response.body, next_cursor: null, total: response.body.length, can_view_all: true }
        : response.body;
      return route.fulfill({
        status: response.status || 200, contentType: 'application/json',
        body: JSON.stringify(body), headers: cors,
      });
    }
    if (url.hostname === 'banking.crowne-cards.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local bank fixture</title>' });
    if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"></svg>' });
    return route.abort('blockedbyclient');
  });
  const params = new URLSearchParams({
    tgWebAppVersion: '8.0', tgWebAppPlatform: 'ios',
    tgWebAppData: new URLSearchParams({ user: JSON.stringify({ id: 1078092674, first_name: 'Darren', username: 'dro238' }) }).toString(),
  });
  await page.goto(`https://miniapp.test/#${params}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    Telegram.WebView.receiveEvent('fullscreen_changed', { is_fullscreen: true });
    Telegram.WebView.receiveEvent('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 });
    Telegram.WebView.receiveEvent('content_safe_area_changed', { top: 46, bottom: 0, left: 0, right: 0 });
    Telegram.WebView.receiveEvent('viewport_changed', { height: 844, is_expanded: true, is_state_stable: true });
  });
  return { context, page, errors, mutations, requests: () => requests };
}

async function waitState(page, state) {
  await page.waitForFunction(state => taskFeedState === state, state);
}

async function assertSharedStatus(page, expected) {
  for (const mode of ['today', 'week']) {
    await page.locator(`#topnav-${mode === 'today' ? 'pending' : 'week'}`).click();
    assert.equal(await page.locator('#task-feed-status').isVisible(), true, `Status is visible in ${mode}`);
    assert.equal(await page.locator('#task-feed-message').textContent(), expected);
  }
  assert.equal(await page.locator('#task-feed-status').evaluate(node => node.parentElement.id), 'view-planning', 'Status belongs to Planning, not banking');
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath() });
  const results = [];
  async function test(name, responses, callback) {
    const app = await createApp(browser, responses);
    try {
      await callback(app);
      assert.deepEqual(app.errors, [], 'No uncaught application errors');
      assert.deepEqual(app.mutations, [], 'No API writes attempted');
      results.push({ name, passed: true }); console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
      await app.page.screenshot({ path: path.join(evidenceDir, `${name}-failure.png`) });
    } finally { await app.context.close(); }
  }

  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await test('loading-visible-in-today-and-week', [{ wait: pending, body: [] }], async ({ page, requests }) => {
    try {
      await waitState(page, 'loading');
      await assertSharedStatus(page, 'Loading tasks…');
      assert.equal(await page.locator('#task-feed-retry').isVisible(), false);
      await page.evaluate(() => loadTasks());
      assert.equal(requests(), 1, 'An in-flight request cannot be duplicated');
    } finally { release(); }
    await waitState(page, 'ready');
  });

  await test('network-error-visible-in-today-and-week', [{ abort: true }], async ({ page }) => {
    await waitState(page, 'error');
    await assertSharedStatus(page, 'Could not load tasks. Try again.');
    assert.equal(await page.locator('#task-feed-retry').isVisible(), true);
    await page.screenshot({ path: path.join(evidenceDir, 'feed-error-week.png') });
  });

  await test('http-error-is-not-an-empty-feed', [{ status: 503, body: [] }], async ({ page }) => {
    await waitState(page, 'error');
    await assertSharedStatus(page, 'Could not load tasks. Try again.');
    assert.equal(await page.locator('.week-section .task-row').count(), 0);
  });

  await test('successful-empty-feed-is-explicit', [{ body: [] }], async ({ page }) => {
    await waitState(page, 'ready');
    await assertSharedStatus(page, 'No tasks yet.');
    assert.equal(await page.locator('#task-feed-retry').isVisible(), false);
  });

  await test('filtered-empty-feedback-follows-view-and-assignee', [{ body: [{ ...fixture, assignee: 'someone_else' }] }], async ({ page }) => {
    await waitState(page, 'ready');
    await assertSharedStatus(page, 'No tasks match these filters.');
    assert.equal(await page.locator('.week-section .task-row').count(), 1, 'The task exists even though Me has no matches');
    await page.locator('#sheet-handle').click();
    await page.locator('#assignee-tab-all').click();
    await waitState(page, 'ready');
    assert.equal(await page.locator('#task-feed-status').isVisible(), false, 'Week All displays a matching task');
    await page.locator('#assignee-tab-me').click();
    await waitState(page, 'ready');
    assert.equal(await page.locator('#task-feed-status').isVisible(), true, 'Week Me explains its empty result');
    await page.locator('#assignee-tab-all').click();
    await waitState(page, 'ready');
    await page.locator('#sheet-handle').click();
    await page.locator('#topnav-pending').click();
    assert.equal(await page.locator('#task-feed-status').isVisible(), false, 'Today All includes the matching task');
    await page.locator('#sheet-handle').click();
    await page.locator('#assignee-tab-me').click();
    await waitState(page, 'ready');
    assert.equal(await page.locator('#task-feed-status').isVisible(), true, 'Today Me explains its empty result');
    assert.equal(await page.locator('#task-feed-message').textContent(), 'No tasks match these filters.');
    await page.locator('#assignee-tab-all').click();
    await waitState(page, 'ready');
    await page.locator('#sheet-handle').click();
    await page.locator('#topnav-week').click();
    assert.equal(await page.locator('#task-feed-status').isVisible(), false, 'Returning to Week All clears the message');
    await page.evaluate(() => selectGroup('Missing fixture group'));
    assert.equal(await page.locator('#task-feed-status').isVisible(), true, 'An unmatched group explains its empty result');
    await page.evaluate(() => selectGroup(null));
    assert.equal(await page.locator('#task-feed-status').isVisible(), false, 'Clearing the group restores the task');
  });

  await test('retry-recovers-without-duplicate-rows', [{ abort: true }, { body: [fixture, fixture] }], async ({ page, requests }) => {
    await waitState(page, 'error');
    await page.locator('#task-feed-retry').click();
    await waitState(page, 'ready');
    assert.equal(await page.locator('#task-feed-status').isVisible(), false);
    assert.equal(await page.locator('.week-section .task-row').count(), 1);
    assert.equal(await page.locator('#today-view .today-task-row').count(), 1, 'Today rebuilds after recovery');
    await page.evaluate(() => loadTasks());
    assert.equal(await page.locator('.week-section .task-row').count(), 1);
    assert.equal(await page.locator('.week-section .swipe-wrapper').count(), 1, 'Retry removes the old swipe wrapper as well as its row');
    assert.equal(requests(), 3);
  });

  await test('failed-refresh-preserves-previous-list', [{ body: [fixture] }, { body: { error: 'Bad response' } }, { body: [fixture] }], async ({ page }) => {
    await waitState(page, 'ready');
    await page.evaluate(() => loadTasks());
    await waitState(page, 'error');
    await assertSharedStatus(page, 'Could not load tasks. Try again.');
    assert.equal(await page.locator('.week-section .task-row').count(), 1);
    assert.equal(await page.locator('#today-view .today-task-row').count(), 1);
    await page.locator('#task-feed-retry').click();
    await waitState(page, 'ready');
    assert.equal(await page.locator('.week-section .task-row').count(), 1);
    assert.equal(await page.locator('#task-feed-status').isVisible(), false);
  });

  await browser.close();
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
