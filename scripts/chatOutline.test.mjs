import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hookHarness, elements } from './chatHarness.mjs';

const byClass = (tree, name) => elements(tree).find(node => node.props?.className?.split?.(/\s+/).includes(name));
const questions = (tree) => elements(byClass(tree, 'chat-question-outline')).filter(node => node.type === 'li');

function addQuestion(row, id, content) {
  row.messages.push({ id, conversationId: row.conversation.id, role: 'user', status: 'completed', content,
    createdAt: 1, updatedAt: 1, ordinal: row.messages.length });
}

test('question outline follows only the current chat and handles multiline prompts', async () => {
  const f = fixture();
  addQuestion(f.rows.get('c1'), 'q1', '  \nFirst question\nlong detail');
  addQuestion(f.rows.get('c1'), 'a1', '');
  f.rows.get('c1').messages.at(-1).role = 'assistant';
  addQuestion(f.rows.get('c1'), 'q2', 'Second question');
  addQuestion(f.rows.get('c2'), 'q3', 'Other conversation');
  await f.controller.start();
  await f.controller.select('c1');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  assert.equal(questions(tree).length, 2);
  assert.equal(elements(questions(tree)[0]).find(node => node.props?.className === 'chat-outline-label').props.children, 'First question');
  assert.equal(elements(questions(tree)[0]).find(node => node.type === 'button').props.title, '  \nFirst question\nlong detail');

  await f.controller.select('c2');
  tree = ui.render();
  assert.equal(questions(tree).length, 1);
  assert.equal(elements(questions(tree)[0]).find(node => node.type === 'button').props.title, 'Other conversation');
  await f.controller.create();
  tree = ui.render();
  assert.equal(byClass(tree, 'chat-question-outline'), undefined);
  ui.cleanup();
});

test('outline is a compact edge rail that reveals on hover or keyboard focus', async () => {
  const f = fixture(1);
  addQuestion(f.rows.get('c1'), 'q1', 'First');
  await f.controller.start();
  await f.controller.select('c1');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  let rail = byClass(tree, 'chat-outline-rail');
  assert.ok(rail);
  assert.equal(rail.props.className.includes('chat-outline-rail-open'), false);
  assert.equal(elements(rail).find(node => node.props?.className === 'chat-outline-toggle').props['aria-expanded'], false);
  rail.props.onMouseEnter();
  tree = ui.render();
  rail = byClass(tree, 'chat-outline-rail');
  assert.ok(rail.props.className.includes('chat-outline-rail-open'));
  rail.props.onMouseLeave();
  tree = ui.render();
  assert.equal(byClass(tree, 'chat-outline-rail').props.className.includes('chat-outline-rail-open'), false);
  rail.props.onFocus();
  tree = ui.render();
  assert.ok(byClass(tree, 'chat-outline-rail').props.className.includes('chat-outline-rail-open'));
  ui.cleanup();
});

test('outline click locates the matching question inside the message scroller and tracks manual scroll', async () => {
  const f = fixture(1);
  addQuestion(f.rows.get('c1'), 'q1', 'First');
  addQuestion(f.rows.get('c1'), 'q2', 'Second');
  await f.controller.start();
  await f.controller.select('c1');
  const ui = hookHarness(f.controller);
  let tree = ui.render();
  let focused = null;
  const nodes = ['q1', 'q2'].map((id, index) => ({ dataset: { chatQuestionId: id },
    focus: () => { focused = id; },
    getBoundingClientRect: () => ({ top: 120 + index * 100 - container.scrollTop }) }));
  const container = { scrollTop: 0, scrollHeight: 800, clientHeight: 200,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => nodes };
  byClass(tree, 'chat-messages').props.ref.current = container;
  let rail = byClass(tree, 'chat-outline-rail');
  rail.props.onMouseEnter();
  tree = ui.render();
  elements(questions(tree)[1]).find(node => node.type === 'button').props.onClick();
  assert.equal(container.scrollTop, 108);
  assert.equal(focused, 'q2');
  tree = ui.render();
  rail = byClass(tree, 'chat-outline-rail');
  assert.equal(rail.props.className.includes('chat-outline-rail-open'), false);
  assert.equal(elements(questions(tree)[1]).find(node => node.type === 'button').props['aria-current'], 'location');
  rail.props.onMouseEnter();
  tree = ui.render();
  assert.equal(byClass(tree, 'chat-outline-rail').props.className.includes('chat-outline-rail-open'), false);
  byClass(tree, 'chat-outline-rail').props.onMouseLeave();
  byClass(ui.render(), 'chat-outline-rail').props.onMouseEnter();
  tree = ui.render();
  assert.equal(byClass(tree, 'chat-outline-rail').props.className.includes('chat-outline-rail-open'), true);

  container.scrollTop = 0;
  byClass(tree, 'chat-messages').props.onScroll({ currentTarget: container });
  tree = ui.render();
  assert.equal(elements(questions(tree)[0]).find(node => node.type === 'button').props['aria-current'], 'location');
  ui.cleanup();
});
