import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function load(path, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, console, URL, Intl, Date, setTimeout, clearTimeout, ...globals,
    require: name => name in mocks ? mocks[name] : require(name) });
  return exports;
}
const types = load('src/features/chat/lib/types.ts');
export const { ChatController } = load('src/features/chat/lib/chatController.ts', { './types': types });
export const interactions = load('src/features/chat/lib/interactions.ts');
export const tick = async () => { for (let n = 0; n < 80; n++) await Promise.resolve(); };
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export function fixture(count = 2) {
  const rows = new Map(), channels = new Map(), calls = [];
  let serial = 0, failUpdate = false, failFlush = false;
  const provider = { appType: 'claude', providerId: 'p', name: 'Mock', defaultModel: 'm', protocol: 'messages', available: true, reason: null };
  function add() {
    const id = `c${++serial}`;
    const c = { id, title: '', draft: '', appType: 'claude', providerId: 'p', model: 'm',
      createdAt: 1, updatedAt: 1, revision: 0, requestId: null, leaseUntil: null };
    rows.set(id, { conversation: c, messages: [] }); return structuredClone(rows.get(id));
  }
  for (let n = 0; n < count; n++) add();
  const api = {
    initialize: async () => { calls.push(['initialize']); return { conversations: [...rows.values()].map(d => structuredClone(d.conversation)), unsaved: [] }; },
    providers: async () => [provider],
    list: async (search, offset) => { calls.push(['list', search, offset]); return [...rows.values()].map(d => structuredClone(d.conversation)).filter(c => c.title.includes(search)).slice(offset, offset + 50); },
    get: async id => { calls.push(['get', id]); if (!rows.has(id)) throw 'chat_not_found'; return structuredClone(rows.get(id)); },
    create: async () => { calls.push(['create']); return add(); },
    update: async input => {
      calls.push(['update', structuredClone(input)]);
      if (failUpdate) throw 'chat_storage';
      const d = rows.get(input.conversationId);
      if (d.conversation.revision !== input.revision) throw 'chat_conflict';
      const { conversationId, revision, ...values } = input;
      Object.assign(d.conversation, values, { revision: revision + 1 }); return structuredClone(d);
    },
    delete: async (id, revision) => { calls.push(['delete', id, revision]); rows.delete(id); },
    generate: async (input, cb) => {
      calls.push(['generate', structuredClone(input)]);
      const d = rows.get(input.conversationId);
      if (d.conversation.revision !== input.revision) throw 'chat_conflict';
      let answer;
      if (input.retry) answer = d.messages.at(-1);
      else {
        d.messages.push({ id: `u${input.requestId}`, conversationId: input.conversationId, ordinal: d.messages.length,
          role: 'user', content: input.text, requestId: input.requestId, status: 'completed', createdAt: 1, updatedAt: 1 });
        answer = { id: `a${input.requestId}`, conversationId: input.conversationId, ordinal: d.messages.length,
          role: 'assistant', content: '', replyTo: d.messages.at(-1).id, createdAt: 1, updatedAt: 1 };
        d.messages.push(answer);
      }
      Object.assign(answer, { requestId: input.requestId, status: 'pending', content: '', errorCode: null,
        finishReason: null, appType: input.appType, providerId: input.providerId, model: input.model });
      Object.assign(d.conversation, { revision: input.revision + 1, draft: input.retry ? d.conversation.draft : '', requestId: input.requestId });
      channels.set(input.requestId, { cb, answer, d }); return structuredClone(answer);
    },
    cancel: async (id, requestId) => { calls.push(['cancel', id, requestId]); },
    flush: async drafts => {
      calls.push(['flush', drafts]); if (failFlush) throw 'chat_storage';
      // Mirror backend atomic draft CAS instead of acknowledging without persistence.
      for (const input of drafts) {
        if (failUpdate) throw 'chat_storage';
        if (rows.get(input.conversationId)?.conversation.revision !== input.revision) throw 'chat_conflict';
      }
      return drafts.map(input => {
        const c = rows.get(input.conversationId).conversation;
        Object.assign(c, { draft: input.draft, revision: input.revision + 1 });
        return structuredClone(c);
      });
    },
  };
  function emit(requestId, values = {}) {
    const { cb, answer, d } = channels.get(requestId);
    const event = { conversationId: d.conversation.id, messageId: answer.id, requestId, sequence: 1,
      content: 'partial', status: 'pending', errorCode: null, finishReason: null, saved: false, ...values };
    if (event.status !== 'pending' && event.saved) {
      Object.assign(answer, { content: event.content, status: event.status });
      Object.assign(d.conversation, { revision: d.conversation.revision + 1, requestId: null });
    }
    cb(event); return event;
  }
  let request = 0;
  const controller = new ChatController(api, () => `r${++request}`);
  return { api, rows, calls, channels, controller, emit, add,
    failUpdate: value => { failUpdate = value; }, failFlush: value => { failFlush = value; } };
}
export function elements(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}
export function hookHarness(controller) {
  const slots = [], effects = []; let index = 0;
  const react = {
    useSyncExternalStore: (_subscribe, get) => get(),
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = initial; return [slots[key], value => { slots[key] = value; }]; },
    useRef(initial) { const key = index++; return slots[key] ?? (slots[key] = { current: initial }); },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) {
      const key = index++, old = slots[key];
      if (!old || deps.some((d, n) => d !== old.deps[n])) effects.push(() => { old?.cleanup?.(); slots[key] = { deps, cleanup: fn() }; });
    },
  };
  const en = load('src/shared/i18n/messages/chat.en-US.ts').en;
  const mocks = {
    react,
    '@tauri-apps/api/core': { invoke: async () => [] },
    '@tauri-apps/plugin-opener': { openUrl: async url => { harness.opened.push(url); } },
    '@tauri-apps/plugin-clipboard-manager': { writeText: async text => { if (harness.copyFails) throw Error(); harness.copies.push(text); } },
    '../../../shared/ui/MarkdownContent': { MarkdownContent: function Markdown() {} },
    '../../../shared/i18n/index': { useI18n: () => ({ t: key => key.startsWith('chat.error.') ? en[key] ?? key : key, language: 'en-US' }) },
    './lifecycle': { chatController: controller }, '../lib/interactions': interactions,
  };
  const { ChatWorkspace } = load('src/features/chat/api/ChatWorkspace.tsx', mocks, { window: { addEventListener() {}, removeEventListener() {} } });
  const harness = { opened: [], copies: [], copyFails: false,
    render(visible = true) { index = 0; const tree = ChatWorkspace({ workspaceVisible: visible, controller }); while (effects.length) effects.shift()(); return tree; },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
  return harness;
}
