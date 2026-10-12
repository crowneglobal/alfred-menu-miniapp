#!/usr/bin/env node
'use strict';

// Run with Playwright installed and TG_SDK_PATH pointing to a saved official
// https://telegram.org/js/telegram-web-app.js. All browser requests are fulfilled
// locally or blocked, including the task API and banking iframe.
// MINIAPP_HTML may point to a baseline HTML file to demonstrate the regression.
// Native events and screenshots are simulations, not an actual Telegram client.
// Mode checks prove bridge requests, not that a real Telegram client accepted
// them. A native-controls fixture checks padding when client insets arrive late.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const htmlPath = process.env.MINIAPP_HTML || path.join(__dirname, '..', 'index.html');
const sdkPath = process.env.TG_SDK_PATH || '/tmp/telegram-web-app-safe-area-20261011.js';
const evidenceDir = process.env.EVIDENCE_DIR || '/tmp/miniapp-fullscreen-restored-evidence-20261011';
const html = fs.readFileSync(htmlPath, 'utf8');
const sdk = fs.readFileSync(sdkPath, 'utf8');
const origin = 'https://miniapp.test';
const zero = { top: 0, right: 0, bottom: 0, left: 0 };
const headerControls = [
  '#header-sidebar-button', '#header-search-button',
  '#app-title-toggle', '#header-add-button',
];
fs.mkdirSync(evidenceDir, { recursive: true });

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function createApp(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 390, height: 844 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [];
  const mutations = [];
  const intercepted = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem('alfred-dark-mode', 'false');
    window.__nativeRequests = [];
    window.TelegramWebviewProxy = {
      postEvent(type, data) {
        // Capture synchronously at the bridge boundary: startup padding must
        // exist before Telegram can draw its fullscreen controls over the app.
        const selectors = ['#header-sidebar-button', '#header-search-button', '#app-title-toggle', '#header-add-button'];
        const positions = {};
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (node) {
            const box = node.getBoundingClientRect();
            positions[selector] = { x: box.x, y: box.y, width: box.width, height: box.height };
          }
        }
        window.__nativeRequests.push({
          type, data, positions,
          fullscreenClass: !!document.querySelector('.telegram-fullscreen'),
        });
      },
    };
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    intercepted.push(request.url());
    if (request.method() === 'OPTIONS' && url.pathname === '/api/tasks') {
      return route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'X-Telegram-Init-Data, Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      } });
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      mutations.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.origin === origin && url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (url.hostname === 'telegram.org' && url.pathname === '/js/telegram-web-app.js') {
      return route.fulfill({ contentType: 'application/javascript', body: options.browser ? '' : sdk });
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('sortable')) {
      return route.fulfill({
        contentType: 'application/javascript',
        body: 'window.Sortable = { create() { return { option() {}, destroy() {} }; } };',
      });
    }
    if (url.pathname === '/api/tasks') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [], next_cursor: null, total: 0, can_view_all: true }),
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'X-Telegram-Init-Data, Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
    }
    if (url.hostname === 'banking.crowne-cards.com') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Bank fixture</title><p>Local banking fixture</p>' });
    }
    // Images and every other unrecognized resource never reach the network.
    return route.abort('blockedbyclient');
  });
  const params = new URLSearchParams({
    tgWebAppVersion: options.version || '8.0',
    tgWebAppPlatform: options.platform || 'ios',
    tgWebAppData: new URLSearchParams({ user: JSON.stringify({ id: 999999, first_name: 'Test', username: 'fixture' }) }).toString(),
  });
  if (options.fullscreen) params.set('tgWebAppFullscreen', '1');
  await page.goto(origin + '/' + (options.browser ? '' : '#' + params), { waitUntil: 'load' });
  await settle(page);
  return { context, page, errors, mutations, intercepted };
}

async function insets(page, system, content, fullscreen = true) {
  await page.evaluate(({ system, content, fullscreen }) => {
    const bridge = window.Telegram.WebView;
    bridge.receiveEvent('fullscreen_changed', { is_fullscreen: fullscreen });
    bridge.receiveEvent('safe_area_changed', system);
    bridge.receiveEvent('content_safe_area_changed', content);
  }, { system: { ...zero, ...system }, content: { ...zero, ...content }, fullscreen });
  await settle(page);
}

async function nativeRequests(page, type) {
  return page.evaluate(type => window.__nativeRequests.filter(request => request.type === type), type);
}

async function assertNoFullscreenGap(page) {
  await assertControls(page, zero, zero);
  const box = await page.locator(headerControls[0]).boundingBox();
  assert.ok(box.y <= 20, `Non-fullscreen header retains ${box.y}px top gap`);
  assert.equal(await page.locator('.telegram-fullscreen').count(), 0, 'Fullscreen fallback class is cleared');
}

async function assertControls(page, system, content, selectors = headerControls) {
  const minTop = (system.top || 0) + (content.top || 0) + 8;
  const minLeft = (system.left || 0) + (content.left || 0) + 8;
  const maxRight = page.viewportSize().width - (system.right || 0) - (content.right || 0) - 8;
  const positions = {};
  for (const selector of selectors) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box, `${selector} is visible`);
    positions[selector] = box;
    assert.ok(box.y >= minTop - 0.5, `${selector}: top ${box.y}px overlaps reserved ${minTop}px`);
    assert.ok(box.x >= minLeft - 0.5, `${selector}: left ${box.x}px overlaps reserved ${minLeft}px`);
    assert.ok(box.x + box.width <= maxRight + 0.5, `${selector}: right edge exceeds ${maxRight}px`);
  }
  return positions;
}

async function assertFullscreenControls(page, system = {}, content = {}, selectors = headerControls) {
  const viewport = page.viewportSize();
  const floor = viewport.width >= 600 && viewport.width > viewport.height ? 96 : 128;
  const minTop = Math.max((system.top || 0) + Math.max(content.top || 0, 56), floor) + 8;
  const positions = await assertControls(page, system, content, selectors);
  assert.ok(await page.locator('.telegram-fullscreen').count(), 'Fullscreen fallback class remains active');
  for (const [selector, box] of Object.entries(positions)) {
    assert.ok(box.y >= minTop - 0.5, `${selector}: top ${box.y}px overlaps fullscreen reservation ${minTop}px`);
  }
  return positions;
}

async function screenshot(page, name, system = {}, content = {}) {
  await page.evaluate(({ system, content }) => {
    document.getElementById('test-native-controls')?.remove();
    const layer = document.createElement('div');
    layer.id = 'test-native-controls';
    layer.style.cssText = `position:fixed;z-index:99999;pointer-events:none;top:${system.top || 0}px;left:${system.left || 0}px;right:${system.right || 0}px;height:${content.top || 0}px;display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(230,160,30,.17);border-bottom:1px dashed #9a6500;font:12px sans-serif;color:#252525;`;
    layer.innerHTML = '<span style="border-radius:20px;padding:8px;background:#ddd">× Close</span><span style="border-radius:20px;padding:8px;background:#ddd">⌄ ···</span>';
    document.body.appendChild(layer);
  }, { system, content });
  await page.screenshot({ path: path.join(evidenceDir, name + '.png') });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
  });
  let failures = 0;
  const results = [];
  async function test(name, callback, options) {
    const app = await createApp(browser, options);
    try {
      await callback(app.page);
      assert.deepEqual(app.errors, [], 'No uncaught application errors');
      assert.deepEqual(app.mutations, [], 'No API mutations attempted');
      results.push({ name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      results.push({ name, passed: false, error: error.message });
      console.error(`FAIL ${name}: ${error.message}`);
      await app.page.screenshot({ path: path.join(evidenceDir, name + '-failure.png') });
    } finally {
      await app.context.close();
    }
  }

  await test('fullscreen-request-has-synchronous-clearance', async page => {
    const requests = await nativeRequests(page, 'web_app_request_fullscreen');
    assert.equal(requests.length, 1, 'Supported launch requests fullscreen exactly once');
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0, 'App must never request a fullscreen exit');
    assert.ok((await nativeRequests(page, 'web_app_expand')).length > 0, 'App also requests expanded height');
    assert.equal(requests[0].fullscreenClass, true, 'Fullscreen padding is enabled before the native request');
    for (const selector of headerControls) {
      const box = requests[0].positions[selector];
      assert.ok(box && box.y >= 136 - 0.5, `${selector} is safe at the native bridge call, before acknowledgement`);
    }
    assert.equal(await page.evaluate(() => Telegram.WebApp.isFullscreen), false, 'Client has not acknowledged fullscreen yet');
    await assertFullscreenControls(page);
    await screenshot(page, 'fullscreen-pending-native-ack', { top: 59 }, { top: 56 });
  });
  await test('initial-fullscreen-does-not-request-again-or-exit', async page => {
    assert.equal(await page.evaluate(() => Telegram.WebApp.isFullscreen), true);
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 0, 'Already-fullscreen launch needs no duplicate request');
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0);
    await assertFullscreenControls(page);
    await insets(page, { top: 59, bottom: 34 }, { top: 56 });
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 0, 'Inset events must not request fullscreen again');
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0);
    await assertFullscreenControls(page, { top: 59 }, { top: 56 });
  }, { fullscreen: true });
  await test('fullscreen-zero-insets-clear-native-controls', async page => {
    await insets(page, zero, zero, true);
    await assertFullscreenControls(page);
    // These native controls occupy their real fixture area even though the
    // simulated client reports zero. Padding cannot depend on positive events.
    await assertControls(page, { top: 59 }, { top: 56 });
    await screenshot(page, 'fullscreen-zero-insets', { top: 59 }, { top: 56 });
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0);
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 1);
  });
  await test('fullscreen-missing-content-inset-clears-native-controls', async page => {
    await page.evaluate(() => {
      Telegram.WebView.receiveEvent('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 });
      Telegram.WebView.receiveEvent('fullscreen_changed', { is_fullscreen: true });
    });
    await settle(page);
    assert.equal(await page.evaluate(() => Telegram.WebApp.contentSafeAreaInset.top), 0, 'Content inset event intentionally never arrives');
    await assertFullscreenControls(page, { top: 59 });
    await assertControls(page, { top: 59 }, { top: 56 });
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0);
  });
  await test('legacy-client-stays-expanded-without-fullscreen-gap', async page => {
    assert.ok((await nativeRequests(page, 'web_app_expand')).length > 0);
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 0);
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0, 'Legacy clients must not receive unsupported fullscreen calls');
    await assertNoFullscreenGap(page);
  }, { version: '7.10' });
  await test('iphone-portrait', async page => {
    await insets(page, { top: 59, bottom: 34 }, { top: 56 });
    await assertFullscreenControls(page, { top: 59 }, { top: 56 });
    await screenshot(page, 'iphone-portrait', { top: 59 }, { top: 56 });
  });
  await test('android-portrait', async page => {
    await insets(page, { top: 24, bottom: 24 }, { top: 56 });
    await assertFullscreenControls(page, { top: 24 }, { top: 56 });
  }, { platform: 'android' });
  await test('larger-native-insets-beat-minimum-reservation', async page => {
    await insets(page, { top: 90, bottom: 34 }, { top: 90 });
    await assertFullscreenControls(page, { top: 90 }, { top: 90 });
    await screenshot(page, 'larger-native-insets', { top: 90 }, { top: 90 });
    // Device insets still combine with the native-controls fallback if only
    // device geometry arrives and it is larger than the portrait floor.
    await insets(page, { top: 90, bottom: 34 }, zero);
    await assertFullscreenControls(page, { top: 90 });
  });
  await test('landscape-side-insets', async page => {
    await insets(page, { left: 44, right: 44, bottom: 21 }, { top: 56 });
    await assertFullscreenControls(page, { left: 44, right: 44 }, { top: 56 });
    await screenshot(page, 'landscape-side-insets', { left: 44, right: 44 }, { top: 56 });
  }, { viewport: { width: 844, height: 390 } });
  await test('orientation-change-updates-zero-inset-fallback', async page => {
    await insets(page, zero, zero, true);
    const portrait = await assertFullscreenControls(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await settle(page);
    const landscape = await assertFullscreenControls(page);
    assert.ok(landscape[headerControls[0]].y < portrait[headerControls[0]].y - 20, 'Landscape does not retain the portrait reservation');
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await assertFullscreenControls(page);
  });
  await test('portrait-keyboard-keeps-zero-inset-clearance', async page => {
    await insets(page, zero, zero, true);
    await page.setViewportSize({ width: 390, height: 300 });
    await settle(page);
    await assertFullscreenControls(page);
    await assertControls(page, { top: 59 }, { top: 56 });
    await screenshot(page, 'portrait-keyboard-zero-insets', { top: 59 }, { top: 56 });
  });
  await test('asynchronous-insets-and-native-fullscreen-exit', async page => {
    // Safe-area events can arrive while the fullscreen request is pending.
    await page.evaluate(() => Telegram.WebView.receiveEvent('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 }));
    await settle(page);
    await assertFullscreenControls(page, { top: 59 });
    await page.evaluate(() => Telegram.WebView.receiveEvent('fullscreen_changed', { is_fullscreen: true }));
    await settle(page);
    await assertFullscreenControls(page, { top: 59 });
    await page.evaluate(() => Telegram.WebView.receiveEvent('content_safe_area_changed', { top: 56, bottom: 0, left: 0, right: 0 }));
    await settle(page);
    await assertFullscreenControls(page, { top: 59 }, { top: 56 });
    await insets(page, zero, zero, false);
    await assertNoFullscreenGap(page);
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0, 'Only the simulated native client exited fullscreen');
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 1, 'Native exit must not trigger an automatic fullscreen loop');
    await insets(page, zero, zero, true);
    await assertFullscreenControls(page);
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 1, 'Native reentry must not trigger another request');
  });
  await test('fullscreen-rejected-clears-fallback-without-another-event', async page => {
    await assertFullscreenControls(page);
    await page.evaluate(() => Telegram.WebView.receiveEvent('fullscreen_failed', { error: 'UNSUPPORTED' }));
    await settle(page);
    assert.equal(await page.evaluate(() => Telegram.WebApp.isFullscreen), false);
    await assertNoFullscreenGap(page);
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 1);
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0);
  });
  await test('already-fullscreen-error-keeps-reservation', async page => {
    await page.evaluate(() => Telegram.WebView.receiveEvent('fullscreen_failed', { error: 'ALREADY_FULLSCREEN' }));
    await settle(page);
    assert.equal(await page.evaluate(() => Telegram.WebApp.isFullscreen), true, 'Official SDK recognizes the native fullscreen state');
    await assertFullscreenControls(page);
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 1);
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0);
  });
  await test('ordinary-browser-without-fullscreen-gap', async page => {
    await assertNoFullscreenGap(page);
    assert.equal((await nativeRequests(page, 'web_app_request_fullscreen')).length, 0);
    assert.equal((await nativeRequests(page, 'web_app_exit_fullscreen')).length, 0);
  }, { browser: true });
  await test('profile-and-sidebar', async page => {
    await insets(page, { top: 59, bottom: 34 }, { top: 56 });
    await page.locator('#profile-trigger').click();
    await assertFullscreenControls(page, { top: 59 }, { top: 56 }, ['#profile-back']);
    await page.locator('#profile-back').click();
    await page.locator('#header-sidebar-button').click();
    await page.locator('.sidebar-panel').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    await assertFullscreenControls(page, { top: 59 }, { top: 56 }, ['.sidebar-group-row:first-child .sidebar-group-name']);
    await screenshot(page, 'sidebar', { top: 59 }, { top: 56 });
  });
  await test('banking-reflows-after-inset-change', async page => {
    await insets(page, { top: 24 }, { top: 56 });
    await page.locator('#app-title-toggle').click();
    await settle(page);
    async function assertBankingTop() {
      const header = await page.locator('.app-header').boundingBox();
      const banking = await page.locator('#view-banking').boundingBox();
      assert.ok(banking && header, 'Banking section and header are visible');
      assert.ok(Math.abs(banking.y - (header.y + header.height)) <= 1, `Banking top ${banking.y}px differs from header bottom ${header.y + header.height}px`);
      return banking.y;
    }
    const before = await assertBankingTop();
    await insets(page, { top: 90 }, { top: 90 });
    const after = await assertBankingTop();
    assert.ok(after > before + 30, 'Banking iframe follows increased native insets beyond the minimum reservation');
    await assertFullscreenControls(page, { top: 90 }, { top: 90 });
  });

  await browser.close();
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify({ htmlPath, sdkPath, simulation: true, results }, null, 2));
  console.log(`${results.length - failures}/${results.length} passed. Screenshots: ${evidenceDir}`);
  if (failures) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
