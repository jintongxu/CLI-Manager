'use strict';
// Deliberately no storage, network, process, clipboard or filesystem APIs.
const state = {
  theme: 'graphite', mode: 'dark', lang: 'zh', density: 'comfortable',
  page: 'workspace', project: 0, tab: 0, file: 'useTreeNavigation.ts',
  collapsed: false, split: true, reviewed: false, restore: true, notify: false,
  shell: 'PowerShell', range: '7', sent: '', notice: ''
};
const themes = [
  {id:'graphite',name:'Graphite',zh:'石墨 · 钴蓝',en:'Graphite · Cobalt',colors:['#202329','#416ee8','#a9b9db']},
  {id:'porcelain',name:'Porcelain',zh:'暖白 · 墨绿',en:'Ivory · Forest',colors:['#f8f6ef','#35634c','#c5cfb7']},
  {id:'midnight',name:'Midnight',zh:'深海 · 青色',en:'Navy · Cyan',colors:['#101c2d','#67d9e7','#557d9a']}
];
const projects = [
  {name:'CLI Manager',initials:'CM',path:'D:/workspace/cli-manager',branch:'feat/keyboard-nav'},
  {name:'Design system',initials:'DS',path:'D:/workspace/design-system',branch:'main'},
  {name:'API gateway / infrastructure',initials:'AG',path:'D:/workspace/api-gateway',branch:'fix/retry-policy'}
];
const t = (zh,en) => state.lang==='zh'?zh:en;
const project = () => projects[state.project];
const escapeHtml = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function icon(name) {
  const paths = {
    terminal:'M4 5h16v14H4z M7 9l3 3-3 3 M13 15h4',
    folder:'M3 7V5h6l2 2h10v12H3z',
    file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.5 1.5 M17 17l1.5 1.5 M5.6 18.4l1.5-1.5 M17 7l1.5-1.5',
    activity:'M3 17V7 M9 17V4 M15 17v-6 M21 17V8',
    plus:'M12 5v14 M5 12h14', arrow:'M5 12h14 M14 7l5 5-5 5',
    collapse:'M4 4h16v16H4z M9 4v16 M15 9l-3 3 3 3',
    branch:'M6 3v12a3 3 0 1 0 3 3 M6 8c0 5 12 0 12 5v2 M18 3v3',
    split:'M3 4h18v16H3z M12 4v16', search:'M16 16l5 5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
    clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
<path d="${paths[name]||paths.terminal}"/>
</svg>`;
}
function select(key, options) {
  const label = {mode:t('颜色模式','Color mode'),lang:t('语言','Language'),density:t('密度','Density'),shell:t('默认 Shell','Default shell'),range:t('日期范围','Date range')}[key];
  return `<select data-setting="${key}" aria-label="${label}">${options.map(([v,l])=>`<option value="${v}" ${state[key]===v?'selected':''}>${l}</option>`).join('')}</select>`;
}
function pageHead(title,sub,action) {
  return `<header class="page-head">
<div>
<h1>${title}</h1>
<p>${sub}</p>
</div>${action||''}</header>`;
}
function pageNames() {
  return {workspace:t('终端工作区','Terminal workspace'),editor:t('文件与变更','Files & changes'),settings:t('设置','Settings'),stats:t('使用统计','Usage analytics')};
}
function navButton(page, image) {
  const label = pageNames()[page];
  return `<button data-page="${page}" title="${label}" aria-label="${label}" ${state.page===page?'aria-current="page"':''} class="${state.page===page?'active':''}">${icon(image)}<span class="hide-collapsed">${label}</span>
</button>`;
}
function sidebar() {
  return `<aside class="sidebar">
<div class="row between">
<strong class="hide-collapsed" style="padding-left:9px">${t('工作空间','Workspace')}</strong>
<button class="collapse" data-action="collapse" aria-label="${state.collapsed?t('展开侧栏','Expand sidebar'):t('折叠侧栏','Collapse sidebar')}" aria-expanded="${!state.collapsed}">${icon('collapse')}</button>
</div>
  <nav aria-label="${t('工作区导航','Workspace navigation')}">${navButton('workspace','terminal')}${navButton('editor','file')}</nav>
  <div>
<div class="sidebar-label hide-collapsed">${t('项目','PROJECTS')} <span style="float:right">03</span>
</div>${projects.map((p,i)=>`<button class="project ${state.project===i?'active':''}" data-project="${i}" aria-pressed="${state.project===i}" title="${p.name}">
<span class="project-icon">${p.initials}</span>
<span class="grow hide-collapsed">
<span class="truncate" style="display:block">${p.name}</span>
<span class="project-meta">${[3,2,1][i]} ${t('个会话','sessions')}</span>
</span>
</button>${state.project===i?`<div class="branch-row hide-collapsed">
<div class="row muted" style="font-size:10px">${icon('branch')}<span class="truncate">${p.branch}</span>
</div>
<button data-tab="0">
<span class="dot">
</span>Claude Code</button>
<button data-tab="1">${icon('terminal')}Codex</button>
</div>`:''}`).join('')}</div>
  <div class="hide-collapsed">
<div class="sidebar-label">${t('最近会话','RECENT SESSIONS')}</div>
<button data-action="history">${icon('clock')}<span>${t('文件树键盘导航','File tree navigation')}</span>
</button>
<small style="padding-left:35px">${t('今天','Today')} · 14:32</small>
<button data-action="history">${icon('clock')}<span>${t('SSH 连接修复','SSH connection fix')}</span>
</button>
<small style="padding-left:35px">${t('今天','Today')} · 11:06</small>
</div>
  <div class="sidebar-bottom">${navButton('stats','activity')}${navButton('settings','settings')}<div class="row" style="padding:14px 8px 2px">
<span class="avatar">JD</span>
<span class="hide-collapsed">
<strong style="font-size:11px">${t('本地工作空间','Local workspace')}</strong>
<br>
<small>${t('预览 · 无真实连接','Preview · No connection')}</small>
</span>
</div>
</div>
</aside>`;
}
function render() {
  // Restore keyboard focus after state updates; never move it on initial load.
  const active = document.activeElement;
  const focusKey = active?.dataset ? ['theme','setting','page','project','tab','file','action','toggle'].find(k=>active.dataset[k]!==undefined) : null;
  const focusValue = focusKey ? active.dataset[focusKey] : null;
  const root = document.documentElement;
  root.dataset.theme=state.theme; root.dataset.mode=state.mode; root.dataset.density=state.density;
  root.lang=state.lang==='zh'?'zh-CN':'en';
  const scenes={workspace:workspaceView,editor:editorView,settings:settingsView,stats:statsView};
  document.getElementById('app').innerHTML = `<div class="studio">
<header class="studio-head">
<div>
<div class="eyebrow">CLI MANAGER / DESIGN STUDY 01</div>
<div class="studio-title">${t('为专注而设计','Designed for focus')}</div>
</div>
<div class="studio-controls">
<div class="segment" aria-label="${t('主题方向','Theme direction')}">${themes.map(th=>`<button data-theme="${th.id}" class="${state.theme===th.id?'active':''}" aria-pressed="${state.theme===th.id}">
<span class="swatch ${th.id}">
</span>${th.name}</button>`).join('')}</div>${select('mode',[['dark',t('深色','Dark')],['light',t('浅色','Light')]])}${select('lang',[['zh','简体中文'],['en','English']])}${select('density',[['comfortable',t('舒适','Comfortable')],['compact',t('紧凑','Compact')]])}</div>
</header>
  <div class="app-window">
<div class="titlebar row between">
<div class="row">
<span class="brandmark">›_</span>
<strong>CLI Manager</strong>
<span class="muted">/ ${t('个人工作空间','Personal workspace')}</span>
</div>
<span class="muted mono">${project().name} — ${project().branch}</span>
<span class="window-actions" aria-hidden="true">− □ ×</span>
</div>
  <div class="shell ${state.collapsed?'collapsed':''}">${sidebar()}<main class="main">
<div class="breadcrumb row">
<span class="muted">${project().name}</span>
<span class="muted">/</span>
<strong class="grow">${pageNames()[state.page]}</strong>
<span class="pill mono">${icon('branch')} ${project().branch}</span>
<span class="pill">
<span class="dot">
</span>${t('模拟环境','Simulation')}</span>
</div>${scenes[state.page]()}</main>
</div>
  <footer class="statusbar row between">
<span class="row">${icon('branch')}<span>${project().branch}</span>
<span class="good">✓ ${t('所有检查通过','All checks passed')}</span>
</span>
<span class="muted">${state.shell} · UTF-8 · LF · 14:32</span>
</footer>
</div>
  <footer class="studio-foot row between">
<span>${themes.find(th=>th.id===state.theme).name} / ${t(themes.find(th=>th.id===state.theme).zh,themes.find(th=>th.id===state.theme).en)} — ${t('独立交互原型，不修改真实应用','Independent prototype. No changes to the real application.')}</span>
<span id="visible-status" role="status">${state.notice||t('所有内容均为模拟数据','All content is simulated')}</span>
</footer>
</div>`;
  if (focusKey) {
    const target = [...document.querySelectorAll(`[data-${focusKey}]`)].find(el=>el.dataset[focusKey]===focusValue);
    target?.focus({preventScroll:true});
  }
}
function announce(message) {
  state.notice=message;
  document.getElementById('announcement').textContent=message;
}
document.addEventListener('click', event => {
  const b=event.target.closest('button');
  if (!b) return;
  if (b.dataset.theme) state.theme=b.dataset.theme;
  else if (b.dataset.page) state.page=b.dataset.page;
  else if (b.dataset.project!==undefined) {state.project=Number(b.dataset.project);state.page='workspace';state.sent='';}
  else if (b.dataset.tab!==undefined) {state.tab=Number(b.dataset.tab);state.page='workspace';}
  else if (b.dataset.file) {state.file=b.dataset.file;state.reviewed=false;}
  else if (b.dataset.toggle) state[b.dataset.toggle]=!state[b.dataset.toggle];
  else if (b.dataset.action==='collapse') state.collapsed=!state.collapsed;
  else if (b.dataset.action==='diff') state.split=!state.split;
  else if (b.dataset.action==='review') state.reviewed=!state.reviewed;
  else if (b.dataset.action==='new-session') {state.tab=2;state.sent='';}
  else if (b.dataset.action==='history') {state.page='workspace';state.tab=0;}
  else return;
  announce(b.dataset.action==='new-session'?t('已打开模拟 Shell；未创建真实进程','Opened a mock shell; no process was created'):t('预览已更新 · 仅内存状态','Preview updated · In-memory state only'));
  render();
});
document.addEventListener('change', event => {
  const key=event.target.dataset.setting;
  if (!key) return;
  state[key]=event.target.value;
  announce(t('预览设置已更新','Preview preferences updated'));
  render();
});
document.addEventListener('submit', event => {
  if (event.target.id!=='terminal-form') return;
  event.preventDefault();
  state.sent=document.getElementById('terminal-message').value.trim();
  announce(state.sent?t('消息仅用于预览，未执行命令','Message is preview-only; no command executed'):t('请输入模拟消息','Enter a mock message'));
  render();
  document.getElementById('terminal-message').focus();
});
render();
