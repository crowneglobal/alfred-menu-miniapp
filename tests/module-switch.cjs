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
  assert.match(html, /padding: 2px; border: 1px solid #A8C7AD;/);
  assert.match(html, /flex: 1; height: 28px;/);
  assert.match(html, /font-size: 12px; font-weight: 750;/);
});

test('switch uses coordinated sage and leaf green tones', () => {
  assert.match(html, /background: #DDECDD;/);
  assert.match(html, /background: #246B3F; color: #FFFFFF;/);
  assert.doesNotMatch(html.match(/\.module-switch \{[\s\S]*?\.module-switch-button\.active \{[\s\S]*?\}/)[0], /#442B22|#2B1500/);
  assert.doesNotMatch(html, /background: #F28C28;/);
});

test('selected Bank module uses the approved Fresh Lime treatment', () => {
  assert.match(html, /#module-switch-bank\.active \{[\s\S]*background: #D7E88F; color: #283018;/);
  assert.match(html, /\.module-switch-button\.active \{[\s\S]*background: #246B3F; color: #FFFFFF;/);
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

test('banking reserves Telegram safe areas instead of painting under native controls', () => {
  assert.match(html, /body\.banking-mode #view-banking \{[\s\S]*top: var\(--app-safe-top\);[\s\S]*bottom: var\(--app-safe-bottom\);/);
  assert.doesNotMatch(html, /body\.banking-mode #view-banking \{ inset: 0; \}/);
});

test('last-open module and deep links remain wired', () => {
  assert.match(html, /const sectionStateKey = `alfred:last-section:/);
  assert.match(html, /localStorage\.setItem\(sectionStateKey, activeSection\)/);
  assert.match(html, /switchSection\(explicitSection \|\| rememberedSection\(\) \|\| 'planning'/);
});

test('task navigation moves into the second row and the date follows beneath it', () => {
  const navigationPosition = html.indexOf('<div class="section-tabs" id="context-tabs"');
  const datePosition = html.indexOf('<div id="date-week-bar"');
  assert.ok(navigationPosition > -1);
  assert.ok(datePosition > navigationPosition);
  assert.match(html, /#context-tabs \{[^}]*margin-top: 0 !important;/);
  assert.match(html, /#date-week-bar \{[^}]*margin-top: 6px !important;/);
});
