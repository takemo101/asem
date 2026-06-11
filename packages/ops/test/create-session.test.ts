import { describe, expect, test } from "bun:test";
import { type ConfigDiscovery, type ConfigLoader, hashToken } from "@asem/core";
import { FakeTemplateRunner } from "@asem/runtime";
import { createSession, TOKEN_FILE_MODE } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeFileSystem,
  FakeScopeResolver,
  FakeStore,
  MemoryLogger,
  makeConfig,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
// FakeIdGenerator / FakeTokenGenerator are deterministic: first id/token below.
const FIRST_ID = "s_0001";
const FIRST_TOKEN = "tok_0001";
// Raw token whose hash a seeded current Session stores, so the implicit-parent
// path can verify it (MIK-023).
const CURRENT_TOKEN = "tok-current";
const SESSION_DIR = `${scopeA.worktreeRoot}/.asem/sessions/${FIRST_ID}`;
const PROMPT_PATH = `${SESSION_DIR}/prompt.md`;
const LAUNCH_PATH = `${SESSION_DIR}/launch.sh`;

/** A runner whose mux `create` step prints the herdr JSON that carries refs. */
function happyRunner(): FakeTemplateRunner {
  // [0] captures the herdr session name; [1] mux create -> herdr `workspace create` JSON.
  // Later calls default to ok.
  return new FakeTemplateRunner({
    commands: [{ stdout: "asem" }, { stdout: HERDR_CREATE_JSON }],
  });
}

/** Minimal `herdr workspace create` JSON shape the builtin herdr template parses. */
const HERDR_CREATE_JSON = JSON.stringify({
  result: {
    workspace: { workspace_id: "herdr-workspace-1" },
    root_pane: { pane_id: "pane-1" },
    tab: { tab_id: "tab-1" },
  },
});

/** Build a deps bundle keeping typed references to the inspectable fakes. */
function deps(
  overrides: {
    runner?: FakeTemplateRunner;
    store?: FakeStore;
    currentSessionResolver?: FakeCurrentSessionResolver;
  } = {},
) {
  const fs = new FakeFileSystem();
  const logger = new MemoryLogger();
  const runner = overrides.runner ?? happyRunner();
  const store = overrides.store ?? new FakeStore();
  const bundle = makeOpsDeps({
    fs,
    logger,
    store,
    templateRunner: runner,
    scopeResolver: new FakeScopeResolver(scopeA),
    ...(overrides.currentSessionResolver
      ? { currentSessionResolver: overrides.currentSessionResolver }
      : {}),
  });
  return { ...bundle, fs, logger, runner, store };
}

const ROOT_INPUT = { name: "reviewer-1", prompt: "do the thing", root: true };

describe("createSession — happy path", () => {
  test("runs mux create before run_in_pane and inserts only after a successful start", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    // Sequence order: capture herdr session, create workspace, then run_in_pane.
    expect(d.runner.commands).toHaveLength(3);
    expect(d.runner.commands[0]!.command).toContain("HERDR_SESSION");
    expect(d.runner.commands[1]!.command).toContain("herdr --session 'asem' workspace create");
    expect(d.runner.commands[2]!.command).toContain("herdr --session 'asem' pane run");

    // The row is persisted exactly once, after the start.
    expect(d.store.sessions).toHaveLength(1);
    expect(d.store.sessions[0]!.id).toBe(session.id);
    expect(session.id).toBe(FIRST_ID);
    expect(session.status).toBe("running");
  });

  test("creates the Session dir and always writes prompt.md", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    expect(d.fs.dirs.has(SESSION_DIR)).toBe(true);
    expect(session.sessionDir).toBe(SESSION_DIR);

    const prompt = d.fs.files.get(PROMPT_PATH);
    expect(prompt).toBeDefined();
    expect(prompt!.contents).toBe("do the thing\n");
  });

  test("captures mux refs from the create sequence onto the Session", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(session.muxRef).toEqual({
      pane_id: "pane-1",
      tab_id: "tab-1",
      herdr_workspace_id: "herdr-workspace-1",
      herdr_session: "asem",
    });
  });

  test("writes a mode-0600 launch script injecting env and the agent command", async () => {
    const d = deps();
    expectOk(await createSession(d, ROOT_INPUT, CTX));

    const launch = d.fs.files.get(LAUNCH_PATH);
    expect(launch).toBeDefined();
    expect(launch!.mode).toBe(TOKEN_FILE_MODE);
    expect(TOKEN_FILE_MODE).toBe(0o600);

    const script = launch!.contents;
    expect(script).toContain(`export AS_SESSION_ID='${FIRST_ID}'`);
    expect(script).toContain("export AS_PARENT_SESSION_ID=''");
    expect(script).toContain(`export AS_WORKSPACE_ID='${scopeA.workspaceId}'`);
    expect(script).toContain(
      `export AS_WORKTREE_ROOT='${scopeA.worktreeRoot}'`,
    );
    expect(script).toContain(`export AS_PROJECT_ROOT='${scopeA.worktreeRoot}'`);
    expect(script).toContain(`export AS_SESSION_TOKEN='${FIRST_TOKEN}'`);
    // Agent (claude, prompt_delivery=arg) reads the prompt file as its argument.
    expect(script).toContain(`claude "$(cat '${PROMPT_PATH}')"`);
  });
});

describe("createSession — parent resolution truth table", () => {
  test("--root creates a root Session with parent_session_id = null", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(session.parentSessionId).toBeNull();
  });

  test("--parent <id> uses the explicit parent when it is in scope", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "p_1", name: "parent" }));
    const d = deps({ store });

    const { session } = expectOk(
      await createSession(
        d,
        { name: "child", prompt: "p", parentSessionId: "p_1" },
        CTX,
      ),
    );
    expect(session.parentSessionId).toBe("p_1");
  });

  test("--parent <id> not in scope returns parent_session_not_found", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { name: "child", prompt: "p", parentSessionId: "missing" },
      CTX,
    );
    expectErr(result, "parent_session_not_found");
    expect(d.store.sessions).toHaveLength(0);
  });

  test("no parent flag falls back to the verified current Session", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({
        id: "cur_1",
        name: "current",
        tokenHash: hashToken(CURRENT_TOKEN),
      }),
    );
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: CURRENT_TOKEN,
      }),
    });

    const { session } = expectOk(
      await createSession(d, { name: "child", prompt: "p" }, CTX),
    );
    expect(session.parentSessionId).toBe("cur_1");
  });

  test("no parent flag with an invalid current-Session token returns invalid_session_token and no side effects", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({
        id: "cur_1",
        name: "current",
        tokenHash: hashToken(CURRENT_TOKEN),
      }),
    );
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: "wrong-token",
      }),
    });

    const result = await createSession(d, { name: "child", prompt: "p" }, CTX);
    expectErr(result, "invalid_session_token");

    // Verification happens before any side effects: no extra row, no panes, no
    // Session dir/files for the doomed create.
    expect(d.store.sessions).toHaveLength(1);
    expect(d.runner.commands).toHaveLength(0);
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.fs.files.has(PROMPT_PATH)).toBe(false);
    expect(d.fs.files.has(LAUNCH_PATH)).toBe(false);
  });

  test("no parent flag with a current Session missing from the store returns parent_session_not_found", async () => {
    const d = deps({
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "ghost",
        token: CURRENT_TOKEN,
      }),
    });
    const result = await createSession(d, { name: "child", prompt: "p" }, CTX);
    expectErr(result, "parent_session_not_found");
    expect(d.store.sessions).toHaveLength(0);
    expect(d.runner.commands).toHaveLength(0);
  });

  test("no parent flag and no current Session returns current_session_not_found", async () => {
    const d = deps({
      currentSessionResolver: new FakeCurrentSessionResolver(null),
    });
    const result = await createSession(d, { name: "child", prompt: "p" }, CTX);
    expectErr(result, "current_session_not_found");
    expect(d.store.sessions).toHaveLength(0);
  });

  test("current Session registered in another scope returns scope_mismatch", async () => {
    const d = deps({
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: "ignored",
        scope: scopeB,
      }),
    });
    const result = await createSession(d, { name: "child", prompt: "p" }, CTX);
    expectErr(result, "scope_mismatch");
    expect(d.store.sessions).toHaveLength(0);
  });
});

describe("createSession — token protection", () => {
  test("keeps the raw token out of the DB, logs, mux refs, and command args", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    // DB stores only the hash.
    expect(session.tokenHash).toBe(hashToken(FIRST_TOKEN));
    expect(session.tokenHash).not.toBe(FIRST_TOKEN);

    // The raw token never appears in logs, mux refs, or issued command strings.
    expect(JSON.stringify(d.logger.entries)).not.toContain(FIRST_TOKEN);
    expect(JSON.stringify(session.muxRef)).not.toContain(FIRST_TOKEN);
    expect(JSON.stringify(d.runner.commands)).not.toContain(FIRST_TOKEN);

    // It lives only in the mode-0600 launch script.
    expect(d.fs.files.get(LAUNCH_PATH)!.contents).toContain(FIRST_TOKEN);
  });
});

describe("createSession — failure leaves no stale row + best-effort cleanup", () => {
  test("a failed mux create returns a structured error with the log path and no row", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 1, stderr: "create boom" }],
    });
    const d = deps({ runner });

    const result = await createSession(d, ROOT_INPUT, CTX);
    const error = expectErr(result, "sequence_step_failed");
    expect(error.details?.logPath).toBe(SESSION_DIR);

    // No stale row; prompt.md was written but the launch script was not (the
    // launch script is generated only after a successful create).
    expect(d.store.sessions).toHaveLength(0);
    expect(d.fs.files.has(PROMPT_PATH)).toBe(true);
    expect(d.fs.files.has(LAUNCH_PATH)).toBe(false);
    expect(
      d.logger.entries.some((e) => e.message.includes("mux cleanup")),
    ).toBe(true);
  });

  test("a failed run_in_pane attempts mux close and leaves no row", async () => {
    const runner = new FakeTemplateRunner({
      commands: [
        { stdout: "asem" }, // herdr session capture
        { stdout: HERDR_CREATE_JSON }, // create ok (captures pane_id/tab_id/workspace)
        { exitCode: 1, stderr: "send boom" }, // run_in_pane fails
        {}, // close ok
      ],
    });
    const d = deps({ runner });

    const result = await createSession(d, ROOT_INPUT, CTX);
    const error = expectErr(result, "sequence_step_failed");
    expect(error.details?.logPath).toBe(SESSION_DIR);

    // Best-effort cleanup ran the mux `close` sequence with the captured workspace.
    const closed = d.runner.commands.some((c) =>
      c.command.includes("herdr --session 'asem' workspace close 'herdr-workspace-1'"),
    );
    expect(closed).toBe(true);

    // No stale Session row.
    expect(d.store.sessions).toHaveLength(0);
  });
});

describe("createSession — template + name validation", () => {
  test("returns mux_template_not_found for an unknown mux", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { ...ROOT_INPUT, mux: "does-not-exist" },
      CTX,
    );
    expectErr(result, "mux_template_not_found");
    // No side effects: the Session dir was never created.
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
  });

  test("returns agent_template_not_found for an unknown agent", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { ...ROOT_INPUT, agent: "does-not-exist" },
      CTX,
    );
    expectErr(result, "agent_template_not_found");
  });

  test("fails fast on a same-scope name collision before any side effects", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "reviewer-1" }));
    const d = deps({ store });

    const result = await createSession(d, ROOT_INPUT, CTX);
    expectErr(result, "session_name_conflict");
    expect(d.runner.commands).toHaveLength(0);
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
  });

  test("rejects invalid input with invalid_input", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { name: "", prompt: "p" } as never,
      CTX,
    );
    expectErr(result, "invalid_input");
  });

  test("returns config_not_found when no .asem.yaml is discovered", async () => {
    const d = deps();
    const result = await createSession(
      {
        ...d,
        configLoader: new FakeConfigLoader({
          kind: "not_found",
        } satisfies ConfigDiscovery),
      },
      ROOT_INPUT,
      CTX,
    );
    expectErr(result, "config_not_found");
  });
});

describe("createSession — project-local templates from .asem.yaml", () => {
  /** A FakeConfigLoader returning a `found` config carrying given templates. */
  function configLoaderWith(config: ReturnType<typeof makeConfig>) {
    return new FakeConfigLoader({
      kind: "found",
      config,
      configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
    } satisfies ConfigDiscovery);
  }

  test("a project-local mux template overrides the builtin used by create", async () => {
    // Project-local `herdr` replaces the builtin: a distinct create command and
    // a regex capture instead of the builtin JSONPath shape.
    const config = makeConfig({
      mux: {
        default: "herdr",
        templates: {
          herdr: {
            create: [
              {
                type: "run",
                command: "my-mux create --cwd {{cwd_shell}}",
                capture: [{ name: "pane_id", regex: "pane=(.+)", group: 1 }],
              },
            ],
            run_in_pane: [
              {
                type: "run",
                command: "my-mux run {{pane_id_shell}} {{launch_cmd_shell}}",
              },
            ],
          },
        },
      },
    });
    // The project-local create command emits the regex-captured pane id.
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "pane=p9" }],
    });
    const d = { ...deps({ runner }), configLoader: configLoaderWith(config) };

    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    // The project-local sequences ran, not the builtin herdr ones.
    expect(d.runner.commands[0]!.command).toContain("my-mux create");
    // `pane_id` flows through shell escaping (`{{pane_id_shell}}`).
    expect(d.runner.commands[1]!.command).toContain("my-mux run 'p9'");
    expect(session.muxRef).toEqual({ pane_id: "p9" });
  });

  test("a project-local agent template overrides the builtin launch command", async () => {
    const config = makeConfig({
      agent: {
        default: "claude",
        templates: {
          claude: { command: "claude-custom", prompt_delivery: "arg" },
        },
      },
    });
    const d = { ...deps(), configLoader: configLoaderWith(config) };

    expectOk(await createSession(d, ROOT_INPUT, CTX));

    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    expect(script).toContain(`claude-custom "$(cat '${PROMPT_PATH}')"`);
  });

  test("builtin templates remain available when project-local maps are empty", async () => {
    // Default makeConfig() carries empty template maps; the builtin herdr/claude
    // must still resolve through the factory.
    const d = { ...deps(), configLoader: configLoaderWith(makeConfig()) };

    expectOk(await createSession(d, ROOT_INPUT, CTX));

    expect(d.runner.commands[1]!.command).toContain("herdr --session 'asem' workspace create");
    expect(d.fs.files.get(LAUNCH_PATH)!.contents).toContain(
      `claude "$(cat '${PROMPT_PATH}')"`,
    );
  });

  test("an invalid project-local mux template returns invalid_template before side effects", async () => {
    const config = makeConfig({
      mux: {
        default: "herdr",
        templates: { herdr: { create: [{ type: "unknown_step" }] } },
      },
    });
    const d = { ...deps(), configLoader: configLoaderWith(config) };

    // A malformed project-local template is a recoverable config defect: it
    // surfaces as a structured error, not a thrown schema exception, and leaves
    // no filesystem/store side effects (MIK-026).
    const error = expectErr(
      await createSession(d, ROOT_INPUT, CTX),
      "invalid_template",
    );
    expect(error.details?.kind).toBe("mux");
    expect(error.details?.name).toBe("herdr");
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.store.sessions).toHaveLength(0);
  });

  test("an invalid project-local agent template returns invalid_template before side effects", async () => {
    const config = makeConfig({
      agent: {
        default: "claude",
        templates: { claude: { command: "" } },
      },
    });
    const d = { ...deps(), configLoader: configLoaderWith(config) };

    const error = expectErr(
      await createSession(d, ROOT_INPUT, CTX),
      "invalid_template",
    );
    expect(error.details?.kind).toBe("agent");
    expect(error.details?.name).toBe("claude");
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.store.sessions).toHaveLength(0);
  });
});

describe("createSession — effective create cwd scope (MIK-025)", () => {
  // The caller runs in scopeA but targets the sibling Worktree Root scopeB via
  // `input.cwd`. Config, scope, parent/token checks, templates, and the launch
  // cwd must all resolve from the target, so the Session lands in scopeB.
  const SIBLING_CWD = scopeB.worktreeRoot;
  const SIBLING_SESSION_DIR = `${scopeB.worktreeRoot}/.asem/sessions/${FIRST_ID}`;
  const SIBLING_LAUNCH_PATH = `${SIBLING_SESSION_DIR}/launch.sh`;

  /**
   * Deps whose scope resolver derives Effective Scope from the cwd it is given
   * (the default {@link FakeScopeResolver} with no fixed scope), so resolving
   * with the target cwd reproduces scopeB and a caller cwd reproduces scopeA.
   */
  function siblingDeps(
    overrides: {
      runner?: FakeTemplateRunner;
      store?: FakeStore;
      configLoader?: ConfigLoader;
      currentSessionResolver?: FakeCurrentSessionResolver;
    } = {},
  ) {
    const fs = new FakeFileSystem();
    const logger = new MemoryLogger();
    const runner = overrides.runner ?? happyRunner();
    const store = overrides.store ?? new FakeStore();
    const bundle = makeOpsDeps({
      fs,
      logger,
      store,
      templateRunner: runner,
      scopeResolver: new FakeScopeResolver(),
      ...(overrides.configLoader
        ? { configLoader: overrides.configLoader }
        : {}),
      ...(overrides.currentSessionResolver
        ? { currentSessionResolver: overrides.currentSessionResolver }
        : {}),
    });
    return { ...bundle, fs, logger, runner, store };
  }

  /** A current Session row registered in the target Worktree Root (scopeB). */
  function currentInSiblingScope() {
    return makeSession({
      id: "cur_b",
      name: "current",
      workspaceId: scopeB.workspaceId,
      worktreeRoot: scopeB.worktreeRoot,
      cwd: scopeB.worktreeRoot,
      sessionDir: `${scopeB.worktreeRoot}/.asem/sessions/cur_b`,
      tokenHash: hashToken(CURRENT_TOKEN),
    });
  }

  test("scopes the Session row to the target Worktree Root, not the caller's", async () => {
    const d = siblingDeps();
    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, cwd: SIBLING_CWD }, CTX),
    );

    // The row carries the target scope and runtime layout, not the caller's.
    expect(session.worktreeRoot).toBe(scopeB.worktreeRoot);
    expect(session.workspaceId).toBe(scopeB.workspaceId);
    expect(session.cwd).toBe(SIBLING_CWD);
    expect(session.sessionDir).toBe(SIBLING_SESSION_DIR);

    // It is visible in the target scope and absent from the caller scope.
    expect(await d.store.getSessionByName(scopeB, "reviewer-1")).not.toBeNull();
    expect(await d.store.getSessionByName(scopeA, "reviewer-1")).toBeNull();

    // The launch script injects the target worktree root and changes into the
    // target cwd before starting the agent.
    const script = d.fs.files.get(SIBLING_LAUNCH_PATH)!.contents;
    expect(script).toContain(
      `export AS_WORKTREE_ROOT='${scopeB.worktreeRoot}'`,
    );
    expect(script).toContain(`export AS_PROJECT_ROOT='${scopeB.worktreeRoot}'`);
    expect(script).toContain(`cd '${SIBLING_CWD}'`);
  });

  test("verifies the implicit current-Session parent in the target scope", async () => {
    const store = new FakeStore();
    store.sessions.push(currentInSiblingScope());
    const d = siblingDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_b",
        token: CURRENT_TOKEN,
      }),
    });

    // No parent flag: the parent is resolved + token-verified in scopeB. Were
    // scope taken from the caller (scopeA), this lookup would miss the row.
    const { session } = expectOk(
      await createSession(
        d,
        { name: "child", prompt: "p", cwd: SIBLING_CWD },
        CTX,
      ),
    );
    expect(session.parentSessionId).toBe("cur_b");
    expect(session.worktreeRoot).toBe(scopeB.worktreeRoot);
  });

  test("authenticates the agent-origin current Session in the target scope", async () => {
    const store = new FakeStore();
    store.sessions.push(currentInSiblingScope());
    const d = siblingDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_b",
        token: CURRENT_TOKEN,
      }),
    });

    // Agent-origin create must prove a current token in the *target* scope even
    // for an explicit `--root`. A caller-scope check would fail with
    // session_not_found because cur_b only exists in scopeB.
    const { session } = expectOk(
      await createSession(
        d,
        { ...ROOT_INPUT, cwd: SIBLING_CWD },
        { cwd: scopeA.worktreeRoot, origin: "agent" },
      ),
    );
    expect(session.worktreeRoot).toBe(scopeB.worktreeRoot);
    expect(session.parentSessionId).toBeNull();
  });

  test("loads project-local templates from the target cwd config", async () => {
    // The target cwd's `.asem.yaml` overrides the builtin herdr mux; the caller
    // cwd keeps the default builtin config. Resolving config from the create cwd
    // means the project-local template is the one that runs.
    const targetConfig = makeConfig({
      mux: {
        default: "herdr",
        templates: {
          herdr: {
            create: [
              {
                type: "run",
                command: "my-mux create --cwd {{cwd_shell}}",
                capture: [{ name: "pane_id", regex: "pane=(.+)", group: 1 }],
              },
            ],
            run_in_pane: [
              { type: "run", command: "my-mux run {{pane_id_shell}}" },
            ],
          },
        },
      },
    });
    const configLoader: ConfigLoader = {
      async load(startDir: string): Promise<ConfigDiscovery> {
        return startDir === SIBLING_CWD
          ? {
              kind: "found",
              config: targetConfig,
              configPath: `${SIBLING_CWD}/.asem.yaml`,
            }
          : {
              kind: "found",
              config: makeConfig(),
              configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
            };
      },
    };
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "pane=p9" }],
    });
    const d = siblingDeps({ runner, configLoader });

    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, cwd: SIBLING_CWD }, CTX),
    );

    // The target cwd's project-local sequence ran, not the builtin herdr one.
    expect(d.runner.commands[0]!.command).toContain("my-mux create");
    expect(session.muxRef).toEqual({ pane_id: "p9" });
    expect(session.worktreeRoot).toBe(scopeB.worktreeRoot);
  });
});
