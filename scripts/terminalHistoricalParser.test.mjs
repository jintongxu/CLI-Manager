import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
globalThis.self = globalThis;
const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/xterm');
assert.equal(require('@xterm/addon-image/package.json').version, '0.10.0-beta.288');
assert.equal(require('@xterm/xterm/package.json').version, '6.1.0-beta.288');
const dir = mkdtempSync(join(tmpdir(), 'terminal-origin-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const source = new URL('../src/shared/lib/terminalHistoricalParser.ts', import.meta.url);
let adapter;
if (existsSync(source)) {
  await build({ entryPoints: [source.pathname.replace(/^\/(\w:)/, '$1')], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'adapter.mjs') });
  adapter = await import(pathToFileURL(join(dir, 'adapter.mjs')));
} else {
  // RED baseline: the old enumerated query policy does not intercept DECSET focus.
  adapter = {
    installTerminalHistoricalParser: () => ({ dispose() {} }),
    writeTerminalOutput: (t, data, origin, cb) => t.write(data, cb),
    canEmitTerminalProtocol: () => true,
    coldSnapshotInputModeReset: '',
  };
}
await build({ entryPoints: ['src/shared/lib/terminalImageProtocolOrigin.ts', 'src/shared/lib/terminalQueryPolicy.ts'], bundle: true, platform: 'node', format: 'esm', outdir: dir });
// Use one adapter module instance for both addon producer and core guard.
await build({ entryPoints: ['src/shared/lib/terminalImageProtocolOrigin.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'image.mjs'), plugins: [{ name: 'shared-adapter', setup(b) { b.onResolve({ filter: /^\.\/terminalHistoricalParser$/ }, () => ({ path: './adapter.mjs', external: true })); } }] });
const imageOrigin = await import(pathToFileURL(join(dir, 'image.mjs')));
const policy = await import(pathToFileURL(join(dir, 'terminalQueryPolicy.js')));
// Real production OSC normalizer, only its React/store environment replaced.
writeFileSync(join(dir, 'react.mjs'), 'export const useRef = current => ({current});');
writeFileSync(join(dir, 'state.mjs'), 'export const useTerminalStore = {getState: () => ({sessions: [], handleShellRuntimeEvent(){}, updateSessionCwd(){}})};');
for (const [name, path] of [['terminalOscParse', 'src/features/terminal/lib/terminalOscParse.ts'], ['terminalOscPath', 'src/features/terminal/lib/terminalOscPath.ts']]) {
  await build({entryPoints: [path], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, name + '.mjs')});
}
const normalizerText = ts.transpileModule(readFileSync('src/features/terminal/hooks/useTerminalOsc.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}}).outputText
  .replace('from "react"', 'from "./react.mjs"').replace('from "../state"', 'from "./state.mjs"')
  .replace('from "../lib/terminalOscPath"', 'from "./terminalOscPath.mjs"').replace('from "../lib/terminalOscParse"', 'from "./terminalOscParse.mjs"');
writeFileSync(join(dir, 'osc.mjs'), normalizerText);
const {useTerminalOsc} = await import(pathToFileURL(join(dir, 'osc.mjs')));
function fixture() {
  const t = new Terminal({ allowProposedApi: true, cols: 40, rows: 8 });
  // No DOM is opened; public paste needs only its textarea value sink.
  t._core.textarea = { value: '' };
  const owner = adapter.installTerminalHistoricalParser(t);
  const sink = [];
  t.onData(data => sink.push(['data', data]));
  t.onBinary(data => sink.push(['binary', data]));
  const write = (data, origin = 'history', normalize) => new Promise(resolve => adapter.writeTerminalOutput(t, data, origin, resolve, normalize));
  return { t, sink, write, close() { owner.dispose(); t.dispose(); } };
}
test('real xterm historical protocol producers are suppressed, visual setters survive', async () => {
  const f = fixture();
  try {
    await f.write('\x1b[6n\x1b[c\x1b[>c\x1b[?1004h\x1b[?1004$p\x1bP$qm\x1b\\\x1b[31m中文😀');
    assert.deepEqual(f.sink, []);
    assert.equal(f.t.buffer.active.getLine(0).translateToString(true), '中文😀');
    assert.equal(f.t.buffer.active.getLine(0).getCell(0).getFgColor(), 1);
    await f.write('\x1b[6n\x1b[c', 'live');
    assert.equal(f.sink.length, 2);
  } finally { f.close(); }
});
test('async parser continuation retains origin but pending input/paste/IME/binary is not gated', async () => {
  const f = fixture();
  let resolveHandler;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.t.parser.registerCsiHandler({ final: 'z' }, () => { entered(); return new Promise(resolve => { resolveHandler = resolve; }); });
  try {
    const pending = f.write('\x1b[z\x1b[?1004h\x1b[6n');
    await started;
    f.t.input('key', true);
    f.t.paste('paste');
    f.t.input('中文😀', true);
    f.t._core.coreService.triggerBinaryEvent('mouse');
    assert.deepEqual(f.sink.map(x => x[1]), ['key', 'paste', '中文😀', 'mouse']);
    resolveHandler(false);
    await pending;
    assert.equal(f.sink.length, 4);
    await f.write('\x1b[6n', 'live');
    assert.equal(f.sink.length, 5);
  } finally { f.close(); }
});
test('FIFO origins, empty writes and nested enqueues use the actual parser execution', async () => {
  const f = fixture();
  let nested;
  f.t.parser.registerCsiHandler({ final: 'z' }, () => { nested = f.write('\x1b[6n', 'live'); return true; });
  try {
    await Promise.all([f.write(''), f.write('\x1b[z\x1b[6n'), f.write('\x1b[6n', 'live'), f.write('\x1b[?1004h')]);
    await nested;
    assert.equal(f.sink.length, 2);
  } finally { f.close(); }
});
test('history ANSI prefix cannot authorize live suffix; subsequent live query still answers', async () => {
  const f = fixture();
  try {
    await f.write('\x1b[?100');
    await f.write('4h\x1b[6n', 'live');
    assert.equal(f.sink.length, 1);
    f.sink.length = 0;
    await f.write('\x1bP$q');
    await f.write('m\x1b\\\x1b[6n', 'live');
    assert.equal(f.sink.length, 1);
  } finally { f.close(); }
});
test('cold snapshot resets only input-reporting modes, same-process history keeps modes', async () => {
  for (const cold of [true, false]) {
    const f = fixture();
    try {
      await f.write('\x1b[?1004h\x1b[?1003h\x1b[?1006h\x1b[31mred' + (cold ? adapter.coldSnapshotInputModeReset : ''));
      assert.deepEqual(f.sink, []);
      assert.equal(f.t._core.coreService.decPrivateModes.sendFocus, !cold);
      assert.equal(f.t._core.mouseStateService.activeProtocol, cold ? 'NONE' : 'ANY');
      assert.equal(f.t._core.mouseStateService.activeEncoding, cold ? 'DEFAULT' : 'SGR');
      assert.equal(f.t.buffer.active.getLine(0).getCell(0).getFgColor(), 1);
    } finally { f.close(); }
  }
});
test('direct ConPTY responder uses same parse-origin predicate, outside input remains allowed', async () => {
  const f = fixture();
  f.t.parser.registerCsiHandler({ final: 'c' }, () => {
    if (adapter.canEmitTerminalProtocol(f.t)) f.sink.push(['direct', 'DA1']);
    return true;
  });
  try {
    await f.write('\x1b[c');
    assert.deepEqual(f.sink, []);
    await f.write('\x1b[c', 'live');
    assert.deepEqual(f.sink, [['direct', 'DA1']]);
    assert.equal(adapter.canEmitTerminalProtocol(f.t), true);
  } finally { f.close(); }
});
test('incompatible pinned adapter shape fails explicitly', () => {
  assert.throws(() => adapter.installTerminalHistoricalParser({}), /xterm.*6\.1\.0-beta\.288/i);
});

test('every split through actual OSC/tmux carry preserves history without blocking following live queries', async () => {
  for (const seq of ['\x1b[?1004h', '\x1b[6n', '\x1bP$qm\x1b\\', '\x1b]12;?\x07', '\x1bPtmux;\x1b\x1b[?1004h\x1b\\']) {
    for (let split = 1; split < seq.length; split++) {
      const f = fixture();
      const osc = useTerminalOsc({sessionId: 'split', osPlatformRef: {current: 'windows'}});
      const normalize = (data, origin) => osc.normalizeTerminalOutput(data, {applyOsc52: origin === 'live'});
      try {
        await f.write(seq.slice(0, split), 'history', normalize);
        await f.write(seq.slice(split) + '\x1b[6n', 'live', normalize);
        assert.equal(f.sink.length, 1, `split ${split} in ${JSON.stringify(seq)}`);
      } finally { f.close(); }
    }
  }
});
test('OSC setter+query, actual title setter and byte-stream decoded Unicode retain semantics', async () => {
  const f = fixture();
  let title;
  f.t.onTitleChange(value => {title = value;});
  try {
    await f.write('\x1b]2;历史标题\x07\x1b]4;1;#ff0000;2;?\x07\x1b[31m');
    const decoder = new TextDecoder();
    for (const byte of new TextEncoder().encode('中文😀')) await f.write(decoder.decode(Uint8Array.of(byte), {stream: true}));
    assert.equal(title, '历史标题');
    assert.equal(f.t.buffer.active.getLine(0).translateToString(true), '中文😀');
    assert.deepEqual(f.sink, []);
  } finally { f.close(); }
});
test('new process startup replay answers once, duplicates remain historical, cold remount reset is once', async () => {
  const f = fixture();
  const id = 'created';
  policy.createTerminalQuerySession(id);
  try {
    const deliver = async (sequence, replay) => {
      await f.write('\x1b[c', policy.canAnswerTerminalQueryFrame(id, sequence, replay) ? 'live' : 'history');
      policy.claimTerminalQueryFrame(id, sequence, replay);
    };
    assert.equal(policy.shouldResetTerminalSnapshotInputModes(id), true);
    policy.markTerminalColdSnapshotRestored(id);
    assert.equal(policy.shouldResetTerminalSnapshotInputModes(id), false);
    await deliver(1, true);
    await deliver(1, true);
    await deliver(2, false);
    assert.equal(f.sink.length, 2);
  } finally { policy.forgetTerminalQuerySession(id); f.close(); }
});
test('real addon Kitty async protocol callback is origin-owned, user data pending is preserved', async () => {
  const {ImageAddon} = require('@xterm/addon-image');
  const f = fixture();
  const addon = new ImageAddon();
  f.t.loadAddon(addon);
  imageOrigin.installTerminalImageProtocolOrigin(f.t, addon);
  const kitty = addon._handlers.get('kitty');
  // Deterministic bitmap completion seam: parser/end/placement/reply are real.
  const lookup = kitty._kittyStorage.getImage;
  const display = kitty._displayImage;
  kitty._kittyStorage.getImage = () => ({});
  let ready, resolveImage;
  const started = new Promise(resolve => {ready = resolve;});
  kitty._displayImage = () => {ready(); return new Promise(resolve => {resolveImage = resolve;});};
  try {
    const pending = f.write('\x1b_Ga=p,i=7;\x1b\\');
    await started;
    f.t.input('typing', true);
    f.t.paste('paste');
    resolveImage(true);
    await pending;
    assert.deepEqual(f.sink.map(x => x[1]), ['typing', 'paste']);
    kitty._displayImage = () => Promise.resolve(true);
    await f.write('\x1b_Ga=p,i=7;\x1b\\', 'live');
    assert.ok(f.sink.at(-1)[1].includes('OK'));
  } finally {kitty._kittyStorage.getImage = lookup; kitty._displayImage = display; f.close();}
});

test('baseline enumerated DSR query policy still leaks real focus DECSET (root counterexample)', async () => {
  const t = new Terminal({allowProposedApi: true});
  const sink = [];
  t.onData(data => sink.push(data));
  const policyOwner = policy.installTerminalQueryPolicy(t, () => false);
  try {
    await new Promise(resolve => t.write('[6n[?1004h', resolve));
    assert.deepEqual(sink, ['[O']);
  } finally {policyOwner.dispose(); t.dispose();}
});
test('same-process reconstructed focus mode emits later real blur; cold snapshot does not', async () => {
  for (const cold of [true, false]) {
    const f = fixture();
    f.t._core.element = {classList: {add(){}, remove(){}, contains(){return false;}}};
    try {
      await f.write('[?1004h' + (cold ? adapter.coldSnapshotInputModeReset : ''));
      f.t._core._handleTextAreaBlur();
      assert.deepEqual(f.sink.map(x => x[1]), cold ? [] : ['[O']);
    } finally {f.close();}
  }
});
test('historical parser binary producer suppressed while real outside binary input remains', async () => {
  const f = fixture();
  f.t.parser.registerCsiHandler({final: 'z'}, () => {f.t._core.coreService.triggerBinaryEvent('protocol'); return true;});
  try {
    await f.write('[z');
    assert.deepEqual(f.sink, []);
    f.t._core.coreService.triggerBinaryEvent('input');
    await f.write('[z', 'live');
    assert.deepEqual(f.sink.map(x => x[1]), ['input', 'protocol']);
  } finally {f.close();}
});
test('immediate WriteBuffer parsing plus nested multipart enqueue does not desynchronize origins', async () => {
  const f = fixture();
  let nested;
  f.t.parser.registerCsiHandler({final: 'z'}, () => {nested = f.write('\x1b[6n', 'history'); return true;});
  try {
    await f.write('\x1b[');
    f.t.input('user', true); // WriteBuffer's next write can parse synchronously.
    await f.write('z\x1b[6n', 'live');
    await nested;
    assert.equal(f.sink.length, 2); // genuine input + only the live DSR
  } finally {f.close();}
});
test('terminal-owner disposal cancels pending callbacks/protocol without a replacement gate', async () => {
  const f = fixture();
  let resolveHandler, entered;
  const started = new Promise(resolve => {entered = resolve;});
  f.t.parser.registerCsiHandler({final: 'z'}, () => {entered(); return new Promise(resolve => {resolveHandler = resolve;});});
  const pending = f.write('\x1b[z\x1b[6n');
  let committed = false;
  pending.then(() => {committed = true;});
  await started;
  f.close();
  resolveHandler(false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(f.sink, []);
  assert.equal(committed, false);
  const replacement = fixture();
  try {await replacement.write('\x1b[6n', 'live'); assert.equal(replacement.sink.length, 1);}
  finally {replacement.close();}
});

test('cancelled live-origin token cannot emit queries during actual async continuation', async () => {
  const f = fixture(); let resume; let current = true;
  f.t.parser.registerCsiHandler({final:'z'}, () => new Promise(resolve => {resume = resolve;}));
  const committed = new Promise(resolve => adapter.writeTerminalOutput(f.t, '\x1b[z\x1b[6n\x1b[?1004h', 'live', resolve, undefined, () => current));
  while (!resume) await new Promise(resolve => setTimeout(resolve, 0));
  current = false;
  f.t.input('user😀', true);
  resume(true); await committed;
  assert.deepEqual(f.sink, [['data', 'user😀']]);
  f.close();
});

test('normalizer and parser reset drop historical OSC carry without corrupting following Unicode', async () => {
  const f = fixture(); const osc = useTerminalOsc({sessionId:'reset-origin',osPlatformRef:{current:'windows'}});
  await f.write('\x1b]52;c;', 'history', osc.normalizeTerminalOutput);
  osc.resetTerminalOutput(); f.t.reset(); adapter.resetTerminalOutputOrigin(f.t);
  await f.write('中文😀\x1b[6n', 'live', osc.normalizeTerminalOutput);
  assert.equal(f.t.buffer.active.getLine(0).translateToString(true), '中文😀');
  assert.equal(f.sink.length,1);
  f.close();
});
