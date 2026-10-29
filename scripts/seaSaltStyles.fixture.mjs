// Standalone source-CSS fixture, not a live-app acceptance test. No server needed.
import { compile } from '@tailwindcss/node';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const compiler = await compile('@import "tailwindcss"; @import "./src/styles/themes.css"; @import "./src/styles/components.css"; @import "./src/features/projects/styles/sidebar-terminals.css"; @import "./src/features/terminal/components/terminalNavigation.css";', { base: resolve('.'), onDependency() {} });
const rail = (id, side, text = false) => `<nav id="${id}" class="ui-terminal-actions ui-terminal-action-sidebar flex flex-col items-center gap-2" data-dock-side="${side}" ${text ? 'data-show-text="true"' : ''}>${Array.from({ length: 10 }, (_, i) => `<div class="ui-terminal-action-sort-item"><button class="ui-icon-action" ${i === 1 ? 'data-active="true"' : ''}>${i + 1}</button></div>`).join('')}</nav>`;
const html = `<!doctype html><html data-theme="light" data-light-palette="sea-salt"><meta charset="utf-8"><title>Sea Salt real stylesheet fixture (not app)</title><style>${compiler.build(['flex', 'flex-col', 'items-center', 'gap-2'])}</style><body>
<h1>Real CSS cascade fixture — not live app</h1>
<div id="project" tabindex="0" class="ui-tree-node ui-tree-project" data-selected="true" data-accent="true">Selected project</div>
<div id="worktree" class="ui-worktree-row"><span class="ui-worktree-tree-icon">◇</span>Worktree</div>
<div id="invalid" class="ui-worktree-row" data-invalid="true"><span class="ui-worktree-tree-icon">!</span><span class="ui-tree-warning-chip">!</span>Missing worktree</div>
<div class="ui-terminal-tab-row"><div class="ui-terminal-tab-row-list">
${[true, false].map((active, i) => `<div id="tab${i}" class="ui-terminal-tab-row-item" data-active="${active}" data-sortable="true"><span class="ui-terminal-tab-row-drag-handle">⠿</span><button class="ui-terminal-tab-row-main"><span class="ui-terminal-tab-row-title">Terminal ${i + 1}</span></button><button class="ui-terminal-tab-row-close">×</button></div>`).join('')}
</div></div><div class="flex">${rail('right', 'right')}${rail('left', 'left')}${rail('text', 'right', true)}</div></body></html>`;
const file = join(mkdtempSync(join(tmpdir(), 'sea-salt-css-')), 'index.html');
writeFileSync(file, html);
console.log(pathToFileURL(file).href);
