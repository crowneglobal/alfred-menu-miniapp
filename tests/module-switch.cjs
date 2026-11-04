const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');

test('fullscreen switch occupies Telegram center slot and stays outside the app header', () => {
  assert.match(html, /<nav class="module-switch"[^>]*aria-label="Switch between Tasks and Banking"/);
  assert.match(html, /html\.telegram-fullscreen \.module-switch \{ display: flex; \}/);
  assert.match(html, /left: 50%;[\s\S]*transform: translateX\(-50%\)/);
  assert.match(html, /top: calc\(var\(--app-device-safe-top\) \+ 2px\);/);
  assert.match(html, /width: clamp\(146px, 43vw, 172px\); height: 34px;/);
  assert.ok(html.indexOf('<nav class="module-switch"') < html.indexOf('<header class="app-header"'));
});

test('switch bubble tightens without shrinking its labels', () => {
  assert.match(html, /padding: 2px; border: 1px solid #9DB885;/);
  assert.match(html, /flex: 1; height: 28px;/);
  assert.match(html, /font-size: 12px; font-weight: 750;/);
});

test('switch uses the Alfred green, beige, and brown palette', () => {
  assert.match(html, /background: #C5D4A8;/);
  assert.match(html, /background: #442B22; color: #F5F2EA;/);
  assert.doesNotMatch(html, /background: #F28C28;/);
});

test('both switch buttons update the shared section state', () => {
  assert.match(html, /id="module-switch-tasks"[^>]*data-section="planning"/);
  assert.match(html, /id="module-switch-bank"[^>]*data-section="banking"/);
  assert.match(html, /document\.querySelectorAll\('\.module-switch-button'\)[\s\S]*switchSection\(button\.dataset\.section\)/);
  assert.match(html, /tasksButton\.setAttribute\('aria-pressed',[\s\S]*bankButton\.setAttribute\('aria-pressed'/);
});

test('banking hides the old header without hiding the fullscreen switch', () => {
  assert.match(html, /body\.banking-mode \.app-header \{ display: none; \}/);
  assert.doesNotMatch(html, /body\.banking-mode \.module-switch \{ display: none; \}/);
});

test('task navigation moves into the second row and the date follows beneath it', () => {
  const navigationPosition = html.indexOf('<div class="section-tabs" id="context-tabs"');
  const datePosition = html.indexOf('<div id="date-week-bar"');
  assert.ok(navigationPosition > -1);
  assert.ok(datePosition > navigationPosition);
  assert.match(html, /#context-tabs \{[^}]*margin-top: 0 !important;/);
  assert.match(html, /#date-week-bar \{[^}]*margin-top: 6px !important;/);
});
