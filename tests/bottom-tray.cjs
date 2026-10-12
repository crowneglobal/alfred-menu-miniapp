#!/usr/bin/env node
'use strict';

// Exercises the bottom tray against local task/SDK fixtures only. Opening the
// creation form is tested without submitting, and every network write is blocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const evidenceDir = process.env.EVIDENCE_DIR || '/tmp/miniapp-bottom-tray-evidence-20261012';
process.env.EVIDENCE_DIR = evidenceDir;
const { createApp, settle, viewport, screenshot, assertSearchGeometry, assertRestored } = require('./search-layout.cjs');
fs.mkdirSync(evidenceDir, { recursive: true });

async function assertTray(page, expanded) {
  await settle(page);
  assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), String(expanded));
  assert.equal(await page.locator('#tray-actions').isVisible(), expanded);
  assert.equal(await page.locator('#tray-search-trigger').isVisible(), expanded);
  assert.equal(await page.locator('#tray-new-task').isVisible(), expanded);
  for (const selector of ['#sheet-handle', '#profile-trigger', '.sheet-pinned [data-status="stuck"]', '.sheet-pinned [data-status="progress"]', '.sheet-pinned [data-status="done"]']) {
    assert.equal(await page.locator(selector).isVisible(), true, `${selector} stays available`);
  }
}

async function swipeHandle(page, deltaY) {
  await page.locator('#sheet-handle').evaluate((handle, deltaY) => {
    const box = handle.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    function send(type, position) {
      const point = new Touch({ identifier: 1, target: handle, clientX: x, clientY: position, pageX: x + scrollX, pageY: position + scrollY });
      handle.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [point],
        targetTouches: type === 'touchend' ? [] : [point],
        changedTouches: [point],
      }));
    }
    send('touchstart', y);
    send('touchmove', y + deltaY);
    send('touchend', y + deltaY);
  }, deltaY);
  await settle(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath() });
  const results = [];
  async function test(name, callback, options) {
    const app = await createApp(browser, options);
    try {
      await callback(app.page);
      assert.deepEqual(app.errors, [], 'No uncaught application errors');
      assert.deepEqual(app.mutations, [], 'No API mutations attempted');
      results.push({ name, passed: true }); console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
      await screenshot(app.page, `${name}-failure`);
    } finally { await app.context.close(); }
  }

  await test('tray-default-hides-search-and-new-task', async page => {
    await assertTray(page, false);
    assert.equal(await page.locator('#header-search-button, #header-add-button').count(), 0, 'No duplicated search or add actions remain in the header');
    assert.equal(await page.locator('#sheet-handle').evaluate(node => node.tagName), 'BUTTON', 'Handle has native keyboard behavior');
    assert.equal(await page.locator('#sheet-handle').getAttribute('aria-controls'), 'tray-actions', 'Handle identifies its drawer');
    for (const selector of ['#tray-search-trigger', '#tray-new-task']) {
      await page.locator(selector).evaluate(node => node.focus());
      assert.notEqual(await page.evaluate(() => document.activeElement.id), selector.slice(1), 'Collapsed actions cannot receive focus');
    }
    await screenshot(page, 'tray-collapsed');
  });

  await test('tray-click-and-keyboard-toggle', async page => {
    await page.locator('#sheet-handle').click();
    await assertTray(page, true);
    await screenshot(page, 'tray-expanded');
    await page.locator('#sheet-handle').press('Enter');
    await assertTray(page, false);
    await page.locator('#sheet-handle').press('Space');
    await assertTray(page, true);
    await page.locator('#sheet-handle').click();
    await assertTray(page, false);
  });

  await test('tray-handle-swipes-expand-and-collapse', async page => {
    await swipeHandle(page, -90);
    await assertTray(page, true);
    await swipeHandle(page, 90);
    await assertTray(page, false);
    await swipeHandle(page, -5);
    await assertTray(page, false);
  });

  await test('trusted-touch-swipes-and-taps-preserve-tray-actions', async page => {
    const client = await page.context().newCDPSession(page);
    await page.evaluate(() => {
      window.__trayTouchEvidence = [];
      for (const type of ['touchstart', 'touchend', 'touchcancel', 'click']) {
        document.addEventListener(type, event => {
          const target = event.target.closest('[id]');
          window.__trayTouchEvidence.push({ type, trusted: event.isTrusted, target: target?.id });
        }, { capture: true });
      }
    });
    async function touch(selector, deltaY = 0) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box, `${selector} is visible before trusted touch`);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
      });
      if (deltaY) {
        for (let step = 1; step <= 6; step++) {
          await client.send('Input.dispatchTouchEvent', {
            type: 'touchMove', touchPoints: [{ x, y: y + deltaY * step / 6, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
          });
          await settle(page);
        }
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      // Allow compatibility mouse/click events, including a delayed mobile click,
      // to arrive before asserting the final tray state.
      await page.waitForTimeout(400);
      await settle(page);
    }
    await touch('#sheet-handle', -90);
    await assertTray(page, true);
    await touch('#sheet-handle', 90);
    await assertTray(page, false);
    const swipeEvidence = await page.evaluate(() => window.__trayTouchEvidence.slice());
    assert.equal(swipeEvidence.filter(event => event.type === 'touchstart' && event.trusted).length, 2, 'Browser dispatched two trusted touch gestures');
    assert.equal(swipeEvidence.filter(event => event.type === 'touchend' && event.trusted).length, 2, 'Both trusted swipes reached touchend');
    assert.equal(swipeEvidence.filter(event => event.type === 'touchcancel').length, 0, 'Native scrolling did not cancel the handle gestures');
    assert.equal(swipeEvidence.filter(event => event.type === 'click').length, 0, 'Swipes produce no compatibility click that reverses expansion');

    await touch('#sheet-handle');
    await assertTray(page, true);
    assert.equal(await page.evaluate(() => window.__trayTouchEvidence.filter(event => event.type === 'click' && event.trusted && event.target === 'sheet-handle').length), 1, 'Trusted handle tap produces exactly one click');
    await touch('#tray-search-trigger');
    assert.equal(await page.locator('#search-overlay').isVisible(), true);
    assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search-overlay-input', 'Search receives focus after a trusted tap');
    await touch('#search-exit');
    await assertTray(page, false);
    await touch('#sheet-handle');
    await touch('#tray-new-task');
    assert.equal(await page.locator('#modal-overlay').isVisible(), true);
    assert.equal(await page.locator('#create-modal-title').textContent(), 'New Task');
    assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), 'false');
    await touch('#modal-overlay .btn-cancel');
    await assertTray(page, false);
    const evidence = await page.evaluate(() => window.__trayTouchEvidence);
    assert.ok(evidence.every(event => event.trusted), 'Gesture evidence contains browser-generated events only');
    fs.writeFileSync(path.join(evidenceDir, 'trusted-touch-events.json'), JSON.stringify(evidence, null, 2) + '\n');
    await client.detach();
  }, { hasTouch: true });

  await test('tray-search-keeps-keyboard-layout-and-restores-collapsed', async page => {
    await page.locator('#sheet-handle').click();
    await page.locator('#tray-search-trigger').click();
    assert.equal(await page.locator('#sheet-handle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search-overlay-input');
    await page.locator('#search-overlay-input').fill('Alpha');
    await viewport(page, { height: 544 });
    await assertSearchGeometry(page);
    await screenshot(page, 'tray-search-keyboard', 544);
    await page.locator('#search-exit').click();
    await viewport(page, { height: 844 });
    await assertRestored(page);
    await assertTray(page, false);
  });

  await test('tray-new-task-opens-existing-form-without-submit', async page => {
    const rowsBefore = await page.locator('.week-section .task-row').count();
    await page.locator('#sheet-handle').click();
    await page.locator('#tray-new-task').click();
    assert.equal(await page.locator('#modal-overlay').isVisible(), true);
    assert.equal(await page.locator('#create-modal-title').textContent(), 'New Task');
    assert.equal(await page.locator('#create-submit').textContent(), 'Add Task');
    await page.locator('#new-task-name').fill('Local test, do not create');
    await page.locator('#modal-overlay .btn-cancel').click();
    assert.equal(await page.locator('#modal-overlay').isVisible(), false);
    assert.equal(await page.locator('.week-section .task-row').count(), rowsBefore, 'Cancel adds no task');
    await assertTray(page, false);
  });

  await test('tray-profile-works-from-collapsed-and-expanded', async page => {
    for (const expanded of [false, true]) {
      if (expanded) await page.locator('#sheet-handle').click();
      await page.locator('#profile-trigger').click();
      assert.equal(await page.locator('#profile-view').isVisible(), true);
      assert.equal(await page.locator('#profile-name').textContent(), 'Darren');
      await page.locator('#profile-back').click();
      assert.equal(await page.locator('#profile-view').isVisible(), false);
      assert.equal(await page.locator('#sheet-handle').isVisible(), true);
    }
  });

  await test('last-task-can-scroll-above-collapsed-and-expanded-tray', async page => {
    for (const expanded of [false, true]) {
      if (expanded) await page.locator('#sheet-handle').click();
      await assertTray(page, expanded);
      const row = page.locator('.week-section .task-row:not(.hidden)').last();
      await row.scrollIntoViewIfNeeded();
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await settle(page);
      const rowBox = await row.boundingBox();
      const tray = await page.locator('#bottom-sheet').boundingBox();
      assert.ok(rowBox.y >= 0, 'Last task remains on screen');
      assert.ok(rowBox.y + rowBox.height <= tray.y + 1, `Last task bottom ${rowBox.y + rowBox.height}px is above tray top ${tray.y}px`);
      await screenshot(page, `tray-${expanded ? 'expanded' : 'collapsed'}-last-task`);
    }
  });

  await browser.close();
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify({ htmlPath: process.env.MINIAPP_HTML || path.join(__dirname, '..', 'index.html'), simulation: true, results }, null, 2) + '\n');
  const failures = results.filter(result => !result.passed).length;
  console.log(`${results.length - failures}/${results.length} passed`);
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
