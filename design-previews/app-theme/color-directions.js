'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = { theme: 'sea', language: 'zh-CN', terminal: 'light', project: 'cli-manager', session: 'dev', name: 'dev' };
  const messages = {
    'zh-CN': {
      preview: '配色试验台', static: '静态模拟 · 不修改配置', sea: '海盐蓝', iris: '鸢尾紫', peach: '桃杏珊瑚',
      terminal: '终端', light: '协调浅色', dark: '独立深色', language: '语言', projects: '项目', workspace: '工作空间',
      local: '本地工作空间', sessions: '2 个终端', mockTerminal: '模拟输出 · 无 PTY', previewOnly: '仅预览',
      mockSettings: '模拟设置', appearance: '外观与终端', sessionName: '终端名称', fontSize: '字体大小', cursor: '显示光标',
      settingsNote: '仅作用于本页示意。刷新后恢复，不保存真实设置。', reset: '重置', apply: '预览应用',
      hint: '试试切换项目、终端标签，或打开右下角设置。',
      seaDescription: '冰透蓝底，钴蓝点睛。清爽，但不寡淡。',
      irisDescription: '浅鸢尾铺底，紫罗兰收笔。安静，也有个性。',
      peachDescription: '桃杏色表面，陶土红强调。温暖，不是奶油色。',
      saved: '模拟设置已应用 · 仅本页', tool: '工具图标仅展示布局；设置可交互。',
      settingsLabel: '设置', closeLabel: '关闭设置', collapseLabel: '收起项目', expandLabel: '展开项目'
    },
    en: {
      preview: 'COLOR LAB', static: 'Static mock · no config changes', sea: 'Sea Salt Blue', iris: 'Iris', peach: 'Peach Coral',
      terminal: 'Terminal', light: 'Coordinated light', dark: 'Independent dark', language: 'Language', projects: 'Projects',
      workspace: 'WORKSPACE', local: 'Local workspace', sessions: '2 terminals', mockTerminal: 'Mock output · no PTY',
      previewOnly: 'Preview only', mockSettings: 'MOCK SETTINGS', appearance: 'Appearance & terminal', sessionName: 'Terminal name',
      fontSize: 'Font size', cursor: 'Show cursor', settingsNote: 'This page only. Resets on refresh; no real settings are saved.',
      reset: 'Reset', apply: 'Apply preview', hint: 'Switch projects or terminal tabs. Open settings at the bottom right.',
      seaDescription: 'Icy azure surfaces. A precise cobalt accent.', irisDescription: 'Pale lilac surfaces. A confident violet accent.',
      peachDescription: 'Soft peach surfaces. A warm terracotta accent.', saved: 'Mock settings applied · this page only',
      tool: 'Tool icons demonstrate layout only; settings is interactive.', settingsLabel: 'Settings', closeLabel: 'Close settings',
      collapseLabel: 'Collapse projects', expandLabel: 'Expand projects'
    }
  };
  const directionNames = { sea: '01 / SEA SALT BLUE', iris: '02 / IRIS', peach: '03 / PEACH CORAL' };
  const text = (key) => messages[state.language][key];
  function escapeText(value) {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function renderTerminal() {
    const project = escapeText(state.project);
    const prompt = `<p><span class="ansi-path">╭─ dev / ${project}</span> <span class="ansi-branch">⑂ main</span></p>`;
    const command = state.session === 'dev'
      ? '<span class="ansi-command">pnpm</span> <span class="ansi-option">dev</span>'
      : '<span class="ansi-command">pnpm</span> <span class="ansi-option">test --run</span>';
    const output = state.session === 'dev'
      ? '<p class="output-gap"><span class="ansi-command">  VITE</span> v6.4.1 <span class="ansi-ok">ready in 284 ms</span></p>\n'
        + '<p>  <span class="ansi-ok">➜</span>  Local:   <span class="ansi-path">http://localhost:1420/</span></p>\n'
        + '<p class="terminal-dim">  press h + enter to show help</p>'
      : '<p class="output-gap"><span class="ansi-ok"> ✓</span> src/theme.test.ts (12 tests)</p>\n'
        + '<p><span class="ansi-ok"> ✓</span> src/workspace.test.ts (8 tests)</p>\n'
        + '<p class="output-gap"> Test Files  <span class="ansi-ok">2 passed (2)</span></p>\n'
        + '<p>      Tests  <span class="ansi-ok">20 passed (20)</span></p>\n'
        + '<p class="terminal-dim">   Duration  0.84s</p>';
    $('#terminal-output').innerHTML = prompt + '\n<p>╰─❯ ' + command + '</p>\n' + output
      + '\n<p class="output-gap"><span class="ansi-path">╭─ ' + project
      + '</span> <span class="ansi-branch">⑂ main</span> <span class="ansi-ok">✓</span></p>\n'
      + '<p>╰─❯ <span class="caret" aria-hidden="true"></span></p>';
    $('.caret').hidden = !$('#cursor-blink').checked;
  }
  function render() {
    document.body.dataset.theme = state.theme;
    document.body.dataset.terminal = state.terminal;
    document.documentElement.lang = state.language;
    $$('[data-i18n]').forEach((element) => { element.textContent = text(element.dataset.i18n); });
    $$('[data-theme-choice]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.theme));
    });
    $('#direction-name').textContent = directionNames[state.theme];
    $('#direction-description').textContent = text(state.theme + 'Description');
    $('#preview-status').textContent = text(state.theme) + ' · ' + text(state.terminal);
    $('#title-project').textContent = state.project;
    $('#toolbar-project').textContent = state.project;
    $('#status-session').textContent = state.session === 'dev' ? state.name : 'checks';
    $('#open-settings').setAttribute('aria-label', text('settingsLabel'));
    $('#close-settings').setAttribute('aria-label', text('closeLabel'));
    $('#collapse-sidebar').setAttribute('aria-label', text('collapseLabel'));
    $('#restore-sidebar').setAttribute('aria-label', text('expandLabel'));
    $$('[data-project]').forEach((button) => {
      const selected = button.dataset.project === state.project;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $$('.tree-session').forEach((button) => {
      const selected = button.dataset.session === state.session;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $$('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === state.session)));
    $('[data-tab="dev"]').innerHTML = '<span class="running-dot"></span> ' + escapeText(state.name) + ' <span class="tab-shell">pwsh</span>';
    renderTerminal();
  }
  function settings(open) {
    $('#settings-popover').hidden = !open;
    $('#open-settings').setAttribute('aria-expanded', String(open));
    if (open) $('#session-name').focus();
    else $('#open-settings').focus();
  }
  $$('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => {
    state.theme = button.dataset.themeChoice;
    render();
  }));
  $('#language').addEventListener('change', (event) => { state.language = event.target.value; render(); });
  $('#terminal-mode').addEventListener('change', (event) => { state.terminal = event.target.value; render(); });
  $$('[data-project]').forEach((button) => button.addEventListener('click', () => {
    state.project = button.dataset.project;
    $('.tree-children').hidden = state.project !== 'cli-manager';
    render();
  }));
  function selectSession(session) { state.session = session; render(); }
  $$('[data-tab]').forEach((button) => button.addEventListener('click', () => selectSession(button.dataset.tab)));
  $$('[data-session]').forEach((button) => button.addEventListener('click', () => selectSession(button.dataset.session)));
  $('[role="tablist"]').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectSession(event.key === 'Home' ? 'dev' : event.key === 'End' ? 'checks' : state.session === 'dev' ? 'checks' : 'dev');
    $('[data-tab="' + state.session + '"]').focus();
  });
  function collapse(value) {
    document.body.classList.toggle('sidebar-collapsed', value);
    $('#restore-sidebar').hidden = !value;
    $('#collapse-sidebar').setAttribute('aria-expanded', String(!value));
    (value ? $('#restore-sidebar') : $('#collapse-sidebar')).focus();
  }
  $('#collapse-sidebar').addEventListener('click', () => collapse(true));
  $('#restore-sidebar').addEventListener('click', () => collapse(false));
  $('#open-settings').addEventListener('click', () => settings($('#settings-popover').hidden));
  $('#close-settings').addEventListener('click', () => settings(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#settings-popover').hidden) settings(false);
  });
  document.addEventListener('click', (event) => {
    if (!$('#settings-popover').hidden && !event.target.closest('#settings-popover, #open-settings')) settings(false);
  });
  $('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.name = $('#session-name').value.trim() || 'dev';
    $('#session-name').value = state.name;
    $('#terminal-output').style.setProperty('--font-size', $('#font-size').value + 'px');
    render();
    $('#preview-status').textContent = text('saved');
  });
  $('#reset-settings').addEventListener('click', () => {
    state.name = 'dev';
    $('#session-name').value = 'dev';
    $('#font-size').value = '14';
    $('#cursor-blink').checked = true;
    $('#terminal-output').style.setProperty('--font-size', '14px');
    render();
  });
  $$('[data-tool]').forEach((button) => button.addEventListener('click', () => {
    $('#preview-status').textContent = text('tool');
  }));
  render();
})();
