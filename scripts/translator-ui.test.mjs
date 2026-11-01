import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const jsx = (type, props) => ({type,...props});
function nodes(tree) {
  const result=[];
  const walk = n => { if(Array.isArray(n)) n.forEach(walk); else if(n && typeof n==='object') {result.push(n);walk(n.children);} };
  walk(tree); return result;
}
function harness(file, dependencies, runEffects=true) {
  const slots=[], effects=[]; let index=0;
  const react={
    useState(initial) { const i=index++; if(!(i in slots)) slots[i]=typeof initial==='function'?initial():initial;
      return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}]; },
    useRef(initial) {const i=index++; return slots[i] ??= {current:initial};},
    useMemo(fn,deps) {const i=index++; if(!slots[i] || deps.some((x,j)=>x!==slots[i].deps[j])) slots[i]={deps,value:fn()};return slots[i].value;},
    useCallback(fn,deps) {return react.useMemo(()=>fn,deps);},
    useEffect(fn,deps) {const i=index++;const old=slots[i];
      if(runEffects && (!old || deps.some((x,j)=>x!==old.deps[j]))) effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'), {compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,
  }}).outputText, {exports,Date,setTimeout,clearTimeout,performance,
    window:{addEventListener(){},removeEventListener(){},setInterval,clearInterval},
    require(id) {
      if(id==='react') return react;
      if(id==='react/jsx-runtime') return {jsx,jsxs:jsx};
      if(id==='@mantine/core') return Object.fromEntries(['Button','Card','Group','Stack','Switch','Text','TextInput','Title'].map(x=>[x,x]));
      if(id.includes('i18n')) return {useI18n:()=>({t:key=>key,language:'en-US'})};
      if(id in dependencies) return dependencies[id];
      throw Error(`Unmocked dependency ${id}`);
    }});
  const component=Object.values(exports)[0];
  return {render(props={}) {index=0;const tree=component(props);while(effects.length)effects.shift()();return tree;},
    unmount(){for(const slot of slots)slot?.cleanup?.();},slots};
}
function screenshotHarness(invoke=async()=>{}) {
  return harness('src/features/translator/components/ScreenshotResultCard.tsx',{
    '@tauri-apps/api/core':{invoke},'@tauri-apps/api/window':{getCurrentWindow:()=>({startDragging:async()=>{}})},
    '../../../shared/platform/systemClipboard':{copyTextToClipboard:async()=>{}},
    '../lib/resultWindow':{translatedClipboardText:r=>r.translated},
    '../lib/errors':{translatorErrorMessage:()=>({key:'translator.error.auth'})},
    '../api/translatorStore':{useTranslatorStore:{getState:()=>({loadModels:async()=>{},models:[],targetLang:'auto'})}},
    '../lib/models':{resolveTranslatorModel:()=>null},
    '../../../shared/preferences/settingsStore':{useSettingsStore:{getState:()=>({load:async()=>{}})}},
  },false);
}
test('actual screenshot success has no history controls or warning and never navigates automatically',()=>{
  const calls=[];const h=screenshotHarness(async(...args)=>calls.push(args));
  const tree=h.render({generation:1,result:{translated:'successful',original:null,imageBase64:'',elapsedMs:1}});
  assert.ok(JSON.stringify(tree).includes('successful'));
  assert.ok(!JSON.stringify(tree).includes('translator.history'));
  assert.equal(nodes(tree).filter(n=>n.children==='translator.retry').length,0);
  assert.equal(calls.length,0);
});
test('actual screenshot retry request failure is localized, recoverable and duplicate guarded',async()=>{
  const request=deferred();let calls=0;
  const h=screenshotHarness(async()=>{calls++;return request.promise;});
  const props={generation:7,result:null,card:{phase:'error',errorCode:'translator_auth',imageBase64:'',startedAt:0,elapsedMs:1}};
  let tree=h.render(props);const retry=nodes(tree).find(n=>n.type==='button' && n.children==='translator.retry');
  retry.onClick();retry.onClick();await flush();assert.equal(calls,1);
  assert.equal(nodes(h.render(props)).find(n=>n.children==='translator.retry').disabled,true);
  request.reject(Error('sensitive request'));await flush();tree=h.render(props);
  assert.ok(JSON.stringify(tree).includes('translator.screenshot.retryFailed'));assert.ok(!JSON.stringify(tree).includes('sensitive request'));
  assert.equal(nodes(tree).find(n=>n.children==='translator.retry').disabled,false);
});

test('actual text panel preserves success and explicit retry without history or automatic navigation',async()=>{
  const calls=[];let translated=0;
  const state={input:'source',result:'translated',resultInput:'source',
    loading:false,error:'',errorKey:'',targetLang:'auto',resolvedTargetLang:'en',models:[],modelsLoaded:true,
    selectedModelKey:'',copied:false,setInput(){},setTargetLang(){},setModel(){},setCopied(){},closeTranslator(){},
    loadModels:async()=>{},resolveTarget:async()=>{},translate:async()=>{translated++;}};
  const h=harness('src/features/translator/components/TranslatorPanel.tsx',{
    '@tauri-apps/api/core':{invoke:async(...args)=>calls.push(args)},
    '@tauri-apps/api/window':{getCurrentWindow:()=>({startDragging:async()=>{}})},
    'lucide-react':{Loader2:'Loader2',Settings2:'Settings2'},
    '../../../shared/platform/systemClipboard':{copyTextToClipboard:async()=>{}},
    '../lib/languages':{TRANSLATOR_TARGET_LANGUAGES:['en'],translatorLanguageLabelKey:()=> 'translator.lang.en'},
    '../lib/models':{resolveTranslatorModel:()=>null,translatorModelKey:()=>'',translatorModelLabel:()=>''},
    '../api/translatorStore':{useTranslatorStore:selector=>selector(state)},
    './TranslatorSelect':{TranslatorSelect:'TranslatorSelect'},
  },false);
  let tree=h.render();assert.ok(!JSON.stringify(tree).includes('translator.history'));
  assert.ok(nodes(tree).some(n=>n.type==='p' && n.children==='translated'));
  assert.equal(calls.length,0);assert.equal(translated,0);
  state.result='';state.errorKey='translator.error.auth';
  tree=h.render();assert.ok(JSON.stringify(tree).includes('translator.error.auth'));
  nodes(tree).find(n=>n.type==='button' && n.children==='translator.retry').onClick();await flush();assert.equal(translated,1);
  state.loading=true;assert.equal(nodes(h.render()).find(n=>n.type==='button' && n.children==='translator.retry').disabled,true);
});

test('settings and both locales expose no canceled history feature; error settings route survives',()=>{
  for(const locale of ['zh-CN','en-US']) {
    assert.doesNotMatch(readFileSync(`src/shared/i18n/messages/translator.${locale}.ts`,'utf8'),/translator.history/);
  }
  const native=readFileSync('src-tauri/src/features/translator/window.rs','utf8');
  const body=native.slice(native.indexOf('pub async fn translator_open_settings'));
  assert.match(body,/main.emit\("translator:open-settings"/);
  assert.match(readFileSync('src/app/App.tsx','utf8'),/listen\("translator:open-settings", \(\) => \{\s*handleOpenSettings\("translator"\)/);
  assert.doesNotMatch(readFileSync('src/features/settings/components/pages/TranslatorSettingsPage.tsx','utf8'),/TranslatorHistory/);
});
