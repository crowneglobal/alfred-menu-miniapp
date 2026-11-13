/* A task's actual Telegram conversation. No client-created history or identity. */
(() => {
  'use strict';
  const host = document.getElementById('task-conversation');
  if (!host) return;
  let active = null;
  let returnFocus = null;
  const drafts = new Map();
  const element = (tag, cls, text) => {
    const el = document.createElement(tag); if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text; return el;
  };
  const button = (text, fn, label) => {
    const el = element('button', 'conversation-action', text); el.type = 'button';
    if (label) el.setAttribute('aria-label', label); el.addEventListener('click', fn); return el;
  };
  function sourceLink(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 't.me' ? url.href : null; } catch (_) { return null; }
  }
  function identity() {
    const user = typeof telegramUser !== 'undefined' ? telegramUser : null;
    if (!user) return 'your Telegram account';
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    return (name || 'You') + (user.username ? ' (@' + user.username + ')' : '');
  }
  const senderName = message => message.sender?.name || (message.sender?.username ? '@' + message.sender.username : 'Telegram user');
  function controls(state) {
    if (active !== state) return;
    state.send.disabled = !state.canComment || state.draft.sending || !state.input.value.trim();
    state.send.textContent = state.draft.sending ? 'Sending…' : 'Send';
    state.input.disabled = !state.canComment || state.draft.sending;
    state.identity.textContent = state.canComment ? 'Posting as ' + identity() : 'Read only';
    state.older.hidden = !state.cursor; state.older.disabled = state.loading;
    state.refresh.disabled = state.loading;
    state.reply.hidden = !state.draft.reply;
    state.replyLabel.textContent = state.draft.reply ? 'Replying to ' + state.draft.reply.name : '';
  }
  function renderMessages(state, older = false) {
    if (active !== state) return;
    const previousHeight = state.list.scrollHeight;
    const previousTop = state.list.scrollTop;
    const nearBottom = previousHeight - previousTop - state.list.clientHeight < 70;
    const existing = new Map([...state.list.querySelectorAll('[data-message-id]')].map(el => [el.dataset.messageId, el]));
    const dayNodes = new Map([...state.list.querySelectorAll('[data-message-date]')].map(el => [el.dataset.messageDate, el]));
    const desired = [];
    const messages = [...state.messages.values()].sort((a, b) => Number(a.id) - Number(b.id));
    let date = '';
    for (const message of messages) {
      const parsed = new Date(message.date);
      const day = Number.isNaN(parsed.valueOf()) ? '' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (day && day !== date) { const separator = dayNodes.get(day) || element('div', 'conversation-day', day); separator.dataset.messageDate = day; desired.push(separator); date = day; }
      const parent = message.reply_to_id ? state.messages.get(String(message.reply_to_id)) : null;
      const signature = JSON.stringify([message, state.canComment, parent?.text, parent?.sender]);
      const previous = existing.get(String(message.id));
      if (previous?.dataset.signature === signature) { desired.push(previous); continue; }
      const article = element('article', 'conversation-message' + (message.is_self ? ' is-self' : ''));
      article.dataset.messageId = String(message.id); article.dataset.signature = signature;
      const meta = element('div', 'conversation-meta');
      meta.append(element('strong', '', senderName(message) + (message.is_self ? ' · You' : '')));
      const time = element('time', '', Number.isNaN(parsed.valueOf()) ? '' : parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      if (!Number.isNaN(parsed.valueOf())) time.dateTime = parsed.toISOString(); meta.append(time);
      article.append(meta);
      if (message.reply_to_id) {
        const parent = state.messages.get(String(message.reply_to_id));
        const label = parent ? '↳ ' + senderName(parent) + ': ' + (parent.text || 'Attachment').slice(0, 110) : '↳ Reply';
        article.append(element('div', 'conversation-quote', label));
      }
      if (message.text) article.append(element('p', 'conversation-text', message.text));
      if (message.media) {
        const attachment = element('div', 'conversation-media', message.media.name || message.media.type || 'Attachment');
        // Media may require account authorization. Open only a supplied Telegram source link.
        const href = sourceLink(message.media.url);
        if (href) { const link = element('a', '', 'Open'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; attachment.append(link); }
        if (message.media.download_url) {
          const download = button('Open attachment', () => loadAttachment(state, message, attachment, download)); attachment.append(download);
        }
        article.append(attachment);
      }
      if (state.canComment) article.append(button('Reply', () => {
        state.draft.reply = { id: message.id, name: senderName(message) }; controls(state); state.input.focus();
      }, 'Reply to ' + senderName(message)));
      desired.push(article);
    }
    if (!messages.length) desired.push(element('p', 'conversation-empty', state.source?.kind === 'unlinked' ? 'This task has no linked Telegram conversation.' : 'No messages yet.'));
    // Reconcile in place so polling or a new reply does not interrupt a playing attachment.
    desired.forEach((el, index) => { if (state.list.children[index] !== el) state.list.insertBefore(el, state.list.children[index] || null); });
    [...state.list.children].slice(desired.length).forEach(el => el.remove());
    if (older) state.list.scrollTop = previousTop + state.list.scrollHeight - previousHeight;
    else if (nearBottom || !state.initialized) state.list.scrollTop = state.list.scrollHeight;
    else state.list.scrollTop = previousTop;
    state.initialized = true;
  }
  function notice(state, text, error = false) {
    state.notice.textContent = text || ''; state.notice.hidden = !text;
    state.notice.setAttribute('role', error ? 'alert' : 'status');
  }
  async function read(state, { older = false, refresh = false } = {}) {
    if (active !== state || state.loading || (older && !state.cursor)) return;
    state.loading = true; controls(state);
    if (!refresh && !older) notice(state, 'Loading conversation…');
    const params = new URLSearchParams({ limit: '50', scope: state.scope }); if (older) params.set('before_id', state.cursor);
    try {
      const response = await taskApiFetch('/api/tasks/' + encodeURIComponent(state.id) + '/conversation?' + params, { signal: state.abort.signal });
      let result = {}; try { result = await response.json(); } catch (_) {}
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) { state.messages.clear(); state.list.replaceChildren(); state.objectUrls.forEach(url => URL.revokeObjectURL(url)); state.objectUrls = []; }
        throw new Error(typeof result.detail === 'string' ? result.detail : 'Could not load this conversation.');
      }
      if (active !== state) return;
      if (!Array.isArray(result.messages)) throw new Error('Conversation unavailable. Try again.');
      // Merge by Telegram message ID; refresh never drops pages already loaded.
      for (const message of result.messages) if (message && message.id != null) state.messages.set(String(message.id), message);
      if (!refresh || !state.initialized) state.cursor = result.next_cursor;
      state.canComment = result.can_comment === true; state.source = result.source;
      state.scopePicker.hidden = !(result.source?.available_scopes?.includes('thread') && result.source.available_scopes.includes('topic'));
      state.scopePicker.value = state.scope === 'auto' ? result.source?.kind || 'thread' : state.scope;
      if (!state.canComment) state.draft.reply = null;
      const href = sourceLink(result.source?.url); state.sourceLink.hidden = !href;
      if (href) state.sourceLink.href = href; else state.sourceLink.removeAttribute('href');
      notice(state, result.notice || (result.source?.kind === 'unlinked' ? 'Link this task to a Telegram request to continue the conversation.' : state.canComment ? '' : 'Connect your Telegram account to comment.'));
      renderMessages(state, older);
    } catch (error) {
      if (active !== state || error.name === 'AbortError') return;
      state.canComment = false;
      notice(state, error.message || 'Connection interrupted. Try refreshing.', true);
    } finally { state.loading = false; controls(state); }
  }
  async function send(state) {
    const text = state.input.value.trim();
    if (active !== state || !state.canComment || state.draft.sending || !text) return;
    const replyId = state.draft.reply?.id;
    const previous = state.draft.submission;
    // A manual retry of the unchanged message reuses the idempotency key.
    const submission = previous && previous.text === text && previous.reply_to_message_id === replyId && previous.scope === state.scope ? previous : {
      text, scope: state.scope, client_request_id: crypto.randomUUID(), ...(replyId ? { reply_to_message_id: replyId } : {})
    };
    state.draft.submission = submission; state.draft.sending = true; controls(state); notice(state, '');
    try {
      const response = await taskApiFetch('/api/tasks/' + encodeURIComponent(state.id) + '/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission)
      });
      let result = {}; try { result = await response.json(); } catch (_) {}
      if (!response.ok || !result.ok || !result.message?.id) throw new Error(typeof result.detail === 'string' ? result.detail : 'Could not confirm sending. Refresh the conversation before trying again.');
      state.draft.text = ''; state.draft.reply = null; state.draft.submission = null;
      // The sender and timestamp come only from the confirmed Telegram response.
      if (active?.id === state.id) {
        const current = active;
        if (current.scope === state.scope) current.messages.set(String(result.message.id), result.message);
        else read(current, { refresh: true });
        current.input.value = '';
        notice(current, 'Sent.'); renderMessages(current); current.list.scrollTop = current.list.scrollHeight;
      }
    } catch (error) {
      if (active?.id === state.id) notice(active, error.message || 'Could not confirm sending. Refresh before trying again.', true);
    } finally {
      state.draft.sending = false;
      if (active?.id === state.id) { controls(active); if (active.canComment) active.input.focus(); }
    }
  }
  async function loadAttachment(state, message, container, control) {
    const expected = '/api/tasks/' + encodeURIComponent(state.id) + '/conversation/' + encodeURIComponent(message.id) + '/media';
    let url;
    try { url = new URL(message.media.download_url, location.origin); } catch (_) { notice(state, 'Attachment link unavailable.', true); return; }
    if (url.origin !== location.origin || url.pathname !== expected) { notice(state, 'Attachment link unavailable.', true); return; }
    if (message.media.size > 20 * 1024 * 1024) { notice(state, 'Open this attachment in Telegram.', true); return; }
    control.disabled = true; control.textContent = 'Loading…';
    try {
      const response = await taskApiFetch(url.pathname + url.search, { signal: state.abort.signal });
      if (!response.ok) throw new Error('Could not open this attachment.');
      const blob = await response.blob();
      if (active !== state) return;
      if (blob.size > 20 * 1024 * 1024) throw new Error('Open this attachment in Telegram.');
      const href = URL.createObjectURL(blob); state.objectUrls.push(href);
      let media;
      if (/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) { media = element('img'); media.alt = message.media.name || 'Telegram image'; }
      else if (blob.type.startsWith('audio/')) { media = element('audio'); media.controls = true; }
      else if (blob.type.startsWith('video/')) { media = element('video'); media.controls = true; }
      if (media) { media.src = href; container.append(media); }
      else { const link = element('a', '', 'Download ' + (message.media.name || 'attachment')); link.href = href; link.download = message.media.name || 'attachment'; container.append(link); link.click(); }
      control.remove();
    } catch (error) {
      if (active !== state || error.name === 'AbortError') return;
      notice(state, error.message || 'Could not open this attachment.', true); control.disabled = false; control.textContent = 'Open attachment';
    }
  }
  function close() {
    if (active) { active.draft.text = active.input.value; active.abort.abort(); clearInterval(active.timer); active.objectUrls.forEach(url => URL.revokeObjectURL(url)); active = null; }
    host.replaceChildren(); document.body.classList.remove('conversation-open');
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); returnFocus = null;
  }
  function open(row, requestedScope = 'auto') {
    const focused = document.activeElement; close(); returnFocus = focused;
    document.body.classList.add('conversation-open');
    const id = row.dataset.taskId;
    if (!id) { host.append(element('p', 'conversation-empty', 'Save this task before opening its conversation.')); return; }
    if (!drafts.has(id)) drafts.set(id, { text: '', reply: null, sending: false, submission: null });
    const state = { id, row, scope: requestedScope, objectUrls: [], draft: drafts.get(id), messages: new Map(), cursor: null, canComment: false, abort: new AbortController(), loading: false };
    active = state;
    const heading = element('div', 'conversation-heading'); heading.append(element('h2', '', 'Conversation'));
    state.sourceLink = element('a', 'conversation-source', 'Telegram ↗'); state.sourceLink.target = '_blank'; state.sourceLink.rel = 'noopener noreferrer'; state.sourceLink.hidden = true;
    state.refresh = button('↻', () => read(state, { refresh: true }), 'Refresh conversation');
    state.scopePicker = element('select', 'conversation-scope'); state.scopePicker.setAttribute('aria-label', 'Conversation scope'); state.scopePicker.hidden = true;
    for (const value of ['thread', 'topic']) { const option = element('option', '', value === 'thread' ? 'Thread' : 'Whole topic'); option.value = value; state.scopePicker.append(option); }
    state.scopePicker.addEventListener('change', () => { const scope = state.scopePicker.value; state.draft.reply = null; open(row, scope); active.scopePicker.focus(); });
    heading.append(state.scopePicker, state.sourceLink, state.refresh); host.append(heading);
    state.notice = element('p', 'conversation-notice'); state.notice.setAttribute('aria-live', 'polite'); host.append(state.notice);
    state.older = button('Earlier messages', () => read(state, { older: true })); state.older.classList.add('conversation-older'); state.older.hidden = true; host.append(state.older);
    state.list = element('div', 'conversation-messages'); state.list.setAttribute('role', 'log'); state.list.setAttribute('aria-label', 'Telegram messages'); state.list.tabIndex = 0; host.append(state.list);
    const form = element('form', 'conversation-compose');
    state.reply = element('div', 'conversation-reply'); state.reply.hidden = true; state.replyLabel = element('span');
    state.reply.append(state.replyLabel, button('×', () => { state.draft.reply = null; controls(state); state.input.focus(); }, 'Cancel reply')); form.append(state.reply);
    state.input = element('textarea', 'conversation-input'); state.input.rows = 2; state.input.maxLength = 4000;
    state.input.placeholder = 'Write a message…'; state.input.setAttribute('aria-label', 'Message'); state.input.value = state.draft.text;
    state.input.addEventListener('input', () => { state.draft.text = state.input.value; controls(state); });
    state.input.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send(state); } });
    form.append(state.input); const footer = element('div', 'conversation-compose-footer');
    state.identity = element('span', 'conversation-identity'); state.send = element('button', 'conversation-send', 'Send'); state.send.type = 'submit'; footer.append(state.identity, state.send); form.append(footer);
    form.addEventListener('submit', event => { event.preventDefault(); send(state); }); host.append(form);
    controls(state); read(state);
    state.timer = setInterval(() => { if (!document.hidden && !state.draft.sending) read(state, { refresh: true }); }, 15000);
    document.getElementById('detail-close').focus({ preventScroll: true });
  }
  document.addEventListener('visibilitychange', () => { if (active && !document.hidden) read(active, { refresh: true }); });
  document.getElementById('detail-overlay').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeDetail(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...document.getElementById('detail-sheet').querySelectorAll('a[href],button,select,textarea,input,summary,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  window.AlfredTaskConversation = { open, close };
})();
