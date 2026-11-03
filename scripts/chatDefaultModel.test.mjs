import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './chatHarness.mjs';
const { defaultCatalogModel } = load('src/features/chat/lib/chatProviderCatalog.ts', { '@tauri-apps/api/core': {} });
const { normalizeChatDefaultModelPreference: normalize } = load('src/shared/preferences/chatDefaultModel.ts');
const sync = load('src/features/sync/lib/syncSettings.ts');
const m = (modelId, enabled = true, isDefault = false) => ({ modelId, enabled, isDefault });
const p = (id, models, enabled = true, isDefault = false) => ({ id, models, enabled, isDefault });
const plain = value => JSON.parse(JSON.stringify(value));
const rows = [p('a', [m('first'), m('same')]), p('b', [m('same', true, true)])];
test('exact enabled provider + model wins for both policies; same-name model cannot cross providers', () => {
  for (const policy of ['sidebar', 'workspace']) {
    assert.deepEqual(plain(defaultCatalogModel(rows, { providerId: 'b', model: 'same' }, policy)), { providerId: 'b', model: 'same' });
    assert.deepEqual(plain(defaultCatalogModel(rows, { providerId: 'deleted', model: 'same' }, policy)), policy === 'sidebar' ? { providerId: 'a', model: 'first' } : { providerId: 'b', model: 'same' });
  }
});
test('disabled/deleted provider or model falls back, null and omitted preserve legacy policy', () => {
  for (const unavailable of [p('b', [m('same')], false), p('b', [m('same', false)]), p('b', [])]) {
    assert.deepEqual(plain(defaultCatalogModel([rows[0], unavailable], { providerId: 'b', model: 'same' })), { providerId: 'a', model: 'first' });
  }
  assert.deepEqual(plain(defaultCatalogModel(rows)), { providerId: 'a', model: 'first' });
  assert.deepEqual(plain(defaultCatalogModel(rows, null, 'workspace')), { providerId: 'b', model: 'same' });
  assert.deepEqual(plain(defaultCatalogModel([p('a', [m('first'), m('preferred', true, true)])])), { providerId: 'a', model: 'preferred' });
  assert.deepEqual(plain(defaultCatalogModel([rows[0], p('b', [m('same')], true, true)], null, 'workspace')), { providerId: 'b', model: 'same' });
  assert.equal(defaultCatalogModel([], { providerId: 'b', model: 'same' }), null);
  assert.equal(defaultCatalogModel([p('a', [m('x', false)])]), null);
});
test('old/invalid settings follow catalog; exact stored identity survives unavailable catalog and sync', () => {
  for (const value of [undefined, null, '', {}, [], { providerId: 'a' }, { providerId: 'a', model: '' }]) assert.equal(normalize(value), null);
  const identity = { providerId: ' b:1 ', model: 'same:model' };
  assert.deepEqual(plain(normalize(identity)), identity);
  assert.equal(sync.SETTING_BACKUP_POLICY.chatDefaultModel, 'preferences');
  assert.deepEqual(plain(sync.pickSyncableSettings({ chatDefaultModel: identity })), { chatDefaultModel: identity });
});

test('real settingsStore persists and reloads exact preference, null, old settings and stale identities', async () => {
  const disk = {};
  const createStore = () => load('src/shared/preferences/settingsStore.ts', {
    '@tauri-apps/api/core': { invoke: async () => {} },
    '@tauri-apps/plugin-store': { Store: { load: async () => ({
      entries: async () => Object.entries(disk),
      get: async key => disk[key],
      delete: async key => { delete disk[key]; },
      set: async (key, value) => { disk[key] = structuredClone(value); },
      save: async () => {},
    }) } },
    '../platform/appPaths': { getCliManagerDataPaths: async () => ({ settingsStorePath: 'test-only' }) },
    '../platform/shell': { getOsPlatform: async () => 'windows', defaultShellForOs: () => 'powershell.exe', isWindowsOnlyShellKey: () => false },
  }, { TextEncoder, window: { matchMedia: () => ({ matches: true }) } }).useSettingsStore;
  let store = createStore(); await store.getState().load();
  assert.equal(store.getState().chatDefaultModel, null);
  const identity = { providerId: 'deleted:provider', model: 'same:model' };
  await store.getState().update('chatDefaultModel', identity);
  assert.deepEqual(disk.chatDefaultModel, identity);
  store = createStore(); await store.getState().load();
  assert.deepEqual(plain(store.getState().chatDefaultModel), identity);
  await store.getState().update('chatDefaultModel', null);
  store = createStore(); await store.getState().load();
  assert.equal(store.getState().chatDefaultModel, null);
});

test('confirmed preference save rejects cache-only set + disk failure, rolls back before queued writes and reloads success', async () => {
  let disk = { chatDefaultModel: { providerId: 'old', model: 'old' } };
  let cache = structuredClone(disk), failSave = false;
  const createStore = () => load('src/shared/preferences/settingsStore.ts', {
    '@tauri-apps/api/core': { invoke: async () => {} },
    '@tauri-apps/plugin-store': { Store: { load: async () => ({
      entries: async () => Object.entries(cache),
      get: async key => cache[key],
      delete: async key => { delete cache[key]; },
      // Mirrors plugin cache semantics: set succeeds even if auto-save fails.
      set: async (key, value) => {
        cache[key] = structuredClone(value);
        if (!failSave) disk = structuredClone(cache);
      },
      save: async () => { if (failSave) throw Error('disk full'); disk = structuredClone(cache); },
    }) } },
    '../platform/appPaths': { getCliManagerDataPaths: async () => ({ settingsStorePath: 'test-only' }) },
    '../platform/shell': { getOsPlatform: async () => 'windows', defaultShellForOs: () => 'powershell.exe', isWindowsOnlyShellKey: () => false },
  }, { TextEncoder, window: { matchMedia: () => ({ matches: true }) } }).useSettingsStore;
  let store = createStore(); await store.getState().load(); await Promise.resolve();
  failSave = true;
  const rejected = store.getState().update('chatDefaultModel', { providerId: 'failed', model: 'failed' });
  const queued = store.getState().update('debugMode', true);
  await assert.rejects(rejected, /disk full/); await queued;
  assert.deepEqual(plain(store.getState().chatDefaultModel), disk.chatDefaultModel);
  assert.deepEqual(cache.chatDefaultModel, disk.chatDefaultModel);
  failSave = false;
  // A later auto-save-equivalent write must never flush the failed selection.
  await store.getState().update('debugMode', false);
  assert.equal(disk.chatDefaultModel.providerId, 'old');
  await store.getState().update('chatDefaultModel', { providerId: 'success', model: 'new' });
  cache = structuredClone(disk); store = createStore(); await store.getState().load();
  assert.deepEqual(plain(store.getState().chatDefaultModel), { providerId: 'success', model: 'new' });
});

test('confirmed write deletes absent baseline and fences subsequent writes if cache rollback fails', async () => {
  const { createSettingsPersistence } = load('src/shared/preferences/settingsPersistence.ts');
  let cache = {}, rollbackFails = false, sets = 0;
  const persistence = createSettingsPersistence({
    get: async key => cache[key], set: async (key, value) => { sets++; cache[key] = value; },
    delete: async key => { if (rollbackFails) throw Error('rollback'); delete cache[key]; },
    save: async () => { throw Error('disk'); },
  });
  await assert.rejects(persistence.setConfirmed('chatDefaultModel', 'bad'), /disk/);
  assert.equal('chatDefaultModel' in cache, false);
  rollbackFails = true;
  await assert.rejects(persistence.setConfirmed('chatDefaultModel', 'bad'), /disk/);
  const before = sets;
  await assert.rejects(persistence.set('debugMode', true));
  assert.equal(sets, before);
});

for (const failure of ['set', 'save']) {
  for (const missing of [false, true]) {
    test(`failed chat ${failure} + failed rollback recovers before root auto-save (${missing ? 'absent' : 'existing'} baseline)`, async () => {
      const { createSettingsPersistence } = load('src/shared/preferences/settingsPersistence.ts');
      const { createWorktreeRootSaver } = load('src/shared/preferences/worktreeRootPersistence.ts');
      const old = { providerId: 'old', model: 'old' };
      let cache = { worktreeDefaultRoot: 'D:/old', ...(missing ? {} : { chatDefaultModel: old }) };
      let disk = structuredClone(cache), broken = true, chatSets = 0, saves = 0;
      const snapshots = [];
      const flush = () => { disk = structuredClone(cache); snapshots.push(disk); };
      const persistence = createSettingsPersistence({
        get: async key => cache[key],
        set: async (key, value) => {
          if (key === 'chatDefaultModel' && broken && ++chatSets > 1) throw Error('rollback');
          cache[key] = structuredClone(value);
          if (broken && key === 'chatDefaultModel') {
            if (failure === 'set') throw Error('set failed after mutation');
            return; // Plugin cache can succeed while auto-save is unavailable.
          }
          flush();
        },
        delete: async key => { if (broken) throw Error('rollback'); delete cache[key]; flush(); },
        save: async () => { saves++; if (broken) throw Error('save failed'); flush(); },
      });
      let published = 'D:/old';
      const saveRoot = createWorktreeRootSaver(async () => persistence, async root => root, root => { published = root; });
      await assert.rejects(persistence.setConfirmed('chatDefaultModel', { providerId: 'failed', model: 'failed' }), /failed/);
      const before = saves;
      // No entry point may flush while the baseline is still unrecoverable.
      await assert.rejects(persistence.set('debugMode', true), /rollback/);
      await assert.rejects(persistence.save(), /rollback/);
      let entered = false;
      await assert.rejects(persistence.exclusive(async store => { entered = true; await store.save(); }), /rollback/);
      await assert.rejects(saveRoot('D:/blocked'), /rollback/);
      assert.equal(entered, false);
      assert.equal(saves, before);
      assert.equal(published, 'D:/old');
      assert.equal(cache.worktreeDefaultRoot, 'D:/old');
      broken = false;
      await saveRoot('D:/new');
      await persistence.set('debugMode', true);
      await persistence.save();
      assert.equal(published, 'D:/new');
      assert.equal(disk.worktreeDefaultRoot, 'D:/new');
      assert.ok(snapshots.length > 0);
      // Every auto-save, including recovery itself, must contain the baseline.
      for (const snapshot of snapshots) {
        assert.deepEqual(snapshot.chatDefaultModel, missing ? undefined : old);
        assert.equal(Object.hasOwn(snapshot, 'chatDefaultModel'), !missing);
      }
    });
  }
}
