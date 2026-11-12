/* Classic script: all views project the authenticated feed's original task rows. */
(() => {
  'use strict';
  const toolbar = document.getElementById('task-layout-toolbar');
  const board = document.getElementById('shared-task-board');
  const calendar = document.getElementById('shared-task-calendar');
  const labels = { todo: 'To do', progress: 'In Progress', stuck: 'Stuck', done: 'Done' };
  const colors = { todo: '#8A9580', stuck: '#B85248', progress: '#C07840', done: '#6E9E5E' };
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  let mode = 'list';
  let sortables = [];
  const node = (tag, cls, text) => {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const dayKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const validDue = row => /^\d{4}-\d{2}-\d{2}$/.test(row.dataset.due || '') && dayKey(new Date(row.dataset.due + 'T12:00:00')) === row.dataset.due;
  const visibleRows = () => syncAllTasks().filter(row => !row.classList.contains('hidden') && !row.closest('.week-hidden'));
  function open(row) { enhanceRow(row); openDetail(row); }
  function card(row) {
    const item = node('article', 'shared-task-card');
    item.dataset.taskId = row.dataset.taskId || '';
    const button = node('button', 'shared-task-open'); button.type = 'button';
    button.append(node('span', 'shared-task-group', row.dataset.group || 'Ungrouped'), node('span', 'shared-task-name', row.querySelector('.task-name').textContent));
    const meta = node('span', 'shared-task-meta');
    meta.append(node('span', '', row.dataset.assignee || 'Unassigned'));
    if (validDue(row)) meta.append(node('span', 'shared-task-due' + (row.dataset.due < dayKey(new Date()) && row.dataset.status !== 'done' ? ' overdue' : ''), new Date(row.dataset.due + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })));
    button.append(meta); button.addEventListener('click', () => open(row)); item.append(button);
    const select = node('select', 'shared-task-status');
    select.setAttribute('aria-label', 'Status for ' + row.querySelector('.task-name').textContent);
    for (const [status, label] of Object.entries(labels)) { const option = node('option', '', label); option.value = status; select.append(option); }
    select.value = row.dataset.status;
    select.disabled = !!row.dataset.statusSaving || !row.dataset.taskId || taskFeedState !== 'ready';
    select.addEventListener('change', async () => { await saveTaskStatus(row, select.value); render(); });
    item.append(select); return item;
  }
  function renderBoard(rows) {
    sortables.forEach(sortable => sortable.destroy?.()); sortables = [];
    board.replaceChildren();
    for (const [status, label] of Object.entries(labels)) {
      const lane = node('section', 'shared-task-lane'); lane.dataset.status = status;
      lane.style.setProperty('--lane-color', colors[status]);
      const matching = rows.filter(row => row.dataset.status === status);
      const heading = node('h2', 'shared-task-lane-heading', label); heading.append(node('small', '', String(matching.length))); lane.append(heading);
      const cards = node('div', 'shared-task-lane-cards'); cards.dataset.status = status;
      matching.forEach(row => cards.append(card(row))); lane.append(cards);
      if (!matching.length) cards.append(node('p', 'shared-task-empty', taskFeedState === 'loading' ? 'Loading tasks…' : taskFeedState === 'error' ? 'Task feed unavailable.' : 'No tasks in this stage.'));
      board.append(lane);
      sortables.push(Sortable.create(cards, {
        group: 'shared-task-states', draggable: '.shared-task-card', animation: 150,
        delay: 180, delayOnTouchOnly: true, filter: 'select,option', preventOnFilter: false,
        disabled: taskFeedState !== 'ready',
        onEnd: async event => {
          const row = allTasks.find(item => item.dataset.taskId === event.item.dataset.taskId);
          const target = event.to.dataset.status;
          render();
          if (row && Object.hasOwn(labels, target)) await saveTaskStatus(row, target);
        }
      }));
    }
  }
  function eventButton(row) {
    const button = node('button', 'task-calendar-event', row.querySelector('.task-name').textContent);
    button.type = 'button'; button.dataset.taskId = row.dataset.taskId || '';
    button.style.setProperty('--lane-color', colors[row.dataset.status]);
    button.title = (row.dataset.assignee || 'Unassigned') + ' · ' + labels[row.dataset.status];
    button.addEventListener('click', () => open(row)); return button;
  }
  function renderCalendar(rows) {
    calendar.replaceChildren();
    const header = node('div', 'task-calendar-header');
    const heading = node('h2', '', month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })); heading.id = 'task-calendar-month'; header.append(heading);
    for (const [label, text, action] of [['Previous month', '‹', () => month.setMonth(month.getMonth() - 1)], ['Current month', 'Today', () => { const today = new Date(); month.setFullYear(today.getFullYear(), today.getMonth(), 1); }], ['Next month', '›', () => month.setMonth(month.getMonth() + 1)]]) {
      const button = node('button', '', text); button.type = 'button'; button.setAttribute('aria-label', label);
      button.addEventListener('click', () => { action(); render(); }); header.append(button);
    }
    calendar.append(header);
    const scroll = node('div', 'task-calendar-scroll');
    const grid = node('div', 'task-calendar-grid'); grid.setAttribute('aria-labelledby', heading.id);
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => grid.append(node('div', 'task-calendar-weekday', day)));
    const date = new Date(month); date.setDate(1 - date.getDay());
    const end = new Date(month); end.setMonth(end.getMonth() + 1, 0);
    const cellCount = Math.ceil((month.getDay() + end.getDate()) / 7) * 7;
    const dated = new Map(); const undated = [];
    rows.forEach(row => { if (!validDue(row)) undated.push(row); else { if (!dated.has(row.dataset.due)) dated.set(row.dataset.due, []); dated.get(row.dataset.due).push(row); } });
    let shown = 0;
    for (let i = 0; i < cellCount; i++, date.setDate(date.getDate() + 1)) {
      const key = dayKey(date);
      const cell = node('div', 'task-calendar-day' + (date.getMonth() !== month.getMonth() ? ' outside' : '') + (key === dayKey(new Date()) ? ' today' : ''));
      cell.dataset.date = key;
      const label = node('time', 'task-calendar-date', String(date.getDate())); label.dateTime = key; cell.append(label);
      for (const row of dated.get(key) || []) { cell.append(eventButton(row)); shown++; }
      grid.append(cell);
    }
    scroll.append(grid); calendar.append(scroll);
    const note = rows.length - undated.length - shown;
    calendar.append(node('p', 'task-calendar-summary', shown + ' scheduled here' + (note > 0 ? ' · ' + note + ' in other months' : '') + ' · Same task filters as List and Kanban'));
    calendar.append(node('h3', 'task-calendar-undated-title', 'No due date · ' + undated.length));
    const unscheduled = node('div', 'task-calendar-undated'); undated.forEach(row => unscheduled.append(eventButton(row)));
    if (!undated.length) unscheduled.append(node('p', 'shared-task-empty', 'All matching tasks have a due date.'));
    calendar.append(unscheduled);
  }
  function render() {
    const available = !homeActive && !boardActive;
    const active = available && !todayActive;
    toolbar.hidden = !available;
    board.hidden = !active || mode !== 'board'; calendar.hidden = !active || mode !== 'calendar';
    document.body.dataset.taskLayout = active ? mode : '';
    toolbar.querySelectorAll('[data-task-layout]').forEach(button => button.setAttribute('aria-pressed', String(active && button.dataset.taskLayout === mode)));
    const rows = visibleRows();
    document.getElementById('task-layout-count').textContent = rows.length + (rows.length === 1 ? ' task' : ' tasks');
    if (!board.hidden) renderBoard(rows);
    if (!calendar.hidden) renderCalendar(rows);
  }
  function select(next) {
    if (!['list', 'board', 'calendar'].includes(next)) return;
    mode = next;
    exitBoardView(); setHomeMode(false); setTodayMode(false);
    document.querySelectorAll('#nav-planning .section-tab').forEach(button => button.classList.toggle('active', button.dataset.qf === 'week'));
    applyAllFilters();
  }
  toolbar.querySelectorAll('[data-task-layout]').forEach(button => button.addEventListener('click', () => select(button.dataset.taskLayout)));
  document.getElementById('topnav-week').addEventListener('click', () => select(mode));
  window.AlfredTaskViews = { render, select };
  render();
})();
