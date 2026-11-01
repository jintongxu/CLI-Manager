import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hookHarness, elements } from './chatHarness.mjs';

const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const byClass = (tree, name) => elements(tree).filter(n => typeof n.props?.className === 'string' && n.props.className.split(/\s+/).includes(name));

test('pasted image becomes a clickable thumbnail with an Esc-dismissable lightbox', async () => {
  const f = fixture();
  await f.controller.start();
  await f.controller.select('c1');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  const textarea = () => elements(tree).find(n => n.type === 'textarea');
  textarea().props.onPaste({
    preventDefault() {},
    clipboardData: { items: [{ type: 'image/png', getAsFile: () => ({ name: 'shot.png', size: 12 }) }] },
  });
  await flush();
  tree = ui.render();

  const thumbs = byClass(tree, 'chat-attachment-thumb');
  assert.equal(thumbs.length, 1, 'pasted image renders a preview button');
  assert.equal(byClass(tree, 'chat-image-lightbox').length, 0);

  thumbs[0].props.onClick();
  tree = ui.render();
  const lightbox = byClass(tree, 'chat-image-lightbox');
  assert.equal(lightbox.length, 1, 'clicking the thumbnail opens the preview');
  assert.equal(lightbox[0].props.role, 'dialog');
  assert.equal(elements(lightbox[0]).find(n => n.type === 'img').props.src, 'data:image/png;base64,AAAA');

  // Backdrop click closes it again.
  lightbox[0].props.onClick();
  tree = ui.render();
  assert.equal(byClass(tree, 'chat-image-lightbox').length, 0);
  ui.cleanup();
});

test('composer reasoning menu opens above input and persists the selected level', async () => {
  const f = fixture();
  await f.controller.start();
  await f.controller.select('c1');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  const trigger = () => elements(tree).find(n => n.props?.className === 'chat-reasoning-trigger');
  assert.equal(trigger().props['aria-expanded'], false);
  assert.equal(elements(tree).filter(n => n.props?.className === 'chat-reasoning-option').length, 0);

  trigger().props.onClick();
  tree = ui.render();
  assert.equal(trigger().props['aria-expanded'], true);
  const options = elements(tree).filter(n => n.props?.className === 'chat-reasoning-option');
  assert.deepEqual(options.map(n => n.props.children[0].props.children), ['chat.reasoning.off', 'chat.reasoning.low', 'chat.reasoning.medium', 'chat.reasoning.high']);
  assert.equal(options[2].props['aria-checked'], true);
  options[3].props.onClick();
  tree = ui.render();
  assert.equal(trigger().props['aria-expanded'], false);
  assert.match(trigger().props['aria-label'], /high/);
  assert.equal(ui.storage.get('cli-manager.chat.reasoning'), JSON.stringify({ c1: 'high' }));
  ui.cleanup();
});
