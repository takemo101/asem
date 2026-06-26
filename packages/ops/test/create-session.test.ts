import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ConfigDiscovery,
  type ConfigLoader,
  hashToken,
  type ScopeResolver,
} from "@asem/core";
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
    scopeResolver?: ScopeResolver;
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
    scopeResolver: overrides.scopeResolver ?? new FakeScopeResolver(scopeA),
    ...(overrides.currentSessionResolver
      ? { currentSessionResolver: overrides.currentSessionResolver }
      : {}),
  });
  return { ...bundle, fs, logger, runner, store };
}

const ROOT_INPUT = { name: "reviewer-1", prompt: "do the thing", root: true };

function workspaceScopeByCwd(
  worktreeByCwd: Record<string, string>,
): ScopeResolver {
  return {
    async resolve(cwd, config) {
      return {
        workspaceId: config.workspace.id,
        worktreeRoot: worktreeByCwd[cwd] ?? cwd,
      };
    },
    async resolveWorktreeRoot(cwd) {
      return worktreeByCwd[cwd] ?? cwd;
    },
  };
}

describe("createSession — happy path", () => {
  test("runs mux create before run_in_pane and inserts only after a successful start", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    // Sequence order: capture herdr session, create workspace, then run_in_pane.
    expect(d.runner.commands).toHaveLength(3);
    expect(d.runner.commands[0]!.command).toContain("HERDR_SESSION");
    expect(d.runner.commands[1]!.command).toContain(
      "herdr --session 'asem' workspace create",
    );
    expect(d.runner.commands[2]!.command).toContain(
      "herdr --session 'asem' pane run",
    );

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
    // MIK-034 launch env available to hooks.
    expect(script).toContain(`export AS_SESSION_DIR='${SESSION_DIR}'`);
    expect(script).toContain(`export AS_PROMPT_PATH='${PROMPT_PATH}'`);
    expect(script).toContain("export AS_SESSION_NAME='reviewer-1'");
    expect(script).toContain("export AS_AGENT='claude'");
    expect(script).toContain("export AS_MUX='herdr'");
    // No model requested, so AS_MODEL is empty and {{model_shell}} collapses to
    // an empty fragment (a harmless double space before the prompt).
    expect(script).toContain("export AS_MODEL=''");
    // Agent (claude) reads the prompt file via {{prompt_shell}}.
    expect(script).toContain(`claude  "$(cat '${PROMPT_PATH}')"`);
  });
});

describe("createSession — model selection (MIK-040)", () => {
  test("persists the model and renders the model flag for a supported Agent Template", async () => {
    const d = deps();
    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, model: "sonnet" }, CTX),
    );

    expect(session.model).toBe("sonnet");
    // The launch command carries the shell-escaped model via {{model_shell}}.
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    expect(script).toContain(
      `claude '--model' 'sonnet' "$(cat '${PROMPT_PATH}')"`,
    );
    expect(script).toContain("export AS_MODEL='sonnet'");
    // Persisted on the stored row too.
    expect(d.store.sessions[0]!.model).toBe("sonnet");
  });

  test("omitting the model keeps Session.model null and emits no model flag", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    expect(session.model).toBeNull();
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    expect(script).not.toContain("--model");
  });

  test("a model for a model-unsupported Agent Template fails before any side effects", async () => {
    // agy is the builtin model-unsupported Agent (no model_flag).
    const d = deps();
    const result = await createSession(
      d,
      { ...ROOT_INPUT, agent: "agy", model: "sonnet" },
      CTX,
    );
    const error = expectErr(result, "invalid_input");
    expect(error.message).toContain("does not support");
    expect(error.details?.agent).toBe("agy");
    expect(error.details?.model).toBe("sonnet");

    // Fails before the Session dir, prompt, mux commands, and the store insert.
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.fs.files.has(PROMPT_PATH)).toBe(false);
    expect(d.runner.commands).toHaveLength(0);
    expect(d.store.sessions).toHaveLength(0);
  });
});

describe("createSession — launch script hooks (MIK-034)", () => {
  /** A FakeConfigLoader returning a `found` config carrying given templates. */
  function configLoaderWith(config: ReturnType<typeof makeConfig>) {
    return new FakeConfigLoader({
      kind: "found",
      config,
      configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
    } satisfies ConfigDiscovery);
  }

  /** A config whose `claude` agent template carries the given hook fields. */
  function agentConfigWithHooks(hooks: {
    before_agent?: string[];
    after_agent?: string[];
  }) {
    return makeConfig({
      agent: {
        default: "claude",
        templates: {
          claude: { command: "claude {{prompt_shell}}", ...hooks },
        },
      },
    });
  }

  test("no hooks: the launch script runs the agent command with no hook machinery", async () => {
    const d = deps();
    expectOk(await createSession(d, ROOT_INPUT, CTX));
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    expect(script).toContain(`claude  "$(cat '${PROMPT_PATH}')"`);
    // Without after hooks there is no exit-code capture machinery.
    expect(script).not.toContain("AS_AGENT_EXIT_CODE");
    expect(script).not.toContain("set +e");
  });

  test("before_agent lines are inserted before the agent command (strict order)", async () => {
    const d = {
      ...deps(),
      configLoader: configLoaderWith(
        agentConfigWithHooks({
          before_agent: ["echo prep-1", "mkdir -p /tmp/work"],
        }),
      ),
    };
    expectOk(await createSession(d, ROOT_INPUT, CTX));
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;

    expect(script).toContain("echo prep-1");
    expect(script).toContain("mkdir -p /tmp/work");
    // before_agent precedes the agent command; set -euo pipefail (still active)
    // aborts on the first failure, so the agent never starts.
    const idxBefore = script.indexOf("echo prep-1");
    const idxAgent = script.indexOf(`claude "$(cat '${PROMPT_PATH}')"`);
    expect(idxBefore).toBeGreaterThanOrEqual(0);
    expect(idxBefore).toBeLessThan(idxAgent);
    // Strict region runs under set -e, which is on by default — no set +e before
    // the agent command starts.
    expect(script.slice(0, idxAgent)).not.toContain("set +e");
  });

  test("after_agent lines run after the agent exits, best-effort, preserving the exit code", async () => {
    const d = {
      ...deps(),
      configLoader: configLoaderWith(
        agentConfigWithHooks({
          after_agent: ["echo cleanup-1", "echo cleanup-2"],
        }),
      ),
    };
    expectOk(await createSession(d, ROOT_INPUT, CTX));
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;

    const idxAgent = script.indexOf(`claude "$(cat '${PROMPT_PATH}')"`);
    const idxCapture = script.indexOf("AS_AGENT_EXIT_CODE=$?");
    const idxClean1 = script.indexOf("echo cleanup-1");
    const idxClean2 = script.indexOf("echo cleanup-2");
    const idxExit = script.indexOf('exit "$AS_AGENT_EXIT_CODE"');

    // Order: agent command → capture exit code → after hooks → exit with it.
    expect(idxAgent).toBeGreaterThanOrEqual(0);
    expect(idxAgent).toBeLessThan(idxCapture);
    expect(idxCapture).toBeLessThan(idxClean1);
    expect(idxClean1).toBeLessThan(idxClean2);
    expect(idxClean2).toBeLessThan(idxExit);

    // Best-effort: after hooks run with set -e disabled so an earlier failure
    // does not skip later after hooks.
    expect(script).toContain("set +e");
    // The exit code is exported so after hooks can read AS_AGENT_EXIT_CODE.
    expect(script).toContain("export AS_AGENT_EXIT_CODE");
  });

  test("hook lines are literal: no {{...}} interpolation is applied to them", async () => {
    const d = {
      ...deps(),
      configLoader: configLoaderWith(
        agentConfigWithHooks({
          before_agent: ['echo "$AS_SESSION_DIR"'],
          after_agent: ['echo "exit=$AS_AGENT_EXIT_CODE"'],
        }),
      ),
    };
    expectOk(await createSession(d, ROOT_INPUT, CTX));
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    // Env-var references survive verbatim (hooks use env, not placeholders).
    expect(script).toContain('echo "$AS_SESSION_DIR"');
    expect(script).toContain('echo "exit=$AS_AGENT_EXIT_CODE"');
  });

  test("after_agent is best-effort under nounset and preserves the agent exit code (shell-level)", async () => {
    // Run the actually-generated launch.sh through bash. The first after hook
    // references an unset variable; with the script's `set -euo pipefail` still
    // applying `nounset`, that would abort before later hooks. The fix disables
    // nounset for the after region so every after hook is attempted, and the
    // agent command's exit code remains the script's final exit code.
    const realCwd = mkdtempSync(join(tmpdir(), "asem-launch-"));
    const config = makeConfig({
      agent: {
        default: "claude",
        templates: {
          claude: {
            // Returns 7 without exiting the launch script itself.
            command: "sh -c 'exit 7'",
            after_agent: [
              'echo "first=$ASEM_DEFINITELY_UNSET_VAR"',
              "echo second-ran",
            ],
          },
        },
      },
    });
    const d = { ...deps(), configLoader: configLoaderWith(config) };
    expectOk(await createSession(d, { ...ROOT_INPUT, cwd: realCwd }, CTX));

    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    const scriptPath = join(realCwd, "launch.sh");
    writeFileSync(scriptPath, script);
    const out = Bun.spawnSync(["bash", scriptPath]);
    const stdout = out.stdout.toString();

    // The unset-var hook ran (printing an empty value) AND the next hook ran.
    expect(stdout).toContain("first=");
    expect(stdout).toContain("second-ran");
    // The agent command's exit code is preserved as the final exit code.
    expect(out.exitCode).toBe(7);
  });

  test("after_agent keeps nounset active for the Agent command itself", async () => {
    // `nounset` is disabled only after the Agent command exits, for the
    // best-effort after hook region. An unset variable in the Agent command is a
    // launch command defect before the Agent starts, so it should still abort
    // before any after hook runs.
    const realCwd = mkdtempSync(join(tmpdir(), "asem-launch-"));
    const config = makeConfig({
      agent: {
        default: "claude",
        templates: {
          claude: {
            command: 'echo "$ASEM_DEFINITELY_UNSET_AGENT_VAR"',
            after_agent: ["echo after-should-not-run"],
          },
        },
      },
    });
    const d = { ...deps(), configLoader: configLoaderWith(config) };
    expectOk(await createSession(d, { ...ROOT_INPUT, cwd: realCwd }, CTX));

    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    const scriptPath = join(realCwd, "launch.sh");
    writeFileSync(scriptPath, script);
    const out = Bun.spawnSync(["bash", scriptPath]);
    const stdout = out.stdout.toString();
    const stderr = out.stderr.toString();

    expect(stdout).not.toContain("after-should-not-run");
    expect(stderr).toContain("ASEM_DEFINITELY_UNSET_AGENT_VAR");
    expect(out.exitCode).not.toBe(0);
  });
});

describe("createSession — paste_prompt delivery (MIK-030)", () => {
  /** A FakeConfigLoader returning a `found` config carrying given templates. */
  function configLoaderWith(config: ReturnType<typeof makeConfig>) {
    return new FakeConfigLoader({
      kind: "found",
      config,
      configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
    } satisfies ConfigDiscovery);
  }

  /** An opencode-shaped paste agent over the builtin herdr mux. */
  function pasteAgentConfig() {
    return makeConfig({
      agent: {
        default: "opencode",
        templates: {
          opencode: {
            command: "opencode",
            paste_prompt: true,
            before_paste: [{ type: "wait_ms", ms: 750 }],
          },
        },
      },
    });
  }

  test("after run_in_pane, runs before_paste then mux send with the prompt as the message", async () => {
    const d = { ...deps(), configLoader: configLoaderWith(pasteAgentConfig()) };
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    const commands = d.runner.commands.map((c) => c.command);
    // [0] herdr session capture, [1] workspace create, [2] run_in_pane (launch
    // script), then the mux `send` sequence pastes the prompt: [3] idle wait,
    // [4] pane run with the prompt as the message. before_paste (wait_ms) runs
    // between [2] and [3] but issues no shell command.
    expect(commands).toHaveLength(5);
    expect(commands[2]).toContain("launch.sh");
    expect(commands[3]).toContain("wait agent-status 'pane-1'");
    // Paste delivery sends the exact bytes written to prompt.md — the effective
    // prompt with the file's trailing newline — so file and paste never drift.
    expect(commands[4]).toBe(
      "herdr --session 'asem' pane run 'pane-1' 'do the thing\n'",
    );
    expect(session.status).toBe("running");
    // The row is persisted only after a successful paste.
    expect(d.store.sessions).toHaveLength(1);
  });

  test("a non-paste agent never runs the mux send sequence during create", async () => {
    // The default claude builtin delivers via {{prompt_shell}}, so create stops
    // after run_in_pane — no paste send.
    const d = deps();
    expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(d.runner.commands).toHaveLength(3);
  });

  test("a failed paste send attempts mux close and leaves no row", async () => {
    const runner = new FakeTemplateRunner({
      commands: [
        { stdout: "asem" }, // herdr session capture
        { stdout: HERDR_CREATE_JSON }, // workspace create
        {}, // run_in_pane ok
        {}, // send: idle wait (on_error ignore)
        { exitCode: 1, stderr: "paste boom" }, // send: pane run prompt fails
        {}, // close ok
      ],
    });
    const d = {
      ...deps({ runner }),
      configLoader: configLoaderWith(pasteAgentConfig()),
    };

    const result = await createSession(d, ROOT_INPUT, CTX);
    const error = expectErr(result, "sequence_step_failed");
    expect(error.details?.logPath).toBe(SESSION_DIR);

    // Best-effort cleanup ran the mux `close` sequence with the captured workspace.
    const closed = d.runner.commands.some((c) =>
      c.command.includes(
        "herdr --session 'asem' workspace close 'herdr-workspace-1'",
      ),
    );
    expect(closed).toBe(true);
    // No stale Session row left after the failed paste.
    expect(d.store.sessions).toHaveLength(0);
  });
});

describe("createSession — Agent Profiles (MIK-041)", () => {
  const PROJECT_AGENTS = `${scopeA.worktreeRoot}/.asem/agents`;
  const USER_AGENTS = "/home/.asem/agents";

  /** Seed a profile file into the fake fs and register its directory. */
  function seedProfile(
    fs: FakeFileSystem,
    dir: string,
    name: string,
    contents: string,
  ): void {
    fs.dirs.add(dir);
    fs.files.set(`${dir}/${name}`, { contents });
  }

  function profileFile(
    frontmatter: Record<string, string>,
    body = "Custom profile instructions.",
  ): string {
    const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
    return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
  }

  test("a builtin profile shapes prompt.md and persists profile/profileSource", async () => {
    const d = deps();
    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, profile: "reviewer" }, CTX),
    );

    expect(session.profile).toBe("reviewer");
    expect(session.profileSource).toBe("builtin");
    expect(d.store.sessions[0]!.profile).toBe("reviewer");
    expect(d.store.sessions[0]!.profileSource).toBe("builtin");

    const prompt = d.fs.files.get(PROMPT_PATH)!.contents;
    expect(prompt).toContain("# Agent Profile");
    expect(prompt).toContain("Profile: reviewer");
    expect(prompt).toContain("Source: builtin");
    // The original user prompt is preserved under # User Prompt.
    const marker = "# User Prompt\n\n";
    expect(prompt.slice(prompt.indexOf(marker) + marker.length)).toBe(
      "do the thing\n",
    );
    // Profile-first ordering.
    expect(prompt.indexOf("# Agent Profile")).toBeLessThan(
      prompt.indexOf("# User Prompt"),
    );
  });

  test("exports AS_PROFILE/AS_PROFILE_SOURCE in launch.sh", async () => {
    const d = deps();
    expectOk(await createSession(d, { ...ROOT_INPUT, profile: "scout" }, CTX));
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    expect(script).toContain("export AS_PROFILE='scout'");
    expect(script).toContain("export AS_PROFILE_SOURCE='builtin'");
  });

  test("with no profile, AS_PROFILE/AS_PROFILE_SOURCE are empty and columns null", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(session.profile).toBeNull();
    expect(session.profileSource).toBeNull();
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    expect(script).toContain("export AS_PROFILE=''");
    expect(script).toContain("export AS_PROFILE_SOURCE=''");
  });

  test("an unknown profile fails with invalid_input before any side effects", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { ...ROOT_INPUT, profile: "does-not-exist" },
      CTX,
    );
    const error = expectErr(result, "invalid_input");
    expect(error.details?.profile).toBe("does-not-exist");
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.fs.files.has(PROMPT_PATH)).toBe(false);
    expect(d.runner.commands).toHaveLength(0);
    expect(d.store.sessions).toHaveLength(0);
  });

  test("a malformed profile file fails with invalid_config before side effects", async () => {
    const d = deps();
    seedProfile(d.fs, PROJECT_AGENTS, "bad.md", "no frontmatter here");
    const result = await createSession(
      d,
      { ...ROOT_INPUT, profile: "reviewer" },
      CTX,
    );
    expectErr(result, "invalid_config");
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.store.sessions).toHaveLength(0);
  });

  test("project profiles override user and builtin (whole-profile replacement)", async () => {
    const d = deps();
    seedProfile(
      d.fs,
      USER_AGENTS,
      "reviewer.md",
      profileFile({ id: "reviewer" }, "user reviewer"),
    );
    seedProfile(
      d.fs,
      PROJECT_AGENTS,
      "reviewer.md",
      profileFile({ id: "reviewer" }, "project reviewer"),
    );
    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, profile: "reviewer" }, CTX),
    );
    expect(session.profileSource).toBe("project");
    expect(d.fs.files.get(PROMPT_PATH)!.contents).toContain("project reviewer");
  });

  test("profile agent/model defaults apply when no explicit input is given", async () => {
    const d = deps();
    seedProfile(
      d.fs,
      PROJECT_AGENTS,
      "claude-rev.md",
      profileFile({ id: "claude-rev", agent: "claude", model: "sonnet" }),
    );
    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, profile: "claude-rev" }, CTX),
    );
    expect(session.agent).toBe("claude");
    expect(session.model).toBe("sonnet");
    const script = d.fs.files.get(LAUNCH_PATH)!.contents;
    expect(script).toContain("export AS_MODEL='sonnet'");
  });

  test("explicit input wins over profile defaults", async () => {
    const d = deps();
    seedProfile(
      d.fs,
      PROJECT_AGENTS,
      "claude-rev.md",
      profileFile({ id: "claude-rev", agent: "claude", model: "sonnet" }),
    );
    const { session } = expectOk(
      await createSession(
        d,
        { ...ROOT_INPUT, profile: "claude-rev", model: "opus" },
        CTX,
      ),
    );
    expect(session.model).toBe("opus");
  });

  test("profile default model is suppressed when explicit agent differs from profile agent", async () => {
    // claude-oriented profile model must not apply to agy (a different Agent).
    const d = deps();
    seedProfile(
      d.fs,
      PROJECT_AGENTS,
      "claude-rev.md",
      profileFile({ id: "claude-rev", agent: "claude", model: "sonnet" }),
    );
    const { session } = expectOk(
      await createSession(
        d,
        { ...ROOT_INPUT, profile: "claude-rev", agent: "agy" },
        CTX,
      ),
    );
    expect(session.agent).toBe("agy");
    // agy is model-unsupported; the suppressed profile model means create still
    // succeeds with no model, and the profile instructions still apply.
    expect(session.model).toBeNull();
    expect(d.fs.files.get(PROMPT_PATH)!.contents).toContain("# Agent Profile");
  });

  test("profile default model on a model-unsupported resolved agent fails before side effects", async () => {
    // No explicit agent: the resolved agent is the profile's agy default, which
    // does not support models, so the profile model is invalid_input up front.
    const d = deps();
    seedProfile(
      d.fs,
      PROJECT_AGENTS,
      "agy-rev.md",
      profileFile({ id: "agy-rev", agent: "agy", model: "sonnet" }),
    );
    const result = await createSession(
      d,
      { ...ROOT_INPUT, profile: "agy-rev" },
      CTX,
    );
    const error = expectErr(result, "invalid_input");
    expect(error.message).toContain("does not support");
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.store.sessions).toHaveLength(0);
  });

  test("paste_prompt delivery sends the effective (profile-shaped) prompt", async () => {
    const config = makeConfig({
      agent: {
        default: "opencode",
        templates: {
          opencode: {
            command: "opencode",
            paste_prompt: true,
            before_paste: [{ type: "wait_ms", ms: 750 }],
          },
        },
      },
    });
    const d = {
      ...deps(),
      configLoader: new FakeConfigLoader({
        kind: "found",
        config,
        configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
      } satisfies ConfigDiscovery),
    };
    expectOk(await createSession(d, { ...ROOT_INPUT, profile: "scout" }, CTX));
    // The final mux send carries the effective prompt, which includes the
    // profile header — not the bare user prompt.
    const sent = d.runner.commands.at(-1)!.command;
    expect(sent).toContain("# Agent Profile");
    expect(sent).toContain("Profile: scout");
    // Paste delivery uses the exact bytes written to prompt.md (single derived
    // promptContents): the full file content appears verbatim in the send.
    const promptContents = d.fs.files.get(PROMPT_PATH)!.contents;
    expect(sent).toContain(promptContents);
  });
});

describe("createSession — repo alias resolution", () => {
  function repoConfigLoader() {
    return new FakeConfigLoader({
      kind: "found",
      config: makeConfig({ repos: { frontend: { path: "./frontend" } } }),
      configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
    } satisfies ConfigDiscovery);
  }

  test("repo alias resolves to cwd under the Workspace root before create side effects", async () => {
    const d = {
      ...deps({
        scopeResolver: workspaceScopeByCwd({
          [`${scopeA.worktreeRoot}/frontend`]: `${scopeA.worktreeRoot}/frontend`,
        }),
      }),
      configLoader: repoConfigLoader(),
    };
    d.fs.dirs.add(`${scopeA.worktreeRoot}/frontend`);

    const { session } = expectOk(
      await createSession(
        d,
        { ...ROOT_INPUT, repo: "frontend" },
        { cwd: scopeA.worktreeRoot },
      ),
    );

    expect(session.cwd).toBe(`${scopeA.worktreeRoot}/frontend`);
    expect(session.worktreeRoot).toBe(`${scopeA.worktreeRoot}/frontend`);
    expect(session.sessionDir).toBe(
      `${scopeA.worktreeRoot}/frontend/.asem/sessions/${FIRST_ID}`,
    );
  });

  test("unknown repo alias fails before create side effects", async () => {
    const d = { ...deps(), configLoader: repoConfigLoader() };
    const result = await createSession(
      d,
      { ...ROOT_INPUT, repo: "missing" },
      CTX,
    );

    expectErr(result, "invalid_input");
    expect(d.runner.commands).toHaveLength(0);
    expect(d.store.sessions).toHaveLength(0);
  });

  test("repo alias path outside the Workspace root is invalid_config", async () => {
    const d = {
      ...deps(),
      configLoader: new FakeConfigLoader({
        kind: "found",
        config: makeConfig({ repos: { outside: { path: "../outside" } } }),
        configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
      } satisfies ConfigDiscovery),
    };
    d.fs.dirs.add("/repo/outside");

    const result = await createSession(
      d,
      { ...ROOT_INPUT, repo: "outside" },
      CTX,
    );

    expectErr(result, "invalid_config");
    expect(d.runner.commands).toHaveLength(0);
    expect(d.store.sessions).toHaveLength(0);
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

  test("--parent <id> can target a parent in the same Workspace from a different Worktree Root", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({
        id: "root_1",
        name: "workspace-root",
        cwd: scopeA.worktreeRoot,
        worktreeRoot: scopeA.worktreeRoot,
      }),
    );
    const d = deps({
      store,
      scopeResolver: workspaceScopeByCwd({
        [scopeA.worktreeRoot]: scopeA.worktreeRoot,
        [scopeB.worktreeRoot]: scopeB.worktreeRoot,
      }),
    });

    const { session } = expectOk(
      await createSession(
        d,
        {
          name: "repo-child",
          prompt: "p",
          cwd: scopeB.worktreeRoot,
          parentSessionId: "root_1",
        },
        CTX,
      ),
    );

    expect(session.workspaceId).toBe(scopeA.workspaceId);
    expect(session.cwd).toBe(scopeB.worktreeRoot);
    expect(session.worktreeRoot).toBe(scopeB.worktreeRoot);
    expect(session.parentSessionId).toBe("root_1");
    expect(session.sessionDir).toBe(
      `${scopeB.worktreeRoot}/.asem/sessions/${FIRST_ID}`,
    );
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

  test("no parent flag can use the Workspace current Session from a different Worktree Root", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({
        id: "cur_1",
        name: "workspace-current",
        cwd: scopeA.worktreeRoot,
        worktreeRoot: scopeA.worktreeRoot,
        tokenHash: hashToken(CURRENT_TOKEN),
      }),
    );
    const d = deps({
      store,
      scopeResolver: workspaceScopeByCwd({
        [scopeA.worktreeRoot]: scopeA.worktreeRoot,
        [scopeB.worktreeRoot]: scopeB.worktreeRoot,
      }),
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: CURRENT_TOKEN,
        scope: scopeA,
      }),
    });

    const { session } = expectOk(
      await createSession(
        d,
        { name: "repo-child", prompt: "p", cwd: scopeB.worktreeRoot },
        CTX,
      ),
    );

    expect(session.workspaceId).toBe(scopeA.workspaceId);
    expect(session.worktreeRoot).toBe(scopeB.worktreeRoot);
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

  test("current Session registered in another Workspace returns scope_mismatch", async () => {
    const d = deps({
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: "ignored",
        scope: { ...scopeB, workspaceId: "ws_2" },
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
      c.command.includes(
        "herdr --session 'asem' workspace close 'herdr-workspace-1'",
      ),
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
          claude: { command: "claude-custom {{prompt_shell}}" },
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

    expect(d.runner.commands[1]!.command).toContain(
      "herdr --session 'asem' workspace create",
    );
    expect(d.fs.files.get(LAUNCH_PATH)!.contents).toContain(
      `claude  "$(cat '${PROMPT_PATH}')"`,
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

describe("createSession — mux template refs", () => {
  function configLoaderWith(config: ReturnType<typeof makeConfig>) {
    return new FakeConfigLoader({
      kind: "found",
      config,
      configPath: `${scopeA.worktreeRoot}/.asem.yaml`,
    } satisfies ConfigDiscovery);
  }

  /** A project-local herdr override whose create captures `pane_id`. */
  function muxConfigWithRefs(refs: Record<string, string>) {
    return makeConfig({
      mux: {
        default: "herdr",
        templates: {
          herdr: {
            create: [
              {
                type: "run",
                command: "my-mux create",
                capture: [{ name: "pane_id", regex: "pane=(.+)", group: 1 }],
              },
            ],
            run_in_pane: [
              { type: "run", command: "my-mux run {{pane_id_shell}}" },
            ],
            refs,
          },
        },
      },
    });
  }

  test("interpolates declared refs from base vars and merges them into muxRef alongside captures", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "pane=p9" }],
    });
    const d = {
      ...deps({ runner }),
      configLoader: configLoaderWith(
        muxConfigWithRefs({ mux_session_name: "asem-{{session_id}}" }),
      ),
    };

    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(session.muxRef).toEqual({
      mux_session_name: `asem-${FIRST_ID}`,
      pane_id: "p9",
    });
  });

  test("a create capture wins over a declared ref with the same name (the capture carries the live coordinate)", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "pane=p9" }],
    });
    const d = {
      ...deps({ runner }),
      configLoader: configLoaderWith(
        muxConfigWithRefs({ pane_id: "declared-{{session_id}}" }),
      ),
    };

    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(session.muxRef).toEqual({ pane_id: "p9" });
  });

  test("a ref referencing an unknown variable returns invalid_template before any side effects", async () => {
    const d = {
      ...deps(),
      configLoader: configLoaderWith(
        muxConfigWithRefs({ bad: "{{no_such_var}}" }),
      ),
    };

    const error = expectErr(
      await createSession(d, ROOT_INPUT, CTX),
      "invalid_template",
    );
    expect(error.details?.kind).toBe("mux");
    expect(d.runner.commands).toHaveLength(0);
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
    expect(d.store.sessions).toHaveLength(0);
  });

  test("builtin zellij records the session name via refs without a fake printf capture step", async () => {
    // write_file is not a command; the only run step is the real zellij create.
    const runner = new FakeTemplateRunner({ commands: [{}] });
    const d = deps({ runner });

    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, mux: "zellij" }, CTX),
    );

    expect(session.muxRef).toEqual({ zellij_session_name: FIRST_ID });
    expect(d.runner.commands.some((c) => c.command.includes("printf"))).toBe(
      false,
    );
  });

  test("builtin tmux records the session name via refs and captures only the pane id", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ stdout: "%7\n" }] });
    const d = deps({ runner });

    const { session } = expectOk(
      await createSession(d, { ...ROOT_INPUT, mux: "tmux" }, CTX),
    );

    expect(session.muxRef).toEqual({
      tmux_session_name: FIRST_ID,
      pane_id: "%7",
    });
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

    // The normal lookup boundary is the Workspace, so either resolved location
    // in the same Workspace can find it; its location metadata still records the
    // target Worktree Root.
    expect(await d.store.getSessionByName(scopeB, "reviewer-1")).not.toBeNull();
    expect(await d.store.getSessionByName(scopeA, "reviewer-1")).not.toBeNull();

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
