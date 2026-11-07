const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');

test('one full-name switch replaces simultaneous module labels with additional eight pixel gap', () => {
  const nav = html.match(/<nav class="module-switch"[\s\S]*?<\/nav>/)[0];
  assert.equal((nav.match(/<button/g) || []).length, 1);
  assert.match(nav, /Alfred Tasks ⇄/);
  assert.doesNotMatch(nav, />Bank<|>Tasks</);
  assert.match(html, /top: calc\(var\(--app-device-safe-top\) \+ 10px\);/);
  assert.match(html, /background: #F2F3EB; color: #293129;/);
  assert.match(html, /font-size: 16px; line-height: 30px;/);
  assert.match(html, /height: 30px; min-height: 30px; padding: 0 10px;/);
  assert.match(html, /module-switch-button::before[^}]*inset: -7px 0/);
  assert.doesNotMatch(html, /body\.banking-mode \.module-switch-button \{ background: #D7E88F/);
});

test('switch toggles both directions, preserves remembered state and dismisses hint once', () => {
  const vm = require('node:vm');
  const elements = new Map();
  const make = () => ({style:{},childNodes:[{}],textContent:'',hidden:false,attrs:{},listeners:{},classList:{toggle(){},add(){},remove(){},contains(){return false}},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,v){this.listeners[k]=v},getBoundingClientRect(){return {bottom:80}}});
  const get = id => { if(!elements.has(id)) elements.set(id,make()); return elements.get(id); };
  const storage = new Map();
  const context = {userId:'test',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},URLSearchParams,ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),window:{location:{search:'?section=bank',hash:''},addEventListener(){}},document:{getElementById:get,querySelector:get,body:make(),documentElement:{style:{setProperty(){}}}}};
  const start = html.indexOf('    const sectionStateKey =');
  const end = html.indexOf('    // ── Top nav quick-filters',start);
  const script = html.slice(start,end);
  vm.runInNewContext(script,context);
  const button=get('module-switch-toggle');
  assert.equal(button.textContent,'Alfred Bank ⇄');
  assert.equal(storage.get('alfred:last-section:telegram:test'),undefined);
  button.listeners.click();
  assert.equal(button.textContent,'Alfred Tasks ⇄');
  assert.equal(storage.get('alfred:last-section:telegram:test'),'planning');
  assert.equal(get('module-switch-hint').hidden,true);
  button.listeners.click();
  assert.equal(button.textContent,'Alfred Bank ⇄');
  context.window.location.search='';
  vm.runInNewContext(script,{...context});
  assert.equal(button.textContent,'Alfred Bank ⇄');
  assert.equal(get('module-switch-hint').hidden,true);
  context.window.location.search='?section=tasks';
  vm.runInNewContext(script,{...context});
  assert.equal(button.textContent,'Alfred Tasks ⇄');
  assert.equal(storage.get('alfred:last-section:telegram:test'),'banking');
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

test('task home navigation and date stay in the header while the date remains centered in the tray', () => {
  const headerClosePosition = html.indexOf('</header>');
  const trayPosition = html.indexOf('<div class="bottom-sheet" id="bottom-sheet">');
  const datePosition = html.indexOf('<div id="date-week-bar"');
  const dateSpanPosition = html.indexOf('<span id="date-week-bar"');
  assert.ok(headerClosePosition > -1);
  assert.ok(trayPosition > headerClosePosition);
  assert.equal(datePosition, -1);
  assert.ok(dateSpanPosition > trayPosition);
  assert.ok(html.indexOf('id="home-date-week-bar"') < headerClosePosition);
  assert.match(html, /data-qf="home">Home<\/button>/);
  assert.match(html, /data-qf="departments">Departments<\/button>/);
  assert.match(html, /#context-tabs \{[^}]*margin-top: 0 !important;/);
  assert.match(html, /\.sheet-handle-bar \{ height: 38px; flex-direction: column; gap: 6px;/);
  assert.match(html, /#date-week-bar \{[^}]*text-align: center;/);
});
