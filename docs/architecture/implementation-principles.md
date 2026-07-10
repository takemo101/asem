# asem 実装原則

> Related design principles: [`design-principles.md`](./design-principles.md)

## 1. Parse, Don’t Merely Check

External input は validation だけで終わらせず、typed value に parse する。

対象:

- CLI args
- MCP inputs
- `.asem.yaml`
- DB rows
- template definitions
- sequence capture outputs

Pattern:

```ts
const parsed = Schema.safeParse(input);
if (!parsed.success) {
  return invalidInput(parsed.error);
}
return useTypedValue(parsed.data);
```

後続 layer は parsed value を前提にする。

## 2. Keep Core Pure Where Possible

`@asem/core` は domain logic と pure helpers を中心にする。

Core に置くもの:

- schemas
- domain types
- scope helper contracts
- pure shell escaping helper
- token hash/verify helpers
- operation input/output contracts

Core に直接置かないもの:

- SQLite connection lifecycle
- real shell execution
- terminal UI
- MCP transport
- filesystem mutation with hidden global state

I/O が必要な operation は injected port を使うか、composition layer に分ける。

## 3. Operation Handlers Are the Semantic Boundary

CLI / MCP / TUI は `@asem/ops` の shared operation handlers を呼ぶ。

- `@asem/core` は operation input/output contracts と port interfaces を持つ。
- `@asem/ops` は injected deps を使って use-case semantics を実装する。
- CLI command handler は rendering と flag mapping に集中する。
- MCP tool handler は request/response mapping に集中する。
- TUI action は view-model state と operator interaction に集中する。

同じ behavior を surface ごとに再実装しない。

Operation deps の標準 checklist:

- `Store`
- `TemplateRegistry`
- `CommandRunner` / `TemplateRunner`
- `FileSystem`
- `ConfigLoader`
- `ScopeResolver`
- `CurrentSessionResolver`
- `LivenessProbe`
- `Clock`
- `IdGenerator`
- `TokenGenerator`
- `Logger` / `Redactor`

Operation tests はこれらを fake に差し替えて、real SQLite / shell / filesystem / clock に依存しない形を基本にする。

## 4. Test with Fake Runner First

Command sequence engine と template は fake runner で先にテストする。

Default tests should not require:

- herdr
- tmux
- rmux
- zellij
- real agent CLIs
- real MCP client
- real TUI session

Real integration tests は optional にする。binary がない場合は skip する。

Fake runner contract:

- 実行された command を順序付き trace として記録する。
- 各 step の `cwd` / `env` / timeout / background flag を assertion 可能にする。
- stdout / stderr / exit code を script できる。
- `wait_ms` と timeout は virtual time で進められる。
- regex / JSONPath capture の fixture を与えられる。
- background process handle を deterministic に返せる。
- 指定 step で failure / timeout / capture failure を注入できる。
- log / error output の redaction を検証できる。

Fake runner tests should cover at least:

- sequence order;
- cwd/env propagation;
- raw vs shell-escaped variable use;
- capture success/failure;
- timeout behavior;
- background handle behavior;
- operation-level cleanup after create failure.

## 5. Never Persist Failed Create Rows

`create_session` は DB row を最後に作る。

Expected order:

1. resolve config / scope / parent;
2. create Session dir;
3. write prompt;
4. run mux `create` sequence and capture mux refs;
5. generate launch script with env and agent command;
6. run mux `run_in_pane` sequence;
7. insert Session row only after successful start.

失敗時:

- structured error を返す;
- log path を返す;
- mux cleanup を best-effort で試みる;
- DB に failed Session row を残さない。

## 6. Persist Messages Before Notification

有効で認可された Message は、notification や mux template 解決より前に durable record として persist する。persist が成功すれば operation は成功であり、notification 失敗は operation-level failure にしない。

- notification success: set `delivered_at` (public state `delivered`)。Agent/model acceptance の証明ではない。
- notification 未試行 (`mux: none` target): public state `undelivered`。正常な pull-only fallback であり remediation hint は不要。
- notification 失敗 (malformed/missing target mux Template を含む): set `delivery_error` (public state `failed`)。Message 作成は失敗しない。
- no ack/read receipt fabrication.
- no durable unread state.

Notification failure は Message 作成の存在を否定しない。history として残す。target Session は cursor 付き `list_messages` / bounded Inbox wait の CLI/MCP pull で Message を取得する。詳細は [`asem-message-protocol-design.md`](../designs/asem-message-protocol-design.md) を参照。

## 7. Scope Every Store Query

Normal Session / Message queries must include scope.

Required default filters:

```text
workspace_id = current workspace
worktree_root = current worktree root
```

Exceptions:

- TUI `--scope workspace` may query by `workspace_id` only and group by `worktree_root`.
- explicit maintenance/debug tools may broaden scope if added later.

Scope bypass を helper に閉じ込め、callsite で ad-hoc に条件を外さない。

## 8. Protect Token Material

Token handling rules:

- generate high-entropy Session token;
- store only token hash in SQLite;
- put raw token only in env or mode-`0600` files;
- keep token-bearing current-session files under ignored paths (`.asem/current-session*.json` or `.asem/tokens/`);
- prefer splitting non-secret current-session metadata from raw token material;
- avoid token in command-line args;
- avoid token in pane title/label/log when possible;
- redact token values from structured errors and logs.

Tests should cover token hash/verify, file mode behavior, gitignore coverage for token-bearing files, and redaction.

## 9. Shell Escaping Is Centralized

Template interpolation is owned by `@asem/runtime` and must expose raw and escaped variants. The escaping primitive itself is owned by `@asem/core` so every runtime/template uses the same shell escaping behavior.

Examples:

```text
{{message}}
{{message_shell}}
{{cwd}}
{{cwd_shell}}
```

Command strings should use escaped variants. Do not let each template or operation invent its own escaping.

## 10. Use Atomic File Writes for Session Files

Session-local files should be written safely.

- write temp file in same directory;
- set mode where required before or immediately after write;
- rename atomically;
- avoid partial token-bearing files;
- log failures with paths but not token contents.

This borrows mikan's preference for ordinary local files while adapting it to asem's token-sensitive runtime files.

## 11. Structured Errors, Not String Matching

Operation errors should have stable codes and typed payloads.

Example shape:

```ts
type OperationError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
```

Surfaces can render these differently, but tests should assert codes and important details, not prose.

## 12. Keep Liveness Checks Lightweight

`list_sessions` / `get_session` may refresh liveness, but must not become expensive monitoring.

- Check only what is needed for selected or visible Sessions.
- Update `running` to `exited` or `missing` when evidence is clear.
- Do not infer task outcome from process state.
- Do not add background polling daemon in MVP.

## 13. Prefer Replaceable Modules

実装は「後で差し替えられる seam」を明確にして進める。

Replaceable seams:

- `Store` interface: SQLite 実装の外側で operation tests を書ける。
- `CommandRunner` / `TemplateRunner` interface: real shell と fake runner を差し替えられる。
- `FileSystem` interface: atomic writes、mode checks、cleanup を fake で検証できる。
- `ConfigLoader` / `ScopeResolver` / `CurrentSessionResolver`: project discovery と current Session 解決を fake にできる。
- `TemplateRegistry`: builtin template と project-local template を同じ解決経路に載せる。
- `LivenessProbe`: mux liveness checks を operation tests から切り離す。
- `Clock` / `IdGenerator` / `TokenGenerator`: time/id/token を deterministic tests にできる。
- `Logger` / `Redactor`: secret redaction をテストできる。
- `SurfaceRenderer`: operation result と human/MCP/TUI 表示を分ける。

Logger implementation is selected by the real surface composition root, not by
operation handlers. `Logger` remains the shared port, but CLI / MCP / TUI may
receive different implementations: CLI can emit diagnostics to stderr, MCP must
protect JSON-RPC stdout and defaults to silence, and TUI must not write operation
logs directly while the cockpit renderer owns the terminal. See
[`ADR 0006`](../adr/0006-surface-specific-logger-composition.md).

Rules:

- Interface は concrete need がある場所にだけ作る。
- 1 implementation しかない抽象を大量に先置きしない。
- ただし real I/O、randomness、time、shell execution、SQLite は seam にする。
- module 境界を越える値は parsed typed value にする。
- tests は可能な限り seam の内側で完結させる。

## 14. Prefer Small Vertical Slices

Implementation order should move in testable slices.

Good slices:

- config parse + scope resolve;
- store migrations + CRUD;
- fake sequence runner;
- one mux template under fake runner;
- one agent prompt delivery mode;
- CLI list/get;
- message send with fake delivery;
- MCP projection of existing operation;
- TUI view-model before full UI polish.

Avoid implementing all muxes, all agents, and all surfaces before tests prove the core flow.

## 15. Documentation Updates Are Part of Implementation

When implementation changes a documented boundary, update docs in the same change.

- Domain vocabulary changes: update `CONTEXT.md`.
- Package boundary changes: update `docs/architecture/overview.md`.
- Design principle changes: update `docs/architecture/design-principles.md`.
- Hard-to-reverse decisions: add or update ADR.
- Feature/subsystem design changes: update `docs/designs/`.

Do not let `HANDOFF.md` become the long-term source of truth.
