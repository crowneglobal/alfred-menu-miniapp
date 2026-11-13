/* Classic script: all views project the authenticated feed's original task rows. */
(() => {
  'use strict';
  const toolbar = document.getElementById('task-layout-toolbar');
  const board = document.getElementById('shared-task-board');
  const calendar = document.getElementById('shared-task-calendar');
  // Older cached app HTML can load a refreshed script before the mini app is reopened.
  let insights = document.getElementById('shared-task-insights');
  if (!insights) {
    insights = document.createElement('section'); insights.id = 'shared-task-insights';
    insights.className = 'shared-task-insights'; insights.hidden = true;
    calendar.after(insights);
  }
  const extraModes = ['overview', 'gantt', 'timeline', 'workflow', 'dashboard'];
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
    const fullTitle = row.querySelector('.task-name').textContent;
    button.setAttribute('aria-label', fullTitle);
    button.append(node('span', 'shared-task-name', fullTitle));
    if (!activeGroupFilter) button.append(node('span', 'shared-task-group', row.dataset.group || 'Ungrouped'));
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
      if (!matching.length && taskFeedState !== 'ready') cards.append(node('p', 'shared-task-empty', taskFeedState === 'loading' ? 'Loading tasks…' : 'Task feed unavailable.'));
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
      button.addEventListener('click', () => { action(); render(); calendar.querySelector('[aria-label="' + label + '"]')?.focus({ preventScroll: true }); }); header.append(button);
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
    calendar.append(node('p', 'task-calendar-summary', shown + ' scheduled here' + (note > 0 ? ' · ' + note + ' in other months' : '')));
    calendar.append(node('h3', 'task-calendar-undated-title', 'No due date · ' + undated.length));
    const unscheduled = node('div', 'task-calendar-undated'); undated.forEach(row => unscheduled.append(eventButton(row)));
    if (!undated.length) unscheduled.append(node('p', 'shared-task-empty', 'All matching tasks have a due date.'));
    calendar.append(unscheduled);
  }
  const titleOf = row => row.querySelector('.task-name').textContent;
  const dateLabel = value => new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  function action(text, callback, cls = 'task-view-action') {
    const button = node('button', cls, text); button.type = 'button';
    button.addEventListener('click', callback); return button;
  }
  function empty(text, parent = insights) { parent.append(node('p', 'shared-task-empty', text)); }
  function summary(rows) {
    const today = dayKey(new Date());
    return { total: rows.length, done: rows.filter(r => r.dataset.status === 'done').length,
      overdue: rows.filter(r => validDue(r) && r.dataset.due < today && r.dataset.status !== 'done').length,
      undated: rows.filter(r => !validDue(r)).length };
  }
  function metrics(rows) {
    const counts = summary(rows); const grid = node('div', 'task-view-metrics');
    for (const [key, label] of [['total', 'Total'], ['done', 'Completed'], ['overdue', 'Overdue'], ['undated', 'No due date']]) {
      const item = node('div', 'task-view-metric'); item.dataset.metric = key;
      item.append(node('strong', '', String(counts[key])), node('span', '', label)); grid.append(item);
    }
    return grid;
  }
  function taskList(rows, parent, message) {
    const list = node('div', 'task-view-task-list');
    rows.forEach(row => {
      const button = action('', () => open(row), 'task-view-task'); button.dataset.taskId = row.dataset.taskId;
      button.style.setProperty('--lane-color', colors[row.dataset.status]);
      button.append(node('strong', '', titleOf(row)), node('span', '', (row.dataset.assignee || 'Unassigned') + ' · ' + labels[row.dataset.status] + (validDue(row) ? ' · ' + dateLabel(row.dataset.due) : '')));
      list.append(button);
    });
    if (!rows.length) empty(message || 'No matching tasks.', list);
    parent.append(list);
  }
  function renderOverview(rows) {
    insights.append(metrics(rows));
    const counts = summary(rows); const progress = node('div', 'task-view-progress');
    progress.append(node('span', '', counts.done + ' of ' + counts.total + ' tasks completed'));
    const meter = document.createElement('progress'); meter.max = counts.total || 1; meter.value = counts.done;
    meter.setAttribute('aria-label', 'Task completion'); progress.append(meter); insights.append(progress);
    const columns = node('div', 'task-view-columns');
    const attention = node('section', 'task-view-panel'); attention.append(node('h3', '', 'Needs attention'));
    const urgent = rows.filter(r => r.dataset.status === 'stuck' || (validDue(r) && r.dataset.due < dayKey(new Date()) && r.dataset.status !== 'done'));
    taskList(urgent.slice(0, 6), attention, 'No stuck or overdue tasks.');
    if (urgent.length > 6) attention.append(node('p', 'task-view-note', 'Showing 6 of ' + urgent.length + ' tasks needing attention.'));
    const next = node('section', 'task-view-panel'); next.append(node('h3', '', 'Upcoming due dates'));
    const upcoming = rows.filter(r => validDue(r) && r.dataset.due >= dayKey(new Date()) && r.dataset.status !== 'done').sort((a, b) => a.dataset.due.localeCompare(b.dataset.due));
    taskList(upcoming.slice(0, 6), next, 'No upcoming due dates. Undated tasks remain in List and Kanban.');
    if (upcoming.length > 6) next.append(node('p', 'task-view-note', 'Showing the next 6 of ' + upcoming.length + ' dated tasks.'));
    columns.append(attention, next); insights.append(columns, action('Open all matching tasks', () => select('list')));
  }
  function monthHeader(parent) {
    const header = node('div', 'task-calendar-header');
    header.append(node('h3', '', month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })));
    for (const [label, text, update] of [
      ['Previous month', '‹', () => month.setMonth(month.getMonth() - 1)],
      ['Current month', 'Today', () => { const now = new Date(); month.setFullYear(now.getFullYear(), now.getMonth(), 1); }],
      ['Next month', '›', () => month.setMonth(month.getMonth() + 1)]
    ]) {
      const button = action(text, () => { update(); render(); parent.querySelector('[aria-label="' + label + '"]')?.focus({ preventScroll: true }); });
      button.setAttribute('aria-label', label); header.append(button);
    }
    parent.append(header);
  }
  function monthRows(rows) {
    const prefix = dayKey(month).slice(0, 7);
    return rows.filter(row => validDue(row) && row.dataset.due.startsWith(prefix)).sort((a, b) => a.dataset.due.localeCompare(b.dataset.due) || titleOf(a).localeCompare(titleOf(b)));
  }
  function unscheduled(rows, scheduled) {
    const other = rows.filter(r => validDue(r)).length - scheduled.length;
    const note = node('p', 'task-view-note', scheduled.length + ' scheduled this month' + (other ? ' · ' + other + ' in other months' : '') + '. Dates come from each task’s saved due date.');
    insights.append(note);
    const undated = rows.filter(r => !validDue(r));
    const section = node('section', 'task-view-undated'); section.append(node('h3', '', 'No due date · ' + undated.length));
    taskList(undated, section, 'Every matching task has a due date.'); insights.append(section);
  }
  function renderTimeline(rows) {
    monthHeader(insights); const scheduled = monthRows(rows);
    const timeline = node('div', 'task-view-timeline');
    const dates = [...new Set(scheduled.map(row => row.dataset.due))];
    dates.forEach(date => {
      const group = node('section', 'task-timeline-day'); group.dataset.date = date;
      const heading = node('h3', '', dateLabel(date)); group.append(heading);
      taskList(scheduled.filter(row => row.dataset.due === date), group); timeline.append(group);
    });
    if (!dates.length) empty('No due dates this month. Browse another month or open an undated task below.', timeline);
    insights.append(timeline); unscheduled(rows, scheduled);
  }
  function renderGantt(rows) {
    monthHeader(insights);
    insights.append(node('p', 'task-view-note', '◆ Due-date milestones. Task durations and dependency links are not recorded yet.'));
    const scheduled = monthRows(rows); const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const scroll = node('div', 'task-gantt-scroll'); scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Scrollable task schedule'); scroll.tabIndex = 0;
    const chart = node('div', 'task-gantt-chart'); chart.style.setProperty('--days', days);
    const heading = node('div', 'task-gantt-row task-gantt-head'); heading.append(node('div', 'task-gantt-label', 'Task / due date'));
    const scale = node('div', 'task-gantt-track');
    for (let i = 1; i <= days; i++) scale.append(node('span', '', String(i)));
    heading.append(scale); chart.append(heading);
    for (const [status, label] of Object.entries(labels)) {
      const matching = scheduled.filter(row => row.dataset.status === status); if (!matching.length) continue;
      chart.append(node('h3', 'task-gantt-stage', label + ' · ' + matching.length));
      matching.forEach(row => {
        const line = node('div', 'task-gantt-row'); line.dataset.taskId = row.dataset.taskId;
        const name = action('', () => open(row), 'task-gantt-label');
        name.append(node('strong', '', titleOf(row)), node('small', '', row.dataset.assignee || 'Unassigned'));
        const track = node('div', 'task-gantt-track'); track.style.setProperty('--lane-color', colors[status]);
        const marker = action('◆', () => open(row), 'task-gantt-milestone'); marker.style.gridColumn = String(Number(row.dataset.due.slice(-2)));
        marker.setAttribute('aria-label', titleOf(row) + ', due ' + dateLabel(row.dataset.due)); marker.title = marker.getAttribute('aria-label'); track.append(marker);
        const now = new Date(); if (now.getMonth() === month.getMonth() && now.getFullYear() === month.getFullYear()) track.style.setProperty('--today', now.getDate() - 0.5);
        line.append(name, track); chart.append(line);
      });
    }
    scroll.append(chart); insights.append(scroll);
    if (!scheduled.length) empty('No tasks have due dates in this month.');
    unscheduled(rows, scheduled);
  }
  function renderWorkflow(rows) {
    insights.append(node('p', 'task-view-note', 'Move work from To do to In Progress to Done. Put blocked tasks in Stuck. Status changes save to the same task everywhere.'));
    const flow = node('div', 'task-workflow');
    for (const status of ['todo', 'progress', 'done', 'stuck']) {
      const matching = rows.filter(row => row.dataset.status === status);
      const stage = node('section', 'task-workflow-stage'); stage.dataset.status = status; stage.style.setProperty('--lane-color', colors[status]);
      stage.append(node('h3', '', labels[status] + ' · ' + matching.length));
      const list = node('div', 'task-workflow-tasks'); matching.forEach(row => list.append(card(row)));
      stage.append(list); flow.append(stage);
    }
    insights.append(flow);
  }
  function bars(title, entries, total, colorByKey = false) {
    const section = node('section', 'task-view-panel'); section.append(node('h3', '', title));
    for (const [key, count] of entries) {
      const row = node('div', 'task-dashboard-bar');
      row.append(node('span', '', colorByKey ? labels[key] : key), node('strong', '', String(count)));
      const track = node('div', 'task-dashboard-track'); const fill = node('div', 'task-dashboard-fill');
      fill.style.width = (total ? count / total * 100 : 0) + '%'; if (colorByKey) fill.style.background = colors[key];
      track.append(fill); row.append(track); section.append(row);
    }
    if (!entries.length) empty('No matching tasks.', section); return section;
  }
  function renderDashboard(rows) {
    insights.append(metrics(rows));
    const counts = summary(rows); const percent = counts.total ? Math.round(counts.done / counts.total * 100) : 0;
    insights.append(node('p', 'task-dashboard-completion', percent + '% complete'));
    const columns = node('div', 'task-view-columns');
    columns.append(bars('Status', Object.keys(labels).map(key => [key, rows.filter(row => row.dataset.status === key).length]), rows.length, true));
    const grouped = new Map(); rows.forEach(row => { const key = row.dataset.group || 'Ungrouped'; grouped.set(key, (grouped.get(key) || 0) + 1); });
    columns.append(bars('Groups', [...grouped].sort((a, b) => b[1] - a[1]), rows.length));
    insights.append(columns, node('p', 'task-view-note', 'All totals follow the current group, assignee, status and search filters.'));
  }
  function renderInsights(rows) {
    insights.replaceChildren(); insights.dataset.view = mode;
    insights.setAttribute('aria-label', 'Task ' + mode);
    const heading = node('div', 'task-view-heading');
    heading.append(node('h2', '', mode.charAt(0).toUpperCase() + mode.slice(1)), node('span', '', typeof activeGroupFilter !== 'undefined' && activeGroupFilter ? activeGroupFilter : 'All matching tasks'));
    // View name and group are already in the single toolbar above.
    if (taskFeedState !== 'ready') { empty(taskFeedState === 'loading' ? 'Loading tasks…' : 'Task feed unavailable.'); return; }
    ({ overview: renderOverview, gantt: renderGantt, timeline: renderTimeline, workflow: renderWorkflow, dashboard: renderDashboard })[mode](rows);
  }
  function render() {
    const available = !homeActive && !boardActive;
    const active = available && !todayActive;
    toolbar.hidden = !available;
    board.hidden = !active || mode !== 'board'; calendar.hidden = !active || mode !== 'calendar';
    insights.hidden = !active || !extraModes.includes(mode);
    document.body.dataset.taskLayout = active ? mode : '';
    toolbar.querySelectorAll('[data-task-layout]').forEach(button => button.setAttribute('aria-pressed', String(active && button.dataset.taskLayout === mode)));
    const rows = visibleRows();
    document.getElementById('task-layout-count').textContent = String(rows.length);
    document.getElementById('task-layout-count').setAttribute('aria-label', rows.length + ' matching tasks');
    if (viewSelect) viewSelect.value = mode;
    const scope = document.getElementById('task-view-scope');
    if (scope) scope.textContent = activeGroupFilter || '';
    if (!board.hidden) renderBoard(rows);
    if (!calendar.hidden) renderCalendar(rows);
    if (!insights.hidden) renderInsights(rows);
    if (mode !== 'board') { sortables.forEach(sortable => sortable.destroy?.()); sortables = []; }
  }
  function select(next) {
    if (!['list', 'board', 'calendar', ...extraModes].includes(next)) return;
    mode = next;
    exitBoardView(); setHomeMode(false); setTodayMode(false);
    document.querySelectorAll('#nav-planning .section-tab').forEach(button => button.classList.toggle('active', button.dataset.qf === 'week'));
    applyAllFilters();
  }
  let viewSelect = document.getElementById('task-view-select');
  if (!viewSelect) {
    viewSelect = node('select', 'task-view-select'); viewSelect.id = 'task-view-select'; viewSelect.setAttribute('aria-label', 'View');
    for (const [key, label] of Object.entries({ overview: 'Overview', list: 'List', gantt: 'Gantt', board: 'Kanban', timeline: 'Timeline', calendar: 'Calendar', workflow: 'Workflow', dashboard: 'Dashboard' })) {
      const option = node('option', '', label); option.value = key; viewSelect.append(option);
    }
    toolbar.prepend(viewSelect);
  }
  toolbar.querySelector('.task-layout-tabs')?.setAttribute('hidden', '');
  viewSelect.addEventListener('change', () => select(viewSelect.value));
  toolbar.querySelectorAll('[data-task-layout]').forEach(button => button.addEventListener('click', () => select(button.dataset.taskLayout)));
  document.getElementById('topnav-week').addEventListener('click', () => select(mode));
  window.AlfredTaskViews = { render, select };
  render();
})();
