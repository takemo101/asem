# Session-row truncation design

## Goal

Keep the Cockpit's left `Sessions` panel vertically scrollable while preventing horizontal scrolling. Long Session labels are ellipsized to the panel width so the visible tree indentation continues to show the parent-child relationship.

## Scope

- Disable horizontal scrolling for the entire Session-list viewport.
- Truncate both Session rows and workspace/worktree group headings.
- Preserve one-row height, `wrapMode="none"`, the fixed/proportional panel width, row background fill, and vertical selection scrolling.

## Design

`SessionRowsScrollBox` uses only vertical scrolling and keeps its content constrained to the viewport width. Every row box and text element uses `width="100%"`; every row text element sets `truncate={true}`. OpenTUI's `TextRenderable` still handles left/right gestures even for truncated text, so each row places a transparent mouse-event overlay above its text and stops those gestures before they reach the text renderable. This keeps a long label from increasing the scroll content width, so neither the tree indent nor the group header moves horizontally.

The horizontal-scroll-specific `innerWidth` contract and panel-chrome width calculation are removed because no row needs a distinct numeric width.

## Testing

Replace rendered horizontal-overflow tests with a focused regression test that renders a long Session row and asserts:

- `scrollX` is false;
- `scrollWidth` equals the viewport width;
- the captured frame contains an ellipsis;
- the row remains one line, clipped, and full panel width.

Retain the existing vertical-selection behavior tests. Run the focused TUI test, typecheck, full test suite, and repository check.
