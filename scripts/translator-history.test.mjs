import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = p => readFileSync(p, 'utf8').replaceAll('\r\n','\n');
test('history migration57 compatibility registration is unchanged', () => {
  const source = read('src-tauri/src/app/migrations.rs');
  assert.match(source, /version: 55,\s*description: "create_independent_chat",\s*sql: crate::chat::SCHEMA,/);
  assert.match(source, /version: 56,\s*description: "create_independent_chat_provider_catalog"/);
  assert.match(source, /version: 57,\s*description: "create_local_translator_history",\s*sql: crate::translator::history::SCHEMA/);
});
test('history and preference are absent from portable export/restore allowlists', () => {
  for (const path of ['src/features/sync/api/syncStore.ts', 'src/features/sync/lib/syncSettings.ts',
    'src-tauri/src/features/sync/commands.rs', 'src-tauri/src/features/sync/service/mod.rs',
    'src/shared/preferences/settingsStore.ts']) {
    assert.doesNotMatch(read(path), /translator_history|translatorHistoryRecording/);
  }
  assert.equal(read('src-tauri/src/features/translator/history.rs').trim(),
    '//! Immutable migration 57 compatibility only; no runtime history API or writer.\npub const SCHEMA: &str = include_str!("history.sql");');
});
test('migration57 remains last with unchanged hashes and no cleanup migration',()=>{
  const baseline={
  "55": "6a01c8bdd99ec37655af7a7f0827c4fa310ac2e72ee987065f057aca151893fa",
  "56": "85492e134d5a827bac224c7a5ce78724147b5a075ab23843507b3ac58fdb9bb2",
  "57": "506a2814bb0d0441086a64c55b2fbe7eac694cd8088f5c035adf170a139ba60f",
  "history.sql": "3caddde580a8bdfa1bbd74438c9671db41725f40100c8dbb86f1e58722364ccb",
  "chat/schema.sql": "ec56e7297f627fa22fe471036a08c96fea600aca884cf2fe4a2935f4bb887805"
};
  const hash=data=>createHash('sha256').update(data).digest('hex');
  const source=read('src-tauri/src/app/migrations.rs');
  for(const version of [55,56,57]) {
    const block=source.match(new RegExp('        Migration \\{\\n            version: '+version+',.*?\\n        \\},','s'))[0];
    assert.equal(hash(block.replaceAll('\r\n','\n')),baseline[version]);
  }
  assert.equal(hash(readFileSync('src-tauri/src/features/translator/history.sql')),baseline['history.sql']);
  assert.equal(hash(readFileSync('src-tauri/src/features/chat/schema.sql')),baseline['chat/schema.sql']);
  assert.match(source, /version: 57,\s*description: "create_local_translator_history",\s*sql: crate::translator::history::SCHEMA,\s*kind: MigrationKind::Up,\s*},\s*]\s*}/);
  assert.doesNotMatch(source, /version: 58|translator_history_cleanup/);
  assert.equal(existsSync('src-tauri/src/app/translator_history_cleanup.sql'), false);
  assert.equal(existsSync('src-tauri/src/features/translator/cleanup_tests.rs'), false);
});
test('no runtime history writers, commands, frontend APIs or warning contracts survive',()=>{
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);
  for(const root of ['src/features/translator','src-tauri/src/features/translator']) {
    for(const path of walk(root).filter(p=>/\.(rs|ts|tsx)$/.test(p))) {
      assert.doesNotMatch(read(path),/translator_history_|super::history::|saveWarning|save_warning|success_attempt_id/);
    }
  }
  assert.doesNotMatch(read('src-tauri/src/lib.rs'),/translator::history::/);
  for(const path of ['src/features/translator/api/history.ts','src/features/translator/api/TranslatorHistory.tsx']) assert.equal(existsSync(path),false);
});
