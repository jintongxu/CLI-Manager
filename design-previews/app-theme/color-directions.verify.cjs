'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const files = ['color-directions.html', 'color-directions.css', 'color-directions.js', 'color-directions.verify.cjs'];
for (const file of files) {
  const lines = read(file).split('\n');
  assert(lines.length < 2000, `${file}: line count`);
  assert(lines.every(line => line.length <= 500), `${file}: long line`);
}
const html = read(files[0]);
const css = read(files[1]);
const js = read(files[2]);
assert.match(html, /data-theme="sea" data-terminal="light"/);
for (const theme of ['sea', 'iris', 'peach']) assert(html.includes(`data-theme-choice="${theme}"`));
for (const id of ['terminal-mode', 'language', 'collapse-sidebar', 'restore-sidebar', 'settings-popover', 'settings-form']) {
  assert(html.includes(`id="${id}"`), `Missing #${id}`);
}
assert.match(html, /role="tablist"/);
assert.match(html, /role="dialog"/);
assert.match(html, /aria-live="polite"/);
assert(!/(?:https?:)?\/\/[^<\s]+/.test(html), 'No remote dependencies');
assert(!/\b(fetch|WebSocket|localStorage|sessionStorage|XMLHttpRequest)\b/.test(js), 'No config/network side effects');
new vm.Script(js);
function luminance(hex) {
  const [r, g, b] = hex.match(/\w\w/g).map(value => {
    const c = parseInt(value, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
const blocks = [...css.matchAll(/^(?:body\s*\{|body\[data-theme="(?:iris|peach)"\]\s*\{)([\s\S]*?)\}/gm)];
assert.equal(blocks.length, 3);
for (const [index, block] of blocks.entries()) {
  const tokens = Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map(m => [m[1], m[2]]));
  for (const foreground of ['terminal-text', 'ansi-path', 'ansi-branch', 'ansi-ok', 'ansi-command', 'ansi-option', 'muted']) {
    assert(contrast(tokens[foreground], tokens.terminal) >= 4.5, `Direction ${index}: ${foreground}`);
  }
  assert(contrast(tokens.text, tokens.surface) >= 4.5);
  assert(contrast('#ffffff', tokens.accent) >= 4.5);
  const channels = tokens.page.match(/\w\w/g).map(c => parseInt(c, 16));
  assert(Math.max(...channels) - Math.min(...channels) >= 25, 'Chromatic, not neutral, page surface');
  assert(luminance(tokens.terminal) > 0.8, 'Light default terminal');
}
console.log('PASS: file limits, isolated mock, layout controls, JS syntax, 3 chromatic light palettes and AA text/ANSI/accent contrast');
