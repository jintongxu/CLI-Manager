import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ChatReasoningPill component structure, labels, and icon', () => {
  const pillSource = readFileSync('src/features/chat/components/ChatReasoningPill.tsx', 'utf8');
  assert.match(pillSource, /Brain/);
  assert.match(pillSource, /ChevronDown/);
  assert.match(pillSource, /Check/);
  assert.match(pillSource, /chat\.panel\.reasoningPrefix/);
  assert.match(pillSource, /chat-reasoning-pill/);
  assert.match(pillSource, /SelectPrimitive\.Root/);
  assert.match(pillSource, /SelectPrimitive\.Trigger/);
  assert.match(pillSource, /SelectPrimitive\.Content/);

  const css = readFileSync('src/features/chat/components/chatPanel.css', 'utf8');
  assert.match(css, /\.chat-reasoning-pill \{/);
  assert.match(css, /\.chat-reasoning-pill\.is-active \{/);
  assert.match(css, /var\(--accent/);
  assert.match(css, /transform: rotate\(180deg\)/);

  const zh = readFileSync('src/shared/i18n/messages/chat.zh-CN.ts', 'utf8');
  assert.match(zh, /"chat\.panel\.reasoningPrefix": "思考"/);
  const en = readFileSync('src/shared/i18n/messages/chat.en-US.ts', 'utf8');
  assert.match(en, /"chat\.panel\.reasoningPrefix": "Think"/);
});

test('useCurrentWorkSessionController splits SSH file editor to the right of active SSH terminal', () => {
  const source = readFileSync('src/features/terminal/hooks/useCurrentWorkSessionController.ts', 'utf8');
  assert.match(source, /CURRENT_WORK_SESSION_CREATED_EVENT/);
  assert.match(source, /isSshFileEditor/);
  assert.match(source, /isCurrentActiveSsh/);
  assert.match(source, /splitSessionToEdge\(sessionId, targetPaneId, "right"\)/);
});

test('CurrentWorkTabBar renders file icon, active file title, dirty marker and SSH host context', () => {
  const source = readFileSync('src/features/terminal/components/CurrentWorkTabBar.tsx', 'utf8');
  assert.match(source, /FileText/);
  assert.match(source, /useFileExplorerStore/);
  assert.match(source, /useSshHostStore/);
  assert.match(source, /state\.project\?\.id === session\.projectId/);
  assert.match(source, /return file \? `\$\{file\.name\}\$\{file\.content !== file\.savedContent \? " \*" : ""\}` : null;/);
  assert.match(source, /`SSH: \$\{sshHostLabel\}`/);
  assert.match(source, /<FileText size=\{12\}/);
});

test('useFileEditorController triggers onClose when remaining files count is 0 and no diff tabs exist', () => {
  const source = readFileSync('src/features/files/hooks/useFileEditorController.ts', 'utf8');
  assert.match(source, /const remainingCount = visibleFiles\.filter\(\(file\) => !paths\.includes\(file\.path\)\)\.length;/);
  assert.match(source, /const hasDiffTabs = diffWorkspace\.tabs\.length > 0;/);
  assert.match(source, /if \(remainingCount === 0 && !hasDiffTabs\) \{\s*onClose\(\);/);
});
