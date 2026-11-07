const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bankingRoot = process.env.BANKING_ROOT || '/Users/alfredo/.openclaw/local-stack/apps/banking';
const tasks = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'tray/alfred-tray.css'), 'utf8');
const bankLayout = fs.readFileSync(path.join(bankingRoot, 'app/views/layouts/application.html.erb'), 'utf8');
const bankTray = fs.readFileSync(path.join(bankingRoot, 'app/javascript/layout/modules/BankingCompanyTray.vue'), 'utf8');

test('Tasks and Banking consume one canonical tray skin and skeleton class contract', () => {
  assert.match(tasks, /href="tray\/alfred-tray\.css"/);
  assert.match(bankLayout, /href="\/app\/tray\/alfred-tray\.css"/);
  for (const name of ['atray-handle', 'atray-date', 'atray-pinned', 'atray-create', 'atray-chips', 'atray-chip', 'atray-search', 'atray-menu', 'atray-row2', 'atray-org', 'atray-avatar']) {
    assert.ok(tasks.includes(name), `Tasks has ${name}`);
    assert.ok(bankTray.includes(name), `Banking has ${name}`);
    assert.ok(css.includes(`.${name}`), `canonical CSS owns ${name}`);
  }
});

test('compact strip keeps + left, words horizontal, search right, and no redundant text search', () => {
  const tasksPinned = tasks.slice(tasks.indexOf('<div class="atray-pinned">'), tasks.indexOf('<div class="atray-menu"'));
  const bankPinned = bankTray.slice(bankTray.indexOf('<div class="atray-pinned">'), bankTray.indexOf('<div v-if="createOpen"'));
  for (const pinned of [tasksPinned, bankPinned]) {
    assert.ok(pinned.indexOf('atray-create') < pinned.indexOf('atray-chips'));
    assert.ok(pinned.indexOf('atray-chips') < pinned.indexOf('atray-search'));
  }
  assert.match(css, /\.atray-chips \{[^}]*overflow-x: auto/);
  assert.doesNotMatch(tasksPinned, /type="search"|yellow|tray-search-trigger/i);
  assert.doesNotMatch(bankPinned, /type="search"|yellow|banking-company-trigger/i);
});

test('each app owns independent state and app-specific words only', () => {
  assert.match(tasks, />Stuck<\/button>/);
  assert.match(tasks, />In Progress<\/button>/);
  assert.match(tasks, />Done<\/button>/);
  assert.match(bankTray, /label: "Home"/);
  assert.match(bankTray, /label: "Transactions"/);
  assert.match(bankTray, /label: "Cards"/);
  assert.match(bankTray, /label: "Wallets"/);
  assert.match(bankTray, /rowOpen: false/);
  assert.match(tasks, /setTrayExpanded\(false\);/);
});
