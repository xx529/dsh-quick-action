// dsh-quick-action — browser half.
//
// One client, one native conversation. The strip never owns the sidebars and
// never replaces the native chat view: it only adds a tab row above the center
// column and asks the native navigation service to open a session.
//
// Status model (from ctx.uiSession.sessionStatus):
//   pendingInteraction.kind = "approval" | "question" | "plan-review"
//   running, completionUnread
//
// Empty-session model (from ctx.sessions.list):
//   a brand-new session is a persisted "blank" row with a real id. Native rules
//   show only the current blank. We keep that blank out of the persisted tab
//   list and render it as a shadow tab until it turns into a real session.

window.__ModuleLoader__.load({
  id: 'dsh-quick-action',
  factory: (require) => {
    var React = require('react');
    var KEY = 'dsh-quick-action.tabs.v1';
    var GLOBAL = '__dshQuickAction';
    var SOURCE = 'dsh-quick-action';

    var WORDS = {
      zh: {
        tabs: '会话标签', new: '新会话', unnamed: '未命名', close: '关闭标签',
        native: '切回原生视图', enable: '显示会话标签',
        running: '运行中', answer: '需要回答', approval: '需要审批', plan: '计划待审',
        unread: '已完成 · 未读', loading: '连接中', idle: '空闲',
        archived: '已归档，请先在左栏恢复', unavailable: '会话暂不可用', failed: '无法打开会话',
        hint: '⌘⇧[ / ⌘⇧] 切换会话；标签栏内 ← → 也可切换',
        add: '新建会话'
      },
      en: {
        tabs: 'Session tabs', new: 'New session', unnamed: 'Untitled', close: 'Close tab',
        native: 'Native view', enable: 'Show session tabs',
        running: 'Running', answer: 'Needs answer', approval: 'Needs approval', plan: 'Plan review',
        unread: 'Done · unread', loading: 'Connecting', idle: 'Idle',
        archived: 'Archived: restore it in the sidebar first', unavailable: 'Session unavailable', failed: 'Could not open session',
        hint: 'Cmd/Ctrl+Shift+[ / ] switches sessions; Arrow keys switch while the strip has focus',
        add: 'New session'
      }
    };

    var CSS = `
.qa-host{--qa-page:var(--dsw-alias-bg-base);--qa-line:var(--dsw-alias-border-l3);--qa-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,var(--qa-page));--qa-strip:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--qa-page));--qa-run:var(--dsw-alias-state-business-primary);--qa-warn:var(--dsw-alias-state-warn-primary);--qa-plan:var(--dsw-alias-state-done-primary);--qa-done:var(--dsw-alias-state-success-primary);--qa-err:var(--dsw-alias-state-error-primary);--qa-ter:var(--dsw-alias-label-tertiary);box-sizing:border-box;flex:0 0 auto;min-width:0;max-width:100%;color:var(--dsw-alias-label-primary);background:var(--qa-strip);font-family:inherit;font-size:14px;line-height:20px;-webkit-app-region:no-drag;padding-inline-start:var(--dsh-frame-leading-clearance,0px)}
.qa-host[hidden]{display:none!important}
.qa-strip{box-sizing:border-box;display:flex;align-items:stretch;min-width:0;height:47px;padding:7px 8px 0 12px;position:relative}
.qa-strip::before{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--qa-line);pointer-events:none}
html[data-platform=darwin] .qa-strip{height:48px}
.qa-list{display:flex;flex:0 1 auto;min-width:0;gap:4px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}
.qa-list::-webkit-scrollbar{display:none}
.qa-spacer{flex:1;min-width:8px}
.qa-add{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:28px;height:28px;margin-top:3px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--qa-ter);cursor:pointer;-webkit-app-region:no-drag}
.qa-add:hover{background:var(--qa-hover);color:var(--dsw-alias-label-secondary)}
.qa-add svg{width:15px;height:15px;display:block}
[data-qa-column]{min-height:0}
[data-qa-main]{flex:1 1 0!important;min-height:0!important;height:auto!important}
.qa-notice{padding:5px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.qa-notice[hidden]{display:none!important}
.qa-tab{box-sizing:border-box;position:relative;display:flex;flex:0 0 auto;width:200px;height:41px;border:1px solid transparent;border-bottom:0;border-radius:10px 10px 0 0;color:var(--dsw-alias-label-secondary);background:transparent;z-index:0}
.qa-tab[data-active=true]{color:var(--dsw-alias-label-primary);background:var(--qa-page);border-color:var(--qa-line);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);z-index:1}
.qa-tab[data-active=false]:is(:hover,:focus-within){background:var(--qa-hover)}
.qa-tab[data-pending=true][data-active=false]{background:color-mix(in srgb,var(--qa-state) 5%,transparent)}
.qa-tab-main{display:flex;flex-direction:column;justify-content:center;gap:1px;flex:1;min-width:0;padding:5px 8px 5px 13px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-app-region:no-drag;border-radius:10px 10px 0 0}
.qa-tab-main:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-3px}
.qa-ws{display:block;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:10px;line-height:12px;letter-spacing:.3px;color:var(--qa-ter)}
.qa-tab[data-active=true] .qa-ws{color:var(--dsw-alias-label-secondary)}
.qa-title{display:block;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.qa-tab[data-active=true] .qa-title{color:var(--dsw-alias-label-primary)}
.qa-tab[data-unread=true] .qa-title{color:var(--dsw-alias-label-primary);font-weight:500}
.qa-close{position:absolute;top:10px;right:4px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--qa-ter);cursor:pointer;opacity:0;transition:opacity .12s ease-out,background-color .12s ease-out;-webkit-app-region:no-drag}
.qa-close svg{width:12px;height:12px;display:block}
.qa-tab:is(:hover,:focus-within) .qa-close{opacity:.75}
.qa-tab[data-active=true] .qa-close{opacity:.55}
.qa-tab:is(:hover,:focus-within) .qa-close:hover{opacity:1;background:var(--qa-hover)}
.qa-badge{position:absolute;left:4px;top:3px;width:10px;height:10px;border-radius:50%;pointer-events:none;-webkit-app-region:no-drag}
.qa-badge[data-kind=idle]{display:none}
.qa-badge[data-kind=unread]{background:var(--qa-done)}
.qa-badge[data-kind=answer]{background:var(--qa-warn)}
.qa-badge[data-kind=approval]{background:color-mix(in srgb,var(--qa-err) 45%,var(--qa-warn))}
.qa-badge[data-kind=plan]{background:var(--qa-plan)}
.qa-badge[data-kind=answer],.qa-badge[data-kind=approval],.qa-badge[data-kind=plan]{box-shadow:0 0 0 1.5px color-mix(in srgb,var(--qa-badge-color) 45%,transparent)}
.qa-badge[data-kind=answer]{--qa-badge-color:var(--qa-warn)}
.qa-badge[data-kind=approval]{--qa-badge-color:color-mix(in srgb,var(--qa-err) 45%,var(--qa-warn))}
.qa-badge[data-kind=plan]{--qa-badge-color:var(--qa-plan)}
.qa-badge[data-kind=answer]::after,.qa-badge[data-kind=approval]::after,.qa-badge[data-kind=plan]::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1.5px solid var(--qa-badge-color);opacity:0;animation:qa-ping 2.2s cubic-bezier(.16,1,.3,1) infinite}
.qa-badge[data-kind=approval]::after{animation-duration:2.8s}
.qa-badge[data-kind=running],.qa-badge[data-kind=loading]{border-radius:50%;-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1.8px));mask:radial-gradient(farthest-side,transparent calc(100% - 1.6px),#000 calc(100% - 1.5px))}
.qa-badge[data-kind=running]{background:conic-gradient(var(--qa-run) 0 100deg,color-mix(in srgb,var(--qa-run) 16%,transparent) 100deg 360deg);animation:qa-spin 1.1s linear infinite}
.qa-badge[data-kind=loading]{background:conic-gradient(var(--qa-ter) 0 270deg,color-mix(in srgb,var(--qa-ter) 22%,transparent) 270deg 360deg);animation:qa-spin .8s linear infinite;opacity:.85}
.qa-badge[data-pulse=true]{animation:qa-pop .52s cubic-bezier(.34,1.56,.64,1)}
@keyframes qa-spin{to{transform:rotate(360deg)}}
@keyframes qa-ping{0%{transform:scale(.62);opacity:.55}70%{opacity:0}100%{transform:scale(1.5);opacity:0}}
@keyframes qa-pop{0%{transform:scale(.45)}60%{transform:scale(1.18)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.qa-badge,.qa-badge::after{animation:none!important}.qa-badge[data-kind=running]{background:conic-gradient(var(--qa-run) 0 92deg,color-mix(in srgb,var(--qa-run) 22%,transparent) 92deg 360deg)}.qa-badge[data-kind=loading]{background:conic-gradient(var(--qa-ter) 0 270deg,color-mix(in srgb,var(--qa-ter) 22%,transparent) 270deg 360deg)}}
.qa-mode{display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex:0 0 auto;padding:4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}
.qa-mode:hover{background:var(--dsw-alias-interactive-bg-hover)}
.qa-mode svg{display:block;width:18px;height:18px}
`;

    function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 512 && !/[\u0000-\u001f]/.test(id); }
    function parse(raw) {
      var value; try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { value = null; }
      if (!value || value.version !== 1) return { version: 1, enabled: true, ids: [], active: null };
      var ids = []; var seen = {};
      (Array.isArray(value.ids) ? value.ids : []).forEach(function (id) { if (validId(id) && !seen[id]) { seen[id] = true; ids.push(id); } });
      ids = ids.slice(0, 50);
      return { version: 1, enabled: value.enabled !== false, ids: ids, active: ids.indexOf(value.active) >= 0 ? value.active : null };
    }
    function serial(s) { return JSON.stringify({ version: 1, enabled: s.enabled, ids: s.ids, active: s.active }); }
    function basename(p) {
      if (typeof p !== 'string' || !p) return '';
      var parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
      return parts[parts.length - 1] || '';
    }
    function currentMain(list) {
      var byId = list && list.byId ? list.byId : {};
      var ids = Object.keys(byId);
      for (var i = 0; i < ids.length; i++) {
        var r = byId[ids[i]];
        if (r && r.retainedBy && (r.retainedBy.mainView || 0) > 0) return ids[i];
      }
      return null;
    }
    function createController(ctx, options) {
      options = options || {};
      var ls = options.storage, state;
      try { state = parse(ls && ls.getItem(KEY)); } catch (_) { state = parse(null); }
      var observers = new Set(), disposers = [], alive = true, notice = '', lastMain = null;
      var list = ctx.sessions.list.getSnapshot(), suppressed = null, draftId = null, syncing = false, again = false, saveTimer = null, restored = false;
      var changed = options.changed || function () {}, getLang = options.lang || function () { return 'en'; };
      function words() { return WORDS[getLang()] || WORDS.en; }
      function saveNow() { try { if (ls) ls.setItem(KEY, serial(state)); } catch (_) {} }
      function persist() { if (!ls || saveTimer !== null) return; saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, 60); }
      function emit() { observers.forEach(function (fn) { try { fn(); } catch (_) {} }); changed(); }
      function archived(id) { var snap = ctx.workspaces.list.getSnapshot(); return (snap.archivedSessionIds || []).indexOf(id) >= 0; }
      function status(id) {
        var live = ctx.uiSession.sessionStatus.getSnapshot().get(id);
        var row = list.byId[id];
        if (live && live.pendingInteraction) {
          var kind = live.pendingInteraction.kind;
          if (kind === 'approval') return 'approval';
          if (kind === 'plan-review') return 'plan';
          if (kind === 'question') return 'answer';
          return 'answer';
        }
        if (live && live.running === true) return 'running';
        if (row && row.running) return 'running';
        if (live && live.completionUnread) return 'unread';
        if (!row) return 'loading';
        return 'idle';
      }
      function workspaceName(id) {
        var snap = ctx.workspaces.list.getSnapshot(), items = snap.items || [], row = list.byId[id], i;
        for (i = 0; i < items.length; i++) {
          if ((items[i].sessionIds || []).indexOf(id) >= 0) return items[i].title || basename(items[i].path);
        }
        if (row && row.cwd) {
          for (i = 0; i < items.length; i++) if (items[i].path === row.cwd) return items[i].title || basename(items[i].path);
          return basename(row.cwd);
        }
        return '';
      }
      function titleOf(id) {
        var row = list.byId[id];
        if (!row) return words().loading;
        if (row.blank) return words().new;
        return row.title || words().unnamed;
      }
      function rows() {
        var out = [];
        state.ids.forEach(function (id) { out.push({ id: id, draft: false, workspace: workspaceName(id), title: titleOf(id), status: status(id) }); });
        if (draftId && state.ids.indexOf(draftId) < 0) out.push({ id: draftId, draft: true, workspace: workspaceName(draftId), title: titleOf(draftId), status: status(draftId) });
        return out;
      }
      function activeId() { return lastMain; }
      function sync() {
        if (!alive) return;
        if (syncing) { again = true; return; }
        syncing = true;
        try {
          do {
            again = false;
            list = ctx.sessions.list.getSnapshot();
            var main = currentMain(list);
            if (list.phase === 'ready') {
              var keep = state.ids.filter(function (s) {
                var r = list.byId[s];
                return !!r && !r.blank && !archived(s);
              });
              if (keep.length !== state.ids.length) { state.ids = keep; persist(); }
            }
            if (main && main !== suppressed) {
              var row = list.byId[main];
              if (row && row.blank) {
                var at = state.ids.indexOf(main);
                if (at >= 0) { state.ids.splice(at, 1); persist(); }
                draftId = main;
              } else if (row) {
                if (draftId === main) draftId = null;
                if (state.ids.indexOf(main) < 0) { state.ids.push(main); persist(); }
              }
            }
            if (draftId && draftId !== main) draftId = null;
            if (main && main !== suppressed && main !== lastMain) lastMain = main;
            if (main && main !== suppressed && state.active !== main) { state.active = main; persist(); }
            if (!restored && list.phase === 'ready') {
              restored = true;
              var saved = state.active;
              if (saved && state.enabled && state.ids.indexOf(saved) >= 0 && main !== saved && list.byId[saved] && !list.byId[saved].blank) {
                try { ctx.uiWorkspace.openSession(saved); } catch (_) {}
              }
            }
          } while (again);
        } finally { syncing = false; }
        emit();
      }
      function navigate(id) {
        if (!validId(id)) { notice = words().unavailable; emit(); return false; }
        var row = list.byId[id];
        if (!row && id !== draftId) { notice = words().unavailable; emit(); return false; }
        if (row && row.blank && id !== draftId) { notice = words().unavailable; emit(); return false; }
        if (archived(id)) { notice = words().archived; emit(); return false; }
        try { ctx.uiWorkspace.openSession(id); return true; } catch (_) { notice = words().failed; emit(); return false; }
      }
      function open(id) {
        notice = '';
        suppressed = null;
        if (id !== draftId && state.ids.indexOf(id) < 0 && validId(id)) { state.ids.push(id); persist(); }
        return navigate(id);
      }
      function close(id) {
        if (id === draftId) {
          if (!state.ids.length) return false;
          draftId = null;
          suppressed = id;
          open(state.ids[state.ids.length - 1]);
          sync();
          return true;
        }
        var index = state.ids.indexOf(id);
        if (index < 0) return false;
        state.ids.splice(index, 1);
        persist();
        if (id === lastMain) {
          suppressed = id;
          var next = state.ids[Math.min(index, state.ids.length - 1)];
          if (next) navigate(next);
          else { try { ctx.uiWorkspace.startSession(); } catch (_) { notice = words().failed; } }
        }
        sync();
        return true;
      }
      function newSession() {
        notice = '';
        suppressed = null;
        try { ctx.uiWorkspace.startSession(); } catch (_) { notice = words().failed; }
        sync();
      }
      function switchBy(delta) {
        var order = rows().map(function (r) { return r.id; });
        if (order.length < 2) return false;
        var i = order.indexOf(lastMain);
        if (i < 0) i = 0;
        var next = order[(i + delta + order.length) % order.length];
        if (!next || next === lastMain) return false;
        return open(next);
      }
      disposers.push(ctx.sessions.list.subscribe(sync));
      disposers.push(ctx.uiSession.sessionStatus.subscribe(sync));
      disposers.push(ctx.workspaces.list.subscribe(sync));
      var api = {
        words: words,
        status: status,
        snapshot: function () { return { enabled: state.enabled, ids: state.ids.slice(), rows: rows(), active: lastMain, draftId: draftId, notice: notice, storage: serial(state) }; },
        subscribe: function (fn) { observers.add(fn); return function () { observers.delete(fn); }; },
        open: open,
        close: close,
        newSession: newSession,
        switchBy: switchBy,
        setEnabled: function (value) { state.enabled = !!value; persist(); emit(); },
        dismiss: function () { notice = ''; emit(); },
        sync: sync,
        dispose: function () { if (!alive) return; alive = false; if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } disposers.forEach(function (fn) { try { fn(); } catch (_) {} }); disposers = []; observers.clear(); }
      };
      sync();
      return api;
    }

    function install(ctx) {
      var alive = true, observer, resizeObserver, timer = null, host, center, mainBody, style, ctrl;
      var strip, listEl, addButton, noticeEl, cells = new Map(), lastSignature = '', lastRevealed = null;
      var local; try { local = window.localStorage; } catch (_) { local = null; }
      function lang() { return String(document.documentElement.lang || navigator.language || 'en').indexOf('zh') === 0 ? 'zh' : 'en'; }
      function attr(el, key, value) { value = String(value); if (el.getAttribute(key) !== value) el.setAttribute(key, value); }
      function closeIcon() { return '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3.2 3.2l5.6 5.6M8.8 3.2L3.2 8.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'; }
      function plusIcon() { return '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'; }
      function unmark() {
        if (center) center.removeAttribute('data-qa-column');
        if (mainBody) mainBody.removeAttribute('data-qa-main');
        center = null; mainBody = null;
      }
      function chrome() {
        host = document.createElement('div');
        host.className = 'qa-host';
        host.setAttribute('data-dsh-quick-action', '');
        strip = document.createElement('div');
        strip.className = 'qa-strip';
        listEl = document.createElement('div');
        listEl.className = 'qa-list';
        listEl.setAttribute('role', 'tablist');
        addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'qa-add';
        addButton.innerHTML = plusIcon();
        addButton.setAttribute('data-qa-action', 'add');
        var spacer = document.createElement('div');
        spacer.className = 'qa-spacer';
        strip.append(listEl, addButton, spacer);
        noticeEl = document.createElement('div');
        noticeEl.className = 'qa-notice';
        noticeEl.setAttribute('role', 'status');
        host.append(strip, noticeEl);
        host.addEventListener('click', onClick);
        host.addEventListener('keydown', onKeydown);
        strip.addEventListener('scroll', revealActive, { passive: true });
        if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(function () { revealActive(); }); resizeObserver.observe(listEl); }
      }
      function frame() { return requestAnimationFrame ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); }; }
      function schedule() { if (!alive || timer !== null) return; timer = setTimeout(function () { timer = null; refresh(); }, 16); }
      function refresh() { if (!alive) return; if (timer !== null) { clearTimeout(timer); timer = null; } mount(); render(); }
      function mount() {
        var slot = document.querySelector('#root [data-slot="main"]');
        if (!slot || !slot.parentElement) { if (host) host.hidden = true; return; }
        var column = slot.parentElement;
        while (column.hasAttribute('data-slot') && column.parentElement) column = column.parentElement;
        if (!host) chrome();
        if (center !== column) { unmark(); center = column; }
        if (host.parentElement !== center) center.insertBefore(host, center.firstChild);
        var enabled = ctrl.snapshot().enabled;
        host.hidden = !enabled;
        if (!enabled) {
          unmark();
          return;
        }
        center.setAttribute('data-qa-column', '');
        var next = slot.firstElementChild;
        while (next && window.getComputedStyle(next).display === 'contents') next = next.firstElementChild;
        if (mainBody !== next) { if (mainBody) mainBody.removeAttribute('data-qa-main'); mainBody = next; }
        if (mainBody) mainBody.setAttribute('data-qa-main', '');
      }
      function cell(row) {
        var el = document.createElement('div');
        el.className = 'qa-tab';
        el.setAttribute('data-tab', row.id);
        el.setAttribute('data-active', 'false');
        var main = document.createElement('button');
        main.type = 'button';
        main.className = 'qa-tab-main';
        main.setAttribute('role', 'tab');
        main.setAttribute('data-qa-action', 'open');
        var ws = document.createElement('span');
        ws.className = 'qa-ws';
        var t = document.createElement('span');
        t.className = 'qa-title';
        main.append(ws, t);
        var badge = document.createElement('span');
        badge.className = 'qa-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.setAttribute('data-kind', 'idle');
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'qa-close';
        close.setAttribute('data-qa-action', 'close');
        close.innerHTML = closeIcon();
        el.append(main, badge, close);
        return { el: el, main: main, ws: ws, title: t, badge: badge, close: close, badgeKind: 'idle' };
      }
      function render() {
        if (!host) return;
        var snap = ctrl.snapshot(), w = ctrl.words();
        var rows = snap.rows.map(function (row) {
          return { id: row.id, workspace: row.workspace, title: row.title, status: row.status, unread: row.status === 'unread' };
        });
        var active = snap.active;
        var signature = JSON.stringify([snap.enabled, active, snap.notice, lang(), rows.map(function (r) { return [r.id, r.workspace, r.title, r.status]; })]);
        if (signature !== lastSignature) {
          lastSignature = signature;
          attr(host, 'aria-label', w.tabs);
          attr(listEl, 'aria-label', w.tabs);
          listEl.title = w.hint;
          var keep = {};
          rows.forEach(function (r) { keep[r.id] = true; });
          cells.forEach(function (entry, id) {
            if (!keep[id]) { entry.el.remove(); cells.delete(id); }
          });
          var cursor = listEl.firstChild;
          rows.forEach(function (row) {
            var entry = cells.get(row.id);
            if (!entry) { entry = cell(row); cells.set(row.id, entry); }
            var isActive = row.id === active;
            attr(entry.el, 'data-active', isActive);
            attr(entry.el, 'data-id', row.id);
            entry.main.setAttribute('aria-selected', isActive ? 'true' : 'false');
            var stateWord = w[row.status] || row.status;
            var label = (row.workspace ? row.workspace + ' · ' : '') + row.title + ' — ' + stateWord;
            entry.main.setAttribute('aria-label', label);
            entry.main.title = label;
            if (entry.ws.textContent !== row.workspace) entry.ws.textContent = row.workspace;
            if (entry.title.textContent !== row.title) entry.title.textContent = row.title;
            attr(entry.el, 'data-unread', row.unread);
            attr(entry.el, 'data-pending', row.status === 'answer' || row.status === 'approval' || row.status === 'plan');
            var kind = row.status;
            if (entry.badgeKind !== kind) {
              entry.badgeKind = kind;
              attr(entry.badge, 'data-kind', kind);
              if (kind === 'unread') attr(entry.badge, 'data-pulse', 'true'); else entry.badge.removeAttribute('data-pulse');
            }
            var stateColor = row.status === 'answer' ? 'var(--qa-warn)' : row.status === 'approval' ? 'color-mix(in srgb,var(--qa-err) 45%,var(--qa-warn))' : row.status === 'plan' ? 'var(--qa-plan)' : 'transparent';
            entry.el.style.setProperty('--qa-state', stateColor);
            attr(entry.close, 'aria-label', w.close + ': ' + row.title);
            entry.close.title = w.close;
            if (entry.el !== cursor) listEl.insertBefore(entry.el, cursor);
            cursor = entry.el.nextSibling;
          });
          addButton.setAttribute('aria-label', w.add);
          addButton.title = w.add;
          noticeEl.hidden = !snap.notice;
          if (noticeEl.textContent !== snap.notice) noticeEl.textContent = snap.notice;
        }
        if (snap.active !== lastRevealed) { lastRevealed = snap.active; revealActive(); }
      }
      function revealActive() {
        if (!host || host.hidden) return;
        var id = ctrl.snapshot().active;
        var entry = cells.get(id);
        if (entry) entry.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      function onClick(event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-qa-action]') : null;
        if (!target) return;
        var action = target.getAttribute('data-qa-action');
        var tabEl = target.closest('[data-tab]');
        var id = tabEl ? tabEl.getAttribute('data-tab') : null;
        if (action === 'open' && id) ctrl.open(id);
        else if (action === 'close' && id) { event.stopPropagation(); ctrl.close(id); }
        else if (action === 'add') ctrl.newSession();
        else return;
        refresh();
      }
      function onKeydown(event) {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        var key = event.key;
        var inStrip = host && host.contains(event.target);
        if (inStrip && (key === 'ArrowLeft' || key === 'ArrowRight') && !event.altKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          event.stopPropagation();
          ctrl.switchBy(key === 'ArrowRight' ? 1 : -1);
          refresh();
        }
      }
      function globalKeydown(event) {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (event.altKey) return;
        var primary = event.metaKey || event.ctrlKey;
        if (!primary || !event.shiftKey) return;
        if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') return;
        if (!ctrl.snapshot().enabled) return;
        event.preventDefault();
        ctrl.switchBy(event.code === 'BracketRight' ? 1 : -1);
        refresh();
      }
      style = document.createElement('style');
      style.setAttribute('data-plugin', 'dsh-quick-action');
      style.setAttribute('data-plugin-css', 'dsh-quick-action/style');
      style.textContent = CSS;
      document.head.append(style);
      ctrl = createController(ctx, { storage: local, lang: lang, changed: schedule });
      window.addEventListener('keydown', globalKeydown, false);
      observer = new MutationObserver(function (records) {
        var external = records.some(function (r) { return !host || (r.target !== host && !host.contains(r.target)); });
        if (!external) return;
        if (!host.isConnected || !mainBody || !mainBody.isConnected) { try { mount(); } catch (_) {} }
        schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
      function ModeButton() {
        var pair = React.useState(0);
        React.useEffect(function () { return ctrl.subscribe(function () { pair[1](function (n) { return n + 1; }); }); }, []);
        var w = ctrl.words();
        var enabled = ctrl.snapshot().enabled;
        var label = enabled ? w.native : w.enable;
        return React.createElement('button', {
          type: 'button',
          className: 'qa-mode',
          'data-qa-mode': '',
          'aria-label': label,
          'aria-pressed': enabled,
          title: label,
          onClick: function () { ctrl.setEnabled(!ctrl.snapshot().enabled); refresh(); }
        }, React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
          React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
          React.createElement('path', { d: 'M3 9h18' }),
          React.createElement('path', { d: 'M9 9v11' })));
      }
      var slotDispose = ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-quick-action:mode', order: 80 }, ModeButton);
      });
      function dispose() {
        if (!alive) return;
        alive = false;
        if (timer !== null) clearTimeout(timer);
        if (observer) observer.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        window.removeEventListener('keydown', globalKeydown, false);
        if (host) { host.removeEventListener('click', onClick); host.removeEventListener('keydown', onKeydown); host.remove(); }
        if (style) style.remove();
        if (slotDispose) slotDispose();
        if (ctrl) ctrl.dispose();
        cells.clear();
        unmark();
        if (window[GLOBAL]) delete window[GLOBAL];
      }
      window[GLOBAL] = { dispose: dispose, snapshot: function () { return ctrl ? ctrl.snapshot() : null; } };
      refresh();
      return dispose;
    }

    function apply(ctx) {
      if (window[GLOBAL]) return;
      try {
        ctx.effect(function () { return install(ctx); }, 'dsh-quick-action: session tab strip');
      } catch (error) {
        if (window[GLOBAL] && window[GLOBAL].dispose) window[GLOBAL].dispose();
        if (ctx.logger && ctx.logger.warn) ctx.logger.warn('dsh-quick-action could not attach; native UI remains available: ' + String(error));
      }
    }

    return {
      apply: apply,
      inject: ['slots', 'sessions', 'uiWorkspace', 'uiSession', 'workspaces'],
      createController: createController,
      parse: parse,
      serialize: serial,
      statusPriority: ['approval', 'plan', 'answer', 'running', 'unread', 'loading', 'idle'],
      CSS: CSS,
      storageKey: KEY
    };
  }
});
