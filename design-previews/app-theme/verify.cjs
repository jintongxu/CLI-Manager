// Dependency-free render-matrix smoke test. Browser geometry remains a manual gate.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const app = { innerHTML: '' };
const announcement = { textContent: '' };
const handlers = {};
const context = vm.createContext({
  document: {
    activeElement: null,
    documentElement: { dataset: {}, lang: '' },
    getElementById: id => id === 'app' ? app : announcement,
    addEventListener: (name, fn) => { handlers[name] = fn; },
    querySelectorAll: () => []
  }
});
for (const file of ['views.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
}
let count = 0;
for (const theme of ['graphite', 'porcelain', 'midnight']) {
  for (const mode of ['dark', 'light']) {
    for (const lang of ['zh', 'en']) {
      for (const density of ['comfortable', 'compact']) {
        for (const page of ['workspace', 'editor', 'settings', 'stats']) {
          vm.runInContext(`Object.assign(state, ${JSON.stringify({theme,mode,lang,density,page})}); render();`, context);
          assert.match(app.innerHTML, /<main/);
          assert(!app.innerHTML.includes('undefined'));
          assert.equal(context.document.documentElement.dataset.theme, theme);
          count++;
        }
      }
    }
  }
}
const click = dataset => handlers.click({ target: { closest: () => ({ dataset }) } });
click({project:'2'});
assert.match(app.innerHTML, /API gateway/);
click({tab:'1'});
assert.match(app.innerHTML, /GPT-5 Codex/);
click({page:'editor'});
click({file:'navigation.test.ts'});
assert.match(app.innerHTML, /moves focus to the next file/);
click({action:'collapse'});
assert.match(app.innerHTML, /shell collapsed/);
click({page:'settings'});
click({toggle:'notify'});
assert.match(app.innerHTML, /aria-checked="true" data-toggle="notify"/);
handlers.change({target:{dataset:{setting:'lang'},value:'zh'}});
assert.equal(context.document.documentElement.lang, 'zh-CN');
vm.runInContext("state.sent = '<script>alert(1)</script>'; state.page = 'workspace'; render();", context);
assert.match(app.innerHTML, /&lt;script&gt;/);
assert(!app.innerHTML.includes('<script>alert'));
console.log(`PASS: ${count} theme/mode/language/density/scene renders, interactions and escaped mock input.`);
