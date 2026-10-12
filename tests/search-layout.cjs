#!/usr/bin/env node
'use strict';

// Search layout simulations using the official Telegram SDK. Every resource is
// fulfilled locally or blocked. This pending feed branch uses signed paginated task responses.
// The fixture host serves that contract without making any live API requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const htmlPath = process.env.MINIAPP_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/const\s+API_BASE\s*=\s*(['"])(.*?)\1/, "const API_BASE = 'https://task-feed-fixture.test'");
const sdk = fs.readFileSync(process.env.TG_SDK_PATH || '/tmp/telegram-web-app-safe-area-20261011.js', 'utf8');
const evidenceDir = process.env.EVIDENCE_DIR || '/tmp/miniapp-search-layout-evidence-20261012';
const origin = 'https://miniapp.test';
const fixtures = Array.from({ length: 30 }, (_, index) => ({
  id: index + 1,
  task: `${index < 24 ? 'Alpha' : 'Other'} search task ${String(index + 1).padStart(2, '0')}`,
  status: 'In Progress', assignee: index < 24 ? 'dro238' : 'Fiorella', group_name: 'Alfred & Darren Chat',
}));
const chrome = [
  '.app-header', '#app-title-toggle', '#date-week-bar', '#context-tabs',
  '#focus-banner', '#bottom-sheet',
];
const controls = ['#header-sidebar-button', '#app-title-toggle', '#sheet-handle', '#tray-search-trigger', '#tray-new-task', '#search-bubble', '#profile-trigger'];
fs.mkdirSync(evidenceDir, { recursive: true });

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function createApp(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: !!options.hasTouch });
  const page = await context.newPage();
  page.setDefaultTimeout(2500);
  const errors = [], mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem('alfred-dark-mode', 'false');
    window.TelegramWebviewProxy = { postEvent() {} };
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.__setVisualViewport = values => {
      Object.assign(viewport, values);
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    };
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      mutations.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.origin === origin) return route.fulfill({ contentType: 'text/html', body: html });
    if (url.hostname === 'telegram.org') return route.fulfill({ contentType: 'application/javascript', body: sdk });
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('sortable')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.Sortable = { create() { return { option() {}, destroy() {} }; } };' });
    }
    if (url.hostname === 'task-feed-fixture.test') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tasks: fixtures, next_cursor: null, total: fixtures.length, can_view_all: true }), headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.hostname === 'banking.crowne-cards.com') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Bank fixture</title><p>Local banking fixture</p>' });
    }
    if (request.resourceType() === 'image') {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><circle cx="36" cy="36" r="36" fill="#C5D4A8"/><text x="36" y="44" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#2A2A25">DR</text></svg>' });
    }
    return route.abort('blockedbyclient');
  });
  const params = new URLSearchParams({
    tgWebAppVersion: '8.0', tgWebAppPlatform: 'ios',
    tgWebAppData: new URLSearchParams({ user: JSON.stringify({ id: 1078092674, first_name: 'Darren', username: 'dro238', ...(options.userPhoto ? { photo_url: 'https://images.miniapp.test/user.svg' } : {}) }) }).toString(),
  });
  await page.goto(`${origin}/#${params}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.week-section .task-row').length === 30);
  await page.evaluate(() => {
    const bridge = Telegram.WebView;
    bridge.receiveEvent('fullscreen_changed', { is_fullscreen: true });
    bridge.receiveEvent('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 });
    bridge.receiveEvent('content_safe_area_changed', { top: 46, bottom: 0, left: 0, right: 0 });
    bridge.receiveEvent('viewport_changed', { height: 844, is_expanded: true, is_state_stable: true });
  });
  await page.locator('#topnav-week').click();
  await page.locator('#sheet-handle').click();
  await page.locator('#assignee-tab-all').click();
  await page.locator('#sheet-handle').click();
  await settle(page);
  return { context, page, errors, mutations };
}

async function viewport(page, { height, offsetTop = 0, telegramHeight = height, shrinkLayout = false }) {
  if (shrinkLayout) await page.setViewportSize({ width: 390, height });
  await page.evaluate(({ height, offsetTop, telegramHeight }) => {
    window.__setVisualViewport({ height, offsetTop });
    Telegram.WebView.receiveEvent('viewport_changed', { height: telegramHeight, is_expanded: true, is_state_stable: true });
  }, { height, offsetTop, telegramHeight });
  await settle(page);
  await page.locator('.search-overlay-header').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
}

async function openSearch(page) {
  await page.locator('#sheet-handle').click();
  await page.locator('#tray-search-trigger').click();
  assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), 'false', 'Opening search collapses the tray');
  await page.locator('#search-overlay-input').fill('Alpha');
  await settle(page);
  assert.equal(await page.locator('.week-section .task-row:not(.hidden)').count(), 24, 'Search filters the task rows');
}

async function assertSearchGeometry(page) {
  for (const selector of [...chrome, '#assignee-tabs', '#sidebar-trigger']) assert.equal(await page.locator(selector).isVisible(), false, `${selector} is hidden during search`);
  assert.equal(await page.locator('#search-overlay-input').isVisible(), true);
  const geometry = await page.evaluate(({ controls }) => {
    const planning = document.getElementById('view-planning');
    const dock = document.querySelector('.search-overlay-header');
    const first = document.querySelector('.week-section:not(.section-empty) .task-row:not(.hidden)');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:var(--app-safe-top);height:0;width:0';
    document.body.appendChild(probe);
    const safeTop = probe.getBoundingClientRect().top;
    probe.remove();
    const rect = node => {
      const { x, y, width, height, bottom } = node.getBoundingClientRect();
      return { x, y, width, height, bottom };
    };
    return {
      planning: rect(planning), dock: rect(dock), first: rect(first), safeTop,
      visibleBottom: visualViewport.height + visualViewport.offsetTop,
      overflow: getComputedStyle(planning).overflowY,
      hitTargets: controls.map(selector => ({ selector, count: document.querySelector(selector).getClientRects().length })),
    };
  }, { controls });
  assert.ok(geometry.planning.y >= geometry.safeTop - 1, 'Results respect Telegram top controls');
  assert.ok(geometry.planning.y <= geometry.safeTop + 12, 'Results reclaim the removed app header area');
  assert.ok(geometry.dock.bottom <= geometry.visibleBottom + 1, 'Search dock stays above the keyboard');
  assert.ok(geometry.dock.bottom >= geometry.visibleBottom - 50, 'Dock does not leave a large keyboard gap');
  assert.ok(geometry.planning.bottom <= geometry.dock.y + 1, 'Results viewport ends above the search dock');
  assert.ok(geometry.planning.bottom >= geometry.dock.y - 16, 'Results use the space immediately above the dock');
  assert.ok(geometry.planning.height >= 150, 'Keyboard leaves useful task result space');
  assert.ok(geometry.first.y >= geometry.planning.y - 1 && geometry.first.y <= geometry.planning.y + 50, 'First matching task appears near the top');
  assert.ok(['auto', 'scroll'].includes(geometry.overflow), 'Result region can scroll independently');
  assert.ok(geometry.hitTargets.every(target => target.count === 0), 'Hidden header controls leave no hit targets');
  return geometry;
}

async function assertRestored(page) {
  await page.waitForFunction(() => !document.body.classList.contains('search-mode'));
  for (const selector of chrome) assert.equal(await page.locator(selector).isVisible(), true, `${selector} returns after search`);
  assert.equal(await page.locator('#sidebar-trigger').isVisible(), false, 'Redundant edge handle stays hidden; planning groups button remains available');
  assert.equal(await page.locator('#search-overlay').isVisible(), false);
  assert.equal(await page.locator('#search-overlay-input').inputValue(), '');
  assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), 'false', 'Tray returns collapsed after search');
  assert.equal(await page.locator('#tray-actions').isVisible(), false, 'Search and creation stay tucked away after search');
  assert.equal(await page.locator('#assignee-tabs').isVisible(), false, 'Me and All stay tucked away after search');
  assert.deepEqual(await page.locator('#nav-planning .section-tab').allTextContents(), ['Rocstars®', 'Roctavos (45d)', 'Week', 'Today']);
  assert.deepEqual(await page.locator('#assignee-tabs button').allTextContents(), ['Me', 'All']);
  assert.equal(await page.locator('.week-section .task-row:not(.hidden)').count(), fixtures.length, 'Closing search clears the query');
  assert.notEqual(await page.locator('#view-planning').evaluate(node => getComputedStyle(node).position), 'fixed', 'Normal planning flow returns');
}

async function screenshot(page, name, keyboardTop) {
  await page.evaluate(() => {
    const native = document.createElement('div');
    native.id = 'test-native-controls';
    native.style.cssText = 'position:fixed;top:59px;left:8px;right:8px;height:46px;display:flex;justify-content:space-between;align-items:center;pointer-events:none;z-index:99998;font:12px sans-serif;color:#555';
    native.innerHTML = '<span style="padding:8px 12px;border-radius:20px;background:#ddd">× Close</span><span style="padding:8px 12px;border-radius:20px;background:#ddd">⌄ ···</span>';
    document.body.appendChild(native);
  });
  if (keyboardTop != null) await page.evaluate(top => {
    let keyboard = document.getElementById('test-keyboard');
    if (!keyboard) {
      keyboard = document.createElement('div'); keyboard.id = 'test-keyboard'; document.body.appendChild(keyboard);
    }
    keyboard.style.cssText = `position:fixed;left:0;right:0;top:${top}px;bottom:0;background:#d4d6da;z-index:99999;pointer-events:none;border-top:1px solid #9b9da1;display:grid;place-items:center;color:#555;font:15px sans-serif`;
    keyboard.textContent = 'Simulated iPhone keyboard';
  }, keyboardTop);
  await page.screenshot({ path: path.join(evidenceDir, `${name}.png`) });
  await page.evaluate(() => {
    document.getElementById('test-keyboard')?.remove();
    document.getElementById('test-native-controls')?.remove();
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath() });
  const results = [];
  async function test(name, callback) {
    const app = await createApp(browser);
    try {
      await callback(app.page);
      assert.deepEqual(app.errors, [], 'No uncaught app errors');
      assert.deepEqual(app.mutations, [], 'No writes attempted');
      results.push({ name, passed: true }); console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
      await screenshot(app.page, `${name}-failure`);
    } finally { await app.context.close(); }
  }

  await test('search-hides-chrome-and-reclaims-space', async page => {
    await screenshot(page, 'before-search');
    await openSearch(page);
    await viewport(page, { height: 544 });
    await assertSearchGeometry(page);
    await screenshot(page, 'search-with-keyboard', 544);
  });

  await test('search-handles-layout-viewport-shrink', async page => {
    await openSearch(page);
    await viewport(page, { height: 544, shrinkLayout: true });
    await assertSearchGeometry(page);
    await screenshot(page, 'search-resized-webview');
  });

  await test('telegram-viewport-event-keeps-dock-above-keyboard', async page => {
    await openSearch(page);
    // visualViewport remains stale, as it can while Telegram resizes its view.
    await viewport(page, { height: 844, telegramHeight: 544 });
    const dock = await page.locator('.search-overlay-header').boundingBox();
    assert.ok(dock.y + dock.height <= 545, 'Telegram viewport event alone positions the search dock');
    const planning = await page.locator('#view-planning').boundingBox();
    assert.ok(planning.y + planning.height <= dock.y + 1);
    await screenshot(page, 'search-telegram-viewport', 544);
  });

  await test('search-results-scroll-above-dock', async page => {
    await openSearch(page);
    await viewport(page, { height: 544 });
    await assertSearchGeometry(page);
    await page.locator('#view-planning').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await settle(page);
    const row = page.locator('.week-section .task-row:not(.hidden)').last();
    const rowBox = await row.boundingBox();
    const dock = await page.locator('.search-overlay-header').boundingBox();
    assert.ok(rowBox.y + rowBox.height <= dock.y + 1, 'Last result can be scrolled above the search dock');
    assert.ok(rowBox.y >= 0, 'Last result is on screen');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search-overlay-input', 'Scrolling does not dismiss search input');
    await screenshot(page, 'search-last-result', 544);
  });

  await test('search-reveals-matches-in-collapsed-week', async page => {
    await page.locator('#section-41 .week-label').click();
    assert.equal(await page.locator('#section-41').evaluate(node => node.classList.contains('collapsed')), true);
    await openSearch(page);
    await viewport(page, { height: 544 });
    await assertSearchGeometry(page);
    assert.ok(await page.locator('#list-41').evaluate(node => node.clientHeight) > 100, 'Search reveals matching rows inside a collapsed section');
    await page.locator('#search-exit').click();
    await viewport(page, { height: 844 });
    await assertRestored(page);
    assert.equal(await page.locator('#section-41').evaluate(node => node.classList.contains('collapsed')), true, 'Original collapsed preference remains intact');
    await page.locator('#list-41').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    assert.equal(await page.locator('#list-41').evaluate(node => node.clientHeight), 0, 'Section collapses again outside search');
  });

  for (const method of ['close', 'telegram-back', 'history-back', 'blur']) {
    await test(`search-${method}-restores-chrome`, async page => {
      await openSearch(page);
      await viewport(page, { height: 544 });
      if (method === 'close') await page.locator('#search-exit').click();
      else if (method === 'telegram-back') await page.evaluate(() => Telegram.WebView.receiveEvent('back_button_pressed'));
      else if (method === 'history-back') await page.evaluate(() => history.back());
      else await page.locator('#search-overlay-input').blur();
      await viewport(page, { height: 844 });
      await assertRestored(page);
      if (method === 'close') await screenshot(page, 'after-search');
    });
  }

  await test('banking-still-fits-after-search', async page => {
    await openSearch(page);
    await viewport(page, { height: 544 });
    await page.locator('#search-exit').click();
    await viewport(page, { height: 844 });
    await assertRestored(page);
    await page.locator('#app-title-toggle').click();
    await settle(page);
    assert.equal(await page.locator('#view-banking').isVisible(), true);
    assert.equal(await page.locator('#view-planning').isVisible(), false);
    const header = await page.locator('.app-header').boundingBox();
    const bank = await page.locator('#view-banking').boundingBox();
    assert.ok(Math.abs(bank.y - (header.y + header.height)) <= 2, 'Bank begins below the restored header');
    assert.ok(bank.height > 500, 'Bank retains its usable viewport');
    await page.locator('#app-title-toggle').click();
    await assertRestored(page);
  });

  await browser.close();
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify({ htmlPath, results }, null, 2) + '\n');
  const failures = results.filter(result => !result.passed).length;
  console.log(`${results.length - failures}/${results.length} passed`);
  process.exitCode = failures ? 1 : 0;
}

module.exports = { createApp, settle, viewport, screenshot, openSearch, assertSearchGeometry, assertRestored };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
