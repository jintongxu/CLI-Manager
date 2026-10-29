'use strict';
// Independent, local-only visual comparison. No PTY, network, or persisted settings.
const copy = {
  'zh-CN': { preview: '真实布局预览', mock: '静态模拟 · 非真实终端', baseline: '原始外观', revised: 'Graphite 修正版', follow: '终端跟随外壳', language: '语言', projects: '项目', new: '+ 新建', pending: '待加入 · 1', terminalList: '终端列表 · 1⌄', note: '仅预览，未修改生产', charcoal: '终端：中性炭灰', navy: '终端：原始深蓝', testing: '测试', ideas: '项目想法', current: '当前工作 终端…', worktree: '新建worktree', server: '服务器', topic: '开题', tools: ['新建终端', 'Pi', '编辑', '浏览器', '终端', '展开', '历史', '文件', '分支', '统计', '同步', '消息', '工作区'] },
  en: {
    preview: 'Real-layout preview', mock: 'STATIC MOCK · NO PTY', baseline: 'Baseline', revised: 'Revised Graphite',
    follow: 'Terminal follows shell', language: 'Language', projects: 'Projects', new: '+ New', pending: 'Pending · 1',
    terminalList: 'Terminals · 1⌄', note: 'Preview only · production unchanged', charcoal: 'Terminal: charcoal',
    navy: 'Terminal: original navy', testing: 'Testing', ideas: 'Project ideas', current: 'Current work terminal…',
    worktree: 'New worktree', server: 'Server', topic: 'Research',
    tools: ['New terminal', 'Pi', 'Edit', 'Browser', 'Terminal', 'Expand', 'History', 'Files', 'Branches', 'Statistics', 'Sync', 'Messages', 'Workspace']
  }
};
const paths = {
  folder: 'M2 5h5l2 2h13v13H2z', branch: 'M6 3v12a4 4 0 0 0 4-4h7V7 M3 3a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M3 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M14 4a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  plus: 'M12 4v16M4 12h16', pi: 'M4 5h16M8 5v15M16 5v15', edit: 'M4 16 16 4l4 4L8 20H4zM14 6l4 4', globe: 'M21 12a9 9 0 1 0-18 0a9 9 0 1 0 18 0M3 12h18M12 3c-5 5-5 13 0 18c5-5 5-13 0-18', terminal: 'M3 4h18v16H3zM6 8l3 3-3 3M12 15h5',
  expand: 'M14 3h7v7M21 3l-7 7M3 14v7h7M3 21l7-7', history: 'M3 5v6h6M3 11a9 9 0 1 1 1 7M12 6v6l4 2', chart: 'M4 3v18h17M8 16v-5M13 16V6M18 16v-8',
  sync: 'M4 7h15l-4-4M20 17H5l4 4M4 7l4 4M20 17l-4-4', message: 'M3 4h18v13H8l-5 4z', layers: 'M12 3 2 8l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5'
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
function span(className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}
function row(label, options = {}) {
  const node = document.createElement('div');
  node.className = `project-row${options.selected ? ' selected' : ''}${options.attention ? ' attention' : ''}`;
  if (options.branch) {
    const badge = span('branch-icon', '');
    badge.append(icon('branch'));
    node.append(badge);
  } else node.append(icon(options.pi ? 'pi' : 'folder'));
  const name = span('label', label);
  name.title = label;
  node.append(name);
  if (options.count) node.append(span('count', `• ${options.count}`));
  if (options.status) node.append(span('tree-status', options.status));
  if (options.selected) node.setAttribute('aria-current', 'true');
  return node;
}
function renderTree(t) {
  const tree = document.getElementById('project-tree');
  tree.replaceChildren();
  const project = (name, count) => tree.append(row(name, { count }));
  const children = (items) => {
    const group = document.createElement('div');
    group.className = 'tree-children';
    items.forEach(([name, options]) => group.append(row(name, { branch: true, ...options })));
    tree.append(group);
  };
  project('asyncflow-java-0926');
  project('cli-manager', 2);
  children([[t.testing], ['ssh'], [t.ideas, { status: 'C' }], [t.current, { attention: true, status: '⚠' }], [t.worktree, { status: 'C' }]]);
  project('obsidian_theme'); project('bark-tool'); project('sublinkPro'); project('cli-test', 3);
  children([['task-preview', { status: 'H' }], [`${t.testing}12345`, { status: 'C' }], ['test', { selected: true, status: 'P' }], ['test']]);
  tree.append(row('ios-youtube-shua…', { pi: true }), row('spotify-bilingual', { pi: true }), row('spotify-loon'), row(t.server, { pi: true }), row(t.topic));
}
function renderRail(t) {
  const rail = document.getElementById('icon-rail');
  rail.replaceChildren();
  const names = ['plus', 'pi', 'edit', 'globe', 'terminal', 'expand', 'history', 'folder', 'branch', 'chart', 'sync', 'message', 'layers'];
  const colors = ['#63c8f4', '#bbc5d3', '#bbc5d3', '#bbc5d3', '#bd7cb9', '#608fe2', '#eccb36', '#5ac5de', '#e4c14c', '#4ac680', '#bbc5d3', '#bbc5d3', '#ac4968'];
  names.forEach((name, i) => {
    const item = span('rail-item', '');
    item.title = `${t.tools[i]} · ${t.mock}`;
    item.setAttribute('role', 'img');
    item.setAttribute('aria-label', t.tools[i]);
    item.style.setProperty('--baseline-icon', colors[i]);
    item.append(icon(name));
    rail.append(item);
  });
}
function render() {
  const language = document.getElementById('language').value;
  const t = copy[language];
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t[node.dataset.i18n]; });
  document.querySelector('.project-sidebar').setAttribute('aria-label', t.projects);
  document.querySelector('.terminal').setAttribute('aria-label', `PowerShell · ${t.mock}`);
  const follow = document.getElementById('terminal-follow').checked;
  document.body.dataset.terminalFollow = String(follow);
  const revised = document.body.dataset.appearance === 'revised';
  document.getElementById('baseline').setAttribute('aria-pressed', String(!revised));
  document.getElementById('revised').setAttribute('aria-pressed', String(revised));
  document.getElementById('preview-note').textContent = `${t.note} · ${revised && follow ? t.charcoal : t.navy}`;
  renderTree(t);
  renderRail(t);
}
for (const appearance of ['baseline', 'revised']) {
  document.getElementById(appearance).addEventListener('click', () => {
    document.body.dataset.appearance = appearance;
    render();
  });
}
document.getElementById('terminal-follow').addEventListener('change', render);
document.getElementById('language').addEventListener('change', render);
render();
