# Terminal navigation polish

## Goal
Make terminal navigation readable, compact and unambiguous without changing navigation semantics. User approved implementation, task creation and TEMP records.

## Requirements and acceptance
- Active chip uses actual terminal foreground/background with subtle surface and thin accent; inactive chips readable; no generic selected teal fill.
- Visible 范围 / Range prefix; separate 查找终端 / Find terminal action; compact quick-access explanation available visibly and accessibly.
- Content-sized chips, hover/focus feedback, search reachable at narrow widths.
- Preserve lifecycle, scope, current-work membership, split and drag/drop behavior and all existing dirty changes.

## Scenarios
- Dark/light/custom terminal theme: current foreground remains legible, accent is an underline rather than a large fill.
- Short/long titles and 1–5 shortcuts: content-sized, ellipsis only when needed; full title tooltip.
- Narrow window in Chinese/English: search remains visible; overflow shortcuts remain searchable.
- Search activation and management retain their existing callbacks; no automatic membership changes.
- Keyboard users can identify range, shortcuts and search, with visible focus.

## Verification
Focused navigation model/UI and related regressions, TypeScript and strict architecture. Static theme assertions do not replace human theme/locale/narrow-window checks. No app launch, dependencies or commit.
