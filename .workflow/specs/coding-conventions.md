---
title: "Coding Conventions"
readMode: required
priority: high
category: coding
keywords:
  - style
  - naming
  - import
  - pattern
  - convention
  - formatting
---

# Coding Conventions

## Formatting

## Naming

## Imports

## Patterns

## Entries



<spec-entry category="coding" keywords="临时版,开发版,开发模式,tauri dev,构建,打包" date="2026-10-06" sid="S-20261006-axbt" title="临时版与开发版默认使用 Tauri dev" sourceRef="wt/task-1006-1637@89640609" relatedPaths="package.json,scripts/tauri-cli.mjs">

### 临时版与开发版默认使用 Tauri dev

在当前项目中，用户提出“构建临时版”“构建开发版”或“开发模式运行”时，默认直接执行 npm run tauri -- dev，启动 Tauri 开发模式，复用增量编译与前端热更新。不要将其解释为 tauri build --debug，也不要打包临时 EXE 或安装包。只有用户明确要求可分发的可执行文件或安装包时，才执行对应构建与打包流程。

</spec-entry>