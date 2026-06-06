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

/** Result of applying one action: useful for tests and the run loop. */
export interface StepResult {
  /** True once a `quit` effect has been carried out. */
  quit: boolean;
  /** The effect the reducer emitted, if any. */
  effect?: CockpitEffect;
  /** A structured error from carrying out the effect, if any. */
  error?: OperationError;
}

export class CockpitApp {
  state: CockpitState;
  private statusLine: string | null = null;
  private stopped = false;

  constructor(
    private readonly deps: EffectDeps,
    private readonly env: CockpitEnv,
    initialState: CockpitState,
    private readonly host: CockpitHost,
  ) {
    this.state = initialState;
  }

  /** The current renderable view (state + transient status line). */
  view(): CockpitView {
    return renderCockpitView(this.state, { statusLine: this.statusLine });
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
        // Leave the TUI, run the attach command, then refresh on return.
        await this.host.attach({ session, attachHint: null });
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
      this.statusLine = `error: ${result.error.code}: ${result.error.message}`;
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
   * Run the interactive loop: draw, read a key, dispatch, until quit or EOF.
   * Always restores the terminal via `host.close()` on exit.
   */
  async run(): Promise<void> {
    try {
      while (!this.stopped) {
        this.host.draw(this.view());
        const event = await this.host.nextKey();
        if (event === null) {
          this.stopped = true;
          break;
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
  options: { cwd: string; scopeMode: CockpitEnv["scopeMode"] },
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
  const app = new CockpitApp(deps, envResult.value, state, host);
  await app.run();
  return { ok: true };
}
