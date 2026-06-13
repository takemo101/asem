/**
 * Shared fixtures for the {@link CockpitApp} test trio (effects, workspace
 * scope, run loop/bootstrap). These wire the pure cockpit state to the scripted
 * {@link FakeHost} and the `@asem/ops` in-memory fakes — no real TTY, mux, or
 * timer. Renderer/core fixtures stay in `./helpers.ts`; this module owns only
 * the orchestration-level wiring the app tests share.
 */
import {
  type FakeCurrentSessionResolver,
  type FakeStore,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";
import type { CockpitSnapshot } from "../src/index.ts";
import { CockpitApp, createCockpitState } from "../src/index.ts";
import {
  FakeHost,
  makeEnv,
  type makeMessage,
  type makeSession,
} from "./helpers.ts";

/** Build a {@link CockpitSnapshot} from sessions and (optional) messages. */
export function snapshot(
  sessions: ReturnType<typeof makeSession>[],
  messages: ReturnType<typeof makeMessage>[] = [],
): CockpitSnapshot {
  return { sessions, messages };
}

/**
 * Build a {@link CockpitApp} over a {@link FakeStore}: resolves a cockpit env
 * (worktree scope by default), seeds the initial snapshot from the store, and
 * attaches a fresh {@link FakeHost}. Returns the app plus the host and deps so
 * tests can assert on drawn frames and attach requests.
 */
export function makeApp(opts: {
  store: FakeStore;
  scopeMode?: "worktree" | "workspace";
  currentSessionResolver?: FakeCurrentSessionResolver;
}) {
  const env = makeEnv(opts.scopeMode ? { scopeMode: opts.scopeMode } : {});
  const snap: CockpitSnapshot = {
    sessions: [...opts.store.sessions],
    messages: [...opts.store.messages],
  };
  const state = createCockpitState(env, snap);
  const host = new FakeHost();
  const deps = makeOpsDeps({
    store: opts.store,
    ...(opts.currentSessionResolver
      ? { currentSessionResolver: opts.currentSessionResolver }
      : {}),
  });
  return { app: new CockpitApp(deps, env, state, host), host, deps };
}
