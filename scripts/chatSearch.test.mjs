import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, hookHarness, elements, tick, deferred } from './chatHarness.mjs';

test('searchHistory debounces rapid keystrokes to a single backend request with the latest query', async () => {
  const f = fixture(10);
  await f.controller.start();

  // Baseline list calls from start()
  const baselineCalls = f.calls.filter(c => c[0] === 'list').length;

  // Rapidly issue multiple searches
  f.controller.searchHistory('c', 40);
  await new Promise(r => setTimeout(r, 10));
  f.controller.searchHistory('co', 40);
  await new Promise(r => setTimeout(r, 10));
  f.controller.searchHistory('con', 40);

  // Before debounce elapses: no new list requests
  assert.equal(f.calls.filter(c => c[0] === 'list').length, baselineCalls);
  assert.equal(f.controller.getSnapshot().search, 'con');
  assert.equal(f.controller.getSnapshot().searching, true);

  // Wait for debounce timer to fire
  await new Promise(r => setTimeout(r, 60));
  await tick();

  // Exactly one new request was made, with the latest query 'con'
  const newCalls = f.calls.filter(c => c[0] === 'list').slice(baselineCalls);
  assert.equal(newCalls.length, 1);
  assert.equal(newCalls[0][1], 'con');
  assert.equal(f.controller.getSnapshot().searching, false);
});

test('searching status is true during debounce and fetch, and transitions to false upon completion', async () => {
  const f = fixture(5);
  await f.controller.start();

  const gate = deferred();
  const originalList = f.api.list;
  f.api.list = async (search, offset) => {
    if (search === 'slow') {
      await gate.promise;
    }
    return originalList(search, offset);
  };

  const p = f.controller.searchHistory('slow', 20);
  assert.equal(f.controller.getSnapshot().searching, true, 'searching while timer pending');

  await new Promise(r => setTimeout(r, 30));
  await tick();
  assert.equal(f.controller.getSnapshot().searching, true, 'searching while request in-flight');

  gate.resolve();
  await p;
  await tick();
  assert.equal(f.controller.getSnapshot().searching, false, 'searching cleared upon completion');
});

test('clearSearch cancels pending debounce, restores full list immediately and resets search text', async () => {
  const f = fixture(6);
  await f.controller.start();

  // Initial count
  const allCount = f.controller.getSnapshot().conversations.length;
  assert.equal(allCount, 6);

  // Set title on c1 and search
  f.rows.get('c1').conversation.title = 'findme';
  await f.controller.loadHistory('findme');
  assert.equal(f.controller.getSnapshot().conversations.length, 1);
  assert.equal(f.controller.getSnapshot().search, 'findme');

  // Trigger a new debounce search that would produce 0 results
  f.controller.searchHistory('nonexistent', 100);
  assert.equal(f.controller.getSnapshot().searching, true);

  // Clear search before debounce expires
  await f.controller.clearSearch();
  assert.equal(f.controller.getSnapshot().search, '');
  assert.equal(f.controller.getSnapshot().searching, false);
  assert.equal(f.controller.getSnapshot().conversations.length, allCount);

  // Ensure the cancelled timer does not run later
  await new Promise(r => setTimeout(r, 120));
  await tick();
  assert.equal(f.controller.getSnapshot().search, '');
  assert.equal(f.controller.getSnapshot().conversations.length, allCount);
});

test('source tab switch and search input change reset multi-select scope preventing accidental deletions', async () => {
  const f = fixture(8);
  await f.controller.start();
  const ui = hookHarness(f.controller);
  let tree = ui.render(true);

  const find = (t, p) => elements(t).find(p);
  const btn = (t, key) => find(t, n => n.type === 'button' && (n.props['aria-label'] === `chat.${key}` || n.props.children === `chat.${key}`));
  const controls = (h, t) => h.renderSelection(t);
  const row = (t, id) => find(t, n => n.props?.['data-chat-selection'] === id);
  const checkbox = (t, id) => find(row(t, id), n => n.type === 'input');

  // Enter multi-select mode
  btn(controls(ui, tree), 'selectChats').props.onClick();
  tree = ui.render(true);

  // Select c1
  checkbox(tree, 'c1').props.onChange();
  tree = ui.render(true);
  assert.equal(checkbox(tree, 'c1').props.checked, true);

  // Switch source tab -> selection MUST be reset
  const quickTab = elements(tree).find(n => n.props?.id === 'chat-source-quick-chat');
  assert.ok(quickTab);
  quickTab.props.onClick();
  tree = ui.render(true);

  // After switching tab, multi-select is reset
  assert.equal(row(tree, 'c1'), undefined, 'source switch resets multi-selection');

  // Switch back to workspace, enter selection again and select c1
  const wsTab = elements(tree).find(n => n.props?.id === 'chat-source-workspace');
  wsTab.props.onClick();
  tree = ui.render(true);
  btn(controls(ui, tree), 'selectChats').props.onClick();
  tree = ui.render(true);
  checkbox(tree, 'c1').props.onChange();
  tree = ui.render(true);
  assert.equal(checkbox(tree, 'c1').props.checked, true);

  // Type in search -> selection MUST be reset
  const searchInput = elements(tree).find(n => n.props?.className === 'chat-history-search');
  assert.ok(searchInput);
  searchInput.props.onChange({ target: { value: 'some search' } });
  tree = ui.render(true);

  assert.equal(row(tree, 'c1'), undefined, 'search input change resets multi-selection');
});

test('search UI provides clear button, honest loaded-history empty semantics and match feedback', async () => {
  const f = fixture(5);
  await f.controller.start();
  const ui = hookHarness(f.controller);

  f.rows.get('c1').conversation.title = 'alpha item';
  f.rows.get('c2').conversation.title = 'beta item';

  // Initially empty search: no clear button, default empty message if none
  let tree = ui.render(true);
  let clearBtn = elements(tree).find(n => n.props?.className === 'chat-history-search-clear');
  assert.equal(clearBtn, undefined, 'no clear button when search is empty');

  // Load search with match
  await f.controller.loadHistory('alpha');
  tree = ui.render(true);

  clearBtn = elements(tree).find(n => n.props?.className === 'chat-history-search-clear');
  assert.ok(clearBtn, 'clear button present when search is active');

  const feedback = elements(tree).find(n => n.props?.className === 'chat-history-search-feedback');
  assert.ok(feedback, 'search feedback present');
  assert.match(feedback.props.children.props.children, /chat\.searchMatches/);

  // Search with no matches in loaded history: honest semantic empty state
  await f.controller.loadHistory('nonexistent_string_123');
  tree = ui.render(true);

  const emptyText = elements(tree).find(n => n.props?.className === 'chat-history-empty');
  assert.ok(emptyText);
  assert.equal(emptyText.props.children, 'chat.searchNoMatchesInLoaded');

  // Click clear button
  clearBtn = elements(tree).find(n => n.props?.className === 'chat-history-search-clear');
  assert.ok(clearBtn);
  clearBtn.props.onClick();
  await tick();
  tree = ui.render(true);

  assert.equal(f.controller.getSnapshot().search, '');
  clearBtn = elements(tree).find(n => n.props?.className === 'chat-history-search-clear');
  assert.equal(clearBtn, undefined);
});
