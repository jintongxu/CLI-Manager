import test from 'node:test';
import assert from 'node:assert/strict';
import { load, elements } from './chatHarness.mjs';

function fixture() {
  const calls = [];
  const { PathCopyMenu } = load('src/features/files/api/PathCopyMenu.tsx', {
    react: { useState: () => [false, () => {}], useRef: () => ({ current: null }), useEffect() {} },
    '../../../shared/ui/icons': { ChevronRight() {}, Copy() {}, Link2() {}, Sparkles() {} },
    '../../../shared/ui/context-menu': { ContextMenuItem: function Item() {} },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
    './aiClipboard': { copyText: (...args) => calls.push(args) },
    './aiPathFormatter': { formatAiPathBlock: value => value },
    '../../projects/api/projectPathFormatter': { formatProjectAbsolutePath: (_, value) => value, formatProjectRelativePath: value => value },
  });
  return { calls, menu: (path, kind = 'file') => elements(PathCopyMenu({ project: {}, relativePath: path, kind }))
    .find(node => [node.props?.children].flat().includes('files.menu.copyName')) };
}

test('copy name takes basename including extension across file/directory path formats', () => {
  for (const [path, kind, expected] of [
    ['src/main.ts', 'file', 'main.ts'], ['src\\中文 文件.test.ts', 'file', '中文 文件.test.ts'],
    ['.env', 'file', '.env'], ['a/b/', 'directory', 'b'], ['目录\\子目录\\', 'directory', '子目录'],
  ]) {
    const f = fixture(); const item = f.menu(path, kind); assert.ok(item);
    item.props.onSelect();
    assert.deepEqual(f.calls[0], [expected, 'files.toast.nameCopied', 'files.toast.copyFailed']);
  }
});

test('root blank-area menu does not expose a copy-name action', () => {
  const f = fixture(); assert.equal(f.menu('', 'directory'), undefined);
  assert.equal(f.menu('/', 'directory'), undefined);
});
