import test from 'node:test';
import assert from 'node:assert/strict';
import { load, elements, tick, deferred } from './chatHarness.mjs';

function fixture(rows = [{ id: 'first', name: 'First', baseUrl: 'https://first.example', protocol: 'openai_chat', enabled: true, isDefault: false, models: [] }]) {
  const slots = [], effects = [], calls = []; let index = 0;
  const react = {
    useState(initial) {
      const key = index++;
      if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
      return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }];
    },
    useMemo(fn) { return fn(); },
    useEffect(fn) { const key = index++; if (!(key in slots)) { slots[key] = true; effects.push(fn); } },
  };
  const mantine = Object.fromEntries(
    ['ActionIcon', 'Box', 'Button', 'Card', 'Checkbox', 'Collapse', 'Group', 'Loader', 'Modal', 'ScrollArea', 'Select', 'Stack', 'Switch', 'Text', 'TextInput', 'Title']
      .map(name => [name, name])
  );
  let response;
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === 'chat_provider_catalog_list') return structuredClone(rows);
    if (command === 'chat_provider_fetch_remote_models') return ['gpt-4o', 'gpt-5.6-luna'];
    if (command === 'chat_provider_batch_sync_models') {
      const found = rows.find(r => r.id === args.providerId);
      const updated = {
        id: args.providerId,
        name: found?.name || 'Prov',
        baseUrl: found?.baseUrl || 'https://',
        protocol: 'openai_chat',
        enabled: true,
        isDefault: false,
        models: args.models.map(m => ({ modelId: m.modelId, enabled: true, isDefault: false })),
      };
      return updated;
    }
    if (response) return response.promise;
    return { ...args?.input, models: [] };
  };
  const { ChatModelSettingsPage } = load('src/features/settings/components/pages/ChatModelSettingsPage.tsx', {
    react,
    '@mantine/core': mantine,
    '@tauri-apps/api/core': { invoke },
    '../../../../shared/i18n/index': { useI18n: () => ({ t: key => key }) },
  });
  let tree;
  const f = {
    calls,
    render() { index = 0; tree = ChatModelSettingsPage(); effects.splice(0).forEach(fn => fn()); return tree; },
    nodes() { return elements(tree); },
    button(key) {
      return f.nodes().find(n => n.type === 'Button' && n.props?.children === key);
    },
    input(label) {
      return f.nodes().find(n => n.type === 'TextInput' && n.props?.label === `settings.chatModels.${label}`);
    },
    pending() { response = deferred(); return response; },
  };
  f.render(); return f;
}
const add = 'settings.chatModels.addProvider';

test('initial load selects first backend provider and shows its fields in right pane', async () => {
  const f = fixture(); await tick(); f.render();
  assert.equal(f.input('name').props.value, 'First');
  assert.equal(f.input('interfaceAddress').props.value, 'https://first.example');
});

test('clicking add provider switches right pane to new-provider view without modal', async () => {
  const f = fixture(); await tick(); f.render();
  f.button(add).props.onClick(); f.render();
  assert.equal(f.input('name').props.value, '');
  assert.equal(f.input('interfaceAddress').props.value, '');
  assert.equal(f.button('common.cancel') !== undefined, true);
});

test('new provider auto-derives id for non-ascii names, allowing save button to be clickable', async () => {
  const f = fixture([]); await tick(); f.render();
  f.button(add).props.onClick(); f.render();
  // Name in Chinese: deriveId should produce non-empty id
  f.input('name').props.onChange({ currentTarget: { value: '重案组之虎' } });
  f.render();
  f.input('interfaceAddress').props.onChange({ currentTarget: { value: 'http://159.138.99.104:8080/v1' } });
  f.render();
  const saveBtn = f.button('settings.chatModels.save');
  assert.equal(saveBtn.props.disabled, false);
  await saveBtn.props.onClick();
  await tick();
  const saveCall = f.calls.find(c => c.command === 'chat_provider_catalog_upsert');
  assert.ok(saveCall);
  assert.ok(saveCall.args.input.id.length > 0);
  assert.equal(saveCall.args.input.name, '重案组之虎');
  assert.equal(saveCall.args.input.baseUrl, 'http://159.138.99.104:8080/v1');
});

test('test connection button is clickable on valid endpoint even when provider is new', async () => {
  const f = fixture([]); await tick(); f.render();
  f.button(add).props.onClick(); f.render();
  const testBtn = f.button('settings.chatModels.test');
  assert.equal(testBtn.props.disabled, true);
  f.input('interfaceAddress').props.onChange({ currentTarget: { value: 'http://159.138.99.104:8080/v1' } });
  f.render();
  const updatedTestBtn = f.button('settings.chatModels.test');
  assert.equal(updatedTestBtn.props.disabled, false);
  await updatedTestBtn.props.onClick();
  await tick();
  const probeCall = f.calls.find(c => c.command === 'chat_provider_test_probe');
  assert.ok(probeCall);
  assert.equal(probeCall.args.input.baseUrl, 'http://159.138.99.104:8080/v1');
});

test('typing in apiKey extracts event value synchronously, avoiding null currentTarget crash', async () => {
  const f = fixture([]); await tick(); f.render();
  f.button(add).props.onClick(); f.render();
  let accessed = false;
  const fakeEvent = {
    get currentTarget() {
      if (accessed) return null;
      accessed = true;
      return { value: 'sk-my-secret-key' };
    },
  };
  const keyInput = f.input('apiKey');
  assert.doesNotThrow(() => {
    keyInput.props.onChange(fakeEvent);
  });
  f.render();
  assert.equal(f.input('apiKey').props.value, 'sk-my-secret-key');
});

test('manage models on new unsaved provider persists provider first, preventing foreign key storage errors', async () => {
  const f = fixture([]); await tick(); f.render();
  f.button(add).props.onClick(); f.render();
  f.input('name').props.onChange({ currentTarget: { value: 'New Cloud' } });
  f.render();
  f.input('interfaceAddress').props.onChange({ currentTarget: { value: 'https://newcloud.example/v1' } });
  f.render();
  const manageBtn = f.button('settings.chatModels.manageModels');
  assert.ok(manageBtn);
  await manageBtn.props.onClick();
  await tick();
  const applyBtn = f.button('settings.chatModels.applyModels');
  assert.ok(applyBtn);
  // Applying on brand new provider triggers persistProvider -> then batch_sync_models
  await applyBtn.props.onClick();
  await tick();
  const upsertCall = f.calls.find(c => c.command === 'chat_provider_catalog_upsert');
  assert.ok(upsertCall, 'Should upsert provider before syncing models');
  const syncCall = f.calls.find(c => c.command === 'chat_provider_batch_sync_models');
  assert.ok(syncCall, 'Should batch sync models with the returned id');
  assert.equal(syncCall.args.providerId, upsertCall.args.input.id);
});
