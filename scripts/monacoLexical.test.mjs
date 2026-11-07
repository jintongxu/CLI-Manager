import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import { TokenTheme } from 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js';
import { compile } from 'monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js';
import { MonarchTokenizer } from 'monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js';

function load(path, dependencies = {}) {
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText()).join('\n');
  const exports = {};
  runInThisContext(`(function(exports, ${Object.keys(dependencies).join(",")}) {` + ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText + "})")(exports, ...Object.values(dependencies));
  return exports;
}
const { enhanceMonacoGrammar, lexicalThemeRules } = load('src/shared/platform/monacoLexical.ts');
const { languageFromPath } = load('src/shared/platform/monacoSetup.ts');
const baselines = {};
for (const id of ['java', 'python', 'dockerfile', 'shell']) {
  // Evaluate the actual installed grammar object. Python's configuration imports
  // editor UI/CSS, which Node cannot load; no hand-written tokenizer stand-in.
  const text = readFileSync(`node_modules/monaco-editor/esm/vs/basic-languages/${id}/${id}.js`, 'utf8');
  baselines[id] = runInThisContext('(function(){' + text.slice(text.indexOf('const language ='), text.indexOf('export {')) + 'return language;})()');
}
function tokenize(id, lines, enhanced = true) {
  const grammar = enhanced ? enhanceMonacoGrammar(id, baselines[id]) : { ...baselines[id] };
  const tokenizer = new MonarchTokenizer({ getLanguageIdCodec: () => ({ encodeLanguageId: () => 1 }), isRegisteredLanguageId: () => true },
    { getColorTheme: () => ({ tokenTheme: { match: () => 0 } }) }, id, compile(id, grammar),
    { getValue: () => 20000, onDidChangeConfiguration: () => ({ dispose() {} }) });
  let state = tokenizer.getInitialState();
  const tokens = lines.map(line => {
    const result = tokenizer.tokenize(line, true, state); state = result.endState;
    return result.tokens.map((token, i) => ({ text: line.slice(token.offset, result.tokens[i + 1]?.offset ?? line.length), type: token.type }));
  });
  tokenizer.dispose();
  return tokens;
}
function scope(tokens, text) {
  let offset = 0;
  const index = tokens.map(token => token.text).join('').indexOf(text);
  assert.ok(index >= 0, `missing text ${text}`);
  return tokens.find(token => { const start = offset; offset += token.text.length; return start <= index && index < offset; })?.type;
}

test('path variants, known extensions take precedence, bounded shebang fallback', () => {
  for (const path of ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod', 'x.DOCKERFILE', '.dockerfile', String.raw`C:\src\DOCKERFILE.test`]) assert.equal(languageFromPath(path), 'dockerfile');
  for (const [path, content, expected] of [['x.java', '#!/bin/sh', 'java'], ['x.py', '', 'python'], ['x.sh', '', 'shell'], ['script', '#!/bin/sh', 'shell'], ['script.unknown', '#!/usr/bin/env -S bash -e\r\necho ok', 'shell'], ['script', '#!/usr/bin/python3', 'python'], ['script', '#!/usr/bin/env python3', 'python'], ['x.json', '#!/bin/sh', 'json'], ['x', 'echo hi', 'plaintext'], ['x', '#!/bin/shadow', 'plaintext']]) assert.equal(languageFromPath(path, content), expected);
  assert.match(readFileSync('src/features/files/hooks/useFileEditorController.ts', 'utf8'), /languageFromPath\(visibleFile.path, visibleFile.content\)/);
});

test('Java declarations, annotations and lexical calls, not every identifier', () => {
  const [line] = tokenize('java', ['@Override class Hello { String greet(String name) { return name.trim(); } }']);
  assert.equal(scope(line, 'Hello'), 'type.declaration.java');
  assert.equal(scope(line, '@Override'), 'annotation.java');
  assert.equal(scope(line, 'greet'), 'function.java');
  assert.equal(scope(line, 'trim'), 'function.java');
  assert.equal(scope(line, 'name'), 'identifier.java');
  assert.match(scope(line, 'return'), /^keyword/);
});

test('Python class/function/decorator and calls preserve plain identifiers', () => {
  const lines = tokenize('python', ['@pkg.decorator(value)', 'class Hello:', '  def greet(self, name):', '    return name.upper() # class Fake:']);
  assert.equal(scope(lines[0], '@pkg.decorator'), 'annotation.python');
  assert.equal(scope(lines[1], 'Hello'), 'type.declaration.python');
  assert.equal(scope(lines[2], 'greet'), 'function.declaration.python');
  assert.equal(scope(lines[2], 'name'), 'identifier.python');
  assert.equal(scope(lines[3], 'upper'), 'function.python');
  assert.equal(scope(lines[3], 'Fake'), 'comment.python');
});

test('Docker case-insensitive directives, images/stages/env and strings', () => {
  for (const directive of ['FROM', 'from', 'FrOm']) {
    const [line] = tokenize('dockerfile', [`${directive} node:22 AS build`]);
    assert.equal(scope(line, directive), 'keyword.dockerfile');
    assert.equal(scope(line, 'node:22'), 'type.image.dockerfile');
    assert.equal(scope(line, 'build'), 'type.stage.dockerfile');
  }
  const consecutive = tokenize('dockerfile', ['FROM alpine', 'RUN echo ok', 'ARG VERSION', 'COPY --link', 'RUN true']);
  assert.equal(scope(consecutive[1], 'RUN'), 'keyword.dockerfile');
  assert.equal(scope(consecutive[4], 'RUN'), 'keyword.dockerfile');
  const lines = tokenize('dockerfile', ['env APP=prod OTHER=value', 'run echo "FROM fake AS wrong"', '# FROM fake', 'COPY --from=build /app /app']);
  assert.equal(scope(lines[0], 'APP'), 'variable.dockerfile');
  assert.equal(scope(lines[0], 'OTHER'), 'variable.dockerfile');
  assert.match(scope(lines[1], 'fake'), /^string/);
  assert.match(scope(lines[2], 'fake'), /^comment/);
  assert.equal(scope(lines[3], '--from'), 'attribute.name.dockerfile');
});

test('shell functions/commands are contextual, flags/variables and heredoc bodies', () => {
  const lines = tokenize('shell', ['greet() { echo "hello"; }', 'custom_command --flag value', 'VALUE=plain', 'echo $VALUE ${HOME}', 'cat <<\'EOF\'', 'class Fake --flag $VALUE', 'EOF', 'next_command value', 'cat <<-END', '\tfunction fake() {}', '\tEND', 'after_command']);
  assert.equal(scope(lines[0], 'greet'), 'function.declaration.shell');
  assert.equal(scope(lines[1], 'custom_command'), 'function.command.shell');
  assert.equal(scope(lines[1], '--flag'), 'attribute.name.shell');
  assert.equal(scope(lines[1], 'value'), '');
  assert.equal(scope(lines[2], 'VALUE'), 'variable.shell');
  assert.equal(scope(lines[2], 'plain'), '');
  assert.equal(scope(lines[3], '$VALUE'), 'variable.shell');
  assert.equal(scope(lines[5], 'Fake'), 'string.heredoc.shell');
  assert.equal(scope(lines[7], 'next_command'), 'function.command.shell');
  assert.equal(scope(lines[9], 'fake'), 'string.heredoc.shell');
  assert.equal(scope(lines[11], 'after_command'), 'function.command.shell');
});

// Assert every character of an exact span, not just the scope at its first offset.
function assertSpan(tokens, text, expected) {
  const line = tokens.map(token => token.text).join('');
  const start = line.indexOf(text);
  assert.ok(start >= 0, `missing span ${text}`);
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    if (offset < start + text.length && end > start) {
      assert.equal(token.type, expected, `${text}: ${JSON.stringify(token)}`);
    }
    offset = end;
  }
}

test('shell comments require a physical line start or consumed whitespace', () => {
  const lines = tokenize('shell', [
    'echo value#suffix', 'echo value#suffix # real comment', '# full comment',
    '  # indented comment', 'echo "value#suffix"', "echo 'value#suffix'", '#!/bin/sh',
  ]);
  assertSpan(lines[0], 'value#suffix', '');
  assertSpan(lines[1], 'value#suffix', '');
  assertSpan(lines[1], '# real comment', 'comment.shell');
  assertSpan(lines[2], '# full comment', 'comment.shell');
  assertSpan(lines[3], '# indented comment', 'comment.shell');
  assertSpan(lines[4], '"value#suffix"', 'string.shell');
  assertSpan(lines[5], "'value#suffix'", 'string.shell');
  assertSpan(lines[6], '#!/bin/sh', 'metatag.shell');
});

test('simple heredoc starts on the next physical line, not the delimiter tail', () => {
  for (const [intro, terminator] of [
    ['cat <<EOF; next_command --flag', 'EOF'],
    ["cat <<'EOF'; next_command --flag", 'EOF'],
    ['cat <<"EOF"; next_command --flag', 'EOF'],
    ['cat <<-EOF; next_command --flag', '\tEOF'],
  ]) {
    const lines = tokenize('shell', [intro, 'body # opaque --flag', terminator, 'after_command']);
    assertSpan(lines[0], ';', 'delimiter.shell');
    assertSpan(lines[0], 'next_command', 'function.command.shell');
    assertSpan(lines[0], '--flag', 'attribute.name.shell');
    assertSpan(lines[1], 'body # opaque --flag', 'string.heredoc.shell');
    assertSpan(lines[2], terminator, 'string.heredoc.shell');
    assertSpan(lines[3], 'after_command', 'function.command.shell');
  }
  for (const quote of ['"', "'"]) {
    const lines = tokenize('shell', [
      `cat <<EOF; echo ${quote}literal # text${quote} # tail comment`, 'body', 'EOF', 'after_command',
    ]);
    assertSpan(lines[0], `${quote}literal # text${quote}`, 'string.shell');
    assertSpan(lines[0], '# tail comment', 'comment.shell');
    assertSpan(lines[1], 'body', 'string.heredoc.shell');
    assertSpan(lines[3], 'after_command', 'function.command.shell');
  }
});

test('Docker FROM platform quotes keep string scopes and resume image/stage contexts', () => {
  for (const platform of ['"linux/amd64"', "'linux/amd64'", 'linux/amd64']) {
    const lines = tokenize('dockerfile', [`FROM --platform=${platform} alpine AS build`, 'RUN echo "FROM fake"']);
    assertSpan(lines[0], '--platform=', 'attribute.name.dockerfile');
    assertSpan(lines[0], platform, platform[0] === 'l' ? 'attribute.name.dockerfile' : 'string.dockerfile');
    assertSpan(lines[0], 'alpine', 'type.image.dockerfile');
    assertSpan(lines[0], 'build', 'type.stage.dockerfile');
    assertSpan(lines[1], 'RUN', 'keyword.dockerfile');
    assertSpan(lines[1], '"FROM fake"', 'string.dockerfile');
  }
});

test('baseline multiline string/comment states remain opaque, original grammar unchanged', () => {
  for (const [id, lines] of [
    ['java', ['/* class Fake { call();', 'still(); */', 'String s = "class Fake call()";', '"""', 'class Fake { call(); }', '"""']],
    ['python', ['"""', 'class Fake: call()', '"""', 'text = "def fake():"']],
    ['shell', ['echo "hello', 'fake_command --flag', 'world"', '# custom_command --flag']],
    ['dockerfile', ['RUN echo "hello ' + String.fromCharCode(92), 'FROM fake AS nope"', '# FROM fake']],
  ]) {
    const before = JSON.stringify(baselines[id]);
    const enhanced = tokenize(id, lines);
    assert.equal(JSON.stringify(baselines[id]), before);
    const baseline = tokenize(id, lines, false);
    for (let n = 0; n < baseline.length; n++) {
      for (const token of baseline[n].filter(token => /^(string|comment)/.test(token.type))) {
        assert.match(scope(enhanced[n], token.text), /^(string|comment)/, `${id}: ${token.text}`);
      }
    }
  }
});

test('scoped dark/light colors with contrast and inherited custom background', () => {
  let theme;
  const { getFileEditorTheme } = load('src/features/files/lib/fileEditorTheme.ts', { lexicalThemeRules, monaco: { editor: { defineTheme: (_name, value) => { theme = value; } } } });
  const luminance = color => {
    const rgb = color.replace('#', '').match(/../g).map(part => parseInt(part, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const background of ['#1e1e1e', '#ffffff']) {
    getFileEditorTheme(background);
    assert.equal(theme.inherit, true);
    assert.equal(theme.colors['editor.background'], background);
    for (const rule of theme.rules) {
      assert.match(rule.token, /\.(java|python|dockerfile|shell)$/);
      const values = [luminance(background), luminance(rule.foreground)].sort((a,b) => a-b);
      assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, rule.token);
    }
  }
  assert.notEqual(lexicalThemeRules(true)[0].foreground, lexicalThemeRules(false)[0].foreground);
});

test('installed baseline reproduces the reported richer-token gaps', () => {
  assert.equal(scope(tokenize('java', ['class Hello { void greet() {} }'], false)[0], 'Hello'), 'identifier.java');
  assert.equal(scope(tokenize('python', ['def greet(name):'], false)[0], 'greet'), 'identifier.python');
  assert.equal(scope(tokenize('dockerfile', ['from alpine'], false)[0], 'from'), '');
  assert.equal(scope(tokenize('shell', ['custom_command value'], false)[0], 'custom_command'), '');
});

test('actual Monaco theme trie resolves the emitted scopes to the intended colors', () => {
  for (const dark of [true, false]) {
    const rules = lexicalThemeRules(dark);
    const theme = TokenTheme.createFromRawTokenTheme([{ token: '', foreground: '888888', background: dark ? '1E1E1E' : 'FFFFFF' }, ...rules], []);
    for (const rule of rules) {
      const color = theme.getColorMap()[((theme.match(1, rule.token) >>> 15) & 0x1ff)];
      assert.equal(color.toString().toUpperCase(), '#' + rule.foreground);
    }
  }
});
