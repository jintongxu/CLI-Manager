'use strict';
/* Scene renderers share only the preview's in-memory state and UI helpers. */
function workspaceView() {
  const name = ['Claude Code', 'Codex', 'PowerShell'][state.tab];
  return `${pageHead(t('当前工作', 'Current work'), t('让每个项目、终端与上下文，井然有序。', 'A focused space for your projects, terminals and context.'), `<button class="primary" data-action="new-session">${icon('plus')}${t('新建终端','New terminal')}</button>`)}
  <div class="workspace-body">
<section class="panel terminal">
    <div class="tabs" aria-label="${t('终端标签','Terminal tabs')}">${['Claude Code','Codex','PowerShell'].map((n,i)=>`<button data-tab="${i}" aria-pressed="${state.tab===i}" class="${state.tab===i?'active':''}">${icon('terminal')}${n}<span class="dot">
</span>
</button>`).join('')}</div>
    <div class="terminal-content">
      <div class="terminal-logo">
<span class="terminal-glyph">&gt;_</span>
<div>
<strong>${name}</strong> <span class="muted">${state.tab===0?'v2.1.14':state.tab===1?'v0.48.0':'7.5.0'}</span>
<br>
<span class="muted">${project().path} · ${project().branch}</span>
</div>
</div>
      <p class="muted">${t('会话已恢复 · 上下文已就绪','Session restored · Context ready')} <span class="accent">14:32:08</span>
</p>
      <div class="prompt-block">
<span class="accent">❯</span> ${t('为项目文件面板添加键盘导航，并补充测试。','Add keyboard navigation to the project file panel and cover it with tests.')}</div>
      <p>${t('我会先检查文件树与焦点管理，再实现方向键导航。','I’ll inspect the file tree and focus management, then implement arrow-key navigation.')}</p>
      <div class="tool-line">
<span class="good">✓</span>
<strong>Read</strong>
<span>src/features/files/FileTree.tsx</span>
<span class="stamp">14:32:12</span>
</div>
      <div class="tool-line">
<span class="good">✓</span>
<strong>Edit</strong>
<span>useTreeNavigation.ts</span>
<span class="stamp">+42 −8</span>
</div>
      <div class="tool-line">
<span class="good">✓</span>
<strong>Test</strong>
<span>npm run test -- files</span>
<span class="stamp">1.24s</span>
</div>
      <div style="margin:20px 0 12px" class="good">${t('12 项测试通过 · 无类型错误','12 tests passed · No type errors')}</div>
      <p>${t('已完成。支持 ↑ ↓ 移动、→ 展开、← 折叠。焦点在切换文件后保留。','Done. Use ↑ ↓ to move, → to expand and ← to collapse. Focus is preserved when switching files.')}</p>
      <div class="muted">${t('变更已准备好，等待你的审阅。','Changes are ready for your review.')} <span class="accent">▍</span>
</div>
      ${state.sent?`<div class="prompt-block">${escapeHtml(state.sent)}<br>
<small>${t('预览消息已接收；未执行任何命令。','Preview message received; no command was executed.')}</small>
</div>`:''}
    </div>
    <form id="terminal-form" class="terminal-input row">
<span class="accent mono">❯</span>
<input id="terminal-message" aria-label="${t('模拟终端输入','Mock terminal input')}" placeholder="${t('继续对话，或输入 / 查看命令…','Continue the conversation, or type / for commands…')}" autocomplete="off">
<button type="submit" aria-label="${t('发送模拟消息','Send mock message')}">${icon('arrow')}</button>
</form>
    <div class="terminal-footer row between">
<span class="muted">${state.tab===0?'Claude Sonnet 4.5':state.tab===1?'GPT-5 Codex':'PowerShell'} · ${t('本地模拟','Local mock')}</span>
<span class="muted">38% ${t('上下文','context')} / 200k</span>
</div>
  </section>
<aside class="inspector">
    <section class="panel">
<div class="panel-title row between">
<h3>${t('会话概览','Session overview')}</h3>${icon('activity')}</div>
<div class="content">
<div class="kv">
<span>${t('状态','Status')}</span>
<span class="good">${t('等待输入','Awaiting input')}</span>
</div>
<div class="kv">
<span>${t('运行时间','Elapsed')}</span>
<span class="mono">08:42</span>
</div>
<div class="kv">
<span>Tokens</span>
<span class="mono">76,284</span>
</div>
<div class="kv">
<span>${t('预估费用','Est. cost')}</span>
<span class="mono">$0.24</span>
</div>
<div class="progress">
<i>
</i>
</div>
<small>76k / 200k ${t('上下文窗口','context window')}</small>
</div>
</section>
    <section class="panel">
<div class="panel-title row between">
<h3>${t('工作区变更','Working changes')}</h3>
<span class="pill">3</span>
</div>
<div class="content">${['FileTree.tsx','useTreeNavigation.ts','navigation.test.ts'].map((f,i)=>`<div class="file-row">${icon('file')}<span class="truncate">${f}</span>
<b>+${[12,42,64][i]}</b>
</div>`).join('')}<button data-page="editor" class="outline" style="width:100%;margin-top:10px">${t('审阅变更','Review changes')}${icon('arrow')}</button>
</div>
</section>
    <section class="panel">
<div class="panel-title">
<h3>${t('执行清单','Execution plan')}</h3>
</div>
<div class="content">${[t('理解现有文件树','Inspect the file tree'),t('实现键盘导航','Implement navigation'),t('补充回归测试','Add regression tests')].map(x=>`<div class="checklist">
<span class="good">✓</span>${x}</div>`).join('')}</div>
</section>
    <div class="note">${t('独立设计预览。所有会话、费用与文件均为模拟数据。','Independent design preview. Sessions, costs and files are all simulated.')}</div>
  </aside>
</div>`;
}

const codeFiles = {
  'useTreeNavigation.ts': [
    "import { useCallback } from 'react';", '',
    'export function useTreeNavigation(', '  nodes: TreeNode[],', '  onSelect: (id: string) => void', ') {',
    '  const handleKey = useCallback(', '    (event: KeyboardEvent) => {',
    "      if (event.key === 'ArrowDown') {", '        event.preventDefault();',
    '        const next = getNextNode(nodes);', '        onSelect(next.id);', '        next.element.focus();',
    '      }', '    }, [nodes, onSelect]', '  );', '', '  return { handleKey };', '}'
  ],
  'FileTree.tsx': ["import { useTreeNavigation } from './hooks';", '', 'export function FileTree({ nodes }) {',
    '  const { handleKey } = useTreeNavigation(', '    nodes, setSelected', '  );', '', '  return (',
    '    <div role="tree"', '      aria-label="Project files"', '      onKeyDown={handleKey}>',
    '      {nodes.map(renderNode)}', '    </div>', '  );', '}'],
  'navigation.test.ts': ["import { describe, it, expect } from 'vitest';", '', "describe('keyboard navigation', () => {", "  it('moves focus to the next file', () => {", '    const tree = renderFileTree();',
    "    tree.press('ArrowDown');", "    expect(tree.activeFile).toBe('index.ts');", '  });', '', "  it('preserves selection on collapse', () => {", "    tree.press('ArrowLeft');", '    expect(tree.selection).toBeDefined();', '  });', '});']
};
function editorView() {
  const lines = codeFiles[state.file];
  const pane = (after) => `<div class="code-pane">
<div class="code-label row between">
<span>${after?t('工作区 · 修改后','Working tree · Modified'):t('HEAD · 原始版本','HEAD · Original')}</span>
<span>${after?'+42 −8':'a19c4e2'}</span>
</div>
<div class="code-lines">${lines.map((l,i)=>`<div class="code-line ${i>=8&&i<=12?(after?'add':'remove'):''}">
<em>${i+1}</em>
<span class="${/import|export|return|const/.test(l)?'syntax':''}">${escapeHtml(!after&&i===12?'        // focus not managed':l)}</span>
</div>`).join('')}</div>
</div>`;
  return `${pageHead(t('文件与变更','Files & changes'),t('审阅当前工作区中的变更，保留完整上下文。','Review working changes without losing your context.'),'<span class="pill good">+118 −16</span>')}
  <div class="editor-layout">
<aside class="file-tree">
<div class="sidebar-label">${t('资源管理器','EXPLORER')}</div>
<div class="folder">⌄ ${project().name}</div>
<div class="folder">　⌄ src / features / files</div>${Object.keys(codeFiles).map(f=>`<button data-file="${f}" class="${state.file===f?'active':''}" aria-pressed="${state.file===f}" title="${f}">${icon('file')}<span class="truncate">${f}</span>
<span class="good">M</span>
</button>`).join('')}<div class="folder">　› shared</div>
<div class="folder">　› styles</div>
<div class="folder">　package.json</div>
<div class="note" style="margin-top:26px">${t('3 个修改的文件 · 无未跟踪文件','3 modified files · No untracked files')}</div>
</aside>
  <section class="code-area">
<div class="tabs">${Object.keys(codeFiles).map(f=>`<button data-file="${f}" class="${state.file===f?'active':''}" aria-pressed="${state.file===f}">${f}</button>`).join('')}</div>
<div class="code-toolbar row between">
<span class="muted mono">src / features / files</span>
<button class="outline" data-action="diff">${icon('split')}${state.split?t('并排对比','Side by side'):t('修改后','Modified')}</button>
</div>
<div class="diff" style="${state.split?'':'grid-template-columns:1fr'}">${state.split?pane(false):''}${pane(true)}</div>
<div class="editor-summary row between">
<span class="good">✓ ${t('12 项检查通过','12 checks passed')}</span>
<button data-action="review" class="primary">${state.reviewed?t('已审阅','Reviewed'):t('标记已审阅','Mark reviewed')}</button>
</div>
</section>
</div>`;
}

function settingsView() {
  const row = (title,desc,control) => `<div class="setting-row">
<div>
<h3>${title}</h3>
<p>${desc}</p>
</div>${control}</div>`;
  const toggle = (key,label) => `<button class="toggle" role="switch" aria-label="${label}" aria-checked="${state[key]}" data-toggle="${key}">
<i>
</i>
</button>`;
  return `${pageHead(t('打造你的工作空间','Make it your workspace'),t('清晰的界面，专注的工作流。更改即时预览。','A clear interface. A focused workflow. Preview changes instantly.'),`<span class="pill">${t('仅当前预览','Preview only')}</span>`)}
  <div class="settings-body">
<div class="settings-grid">
<div class="stack">
    <section class="panel">
<div class="panel-title">
<h2>${t('外观','Appearance')}</h2>
</div>
<div class="theme-cards">${themes.map(th=>`<button class="theme-card ${state.theme===th.id?'active':''}" data-theme="${th.id}" aria-pressed="${state.theme===th.id}">
<span class="mini-palette">${th.colors.map(c=>`<i style="background:${c}">
</i>`).join('')}</span>
<strong>${th.name}</strong>
<small>${t(th.zh,th.en)}</small>
</button>`).join('')}</div>
    ${row(t('颜色模式','Color mode'),t('为明亮与低光环境分别优化','Tuned for bright and low-light environments'),select('mode',[['dark',t('深色','Dark')],['light',t('浅色','Light')]]))}
    ${row(t('界面密度','Interface density'),t('在信息量与呼吸感之间取得平衡','Balance information and breathing room'),select('density',[['comfortable',t('舒适','Comfortable')],['compact',t('紧凑','Compact')]]))}
    ${row(t('界面语言','Interface language'),t('时间统一使用 24 小时制','Time is always displayed in 24-hour format'),select('lang',[['zh','简体中文'],['en','English']]))}</section>
    <section class="panel">
<div class="panel-title">
<h2>${t('终端与工作流','Terminal & workflow')}</h2>
</div>
    ${row(t('恢复上次会话','Restore last session'),t('启动时回到上次的工作上下文','Resume your previous context on launch'),toggle('restore',t('恢复上次会话','Restore last session')))}
    ${row(t('任务完成提醒','Task notifications'),t('模拟设置，不发送系统通知','Mock preference; no system notifications are sent'),toggle('notify',t('任务完成提醒','Task notifications')))}
    ${row(t('默认 Shell','Default shell'),t('用于新建的模拟终端','Used for new simulated terminals'),select('shell',[['PowerShell','PowerShell 7'],['WSL','WSL · Ubuntu'],['Bash','Git Bash']]))}</section>
  </div>
<aside class="stack">
<section class="panel preview-sample">
<div class="eyebrow">${t('实时预览','LIVE PREVIEW')}</div>
<h2 style="margin-top:15px">${t('少一些干扰。','Less distraction.')}</h2>
<p class="muted" style="margin-top:6px">${t('多一些专注。','More room to focus.')}</p>
<pre>
<span class="accent">❯</span> git status<br>
<span class="good">✓ working tree clean</span>
<br>
<span class="muted">14:32:08 · UTF-8</span>
</pre>
<button class="primary" data-page="workspace">${t('返回工作区','Back to workspace')}${icon('arrow')}</button>
</section>
<div class="note">${t('设置只保存在内存中。刷新页面将恢复默认值，不会影响真实应用。','Preferences live in memory only. Reloading resets them and never changes the real app.')}</div>
</aside>
</div>
</div>`;
}

function statsView() {
  const metric = (label,value,delta) => `<section class="panel metric">
<span class="muted">${label}</span>
<div class="metric-value">${value}</div>
<small class="good">↗ ${delta}</small> <small>${t('较上一周期','vs. previous period')}</small>
</section>`;
  return `${pageHead(t('工作有迹可循','Your work, in perspective'),t('理解使用趋势，让每一次专注更有价值。','Understand your usage. Make every focused session count.'),select('range',[['7',t('最近 7 天','Last 7 days')],['30',t('最近 30 天','Last 30 days')]]))}
  <div class="stats-body">
<div class="metrics">${metric(t('会话数','Sessions'),state.range==='7'?'48':'186','18.2%')}${metric(t('消息数','Messages'),state.range==='7'?'1,284':'4,892','12.8%')}${metric(t('总 Token','Total tokens'),state.range==='7'?'2.84M':'11.6M','8.4%')}${metric(t('预估费用','Estimated cost'),state.range==='7'?'$12.68':'$48.32','6.1%')}</div>
  <div class="charts">
<section class="panel chart">
<div class="row between">
<h3>${t('每日 Token 用量','Daily token usage')}</h3>
<small>
<span class="dot">
</span>${t('输入 + 输出','Input + output')}</small>
</div>
<svg role="img" aria-label="${t('Token 用量趋势，模拟数据','Token usage trend, simulated data')}" viewBox="0 0 520 180" preserveAspectRatio="none">
<path class="chart-grid" d="M0 30H520 M0 75H520 M0 120H520 M0 165H520"/>
<path class="chart-area" d="M0 140L45 128L85 138L130 90L175 104L218 78L260 94L303 50L350 66L390 34L435 55L480 22L520 38V165H0Z"/>
<path class="chart-line" d="M0 140L45 128L85 138L130 90L175 104L218 78L260 94L303 50L350 66L390 34L435 55L480 22L520 38"/>
</svg>
<div class="chart-labels">
<span>${state.range==='7'?'10/22':'09/29'}</span>
<span>10/24</span>
<span>10/26</span>
<span>10/28</span>
</div>
</section>
  <section class="panel chart">
<h3>${t('模型使用分布','Model distribution')}</h3>${[['Claude Sonnet 4.5',62],['GPT-5 Codex',28],['Claude Haiku 4.5',10]].map(([m,n])=>`<div class="model-row">
<div class="row between">
<small>${m}</small>
<span class="mono">${n}%</span>
</div>
<div class="progress">
<i style="width:${n}%;opacity:${n===62?1:n===28?.7:.4}">
</i>
</div>
</div>`).join('')}<small>${t('按 Token 用量统计 · 模拟数据','By token volume · Simulated data')}</small>
</section>
</div>
  <section class="panel" style="margin-top:18px">
<div class="panel-title row between">
<h3>${t('项目活跃度','Project activity')}</h3>
<small>${t('点击项目进入工作区','Select a project to open its workspace')}</small>
</div>
<table>
<thead>
<tr>
<th>${t('项目','Project')}</th>
<th>${t('会话','Sessions')}</th>
<th>Tokens</th>
<th>${t('最近活动','Last active')}</th>
<th>${t('费用','Cost')}</th>
</tr>
</thead>
<tbody>${projects.map((p,i)=>`<tr>
<td>
<button data-project="${i}">${icon('folder')}${p.name}</button>
</td>
<td>${[28,14,6][i]}</td>
<td class="mono">${['1.68M','824k','336k'][i]}</td>
<td class="muted">${['14:32','13:18','10:46'][i]}</td>
<td class="mono">${['$7.42','$3.81','$1.45'][i]}</td>
</tr>`).join('')}</tbody>
</table>
</section>
</div>`;
}
