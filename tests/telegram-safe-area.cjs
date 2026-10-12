#!/usr/bin/env node
'use strict';

// Run with Playwright installed and TG_SDK_PATH pointing to a saved official
// https://telegram.org/js/telegram-web-app.js. All browser requests are fulfilled
// locally or blocked, including the task API and banking iframe.
// MINIAPP_HTML may point to a baseline HTML file to demonstrate the regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const htmlPath = process.env.MINIAPP_HTML || path.join(__dirname, '..', 'index.html');
const sdkPath = process.env.TG_SDK_PATH || '/tmp/telegram-web-app-safe-area-20261011.js';
const evidenceDir = process.env.EVIDENCE_DIR || '/tmp/miniapp-safe-area-evidence-2026-10-11';
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
      postEvent(type, data) { window.__nativeRequests.push({ type, data }); },
    };
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    intercepted.push(request.url());
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
        contentType: 'application/json', body: '[]',
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (url.hostname === 'banking.crowne-cards.com') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Bank fixture</title><p>Local banking fixture</p>' });
    }
    // Images and every other unrecognized resource never reach the network.
    return route.abort('blockedbyclient');
  });
  const params = new URLSearchParams({
    tgWebAppVersion: '8.0',
    tgWebAppPlatform: options.platform || 'ios',
    tgWebAppData: new URLSearchParams({ user: JSON.stringify({ id: 999999, first_name: 'Test', username: 'fixture' }) }).toString(),
  });
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

  await test('iphone-portrait', async page => {
    await insets(page, { top: 59, bottom: 34 }, { top: 56 });
    await screenshot(page, 'iphone-portrait', { top: 59 }, { top: 56 });
    await assertControls(page, { top: 59 }, { top: 56 });
  });
  await test('android-portrait', async page => {
    await insets(page, { top: 24, bottom: 24 }, { top: 56 });
    await assertControls(page, { top: 24 }, { top: 56 });
  }, { platform: 'android' });
  await test('landscape-side-insets', async page => {
    await insets(page, { left: 44, right: 44, bottom: 21 }, { top: 56 });
    await assertControls(page, { left: 44, right: 44 }, { top: 56 });
    await screenshot(page, 'landscape-side-insets', { left: 44, right: 44 }, { top: 56 });
  }, { viewport: { width: 844, height: 390 } });
  await test('asynchronous-insets-and-fullscreen-exit', async page => {
    await insets(page, zero, zero, false);
    await assertControls(page, zero, zero);
    let box = await page.locator(headerControls[0]).boundingBox();
    assert.ok(box.y <= 20, `Windowed header retains ${box.y}px top gap`);
    // Dispatch these separately, matching native safe-area events arriving later.
    await page.evaluate(() => Telegram.WebView.receiveEvent('fullscreen_changed', { is_fullscreen: true }));
    await page.evaluate(() => Telegram.WebView.receiveEvent('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 }));
    await settle(page);
    await page.evaluate(() => Telegram.WebView.receiveEvent('content_safe_area_changed', { top: 56, bottom: 0, left: 0, right: 0 }));
    await settle(page);
    await assertControls(page, { top: 59 }, { top: 56 });
    await insets(page, zero, zero, false);
    await assertControls(page, zero, zero);
    box = await page.locator(headerControls[0]).boundingBox();
    assert.ok(box.y <= 20, `Fullscreen exit retains ${box.y}px top gap`);
  });
  await test('fullscreen-rejected', async page => {
    await page.evaluate(() => Telegram.WebView.receiveEvent('fullscreen_failed', { error: 'UNSUPPORTED' }));
    await insets(page, zero, zero, false);
    await assertControls(page, zero, zero);
    const box = await page.locator(headerControls[0]).boundingBox();
    assert.ok(box.y <= 20, `Rejected fullscreen retains ${box.y}px top gap`);
  });
  await test('ordinary-browser', async page => {
    await assertControls(page, zero, zero);
    const box = await page.locator(headerControls[0]).boundingBox();
    assert.ok(box.y <= 20, `Browser header retains ${box.y}px top gap`);
  }, { browser: true });
  await test('profile-and-sidebar', async page => {
    await insets(page, { top: 59, bottom: 34 }, { top: 56 });
    await page.locator('#profile-trigger').click();
    await assertControls(page, { top: 59 }, { top: 56 }, ['#profile-back']);
    await page.locator('#profile-back').click();
    await page.locator('#header-sidebar-button').click();
    await page.locator('.sidebar-panel').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    await assertControls(page, { top: 59 }, { top: 56 }, ['.sidebar-group-row:first-child .sidebar-group-name']);
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
    await insets(page, { top: 59 }, { top: 56 });
    const after = await assertBankingTop();
    assert.ok(after > before + 30, 'Banking iframe follows increased system inset');
    await assertControls(page, { top: 59 }, { top: 56 });
  });

  await browser.close();
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify({ htmlPath, sdkPath, results }, null, 2));
  console.log(`${results.length - failures}/${results.length} passed. Screenshots: ${evidenceDir}`);
  if (failures) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
