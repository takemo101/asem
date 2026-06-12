/**
 * The cockpit app: orchestration that ties the pure view-model to a
 * {@link CockpitHost} and `@asem/ops`.
 *
 * Responsibilities, and only these: apply an action to the view-model, carry out
 * the single {@link CockpitEffect} it may emit, and keep the host painted. All
 * use-case semantics stay in `@asem/ops`; all state transitions stay in the pure
 * reducer. The app just sequences them — so it is fully testable with a scripted
 * fake host and the `@asem/ops` in-memory fakes (no real TTY or multiplexer).
 *
 * Scope handling: in `workspace` mode a mutation targets a Session that may live
 * in a sibling worktree, so the app runs the operation with `cwd` set to that
 * Session's `worktree_root`, resolving it to the correct Effective Scope. The
 * snapshot refresh always uses the base `cwd` and the cockpit's scope mode.
 */
import type { OperationError, Session } from "@asem/core";
import {
  type CockpitEffectOutcome,
  type EffectDeps,
  executeCockpitEffect,
  loadAttach,
  loadCockpitSnapshot,
  resolveCockpitEnv,
} from "./cockpit.ts";
import type { CockpitHost } from "./host.ts";
import { type KeyEvent, keyToAction } from "./keymap.ts";
import type {
  CockpitAction,
  CockpitEffect,
  CockpitEnv,
  CockpitState,
} from "./types.ts";
import { type CockpitView, renderCockpitView } from "./view.ts";
import {
  applySnapshot,
  createCockpitState,
  dispatchCockpit,
} from "./view-model.ts";

/** Auto-refresh cadence while the cockpit is idle (cuekit's refresh model). */
export const AUTO_REFRESH_MS = 3000;

/** Result of applying one action: useful for tests and the run loop. */
export interface StepResult {
  /** True once a `quit` effect has been carried out. */
  quit: boolean;
  /** The effect the reducer emitted, if any. */
  effect?: CockpitEffect;
  /** A structured error from carrying out the effect, if any. */
  error?: OperationError;
}

/** Optional knobs for {@link CockpitApp}. */
export interface CockpitAppOptions {
  /** Auto-refresh interval; defaults to {@link AUTO_REFRESH_MS}. */
  autoRefreshMs?: number;
}

export class CockpitApp {
  state: CockpitState;
  private statusLine: string | null = null;
  private stopped = false;
  private readonly autoRefreshMs: number;

  constructor(
    private readonly deps: EffectDeps,
    private readonly env: CockpitEnv,
    initialState: CockpitState,
    private readonly host: CockpitHost,
    options: CockpitAppOptions = {},
  ) {
    this.state = initialState;
    this.autoRefreshMs = options.autoRefreshMs ?? AUTO_REFRESH_MS;
  }

  /** The current renderable view (state + transient status line). */
  view(): CockpitView {
    return renderCockpitView(this.state, {
      statusLine: this.statusLine,
      ...(this.host.nextKeyOrTick !== undefined
        ? { autoRefreshMs: this.autoRefreshMs }
        : {}),
    });
  }

  /** True once the app has been asked to quit. */
  get quit(): boolean {
    return this.stopped;
  }

  /** Find a Session in the current snapshot by id. */
  private session(id: string): Session | null {
    return this.state.snapshot.sessions.find((s) => s.id === id) ?? null;
  }

  /**
   * The `cwd` an operation on `sessionId` should run in. In `workspace` mode a
   * cross-worktree target resolves to its own `worktree_root`; otherwise the
   * cockpit's base `cwd` is used.
   */
  private cwdFor(sessionId: string): string {
    if (this.env.scopeMode !== "workspace") {
      return this.env.cwd;
    }
    return this.session(sessionId)?.worktreeRoot ?? this.env.cwd;
  }

  /** Reload the snapshot for the cockpit scope and fold it into the state. */
  private async refresh(): Promise<OperationError | undefined> {
    const result = await loadCockpitSnapshot(
      this.deps,
      { cwd: this.env.cwd },
      this.env.scopeMode,
    );
    if (!result.ok) {
      return result.error;
    }
    this.state = applySnapshot(this.state, result.value);
    return undefined;
  }

  /** Apply a {@link KeyEvent}; a no-op when the key is unbound in this mode. */
  async handleKey(event: KeyEvent): Promise<StepResult> {
    const action = keyToAction(this.state, event);
    if (action === null) {
      return { quit: false };
    }
    return this.dispatch(action);
  }

  /** Apply an action to the view-model and carry out any emitted effect. */
  async dispatch(action: CockpitAction): Promise<StepResult> {
    const { state, effect } = dispatchCockpit(this.state, action);
    this.state = state;
    if (effect === undefined) {
      this.statusLine = null;
      return { quit: false };
    }
    return this.handleEffect(effect);
  }

  private async handleEffect(effect: CockpitEffect): Promise<StepResult> {
    if (effect.kind === "quit") {
      this.stopped = true;
      return { quit: true, effect };
    }

    if (effect.kind === "attach") {
      const session = this.session(effect.sessionId);
      if (session !== null) {
        // Resolve the attach hint through the same shared `get_session` path the
        // CLI uses, then leave the TUI, run it, and refresh on return.
        const attach = await loadAttach(
          this.deps,
          { cwd: this.cwdFor(effect.sessionId) },
          effect.sessionId,
        );
        await this.host.attach({ session, ...attach });
      }
      const error = await this.refresh();
      this.setStatus(
        error,
        session === null ? null : `attached to ${session.name}`,
      );
      return { quit: false, effect, ...(error ? { error } : {}) };
    }

    if (effect.kind === "refresh") {
      const error = await this.refresh();
      this.setStatus(error, "refreshed");
      return { quit: false, effect, ...(error ? { error } : {}) };
    }

    // send / close / delete run against the target Session's scope.
    const ctx = { cwd: this.cwdFor(effect.sessionId) };
    const result = await executeCockpitEffect(
      this.deps,
      ctx,
      effect,
      this.env.scopeMode,
    );
    if (!result.ok) {
      // An operator-initiated mutation failed: surface it as a dismissible
      // dialog, not just a footer line (refresh/tick errors stay in the
      // status line — a modal would reopen on every interval).
      this.reportOperationError(result.error);
      return { quit: false, effect, error: result.error };
    }
    // Reflect the mutation by refreshing the snapshot.
    const refreshError = await this.refresh();
    this.setStatus(refreshError, outcomeStatus(result.value));
    return {
      quit: false,
      effect,
      ...(refreshError ? { error: refreshError } : {}),
    };
  }

  private setStatus(
    error: OperationError | undefined,
    ok: string | null,
  ): void {
    this.statusLine =
      error === undefined ? ok : `error: ${error.code}: ${error.message}`;
  }

  /**
   * Surface a failed operator operation as the error modal. If another modal
   * is already open (e.g. a send draft) the reducer refuses to clobber it, and
   * the error degrades to the status line instead.
   */
  reportOperationError(error: OperationError): void {
    const { state } = dispatchCockpit(this.state, {
      type: "showError",
      code: error.code,
      message: error.message,
    });
    this.state = state;
    this.statusLine =
      state.modal.kind === "error"
        ? null
        : `error: ${error.code}: ${error.message}`;
  }

  /**
   * Run the interactive loop: draw, read a key, dispatch, until quit or EOF.
   * While no modal is open and the host supports it, key reads time out every
   * {@link AUTO_REFRESH_MS} and the snapshot is refreshed (design "Refresh
   * model"); an open send/confirm/help modal pauses the timer by falling back
   * to a plain blocking key read. Always restores the terminal via
   * `host.close()` on exit.
   */
  async run(): Promise<void> {
    try {
      while (!this.stopped) {
        this.host.draw(this.view());
        const idle = this.state.modal.kind === "none";
        const event =
          idle && this.host.nextKeyOrTick !== undefined
            ? await this.host.nextKeyOrTick(this.autoRefreshMs)
            : await this.host.nextKey();
        if (event === null) {
          this.stopped = true;
          break;
        }
        if (event === "tick") {
          // A quiet auto-refresh: fold in the new snapshot (and any activity),
          // surface errors, but do not overwrite the last status with noise.
          const error = await this.refresh();
          if (error !== undefined) {
            this.statusLine = `error: ${error.code}: ${error.message}`;
          }
          continue;
        }
        await this.handleKey(event);
      }
    } finally {
      this.host.close();
    }
  }
}

/** A human status line for a successful effect outcome. */
function outcomeStatus(outcome: CockpitEffectOutcome): string {
  switch (outcome.kind) {
    case "sent":
      return `sent message to ${outcome.message.toSessionId}`;
    case "closed":
      return `closed ${outcome.session.name}`;
    case "deleted":
      return `deleted ${outcome.deletedSessionId} (${outcome.deletedMessageCount} messages)`;
    case "refreshed":
      return "refreshed";
    case "attach":
      return "attached";
    case "quit":
      return "quit";
    default: {
      const _never: never = outcome;
      return _never;
    }
  }
}

/**
 * Build and run a cockpit for `cwd` and scope mode against a host. Resolves the
 * env and loads the initial snapshot through `@asem/ops`; any structured error
 * (e.g. `config_not_found`) is returned for the caller to render, and the loop is
 * not started. Returns when the user quits or input ends.
 */
export async function runCockpit(
  deps: EffectDeps,
  host: CockpitHost,
  options: {
    cwd: string;
    scopeMode: CockpitEnv["scopeMode"];
  } & CockpitAppOptions,
): Promise<{ ok: true } | { ok: false; error: OperationError }> {
  const envResult = await resolveCockpitEnv(
    deps,
    options.cwd,
    options.scopeMode,
  );
  if (!envResult.ok) {
    return { ok: false, error: envResult.error };
  }
  const snapshot = await loadCockpitSnapshot(
    deps,
    { cwd: options.cwd },
    options.scopeMode,
  );
  if (!snapshot.ok) {
    return { ok: false, error: snapshot.error };
  }
  const state = createCockpitState(envResult.value, snapshot.value);
  const app = new CockpitApp(
    deps,
    envResult.value,
    state,
    host,
    options.autoRefreshMs !== undefined
      ? { autoRefreshMs: options.autoRefreshMs }
      : {},
  );
  await app.run();
  return { ok: true };
}
