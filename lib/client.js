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
        archived: '已归档，请先在左栏恢复', unavailable: '会话暂不可用', failed: '无法打开会话', noAttention: '目前没有需要处理的会话',
        hintSwitch: '切换会话', hintTabs: '跳到第 N 个标签', hintFocus: '聚焦输入框', hintNext: '跳到待处理', hintClose: '关闭当前标签',
        readOn: '阅读收起：已开启（上滚淡出输入框）', readOff: '阅读收起：已关闭', readPaused: '阅读收起：本次暂未启用（上次未正常退出），⌘⇧H 可开启',
        add: '新建会话'
      },
      en: {
        tabs: 'Session tabs', new: 'New session', unnamed: 'Untitled', close: 'Close tab',
        native: 'Native view', enable: 'Show session tabs',
        running: 'Running', answer: 'Needs answer', approval: 'Needs approval', plan: 'Plan review',
        unread: 'Done · unread', loading: 'Connecting', idle: 'Idle',
        archived: 'Archived: restore it in the sidebar first', unavailable: 'Session unavailable', failed: 'Could not open session', noAttention: 'Nothing needs you right now',
        hintSwitch: 'switch sessions', hintTabs: 'jump to the Nth tab', hintFocus: 'focus the composer', hintNext: 'jump to what needs you', hintClose: 'close the current tab',
        readOn: 'Reading mode: on (composer fades when you scroll up)', readOff: 'Reading mode: off', readPaused: 'Reading mode: paused for this run after an unclean exit; Cmd/Ctrl+Shift+H turns it on',
        add: 'New session'
      }
    };

    var CSS = `
.qa-host{--qa-page:var(--dsw-alias-bg-base);--qa-line:var(--dsw-alias-border-l3);--qa-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,var(--qa-page));--qa-strip:color-mix(in srgb,#000 18%,var(--qa-page));--qa-run:var(--dsw-alias-state-business-primary);--qa-warn:var(--dsw-alias-state-warn-primary);--qa-plan:var(--dsw-alias-state-done-primary);--qa-done:var(--dsw-alias-state-success-primary);--qa-err:var(--dsw-alias-state-error-primary);--qa-ter:var(--dsw-alias-label-tertiary);--qa-sep:color-mix(in srgb,var(--dsw-alias-label-primary) 15%,transparent);box-sizing:border-box;flex:0 0 auto;min-width:0;max-width:100%;color:var(--dsw-alias-label-primary);background:var(--qa-strip);font-family:inherit;font-size:14px;line-height:20px;-webkit-app-region:no-drag;padding-inline-start:var(--dsh-frame-leading-clearance,0px)}
.qa-host[hidden]{display:none!important}
[data-composer-seat]{transition:opacity .24s ease}
[data-composer-seat][data-qa-composer=hidden]{opacity:0!important;pointer-events:none!important}
.qa-strip{box-sizing:border-box;display:flex;align-items:stretch;min-width:0;height:52px;padding:6px 0 0 4px;position:relative}
.qa-strip::before{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--qa-line);pointer-events:none}
html[data-platform=darwin] .qa-strip{height:52px}
.qa-list{display:flex;flex:1 1 auto;min-width:0;gap:6px;padding:0 16px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}
.qa-list::-webkit-scrollbar{display:none}
.qa-spacer{flex:1;min-width:8px}
.qa-add{display:flex;align-items:center;justify-content:center;align-self:center;flex:0 0 auto;width:28px;height:28px;margin:0 0 0 4px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--qa-ter);cursor:pointer;-webkit-app-region:no-drag}
.qa-add:hover{background:var(--qa-hover);color:var(--dsw-alias-label-secondary)}
.qa-add svg{width:15px;height:15px;display:block}
[data-qa-column]{min-height:0}
[data-qa-main]{flex:1 1 0!important;min-height:0!important;height:auto!important}
.qa-notice{padding:5px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.qa-notice[hidden]{display:none!important}
.qa-tab{box-sizing:border-box;position:relative;display:flex;align-items:stretch;flex:1 1 0;min-width:132px;max-width:260px;height:46px;border-radius:23px 23px 0 0;color:var(--dsw-alias-label-secondary);background:transparent;transition:transform .18s cubic-bezier(.2,.8,.2,1),background-color .14s ease-out,color .14s ease-out;z-index:0}
.qa-tab[data-active=true]{background:var(--qa-page);box-shadow:inset 0 1px 0 rgba(255,255,255,.07);color:var(--dsw-alias-label-primary);z-index:1}
.qa-tab[data-active=true]::before{content:"";box-sizing:border-box;position:absolute;left:0;right:0;top:0;height:calc(100% - 16px);border:1px solid var(--qa-line);border-bottom:0;border-radius:23px 23px 0 0;pointer-events:none}
.qa-tail{position:absolute;bottom:0;width:16px;height:16px;pointer-events:none;display:none}
.qa-tab[data-active=true] .qa-tail{display:block}
.qa-tail-left{left:-15.5px}
.qa-tail-right{right:-15.5px}
.qa-tail svg{display:block;width:16px;height:16px;overflow:visible}
.qa-tail-fill{fill:var(--qa-page)}
.qa-tail-line{fill:none;stroke:var(--qa-line);stroke-width:1}
.qa-tab::after{content:"";position:absolute;left:-3.5px;top:14px;width:1px;height:18px;border-radius:1px;background:var(--qa-sep);pointer-events:none;display:none}
.qa-tab + .qa-tab::after{display:block}
.qa-tab[data-active=true]::after,.qa-tab:hover::after,.qa-tab[data-active=true] + .qa-tab::after,.qa-tab:hover + .qa-tab::after{display:none}
.qa-tab[data-active=false]:not([data-dragging=true]):hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.qa-list[data-qa-dragging=true]{cursor:grabbing;user-select:none}
.qa-tab[data-dragging=true]{z-index:3;transition:none!important;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--qa-page));box-shadow:0 10px 26px rgba(0,0,0,.45),0 0 0 1px var(--qa-line)}
.qa-tab[data-dragging=true] .qa-tab-main{cursor:grabbing}
.qa-tab[data-dragging=true] .qa-close{display:none}
.qa-tab[data-pending=true][data-active=false]:not([data-dragging=true]){background:color-mix(in srgb,var(--qa-state) 5%,transparent)}
.qa-tab-main{position:relative;display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:7px;flex:1;min-width:0;padding:0 24px 0 12px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:23px 23px 0 0}
.qa-tab-main:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-3px}
.qa-badge{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:14px;height:14px;color:var(--qa-badge-color);pointer-events:none}
.qa-badge svg{display:block;width:14px;height:14px}
.qa-badge[data-kind=idle]{visibility:hidden}
.qa-badge[data-kind=unread]{--qa-badge-color:var(--qa-done)}
.qa-badge[data-kind=answer]{--qa-badge-color:var(--qa-warn)}
.qa-badge[data-kind=approval]{--qa-badge-color:color-mix(in srgb,var(--qa-err) 45%,var(--qa-warn))}
.qa-badge[data-kind=plan]{--qa-badge-color:var(--qa-plan)}
.qa-badge[data-kind=running]{--qa-badge-color:var(--qa-run)}
.qa-badge[data-kind=loading]{--qa-badge-color:var(--qa-ter)}
.qa-badge[data-kind=answer]::after,.qa-badge[data-kind=approval]::after,.qa-badge[data-kind=plan]::after{content:"";position:absolute;inset:0;border-radius:50%;border:1.5px solid var(--qa-badge-color);opacity:0;animation:qa-ping 2.2s cubic-bezier(.16,1,.3,1) infinite}
.qa-badge[data-kind=approval]::after{animation-duration:2.8s}
.qa-badge[data-kind=running] svg{animation:qa-spin 1.1s linear infinite}
.qa-badge[data-kind=loading] svg{animation:qa-spin .8s linear infinite}
.qa-badge[data-pulse=true]{animation:qa-pop .52s cubic-bezier(.34,1.56,.64,1)}
@keyframes qa-spin{to{transform:rotate(360deg)}}
@keyframes qa-ping{0%{transform:scale(.62);opacity:.55}70%{opacity:0}100%{transform:scale(1.5);opacity:0}}
@keyframes qa-pop{0%{transform:scale(.45)}60%{transform:scale(1.18)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.qa-badge,.qa-badge::after,.qa-badge svg{animation:none!important}.qa-tab{transition:none!important}}
.qa-ws{display:block;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:9px;line-height:12px;letter-spacing:.35px;color:var(--qa-ter)}
.qa-tab[data-active=true] .qa-ws{color:var(--dsw-alias-label-secondary)}
.qa-sep{display:none}
.qa-text{display:flex;flex-direction:column;align-items:flex-start;gap:0;min-width:0;max-width:100%}
.qa-title{display:block;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.qa-tab[data-active=true] .qa-title{color:var(--dsw-alias-label-primary)}
.qa-tab[data-unread=true] .qa-title{color:var(--dsw-alias-label-primary);font-weight:500}
.qa-close{position:absolute;top:14px;right:6px;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--qa-ter);cursor:pointer;opacity:0;transition:opacity .12s ease-out,background-color .12s ease-out;-webkit-app-region:no-drag}
.qa-close svg{width:11px;height:11px;display:block}
.qa-tab:is(:hover,:focus-within) .qa-close{opacity:.7}
.qa-tab[data-active=true] .qa-close{opacity:.5}
.qa-tab:is(:hover,:focus-within) .qa-close:hover{opacity:1;background:var(--qa-hover)}
.qa-mode svg{display:block;width:18px;height:18px}
`;

    function qaArc(cx, cy, r, a0, a1) {
      var rad = function (a) { return (a * Math.PI) / 180; };
      var p0 = { x: cx + r * Math.cos(rad(a0)), y: cy + r * Math.sin(rad(a0)) };
      var p1 = { x: cx + r * Math.cos(rad(a1)), y: cy + r * Math.sin(rad(a1)) };
      var large = Math.abs(a1 - a0) > 180 ? 1 : 0;
      return 'M' + p0.x.toFixed(2) + ' ' + p0.y.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2);
    }
    var QA_RING = '<circle cx="7" cy="7" r="5.2" stroke="currentColor" stroke-width="1.5" fill="none"/>';
    var QA_TRACK = '<circle cx="7" cy="7" r="5.2" stroke="currentColor" stroke-opacity="0.16" stroke-width="1.5" fill="none"/>';
    var BADGE_ICONS = {
      running: '<svg viewBox="0 0 14 14" fill="none">' + QA_TRACK + '<path d="' + qaArc(7, 7, 5.2, -160, -40) + '" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
      loading: '<svg viewBox="0 0 14 14" fill="none">' + QA_TRACK + '<path d="' + qaArc(7, 7, 5.2, -90, 180) + '" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
      answer: '<svg viewBox="0 0 14 14" fill="none">' + QA_RING + '<path d="M5.7 4.6a1.35 1.35 0 1 1 1.5 2c-.23.15-.37.34-.37.65" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/><circle cx="6.7" cy="9.1" r=".68" fill="currentColor"/></svg>',
      approval: '<svg viewBox="0 0 14 14" fill="none">' + QA_RING + '<path d="M7 4.3v2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="9" r=".7" fill="currentColor"/></svg>',
      plan: '<svg viewBox="0 0 14 14" fill="none">' + QA_RING + '<path d="M4.6 5.1h4.8M4.6 7h3.3M4.6 8.9h4.2" stroke="currentColor" stroke-width="1.05" stroke-linecap="round"/></svg>',
      unread: '<svg viewBox="0 0 14 14" fill="none">' + QA_RING + '<circle cx="7" cy="7" r="2.5" fill="currentColor"/></svg>'
    };

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
    // 宿主把「审批 / 回答 / 计划待审」卡片注入到 conversation.composer 槽，
    // 也就是挂在 [data-composer-seat] 内部：整块 seat 淡出时卡片会一起消失且不可点击。
    // 下面三个属性是宿主插件（ui-approval / ui-user-questions）的稳定 DOM 标记（不是哈希类名）。
    var PENDING_CARD_SELECTOR = '[data-approval-key],[data-question-key],[data-plan-review-key]';
    function hasPendingCard(root) {
      return !!(root && typeof root.querySelector === 'function' && root.querySelector(PENDING_CARD_SELECTOR));
    }
    // 阅读收起的开关注解：默认开（stored 缺失或不是 'off'），崩溃保护只压制当次运行。
    function readModeFrom(stored, suppressed) { return !suppressed && stored !== 'off'; }
    // 主面板被侧栏的全局视图/配置占用时（[data-global-panel]），当前没有「当前会话」，
    // 标签条不应把任何 chip 标成选中。
    function stripActive(active, globalView) { return globalView ? null : active; }
    // DOM 兜底必须与宿主配置一致：catalog 里有该命令 → 用它当前的绑定（binding=null 表示用户解绑，旧键即失效）；
    // catalog 里没有该命令（快捷键服务不可用/注册失败）→ 才退回插件声明的默认键。
    function fallbackBindingFor(row, declared) {
      if (row) return row.binding || null;
      return declared || null;
    }
    // 事件是否命中一条宿主 binding（code + 精确修饰键集合；mac 的 primary=meta，其它平台=ctrl）。
    function bindingMatches(event, binding, mac) {
      if (!binding || !binding.code || binding.code !== event.code) return false;
      var want = [], have = [], i, m, mods = binding.modifiers || [];
      for (i = 0; i < mods.length; i++) {
        m = mods[i];
        if (m === 'primary') want.push(mac ? 'meta' : 'ctrl');
        else if (m === 'meta' || m === 'cmd' || m === 'command') want.push('meta');
        else if (m === 'ctrl' || m === 'control') want.push('ctrl');
        else want.push(m);
      }
      if (event.shiftKey) have.push('shift');
      if (event.altKey) have.push('alt');
      if (event.metaKey) have.push('meta');
      if (event.ctrlKey) have.push('ctrl');
      want.sort();
      have.sort();
      if (want.length !== have.length) return false;
      for (i = 0; i < want.length; i++) if (want[i] !== have[i]) return false;
      return true;
    }
    function keyLabel(binding, mac) {
      if (!binding || !binding.code) return null;
      var parts = [], mods = binding.modifiers || [], i, m;
      for (i = 0; i < mods.length; i++) {
        m = mods[i];
        if (m === 'primary') parts.push(mac ? '⌘' : 'Ctrl');
        else if (m === 'shift') parts.push(mac ? '⇧' : 'Shift');
        else if (m === 'alt') parts.push(mac ? '⌥' : 'Alt');
        else if (m === 'meta' || m === 'cmd' || m === 'command') parts.push(mac ? '⌘' : 'Meta');
        else if (m === 'ctrl' || m === 'control') parts.push(mac ? '⌃' : 'Ctrl');
      }
      var code = binding.code, name = code;
      if (code.indexOf('Key') === 0) name = code.slice(3);
      else if (code.indexOf('Digit') === 0) name = code.slice(5);
      else if (code === 'BracketLeft') name = '[';
      else if (code === 'BracketRight') name = ']';
      else if (code === 'Enter') name = 'Enter';
      else if (code === 'Escape') name = 'Esc';
      parts.push(name);
      return parts.join(mac ? '' : '+');
    }
    // 会话区域判定（纯函数）：栈内仍是主面板的会话区才允许 session 级快捷键。
    function sessionRegionFor(flags) {
      flags = flags || {};
      if (flags.modal) return false;
      if (flags.host) return true;
      if (!flags.hasMain) return true;
      if (!flags.inMain) return false;
      return !flags.globalPanel;
    }
    function isMacPlatform() {
      try {
        var nav = typeof navigator === 'undefined' ? null : navigator;
        return /Mac|iPhone|iPad|iPod/.test(String((nav && nav.platform) || '') + ' ' + String((nav && nav.userAgent) || ''));
      } catch (_) { return false; }
    }
    // 崩溃保护：只有连续两次未正常退出（上次残留 session token）才压制本次运行。
    function crashState(hadToken, storedStreak) {
      var streak = Number(storedStreak || 0) || 0;
      streak = hadToken ? streak + 1 : 0;
      return { streak: streak, suppress: streak >= 2 };
    }
    function createController(ctx, options) {
      options = options || {};
      var ls = options.storage, state;
      try { state = parse(ls && ls.getItem(KEY)); } catch (_) { state = parse(null); }
      var observers = new Set(), disposers = [], alive = true, notice = '', lastMain = null;
      var list = ctx.sessions.list.getSnapshot(), suppressed = null, draftId = null, syncing = false, again = false, saveTimer = null, restored = false;
      var changed = options.changed || function () {}, getLang = options.lang || function () { return 'en'; };
      var ATTENTION = { approval: 0, plan: 1, answer: 2, unread: 3 }; var lastAttention = null;
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
      // 当前会话是否正在等用户处理（审批 / 回答 / 计划待审）。用于阻止输入框淡出把卡片一起藏掉。
      function activePending() {
        if (!lastMain || lastMain === draftId) return false;
        var live = ctx.uiSession.sessionStatus.getSnapshot().get(lastMain);
        return !!(live && live.pendingInteraction);
      }
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
      function attentionRows() {
        var byId = list.byId || {}, out = [];
        Object.keys(byId).forEach(function (id) {
          var row = byId[id];
          if (!row || row.blank || row.origin === 'subagent') return;
          if (archived(id)) return;
          var st = status(id);
          if (ATTENTION[st] === undefined) return;
          out.push({ id: id, status: st, updatedAt: row.updatedAt || 0 });
        });
        out.sort(function (a, b) {
          var d = ATTENTION[a.status] - ATTENTION[b.status];
          return d !== 0 ? d : (b.updatedAt - a.updatedAt);
        });
        return out;
      }
      function focusAttention() {
        var list = attentionRows();
        if (!list.length) { notice = words().noAttention; emit(); return false; }
        var index = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === lastAttention) { index = i; break; }
        var next = list[(index + 1) % list.length];
        lastAttention = next.id;
        return open(next.id);
      }
      // 拖动排序：ids 必须恰好覆盖当前已持久化的标签（draft 影子标签不参与）。
      function reorder(ids) {
        if (!Array.isArray(ids) || ids.length !== state.ids.length) return false;
        var seen = {}, next = [];
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i];
          if (!validId(id) || seen[id] || state.ids.indexOf(id) < 0) return false;
          seen[id] = true;
          next.push(id);
        }
        var same = true;
        for (var j = 0; j < next.length; j++) if (next[j] !== state.ids[j]) { same = false; break; }
        if (same) return false;
        state.ids = next;
        persist();
        emit();
        return true;
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
      // ⌘1–⌘9：按标签从左到右的顺序跳到第 index 个会话（含「新会话」影子标签）。
      function jumpTo(index) {
        var list = rows();
        if (typeof index !== 'number' || index % 1 !== 0 || index < 1 || index > list.length) return false;
        return open(list[index - 1].id);
      }
      disposers.push(ctx.sessions.list.subscribe(sync));
      disposers.push(ctx.uiSession.sessionStatus.subscribe(sync));
      disposers.push(ctx.workspaces.list.subscribe(sync));
      var api = {
        words: words,
        status: status,
        activePending: activePending,
        snapshot: function () { return { enabled: state.enabled, ids: state.ids.slice(), rows: rows(), active: lastMain, draftId: draftId, notice: notice, storage: serial(state) }; },
        subscribe: function (fn) { observers.add(fn); return function () { observers.delete(fn); }; },
        open: open,
        close: close,
        focusAttention: focusAttention,
        newSession: newSession,
        switchBy: switchBy,
        jumpTo: jumpTo,
        reorder: reorder,
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
      var composerSeat = null, composerScroll = null, composerFieldEl = null, composerTop = 0;
      var composerScrollH = 0, composerClientH = 0, composerRaf = 0, composerShowTimer = null, composerBound = false;
      var drag = null, dragLastX = 0, dragRaf = 0, suppressClickUntil = 0;
      var READMODE_KEY = 'dsh-quick-action.readmode', SESSION_TOKEN_KEY = 'dsh-quick-action.session-token',
        CRASH_KEY = 'dsh-quick-action.crash-streak';
      var sessionToken = 'qa-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      // 阅读收起**默认开启**：只有用户显式存成 'off' 才关闭。
      // 崩溃保护只压制「本次运行」，绝不把持久开关改写成 off；而且只有连续两次未正常退出才压制，
      // 正常退出或偶发一次异常都不会让默认变成关闭。
      var crashSuppressed = false;
      function readModeEnabled() {
        var stored; try { stored = localStorage.getItem(READMODE_KEY); } catch (_) { return false; }
        return readModeFrom(stored, crashSuppressed);
      }
      function setReadMode(value) { try { localStorage.setItem(READMODE_KEY, value ? 'on' : 'off'); } catch (_) {} }
      try {
        var cs = crashState(localStorage.getItem(SESSION_TOKEN_KEY), localStorage.getItem(CRASH_KEY));
        crashSuppressed = cs.suppress;
        localStorage.setItem(CRASH_KEY, String(cs.streak));
        localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
      } catch (_) {}
      function markCleanExit() {
        try {
          if (localStorage.getItem(SESSION_TOKEN_KEY) === sessionToken) localStorage.removeItem(SESSION_TOKEN_KEY);
          localStorage.setItem(CRASH_KEY, '0');
        } catch (_) {}
      }
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
        strip.append(listEl, spacer);
        listEl.append(addButton);
        noticeEl = document.createElement('div');
        noticeEl.className = 'qa-notice';
        noticeEl.setAttribute('role', 'status');
        host.append(strip, noticeEl);
        host.addEventListener('click', onClick);
        host.addEventListener('keydown', onKeydown);
        listEl.addEventListener('pointerdown', onPointerDown);
        strip.addEventListener('scroll', revealActive, { passive: true });
        if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(function () { revealActive(); }); resizeObserver.observe(listEl); }
      }
      function frame() { return requestAnimationFrame ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); }; }
      function schedule() { if (!alive || timer !== null) return; timer = setTimeout(function () { timer = null; refresh(); }, 16); }
      function refresh() { if (!alive) return; if (timer !== null) { clearTimeout(timer); timer = null; } mount(); bindComposer(); measureComposer(); render(); }
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
        var badge = document.createElement('span');
        badge.className = 'qa-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.setAttribute('data-kind', 'idle');
        var text = document.createElement('span');
        text.className = 'qa-text';
        var ws = document.createElement('span');
        ws.className = 'qa-ws';
        var t = document.createElement('span');
        t.className = 'qa-title';
        text.append(ws, t);
        main.append(badge, text);
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'qa-close';
        close.setAttribute('data-qa-action', 'close');
        close.innerHTML = closeIcon();
        var tailLeft = document.createElement('span');
        tailLeft.className = 'qa-tail qa-tail-left';
        tailLeft.setAttribute('aria-hidden', 'true');
        tailLeft.innerHTML = '<svg viewBox="0 0 16 16"><path class="qa-tail-fill" d="M16 0A16 16 0 0 1 0 16L16 16Z"/><path class="qa-tail-line" d="M16 0A16 16 0 0 1 0 16"/></svg>';
        var tailRight = document.createElement('span');
        tailRight.className = 'qa-tail qa-tail-right';
        tailRight.setAttribute('aria-hidden', 'true');
        tailRight.innerHTML = '<svg viewBox="0 0 16 16"><path class="qa-tail-fill" d="M0 0A16 16 0 0 0 16 16L0 16Z"/><path class="qa-tail-line" d="M0 0A16 16 0 0 0 16 16"/></svg>';
        el.append(main, close, tailLeft, tailRight);
        return { el: el, main: main, ws: ws, title: t, badge: badge, close: close, badgeKind: 'idle' };
      }
      function render() {
        if (!host) return;
        var snap = ctrl.snapshot(), w = ctrl.words();
        var rows = snap.rows.map(function (row) {
          return { id: row.id, draft: row.draft, workspace: row.workspace, title: row.title, status: row.status, unread: row.status === 'unread' };
        });
        var globalView = globalPanelOpen();
        var active = stripActive(snap.active, globalView);
        var signature = JSON.stringify([snap.enabled, active, globalView, snap.notice, lang(), rows.map(function (r) { return [r.id, r.workspace, r.title, r.status]; })]);
        if (signature !== lastSignature) {
          lastSignature = signature;
          attr(host, 'aria-label', w.tabs);
          attr(listEl, 'aria-label', w.tabs);
          listEl.title = hintText(w);
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
            var hasWs = !!row.workspace;
            if (entry.ws.style.display !== (hasWs ? '' : 'none')) entry.ws.style.display = hasWs ? '' : 'none';
            if (entry.title.textContent !== row.title) entry.title.textContent = row.title;
            attr(entry.el, 'data-unread', row.unread);
            attr(entry.el, 'data-draft', row.draft);
            attr(entry.el, 'data-pending', row.status === 'answer' || row.status === 'approval' || row.status === 'plan');
            var kind = row.status;
            if (entry.badgeKind !== kind) {
              entry.badgeKind = kind;
              attr(entry.badge, 'data-kind', kind);
              entry.badge.innerHTML = BADGE_ICONS[kind] || '';
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
        if (snap.active !== lastRevealed) { lastRevealed = snap.active; revealActive(); showComposer(); }
        if (pendingCardPresent()) showComposer();
      }
      function revealActive() {
        if (!host || host.hidden || lastRevealed === null) return;
        var entry = cells.get(lastRevealed);
        if (entry) entry.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      // 审批 / 回答 / 计划待审卡片在 seat 内部，永不隐藏（并主动还原已隐藏的输入框）。
      function pendingCardPresent() {
        if (hasPendingCard(composerSeat)) return true;
        try { return !!(ctrl && typeof ctrl.activePending === 'function' && ctrl.activePending()); } catch (_) { return false; }
      }
      // 侧栏打开的全局视图/配置在主面板上带 [data-global-panel]；conversation 面板没有该属性。
      function globalPanelOpen() {
        var slot = document.querySelector('#root [data-slot="main"]');
        if (!slot) return false;
        var panel = typeof slot.closest === 'function' ? slot.closest('[data-global-panel]') : null;
        return !!panel;
      }
      // 焦点/最近一次点击是否在「会话区」：主面板内的 conversation 或标签条；
      // 左侧栏、右侧栏、全局视图/配置、模态框都不算（⌘W 之类只在会话区生效）。
      function regionIsSession(node) {
        if (!node || !node.closest) return sessionFocus;
        if (node === document.body || node === document.documentElement) return sessionFocus;
        var inModal = !!node.closest('[role="dialog"],[aria-modal="true"],dialog[open]');
        var inHost = !!(host && host.contains(node));
        var main = null;
        try { main = document.querySelector('#root [data-slot="main"]'); } catch (_) {}
        return sessionRegionFor({
          modal: inModal,
          host: inHost,
          hasMain: !!main,
          inMain: !!(main && main.contains(node)),
          globalPanel: main ? globalPanelOpen() : false
        });
      }
      function sessionNow(target) {
        if (target && target.closest) return regionIsSession(target);
        return sessionFocus;
      }
      function trackSessionFocus(event) { sessionFocus = regionIsSession(event.target); }
      function composerIsEmpty() {
        if (!composerFieldEl) return true;
        if (composerFieldEl.isContentEditable) return !String(composerFieldEl.textContent || '').replace(/[\u200b\u00a0\s]/g, '');
        return !String(composerFieldEl.value || '').trim();
      }
      function composerHidden(value) {
        if (!composerSeat) return;
        var current = composerSeat.getAttribute('data-qa-composer') === 'hidden';
        if (current === value) return;
        if (value) composerSeat.setAttribute('data-qa-composer', 'hidden');
        else composerSeat.removeAttribute('data-qa-composer');
      }
      function showComposer() {
        if (composerShowTimer !== null) { clearTimeout(composerShowTimer); composerShowTimer = null; }
        composerHidden(false);
      }
      function measureComposer() {
        if (!composerScroll) return;
        composerScrollH = composerScroll.scrollHeight;
        composerClientH = composerScroll.clientHeight;
        composerTop = composerScroll.scrollTop;
      }
      function scheduleComposerCheck() {
        if (composerRaf) return;
        composerRaf = requestAnimationFrame(function () { composerRaf = 0; checkComposerScroll(); });
      }
      function checkComposerScroll() {
        if (!composerScroll || !composerSeat) return;
        if (pendingCardPresent()) { composerTop = composerScroll.scrollTop; showComposer(); return; }
        var top = composerScroll.scrollTop;
        var distance = composerScrollH - top - composerClientH;
        var scrollingUp = top < composerTop - 2;
        composerTop = top;
        if (distance < 56) {
          if (composerShowTimer === null && composerSeat.getAttribute('data-qa-composer') === 'hidden') {
            composerShowTimer = setTimeout(function () {
              composerShowTimer = null;
              var settle = composerScrollH - composerScroll.scrollTop - composerClientH;
              if (settle < 72) composerHidden(false);
            }, 120);
          }
          return;
        }
        if (composerShowTimer !== null) { clearTimeout(composerShowTimer); composerShowTimer = null; }
        if (scrollingUp && readModeEnabled() && distance > 88 && composerIsEmpty() && !composerSeat.contains(document.activeElement) && !pendingCardPresent()) composerHidden(true);
      }
      function bindComposer() {
        var seat = document.querySelector('#root [data-composer-seat]');
        if (!seat) { composerSeat = null; composerScroll = null; composerBound = false; composerFieldEl = null; return; }
        if (seat === composerSeat && composerBound) return;
        if (composerScroll) composerScroll.removeEventListener('scroll', scheduleComposerCheck);
        if (composerShowTimer !== null) { clearTimeout(composerShowTimer); composerShowTimer = null; }
        if (composerRaf) { cancelAnimationFrame(composerRaf); composerRaf = 0; }
        window.removeEventListener('beforeunload', markCleanExit);
        window.removeEventListener('pagehide', markCleanExit);
        composerSeat = seat;
        composerFieldEl = seat.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        composerScroll = seat.closest('[data-conversation-scroll]');
        if (composerScroll) {
          composerScroll.addEventListener('scroll', scheduleComposerCheck, { passive: true });
          measureComposer();
        }
        seat.addEventListener('focusin', showComposer);
        seat.addEventListener('pointerdown', showComposer);
        seat.addEventListener('input', showComposer);
        composerBound = true;
        composerHidden(false);
      }
      function toggleReadMode() {
        var next = !readModeEnabled();
        crashSuppressed = false; // 用户手动操作即视为本次允许，覆盖崩溃压制
        setReadMode(next);
        if (!next) composerHidden(false);
        var w = ctrl ? ctrl.words() : WORDS.zh;
        if (noticeEl) { noticeEl.hidden = false; noticeEl.textContent = next ? w.readOn : w.readOff; }
      }
      function composerTarget() {
        var root = document.querySelector('#root') || document;
        var seat = root.querySelector('[data-composer-seat]');
        var region = root.querySelector('[data-conversation-region="composer"]');
        var scope = seat || region || root;
        return scope.querySelector('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]');
      }
      function focusComposer() {
        showComposer();
        var el = composerTarget();
        if (!el) return false;
        try { el.focus({ preventScroll: false }); } catch (_) { try { el.focus(); } catch (__) { return false; } }
        try {
          if (el.isContentEditable) {
            var selection = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          } else if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
            el.setSelectionRange(el.value.length, el.value.length);
          }
        } catch (_) {}
        return true;
      }
      function tabUnder(target) {
        if (!target || !target.closest) return null;
        if (target.closest('.qa-close')) return null;
        var el = target.closest('.qa-tab');
        if (!el || el.parentElement !== listEl) return null;
        if (el.getAttribute('data-draft') === 'true') return null;
        return el;
      }
      function listTabs() {
        var out = [];
        for (var i = 0; i < listEl.children.length; i++) {
          var n = listEl.children[i];
          if (n.classList && n.classList.contains('qa-tab')) out.push(n);
        }
        return out;
      }
      function measureDragTabs() {
        var rect = listEl.getBoundingClientRect(), scroll = listEl.scrollLeft;
        return listTabs().map(function (el) {
          var r = el.getBoundingClientRect();
          var left = r.left - rect.left + scroll;
          return {
            el: el,
            id: el.getAttribute('data-id'),
            draft: el.getAttribute('data-draft') === 'true',
            width: r.width,
            center: left + r.width / 2
          };
        });
      }
      function clearDragVisual() {
        if (drag && drag.el) drag.el.removeAttribute('data-dragging');
        if (listEl) listEl.removeAttribute('data-qa-dragging');
        if (listEl) listTabs().forEach(function (el) { el.style.transform = ''; });
        if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
      }
      // 关键：拖动中不改 DOM 顺序，只做 transform —— 被拖的跟着指针走，其它 chip 平滑让位。
      function updateDragLayout(clientX) {
        if (!drag || !drag.active || !listEl) return;
        drag.pointerX = clientX;
        var rect = listEl.getBoundingClientRect(), scroll = listEl.scrollLeft;
        var pointer = clientX - rect.left + scroll;
        var reals = drag.tabs.filter(function (t) { return !t.draft; });
        var draggedIdx = -1, i;
        for (i = 0; i < reals.length; i++) if (reals[i].el === drag.el) { draggedIdx = i; break; }
        if (draggedIdx < 0) return;
        var others = reals.filter(function (t) { return t.el !== drag.el; });
        var target = 0;
        for (i = 0; i < others.length; i++) if (pointer > others[i].center) target++;
        var shift = drag.draggedWidth + 6;
        for (i = 0; i < others.length; i++) {
          var original = reals.indexOf(others[i]);
          var total = (i >= target ? shift : 0) - (original > draggedIdx ? shift : 0);
          others[i].el.style.transform = total ? 'translateX(' + total + 'px)' : '';
        }
        var draft = null;
        for (i = 0; i < drag.tabs.length; i++) if (drag.tabs[i].draft) { draft = drag.tabs[i]; break; }
        if (draft) draft.el.style.transform = target >= others.length ? 'translateX(' + shift + 'px)' : '';
        var dx = clientX - drag.x0 + (scroll - drag.startScroll);
        drag.el.style.transform = 'translateX(' + dx + 'px)';
        drag.target = target;
      }
      function dragAutoScroll() {
        dragRaf = 0;
        if (!drag || !drag.active || !listEl) return;
        var rect = listEl.getBoundingClientRect();
        var step = drag.pointerX < rect.left + 44 ? -14 : drag.pointerX > rect.right - 44 ? 14 : 0;
        if (step) {
          listEl.scrollLeft += step;
          updateDragLayout(drag.pointerX);
        }
        dragRaf = requestAnimationFrame(dragAutoScroll);
      }
      function beginDrag(event) {
        drag.active = true;
        drag.startScroll = listEl.scrollLeft;
        drag.tabs = measureDragTabs();
        var self = null;
        for (var i = 0; i < drag.tabs.length; i++) if (drag.tabs[i].el === drag.el) self = drag.tabs[i];
        drag.draggedWidth = self ? self.width : 0;
        drag.target = 0;
        attr(drag.el, 'data-dragging', 'true');
        attr(listEl, 'data-qa-dragging', 'true');
        drag.el.style.transition = 'none';
        try { drag.el.setPointerCapture(drag.pointerId); } catch (_) {}
        updateDragLayout(event.clientX);
        if (!dragRaf) dragRaf = requestAnimationFrame(dragAutoScroll);
      }
      function onPointerDown(event) {
        if (event.button !== 0) return;
        if (event.pointerType && event.pointerType !== 'mouse') return;
        var el = tabUnder(event.target);
        if (!el) return;
        drag = { el: el, x0: event.clientX, y0: event.clientY, active: false, cancelled: false, pointerId: event.pointerId, pointerX: event.clientX, tabIndex: -1 };
      }
      function onPointerMove(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        var dx = event.clientX - drag.x0, dy = event.clientY - drag.y0;
        if (!drag.active) {
          if (Math.abs(dy) > 10) { drag = null; return; }
          if (Math.abs(dx) < 6) return;
          beginDrag(event);
          if (event.cancelable) event.preventDefault();
          return;
        }
        if (event.cancelable) event.preventDefault();
        updateDragLayout(event.clientX);
      }
      function computeDragOrder() {
        if (!drag || !drag.active) return null;
        var reals = drag.tabs.filter(function (t) { return !t.draft; });
        var dragged = null, others = [];
        for (var i = 0; i < reals.length; i++) { if (reals[i].el === drag.el) dragged = reals[i]; else others.push(reals[i]); }
        if (!dragged) return null;
        var order = [], target = drag.target;
        for (var j = 0; j < others.length; j++) { if (j === target) order.push(dragged.id); order.push(others[j].id); }
        if (target >= others.length) order.push(dragged.id);
        return order;
      }
      function endDrag(event) {
        if (!drag) return;
        if (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
        var active = drag.active, cancelled = drag.cancelled, el = drag.el, pointerId = drag.pointerId;
        var order = cancelled ? null : computeDragOrder();
        try { if (el.hasPointerCapture && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId); } catch (_) {}
        listTabs().forEach(function (node) { node.style.transition = 'none'; });
        clearDragVisual();
        drag = null;
        if (!active) return;
        suppressClickUntil = Date.now() + 350;
        if (order) { if (ctrl.reorder(order)) refresh(); }
        requestAnimationFrame(function () { listTabs().forEach(function (node) { node.style.transition = ''; }); });
        if (cancelled) lastSignature = '';
      }
      function onDragKey(event) {
        if (!drag || !drag.active || event.key !== 'Escape') return;
        drag.cancelled = true;
        event.preventDefault();
        event.stopPropagation();
        endDrag();
      }
      function onClick(event) {
        if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
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
      function catalogRow(id) {
        try {
          var svc = (shortcutScope && shortcutScope.shortcuts) || ctx.shortcuts;
          var snap = svc && svc.catalog ? svc.catalog.getSnapshot() : null;
          if (Array.isArray(snap)) {
            for (var i = 0; i < snap.length; i++) if (snap[i] && snap[i].id === id) return snap[i];
          }
        } catch (_) {}
        return null;
      }
      function fallbackBinding(slot) {
        var id = shortcutIds[slot];
        return fallbackBindingFor(id ? catalogRow(id) : null, shortcutDeclared[slot]);
      }
      // tooltip 里的快捷键一律从「当前配置」生成：改键后立即跟着变，未绑定就不显示。
      function hintText(w) {
        var mac = isMacPlatform(), parts = [];
        var prev = keyLabel(fallbackBinding('prevSession'), mac);
        var next = keyLabel(fallbackBinding('nextSession'), mac);
        var pair = [prev, next].filter(Boolean);
        if (pair.length) parts.push(pair.join(' / ') + ' ' + w.hintSwitch);
        var first = fallbackBinding('tab1'), last = fallbackBinding('tab9');
        var firstKey = keyLabel(first, mac), lastKey = keyLabel(last, mac);
        var sameMods = first && last && String((first.modifiers || []).slice().sort()) === String((last.modifiers || []).slice().sort());
        if (firstKey && lastKey && sameMods && first.code === 'Digit1' && last.code === 'Digit9') {
          var prefix = firstKey.slice(0, firstKey.length - 1);
          parts.push((mac ? prefix + '1–' + prefix + '9' : prefix + '1–9') + ' ' + w.hintTabs);
        } else if (firstKey || lastKey) {
          parts.push([firstKey, lastKey].filter(Boolean).join(' / ') + ' ' + w.hintTabs);
        }
        var focus = keyLabel(fallbackBinding('focus'), mac);
        if (focus) parts.push(focus + ' ' + w.hintFocus);
        var attention = keyLabel(fallbackBinding('next'), mac);
        if (attention) parts.push(attention + ' ' + w.hintNext);
        var close = keyLabel(fallbackBinding('close'), mac);
        if (close) parts.push(close + ' ' + w.hintClose);
        return parts.join('；');
      }
      function refreshHint() {
        if (!listEl || !ctrl) return;
        var text = hintText(ctrl.words());
        if (listEl.title !== text) listEl.title = text;
      }
      function fallbackSlots() {
        var list = ['next', 'focus', 'close', 'readMode', 'prevSession', 'nextSession'], i;
        for (i = 1; i <= 9; i++) list.push('tab' + i);
        return list;
      }
      function runSlot(slot) {
        var scoped = slot === 'next' || slot === 'close' || slot === 'prevSession' || slot === 'nextSession' || slot.indexOf('tab') === 0;
        if (scoped && !sessionFocus) return false;
        if (slot === 'next') { ctrl.focusAttention(); refresh(); return true; }
        if (slot === 'focus') {
          var target = composerTarget();
          if (target && (target === document.activeElement || target.contains(document.activeElement))) return false;
          return focusComposer();
        }
        if (slot === 'close') {
          var active = ctrl.snapshot().active;
          if (!active) return false;
          ctrl.close(active);
          refresh();
          return true;
        }
        if (slot === 'readMode') { toggleReadMode(); return true; }
        if (slot === 'prevSession') { ctrl.switchBy(-1); refresh(); return true; }
        if (slot === 'nextSession') { ctrl.switchBy(1); refresh(); return true; }
        if (slot.indexOf('tab') === 0) {
          var n = Number(slot.slice(3));
          if (!(n >= 1 && n <= 9)) return false;
          if (!ctrl.jumpTo(n)) return false;
          refresh();
          return true;
        }
        return false;
      }
      // 唯一的键盘入口：按「宿主当前生效绑定」匹配按键（配置改了兜底就跟着改，旧键自动失效）。
      function globalKeydown(event) {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        var mac = isMacPlatform(), slots = fallbackSlots(), i;
        for (i = 0; i < slots.length; i++) {
          var binding = fallbackBinding(slots[i]);
          if (!binding || !bindingMatches(event, binding, mac)) continue;
          if (runSlot(slots[i])) event.preventDefault();
          return;
        }
      }
      style = document.createElement('style');
      style.setAttribute('data-plugin', 'dsh-quick-action');
      style.setAttribute('data-plugin-css', 'dsh-quick-action/style');
      style.textContent = CSS;
      document.head.append(style);
      ctrl = createController(ctx, { storage: local, lang: lang, changed: schedule });
      window.addEventListener('pointerdown', trackSessionFocus, true);
      window.addEventListener('focusin', trackSessionFocus, true);
      window.addEventListener('keydown', globalKeydown, false);
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', endDrag, true);
      window.addEventListener('pointercancel', endDrag, true);
      window.addEventListener('keydown', onDragKey, true);
      window.addEventListener('blur', endDrag);
      window.addEventListener('beforeunload', markCleanExit);
      window.addEventListener('pagehide', markCleanExit);
      observer = new MutationObserver(function (records) {
        var external = records.some(function (r) { return !host || (r.target !== host && !host.contains(r.target)); });
        if (!external) return;
        if (!host.isConnected || !mainBody || !mainBody.isConnected) { try { mount(); } catch (_) {} }
        schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'data-global-panel'] });
      function dispose() {
        if (!alive) return;
        alive = false;
        if (timer !== null) clearTimeout(timer);
        if (observer) observer.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        window.removeEventListener('pointerdown', trackSessionFocus, true);
        window.removeEventListener('focusin', trackSessionFocus, true);
        window.removeEventListener('keydown', globalKeydown, false);
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', endDrag, true);
        window.removeEventListener('pointercancel', endDrag, true);
        window.removeEventListener('keydown', onDragKey, true);
        window.removeEventListener('blur', endDrag);
        clearDragVisual();
        drag = null;
        if (host) { host.removeEventListener('click', onClick); host.removeEventListener('keydown', onKeydown); host.remove(); }
        if (style) style.remove();
        if (ctrl) ctrl.dispose();
        cells.clear();
        unmark();
        if (window[GLOBAL]) delete window[GLOBAL];
      }
      // 把 ⌘J / ⌘W 注册进宿主快捷键表（可改键、可查冲突、出现在设置里）。
      // 注册失败时保留 window keydown 作为回退；注册成功后宿主会在 Electron 层拦截并派发，DOM 不会重复触发。
      var shortcutState = { next: 'pending', close: 'pending', focus: 'pending', prevSession: 'pending', nextSession: 'pending', readMode: 'pending' };
      var shortcutIds = {}, shortcutDeclared = {}, shortcutScope = null, sessionFocus = true;
      for (var tabSlot = 1; tabSlot <= 9; tabSlot++) shortcutState['tab' + tabSlot] = 'pending';
      try {
        ctx.inject(['shortcuts'], function (scope) {
          shortcutScope = scope;
          function register(command, slot) {
            shortcutIds[slot] = command.id;
            var declared = command.defaults || (command.code === null ? {} : {
              'desktop:macos': { code: command.code, modifiers: ['primary'] },
              'web:macos': { code: command.code, modifiers: ['primary', 'alt'] }
            });
            shortcutDeclared[slot] = isMacPlatform() ? (declared['desktop:macos'] || declared['web:macos']) : null;
            try {
              var dispose = scope.shortcuts.register({
                id: command.id,
                label: function () { return command.label; },
                aliases: command.aliases,
                defaults: command.defaults || (command.code === null ? {} : {
                  'desktop:macos': { code: command.code, modifiers: ['primary'] },
                  'web:macos': { code: command.code, modifiers: ['primary', 'alt'] }
                }),
                regions: ['page', 'editable'],
                modals: [],
                resolve: command.resolve || function (context) {
                  return { status: 'handled', run: function () { command.run(context); } };
                }
              });
              ctx.effect(function () { return dispose; }, 'dsh-quick-action: shortcut ' + command.id);
              shortcutState[slot] = 'ok';
            } catch (err) {
              shortcutState[slot] = 'error: ' + String((err && err.message) || err).slice(0, 120);
            }
          }
          register({
            id: 'quick-action.nextAttention',
            label: '跳到需要处理的会话',
            aliases: ['next attention', 'needs you'],
            code: 'KeyJ',
            run: function (context) {
              if (!sessionNow(context && context.target)) return;
              ctrl.focusAttention();
              refresh();
            }
          }, 'next');
          register({
            id: 'quick-action.closeTab',
            label: '关闭当前会话标签',
            aliases: ['close session tab'],
            code: null,
            run: function (context) {
              if (!sessionNow(context && context.target)) return;
              var current = ctrl.snapshot().active;
              if (!current) return;
              ctrl.close(current);
              refresh();
            }
          }, 'close');
          register({
            id: 'quick-action.focusComposer',
            label: '聚焦对话输入框',
            aliases: ['focus composer', 'focus input'],
            code: 'KeyI',
            resolve: function () {
              var target = composerTarget();
              if (target && (target === document.activeElement || target.contains(document.activeElement))) return { status: 'pass' };
              return { status: 'handled', run: function () { focusComposer(); } };
            }
          }, 'focus');
          register({
            id: 'quick-action.toggleReadMode',
            label: '切换阅读收起（输入框淡出）',
            aliases: ['toggle read mode', 'hide composer'],
            defaults: {
              'desktop:macos': { code: 'KeyH', modifiers: ['primary', 'shift'] },
              'web:macos': { code: 'KeyH', modifiers: ['primary', 'alt', 'shift'] }
            },
            run: function () { toggleReadMode(); }
          }, 'readMode');
          register({
            id: 'quick-action.prevSession',
            label: '上一个会话标签',
            aliases: ['previous session', 'prev tab'],
            defaults: {
              'desktop:macos': { code: 'BracketLeft', modifiers: ['primary', 'shift'] },
              'web:macos': { code: 'BracketLeft', modifiers: ['primary', 'alt', 'shift'] }
            },
            run: function (context) {
              if (!sessionNow(context && context.target)) return;
              ctrl.switchBy(-1);
              refresh();
            }
          }, 'prevSession');
          register({
            id: 'quick-action.nextSession',
            label: '下一个会话标签',
            aliases: ['next session', 'next tab'],
            defaults: {
              'desktop:macos': { code: 'BracketRight', modifiers: ['primary', 'shift'] },
              'web:macos': { code: 'BracketRight', modifiers: ['primary', 'alt', 'shift'] }
            },
            run: function (context) {
              if (!sessionNow(context && context.target)) return;
              ctrl.switchBy(1);
              refresh();
            }
          }, 'nextSession');
          // ⌘1–⌘9：跳到从左到右第 N 个会话标签（Web 端默认 ⌥⌘1..9，避免和浏览器切标签冲突）。
          for (var tabIndex = 1; tabIndex <= 9; tabIndex++) {
            (function (n) {
              register({
                id: 'quick-action.tab' + n,
                label: '切换到第 ' + n + ' 个会话标签',
                aliases: ['session ' + n, 'tab ' + n],
                defaults: {
                  'desktop:macos': { code: 'Digit' + n, modifiers: ['primary'] },
                  'web:macos': { code: 'Digit' + n, modifiers: ['primary', 'alt'] }
                },
                run: function (context) {
                  if (!sessionNow(context && context.target)) return;
                  ctrl.jumpTo(n);
                  refresh();
                }
              }, 'tab' + n);
            })(tabIndex);
          }
          if (scope.shortcuts.catalog && typeof scope.shortcuts.catalog.subscribe === 'function') {
            ctx.effect(function () { return scope.shortcuts.catalog.subscribe(refreshHint); }, 'dsh-quick-action: hint follows bindings');
          }
          if (window[GLOBAL]) window[GLOBAL].shortcuts = shortcutState;

        });
      } catch (_) {}
      window[GLOBAL] = { dispose: dispose, snapshot: function () { return ctrl ? ctrl.snapshot() : null; } };
      refresh();
      // 崩溃保护只在本次运行压制，并把原因说出来（默认仍是开启，⌘⇧H 可立即开启）。
      if (crashSuppressed && noticeEl) {
        noticeEl.hidden = false;
        noticeEl.textContent = (ctrl ? ctrl.words() : WORDS.zh).readPaused;
      }
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
      hasPendingCard: hasPendingCard,
      readModeFrom: readModeFrom,
      stripActive: stripActive,
      crashState: crashState,
      keyLabel: keyLabel,
      fallbackBindingFor: fallbackBindingFor,
      bindingMatches: bindingMatches,
      sessionRegionFor: sessionRegionFor,
      pendingCardSelector: PENDING_CARD_SELECTOR,
      parse: parse,
      serialize: serial,
      statusPriority: ['approval', 'plan', 'answer', 'running', 'unread', 'loading', 'idle'],
      CSS: CSS,
      storageKey: KEY
    };
  }
});
