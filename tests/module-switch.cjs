const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');

test('fullscreen switch occupies Telegram center slot and stays outside the app header', () => {
  assert.match(html, /<nav class="module-switch"[^>]*aria-label="Switch between Tasks and Banking"/);
  assert.match(html, /html\.telegram-fullscreen \.module-switch \{ display: flex; \}/);
  assert.match(html, /left: 50%;[\s\S]*transform: translateX\(-50%\)/);
  assert.ok(html.indexOf('<nav class="module-switch"') < html.indexOf('<header class="app-header"'));
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
