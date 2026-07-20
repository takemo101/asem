# Session-row horizontal scroll design

## Goal

Allow an operator to read the complete text of each Session row in the Cockpit's left `Sessions` panel by horizontal scrolling, without widening the panel or truncating the row label.

## Scope

- Apply only to Session rows.
- Keep workspace/worktree group headings at their current truncation behavior.
- Preserve the existing fixed/proportional left-panel width and vertical row scrolling.

## Design

`SessionRowsScrollBox` will enable horizontal scrolling. Session-row text will no longer set OpenTUI's `truncate` property, so its intrinsic content width remains available to the scroll viewport. Group headings retain their current `truncate` setting.

The row container remains one terminal row high with wrapping disabled. Thus long labels do not alter vertical layout, and the operator can scroll sideways to inspect the full Session name, badges, and location badge.

## Testing

Add a component-projection test that distinguishes the two row kinds:

- a Session row renders without truncation;
- a group heading remains truncated;
- the Session-list scrollbox enables horizontal scrolling.

Run the focused TUI test suite, then the repository's typecheck, test, and check commands.
