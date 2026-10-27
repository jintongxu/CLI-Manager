# Design

- A single navigation collection is produced by `terminalNavigationModel`; the global row renders that collection directly and the drawer consumes the same `projectGroups`/`totalCount`.
- The top chrome is a real horizontal tab row plus one drawer anchor. The drawer uses a Radix Popover portal and a separate hover-intent hook: 350ms open, 300ms leave close, click pins, Escape closes and restores focus.
- Current-work membership remains mode-specific. Ordinary view can explicitly add non-members but does not expose removal/multi-select membership mutation. Current-work view exposes member removal and anonymous-Pi remove-and-close semantics.
- DnD IDs are namespaced: global current-work row uses `current-work-tab:`, legacy/current-work ordering uses `current-work-order:`, and pane targets retain existing IDs. The parser accepts all current-work prefixes.
- Existing terminal body mounting, pane menus, close confirmation and dirty-file protection stay owned by the controller and pane adapter.
