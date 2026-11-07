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

test('SSH file opening ensures companion identity without replacing main ownership', () => {
  const source = readFileSync('src/features/terminal/store/terminalStore.ts', 'utf8');
  const editor = source.slice(source.indexOf('openFileEditorPane:'), source.indexOf('openSyncedHistoryPane:'));
  assert.match(editor, /kind: "file-editor"/);
  assert.doesNotMatch(editor, /createTerminalWorkspan|buildWorkspanMirror|setActive/);
  assert.match(editor, /\.show\(editorSessionId, project, mode\)/);
  assert.doesNotMatch(editor, /dispatchCurrentWork|splitSessionToEdge/);
  const controller = readFileSync('src/features/terminal/hooks/useTerminalTabsController.tsx', 'utf8');
  assert.match(controller, /useTerminalFileNavigation/);
  assert.doesNotMatch(controller, /useSshFileEditorCurrentWork|useCurrentWorkSessionController/);
});

test('canonical split panes exclude companion renderer and terminal tab identity', () => {
  const tabs = readFileSync('src/features/terminal/components/PaneTabBar.tsx', 'utf8');
  assert.match(tabs, /session.kind !== "file-editor"/);
  const leaf = readFileSync('src/features/terminal/components/PaneLeafView.tsx', 'utf8');
  assert.match(leaf, /session.kind !== "file-editor"/);
  assert.doesNotMatch(leaf, /<FileEditorPane/);
  assert.match(leaf, /session.kind === "subagent-transcript"/);
  assert.match(leaf, /<XTermTerminal/);
  assert.doesNotMatch(leaf, /currentWorkPortalTargets|createPortal/);
});

test('useFileEditorController triggers onClose when remaining files count is 0 and no diff tabs exist', () => {
  const source = readFileSync('src/features/files/hooks/useFileEditorController.ts', 'utf8');
  assert.match(source, /const remainingCount = visibleFiles\.filter\(\(file\) => !paths\.includes\(file\.path\)\)\.length;/);
  assert.match(source, /const hasDiffTabs = diffWorkspace\.tabs\.length > 0;/);
  assert.match(source, /if \(remainingCount === 0 && !hasDiffTabs\) \{\s*onClose\(\);/);
});
