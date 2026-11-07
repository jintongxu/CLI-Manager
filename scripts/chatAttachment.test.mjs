import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { fixture, hookHarness, elements, load } from './chatHarness.mjs';

const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const byClass = (tree, name) => elements(tree).filter(n => typeof n.props?.className === 'string' && n.props.className.split(/\s+/).includes(name));

const editorReact = {
  useEffect() {},
  useRef: value => ({ current: value }),
  useState: value => [value, () => {}],
};
const { ChatMessageEditor } = load('src/features/chat/components/ChatMessageEditor.tsx', { react: editorReact });
const editorLabels = {
  edit: 'Edit message', text: 'Message', preserveImages: 'Keep images', replaceImages: 'Replace images',
  addImages: 'Add image', removeImage: name => `Remove ${name}`, staging: 'Staging', stageFailed: 'Failed',
  retry: 'Retry', cancel: 'Cancel', submit: 'Save',
};

test('chat messages center assistant reading column and keep composer aligned while user turns stay right aligned', () => {
  const root = postcss.parse(readFileSync('src/features/chat/components/chatWorkspace.css', 'utf8'));
  const declarations = selector => {
    const rule = root.nodes.find(node => node.type === 'rule' && node.selector === selector);
    return new Map((rule?.nodes ?? []).filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  };
  assert.equal(declarations('.chat-message-assistant').get('align-self'), 'center');
  assert.equal(declarations('.chat-message-assistant').get('width'), 'min(100%, 960px)');
  assert.equal(declarations('.chat-composer-container').get('width'), 'min(calc(100% - 32px), 960px)');
  assert.equal(declarations('.chat-composer-container').get('margin'), '8px auto 16px');
  assert.equal(declarations('.chat-message-user').get('align-self'), 'flex-end');
});

test('message editor renders an accessible compact image group with bounded thumbnail controls', () => {
  const tree = ChatMessageEditor({
    message: { id: 'u1', role: 'user', status: 'completed', content: 'hello', assets: [{ assetId: 'a1' }] },
    staged: [{ localId: 'local-1', previewUrl: 'blob:one', name: 'a-very-long-screenshot-name.png', status: 'failed' }],
    labels: editorLabels, onStageImages() {}, onRemoveStaged() {}, onRetryStaged() {}, onSubmit() {}, onCancel() {},
  });
  const fieldset = elements(tree).find(node => node.type === 'fieldset');
  assert.ok(fieldset, 'image choices use a semantic fieldset');
  assert.equal(elements(fieldset).find(node => node.type === 'legend').props.children, 'Add image');
  assert.equal(elements(fieldset).filter(node => node.type === 'input' && node.props.type === 'radio').length, 2);
  assert.equal(byClass(tree, 'chat-message-editor-thumbnail').length, 1, 'preview is bounded by a dedicated thumbnail wrapper');
  const remove = byClass(tree, 'chat-message-editor-remove-image')[0];
  assert.equal(remove.props.children, '×', 'long remove label is not duplicated visibly');
  assert.equal(remove.props['aria-label'], 'Remove a-very-long-screenshot-name.png');
  assert.equal(byClass(tree, 'chat-message-editor-image-name')[0].props.children, 'a-very-long-screenshot-name.png');
});

test('message editor source and CSS keep attachment and staged image sizing independently bounded', () => {
  const source = readFileSync('src/features/chat/components/ChatMessageEditor.tsx', 'utf8');
  assert.match(source, /className="chat-message-editor-thumbnail"/);
  assert.doesNotMatch(source, /min-width:\s*min\([^\n]*72vw/);

  const root = postcss.parse(readFileSync('src/features/chat/components/chatMessageMedia.css', 'utf8'));
  const rules = [];
  root.walkRules(rule => rules.push(rule));
  const declarations = selector => rules.filter(rule => rule.selector === selector)
    .flatMap(rule => rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  assert.ok(declarations('.chat-message-attachment-open').some(([prop, value]) => prop === 'width' && value === '64px'));
  assert.ok(declarations('.chat-message-editor-thumbnail').some(([prop, value]) => prop === 'width' && value === '72px'));
  assert.ok(declarations('.chat-message-editor-thumbnail').some(([prop, value]) => prop === 'height' && value === '72px'));
  assert.ok(declarations('.chat-message-editor-thumbnail img').some(([prop, value]) => prop === 'object-fit' && value === 'cover'));
  assert.equal(rules.some(rule => rule.selector?.split(',').map(value => value.trim()).includes('.chat-message-editor-images img')), false,
    'no unbounded editor image selector can override the fixed wrapper');
  assert.ok(declarations('.chat-message-editor').some(([prop, value]) => prop === 'min-width' && value === '0'));
  assert.ok(declarations('.chat-message-editor').some(([prop, value]) => prop === 'width' && value === '100%'));
  assert.equal(root.toString().includes('72vw'), false);
});

test('staged attachment owner fences late stages and releases only backend-owned IDs', async () => {
  const urls = [], revoked = [], released = []; let stage = 0, fail = false;
  const { AttachmentDraftOwner } = (await import('./chatHarness.mjs')).load('src/features/chat/lib/chatImageAttachments.ts', {}, { File: class File {} });
  const owner = new AttachmentDraftOwner({ stage: async bytes => {
    if (fail) throw 'chat_asset_storage';
    return { stageId: `s${++stage}`, mediaType: 'image/png', byteLength: bytes.byteLength, width: 1, height: 1 };
  }, releaseAssets: async ids => { released.push([...ids]); } },
    () => { const url = `blob:preview-${urls.length + 1}`; urls.push(url); return url; }, url => revoked.push(url));
  const blob = new Blob(['image'], { type: 'image/png' });
  const first = await owner.stage(blob, 'shot.png');
  assert.equal(first.previewUrl, 'blob:preview-1'); assert.equal(owner.value[0].previewUrl, first.previewUrl);
  // A failed generate/fork does not transfer ownership or require any mutation.
  assert.equal(owner.stageIds.join(','), 's1'); assert.deepEqual(revoked, []);
  owner.remove('s1'); assert.deepEqual(revoked, ['blob:preview-1']); assert.deepEqual(released, [['s1']]);
  await owner.stage(blob); owner.switchConversation(); assert.deepEqual(revoked, ['blob:preview-1', 'blob:preview-2']);
  assert.deepEqual(released, [['s1'], ['s2']]);
  await owner.stage(blob); owner.consumed(['s3']); assert.deepEqual(revoked, ['blob:preview-1', 'blob:preview-2', 'blob:preview-3']);
  assert.deepEqual(released, [['s1'], ['s2']], 'success commit consumes its submitted ID without releasing it');
  fail = true; await assert.rejects(owner.stage(blob), error => error === 'chat_asset_storage');
  const retained = owner.value[0]; assert.equal(retained.status, 'failed'); assert.equal(retained.previewUrl, 'blob:preview-4');
  assert.deepEqual(revoked, ['blob:preview-1', 'blob:preview-2', 'blob:preview-3']);
  fail = false;
  const retryOne = owner.retry(retained.localId); const retryTwo = owner.retry(retained.localId);
  assert.equal(retryOne, retryTwo, 'retry is single-flight per draft');
  await retryOne; assert.equal(retained.status, 'staged');
  owner.dispose(); assert.deepEqual(revoked, ['blob:preview-1', 'blob:preview-2', 'blob:preview-3', 'blob:preview-4']);
  assert.deepEqual(released.at(-1), ['s4']);

  let finish;
  const late = new AttachmentDraftOwner({ stage: () => new Promise(resolve => { finish = resolve; }),
    releaseAssets: async ids => { released.push([...ids]); } }, () => 'blob:late', url => revoked.push(url));
  const pending = late.stage(blob); late.switchConversation(); await flush();
  finish({ stageId: 'late-stage', mediaType: 'image/png', byteLength: 5, width: 1, height: 1 });
  await pending; await flush();
  assert.deepEqual(released.at(-1), ['late-stage']);
  assert.equal(late.value.length, 0, 'late completion cannot reattach to the switched draft owner');
});

test('pasted image becomes a clickable thumbnail with an Esc-dismissable lightbox', async () => {
  const f = fixture();
  await f.controller.start();
  await f.controller.select('c1');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  const textarea = () => elements(tree).find(n => n.type === 'textarea');
  textarea().props.onPaste({
    preventDefault() {},
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => Object.assign(new Blob(['image'], { type: 'image/png' }), { name: 'shot.png' }) }] },
  });
  await flush();
  tree = ui.render();

  const thumbs = byClass(tree, 'chat-attachment-thumb');
  assert.equal(thumbs.length, 1, 'pasted image renders a preview button');
  assert.equal(byClass(tree, 'chat-send-btn')[0].props.disabled, false, 'a staged image enables image-only workspace send');
  assert.equal(byClass(tree, 'chat-image-lightbox').length, 0);

  thumbs[0].props.onClick();
  tree = ui.render();
  const lightbox = byClass(tree, 'chat-image-lightbox');
  assert.equal(lightbox.length, 1, 'clicking the thumbnail opens the preview');
  assert.match(elements(lightbox[0]).find(n => n.type === 'img').props.src, /^blob:/);

  // The shared lightbox owns backdrop/Escape dismissal and calls this close boundary.
  lightbox[0].props.onClose();
  tree = ui.render();
  assert.equal(byClass(tree, 'chat-image-lightbox').length, 0);
  ui.cleanup();
});

test('branch parent remains selectable while unloaded and is deleted only when lineage nulls it', async () => {
  const { ChatBranchNavigation } = (await import('./chatHarness.mjs')).load('src/features/chat/components/ChatBranchNavigation.tsx');
  const selected = [];
  const labels = { navigation: 'Branches', parent: 'Parent', parentDeleted: 'Deleted', children: 'Children', child: () => 'Child' };
  const lineage = { current: { conversationId: 'child', parentConversationId: 'unloaded-parent' }, children: [] };
  let tree = ChatBranchNavigation({ lineage, labels, parentAvailable: true, onSelectConversation: id => selected.push(id) });
  const parent = elements(tree).find(node => node.type === 'button');
  parent.props.onClick(); assert.deepEqual(selected, ['unloaded-parent']);
  tree = ChatBranchNavigation({ lineage: { current: { ...lineage.current, parentConversationId: null }, children: [] }, labels,
    parentAvailable: false, onSelectConversation: id => selected.push(id) });
  assert.equal(elements(tree).some(node => node.props?.role === 'status'), true);
  assert.equal(elements(tree).some(node => node.type === 'button'), false);
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
  assert.deepEqual(options.map(n => n.props.children[0].props.children), ['chat.reasoning.medium', 'chat.reasoning.high', 'chat.reasoning.xhigh', 'chat.reasoning.max']);
  assert.equal(options[0].props['aria-checked'], true);
  options[1].props.onClick();
  tree = ui.render();
  assert.equal(trigger().props['aria-expanded'], false);
  assert.match(trigger().props['aria-label'], /high/);
  assert.equal(ui.storage.get('cli-manager.chat.reasoning'), JSON.stringify({ c1: 'high' }));
  ui.cleanup();
});
