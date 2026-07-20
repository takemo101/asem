import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type InstallOptions,
  integrationTargetError,
} from "@asem/integrations";
import { configPathFor, listMessages } from "@asem/ops";
import { FakeTemplateRunner } from "@asem/runtime";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeExecutableResolver,
  FakeFileSystem,
  FakeLivenessProbe,
  FakeScopeResolver,
  type FakeSleeper,
  FakeStore,
  MemoryLogger,
  makeConfig,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";
import { BufferIo } from "../src/io.ts";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, runCli } from "../src/run.ts";
import {
  CWD,
  makeCliFixture,
  makeMessage,
  makeSession,
  SCOPE,
  SCOPE_SIBLING,
  seedCurrentSession,
} from "./helpers.ts";

/** Run one command against fake deps and return io + exit code. */
async function run(argv: string[], deps = makeCliFixture().deps) {
  const io = new BufferIo();
  const code = await runCli({ argv, cwd: CWD, deps, io });
  return { io, code };
}

function requiredAt<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing ${label} at ${index}`);
  return item;
}

function parseJson(text: string): ReturnType<typeof JSON.parse> {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`failed to parse JSON: ${String(error)}\n${text}`);
  }
}

const HERDR_REF = {
  pane_id: "pane-1",
  tab_id: "tab-1",
  herdr_workspace_id: "herdr-workspace-1",
  herdr_session: "asem",
};

describe("runCli help & usage", () => {
  test("no args prints usage and exits 0", async () => {
    const { io, code } = await run([]);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("usage: asem");
  });

  test("--version prints the package version and exits 0", async () => {
    const { io, code } = await run(["--version"]);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toBe("0.1.7");
    expect(io.errText()).toBe("");
  });

  test("-v prints the package version and exits 0", async () => {
    const { io, code } = await run(["-v"]);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toBe("0.1.7");
    expect(io.errText()).toBe("");
  });

  test("unknown command exits with usage code and structured error", async () => {
    const { io, code } = await run(["frob"]);
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
  });

  test("invalid input (bad mux-ref) exits with usage code", async () => {
    const { code } = await run([
      "init-session",
      "--name",
      "x",
      "--mux-ref",
      "nope",
    ]);
    expect(code).toBe(EXIT_USAGE);
  });

  test("root help is grouped into scannable sections with workflows", async () => {
    const { io, code } = await run(["--help"]);
    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    for (const heading of [
      "Common workflows:",
      "Setup:",
      "Sessions:",
      "Messages:",
      "Surfaces:",
    ]) {
      expect(out).toContain(heading);
    }
    // The workflow block names the first-run sequence.
    expect(out).toContain("asem init --interactive");
    expect(out).toContain("asem doctor");
    expect(out).toContain("asem init-session");
    expect(out).toContain("asem session create");
    expect(out).toContain("asem tui");
  });

  test("group help shows focused subcommands, not the root command map", async () => {
    const { io, code } = await run(["session", "--help"]);
    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("asem session <subcommand>");
    expect(out).toContain("create");
    expect(out).toContain("attach");
    // Group help must not fall back to the root listing's other groups.
    expect(out).not.toContain("Surfaces:");
  });

  test("message and report group help are focused on their nouns", async () => {
    const message = await run(["message", "--help"]);
    expect(message.code).toBe(EXIT_OK);
    expect(message.io.outText()).toContain("asem message <subcommand>");

    const report = await run(["report", "--help"]);
    expect(report.code).toBe(EXIT_OK);
    expect(report.io.outText()).toContain("asem report <subcommand>");
  });

  test("subcommand help separates usage, required, options, and examples", async () => {
    const { io, code } = await run(["session", "create", "--help"]);
    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("asem session create <name> --prompt <text>");
    expect(out).toContain("required:");
    expect(out).toContain("--prompt <text>");
    expect(out).toContain("options:");
    expect(out).toContain("examples:");
  });

  test("message wait help documents the cursor-required Inbox wait", async () => {
    const { io, code } = await run(["message", "wait", "--help"]);
    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("asem message wait --cursor <cursor>");
    expect(out).toContain("--timeout-ms");
    expect(out).not.toContain("--kind");
    expect(out).not.toContain("--poll-ms");
  });

  test("doctor renders focused help", async () => {
    const { io, code } = await run(["doctor", "--help"]);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain(
      "asem doctor — check local Agent and Multiplexer command availability",
    );
    expect(io.outText()).toContain("Missing executables are diagnostics");
  });

  test("init and init-session each render their own focused page", async () => {
    const init = await run(["init", "--help"]);
    expect(init.code).toBe(EXIT_OK);
    expect(init.io.outText()).toContain("asem init — initialize an asem");

    const initSession = await run(["init-session", "--help"]);
    expect(initSession.code).toBe(EXIT_OK);
    expect(initSession.io.outText()).toContain("--mux-ref");
  });

  test("tui --help exits 0 and shows TUI-specific scope help", async () => {
    const { io, code } = await run(["tui", "--help"]);
    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("asem tui — open the human Cockpit");
    expect(out).toContain("--scope worktree");
    expect(out).toContain("--scope workspace");
    expect(out).toContain("(default)");
  });

  test("mcp --help exits 0 and describes the AI-facing server", async () => {
    const { io, code } = await run(["mcp", "--help"]);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("asem mcp — start the AI-facing MCP server");
  });

  test("an unknown option still errors instead of printing help", async () => {
    const { io, code } = await run(["session", "list", "--bogus"]);
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
  });
});

describe("runCli doctor", () => {
  test("renders availability and exits 0 even with missing executables", async () => {
    const { deps } = makeCliFixture();
    const executableResolver = new FakeExecutableResolver()
      .set("herdr", "/bin/herdr")
      .set("claude", "/bin/claude");
    deps.executableResolver = executableResolver;

    const io = new BufferIo();
    const code = await runCli({ argv: ["doctor"], cwd: CWD, deps, io });

    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("asem doctor");
    expect(out).toContain("Config: /repo/.asem.yaml");
    expect(out).toContain("Workspace: ws_1");
    expect(out).toContain("Multiplexers:");
    expect(out).toContain("ok       herdr");
    expect(out).toContain("missing  rmux");
    expect(out).toContain("Agents:");
    expect(out).toContain("ok       claude");
    expect(out).toContain("missing  codex");
  });

  test("renders json availability", async () => {
    const { deps } = makeCliFixture();
    const executableResolver = new FakeExecutableResolver().set(
      "rmux",
      "/bin/rmux",
    );
    deps.executableResolver = executableResolver;

    const io = new BufferIo();
    const code = await runCli({
      argv: ["doctor", "--json"],
      cwd: CWD,
      deps,
      io,
    });

    expect(code).toBe(EXIT_OK);
    const parsed = parseJson(io.outText());
    expect(parsed.config.kind).toBe("found");
    expect(
      parsed.multiplexers.find(
        (c: { template: string }) => c.template === "rmux",
      ),
    ).toMatchObject({
      status: "ok",
      path: "/bin/rmux",
    });
  });
});

describe("runCli init", () => {
  test("creates config and renders the path", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--workspace", "ws-new"],
      cwd: CWD,
      deps,
      io,
    });
    expect(code).toBe(EXIT_OK);
    const configPath = configPathFor(CWD);
    const out = io.outText();
    expect(out).toContain(configPath);
    expect(out).toContain("Next steps:");
    expect(out).toContain("asem init-session");
    expect(out).toContain("asem session create");
    expect(out).toContain("asem tui");
    // The operation — not the CLI — performed the write.
    expect(await deps.fs.exists(configPath)).toBe(true);
  });

  test("non-interactive init materializes selected builtin templates", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--workspace", "ws-new", "--agent", "pi", "--mux", "tmux"],
      cwd: CWD,
      deps,
      io,
    });

    expect(code).toBe(EXIT_OK);
    const config = await deps.fs.readFile(configPathFor(CWD));
    expect(config).toContain("default: tmux");
    expect(config).toContain("default: pi");
    expect(config).toContain("tmux new-session");
    expect(config).toContain("attach_command");
    expect(config).toContain('command: "pi {{model_shell}} {{prompt_shell}}"');
  });

  test("interactive init in non-TTY exits with guidance", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive"],
      cwd: CWD,
      deps,
      io,
      isTty: false,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("interactive init requires a TTY");
    expect(await deps.fs.exists(configPathFor(CWD))).toBe(false);
  });

  test("interactive init cancellation exits 0 and writes no config", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--workspace", "ws-new"],
      cwd: CWD,
      deps,
      io,
      isTty: true,
      prompts: {
        input: async () => "ws-new",
        checkbox: async <T extends string>() => ["pi"] as T[],
        select: async <T extends string>() => "pi" as T,
        confirm: async () => false,
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("cancelled; no files changed");
    expect(await deps.fs.exists(configPathFor(CWD))).toBe(false);
  });

  test("interactive init materializes every selected template, sorted and deduped", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--workspace", "ws-new"],
      cwd: CWD,
      deps,
      io,
      isTty: true,
      prompts: {
        input: async () => "ws-new",
        checkbox: async <T extends string>(prompt: {
          message: string;
        }): Promise<T[]> =>
          (prompt.message.includes("Agent")
            ? ["pi", "claude"]
            : ["tmux", "herdr"]) as T[],
        select: async <T extends string>(prompt: {
          message: string;
        }): Promise<T> =>
          (prompt.message.includes("Agent") ? "pi" : "tmux") as T,
        confirm: async () => true,
      },
    });

    expect(code).toBe(EXIT_OK);
    const config = await deps.fs.readFile(configPathFor(CWD));
    expect(config).toContain("default: pi");
    expect(config).toContain("default: tmux");
    // both agent templates present, builtin-name ascending order
    const claudeAt = config.indexOf("claude:");
    const piAt = config.indexOf("pi:");
    expect(claudeAt).toBeGreaterThan(-1);
    expect(piAt).toBeGreaterThan(-1);
    expect(claudeAt).toBeLessThan(piAt);
    // both mux templates present
    expect(config).toContain("herdr:");
    expect(config).toContain("tmux:");
    expect(config).toContain('command: "pi {{model_shell}} {{prompt_shell}}"');
    expect(config).toContain(
      'command: "claude {{model_shell}} {{prompt_shell}}"',
    );
    // no duplicate template keys
    expect(config.split("\n").filter((l) => l.trim() === "pi:")).toHaveLength(
      1,
    );
  });

  test("plain init leaves an existing config untouched without requiring workspace", async () => {
    const { deps } = makeCliFixture();
    await deps.fs.writeFileAtomic(
      configPathFor(CWD),
      "workspace:\n  id: existing\n",
    );
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init"],
      cwd: CWD,
      deps,
      io,
    });

    expect(code).toBe(EXIT_OK);
    expect(await deps.fs.readFile(configPathFor(CWD))).toBe(
      "workspace:\n  id: existing\n",
    );
    expect(await deps.fs.exists(`${CWD}/.gitignore`)).toBe(true);
    expect(io.outText()).toContain("left existing config unchanged");
    expect(io.outText()).toContain("ensured runtime ignore rules");
  });

  test("interactive init leaves an existing config untouched without prompting", async () => {
    const { deps } = makeCliFixture();
    await deps.fs.writeFileAtomic(
      configPathFor(CWD),
      "workspace:\n  id: existing\n",
    );
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--agent", "does-not-matter"],
      cwd: CWD,
      deps,
      io,
      isTty: true,
      prompts: {
        input: async () => {
          throw new Error("should not prompt");
        },
        checkbox: async () => {
          throw new Error("should not prompt");
        },
        select: async () => {
          throw new Error("should not prompt");
        },
        confirm: async () => {
          throw new Error("should not prompt");
        },
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(await deps.fs.readFile(configPathFor(CWD))).toBe(
      "workspace:\n  id: existing\n",
    );
    expect(await deps.fs.exists(`${CWD}/.gitignore`)).toBe(true);
    const out = io.outText();
    expect(out).toContain("left existing config unchanged");
    expect(out).toContain("ensured runtime ignore rules");
    expect(out).not.toContain("Next steps:");
  });

  test("interactive init with existing config no-ops even when non-TTY", async () => {
    const { deps } = makeCliFixture();
    await deps.fs.writeFileAtomic(
      configPathFor(CWD),
      "workspace:\n  id: existing\n",
    );
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--agent", "not-an-agent"],
      cwd: CWD,
      deps,
      io,
      isTty: false,
    });

    expect(code).toBe(EXIT_OK);
    expect(await deps.fs.readFile(configPathFor(CWD))).toBe(
      "workspace:\n  id: existing\n",
    );
    expect(io.outText()).toContain("left existing config unchanged");
    expect(io.errText()).toBe("");
  });

  test("interactive init validates preselected agent before prompting", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--agent", "not-an-agent"],
      cwd: CWD,
      deps,
      io,
      isTty: true,
      prompts: {
        input: async () => {
          throw new Error("should not prompt");
        },
        checkbox: async () => {
          throw new Error("should not prompt");
        },
        select: async () => {
          throw new Error("should not prompt");
        },
        confirm: async () => {
          throw new Error("should not prompt");
        },
      },
    });

    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("unknown agent template");
    expect(io.errText()).toContain("pi");
    expect(await deps.fs.exists(configPathFor(CWD))).toBe(false);
  });

  test("interactive init validates preselected mux before prompting", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--mux", "not-a-mux"],
      cwd: CWD,
      deps,
      io,
      isTty: true,
      prompts: {
        input: async () => {
          throw new Error("should not prompt");
        },
        checkbox: async () => {
          throw new Error("should not prompt");
        },
        select: async () => {
          throw new Error("should not prompt");
        },
        confirm: async () => {
          throw new Error("should not prompt");
        },
      },
    });

    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("unknown mux template");
    expect(io.errText()).toContain("tmux");
    expect(await deps.fs.exists(configPathFor(CWD))).toBe(false);
  });
});

describe("runCli init-session", () => {
  test("prints the four shell exports without leaking the token to logs", async () => {
    const logger = new MemoryLogger();
    const deps = makeOpsDeps({
      scopeResolver: new FakeScopeResolver(SCOPE),
      logger,
    });
    const io = new BufferIo();
    const code = await runCli({
      argv: [
        "init-session",
        "--name",
        "reviewer-1",
        "--root",
        "--mux-ref",
        '{"pane":"p1"}',
      ],
      cwd: CWD,
      deps,
      io,
    });
    expect(code).toBe(EXIT_OK);

    const out = io.outText();
    expect(out).toContain("export AS_SESSION_ID=");
    expect(out).toContain("export AS_SESSION_TOKEN=");
    expect(out).toContain("export AS_WORKSPACE_ID=");
    expect(out).toContain("export AS_WORKTREE_ROOT=");

    // FakeTokenGenerator emits tok_0001; it must reach stdout exports only —
    // never the logger or stderr (implementation principle 8).
    const token = "tok_0001";
    expect(out).toContain(token);
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toContain(token);
    expect(io.errText()).not.toContain(token);
  });

  test("--json prints token + identity fields as JSON", async () => {
    const deps = makeOpsDeps({ scopeResolver: new FakeScopeResolver(SCOPE) });
    const io = new BufferIo();
    const code = await runCli({
      argv: [
        "init-session",
        "--name",
        "helper-1",
        "--root",
        "--mux-ref",
        "{}",
        "--json",
      ],
      cwd: CWD,
      deps,
      io,
    });
    expect(code).toBe(EXIT_OK);
    const parsed = parseJson(io.outText());
    expect(parsed).toMatchObject({
      workspaceId: SCOPE.workspaceId,
      worktreeRoot: SCOPE.worktreeRoot,
    });
    expect(typeof parsed.token).toBe("string");
    expect(typeof parsed.sessionId).toBe("string");
  });
});

describe("runCli session create", () => {
  /** Minimal `herdr workspace create` JSON the builtin herdr mux template captures. */
  const HERDR_CREATE_JSON = JSON.stringify({
    result: {
      workspace: { workspace_id: "herdr-workspace-1" },
      root_pane: { pane_id: "pane-1" },
      tab: { tab_id: "tab-1" },
    },
  });

  /** Deps whose mux `create` step yields capturable refs so a launch succeeds. */
  function createDeps(options: { store?: FakeStore } = {}) {
    const store = options.store ?? new FakeStore();
    const deps = makeOpsDeps({
      store,
      configLoader: new FakeConfigLoader(),
      scopeResolver: new FakeScopeResolver(SCOPE),
      currentSessionResolver: new FakeCurrentSessionResolver(null),
      templateRunner: new FakeTemplateRunner({
        commands: [{ stdout: "asem" }, { stdout: HERDR_CREATE_JSON }],
      }),
    });
    return { deps, store };
  }

  test("delegates to createSession and renders the created Session", async () => {
    const { deps, store } = createDeps();
    const { io, code } = await run(
      ["session", "create", "reviewer-1", "--prompt", "do it", "--root"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("created reviewer-1");
    expect(io.outText()).toContain("running");
    // The operation — not the CLI — persisted the Session.
    expect(store.sessions).toHaveLength(1);
    const session = requiredAt(store.sessions, 0, "session");
    expect(session.name).toBe("reviewer-1");
    expect(session.parentSessionId).toBeNull();
  });

  test("--model passes through to createSession and is rendered/persisted", async () => {
    const { deps, store } = createDeps();
    const { io, code } = await run(
      [
        "session",
        "create",
        "reviewer-1",
        "--prompt",
        "do it",
        "--root",
        "--model",
        "sonnet",
        "--json",
      ],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(parseJson(io.outText())).toMatchObject({ model: "sonnet" });
    expect(store.sessions[0]?.model).toBe("sonnet");
  });

  test("--profile shapes prompt.md and persists profile/profileSource", async () => {
    const { deps, store } = createDeps();
    const { io, code } = await run(
      [
        "session",
        "create",
        "reviewer-1",
        "--prompt",
        "do it",
        "--root",
        "--profile",
        "reviewer",
        "--json",
      ],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(parseJson(io.outText())).toMatchObject({
      profile: "reviewer",
      profileSource: "builtin",
    });
    expect(store.sessions[0]?.profile).toBe("reviewer");
    expect(store.sessions[0]?.profileSource).toBe("builtin");
  });

  test("--profile with an unknown id fails as a usage error", async () => {
    const { deps, store } = createDeps();
    const { code } = await run(
      [
        "session",
        "create",
        "reviewer-1",
        "--prompt",
        "do it",
        "--root",
        "--profile",
        "does-not-exist",
      ],
      deps,
    );
    expect(code).toBe(EXIT_USAGE);
    expect(store.sessions).toHaveLength(0);
  });

  test("--model against a model-unsupported Agent Template fails as usage error", async () => {
    const { deps, store } = createDeps();
    const { io, code } = await run(
      [
        "session",
        "create",
        "reviewer-1",
        "--prompt",
        "do it",
        "--root",
        "--agent",
        "agy",
        "--model",
        "sonnet",
      ],
      deps,
    );
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("does not support");
    expect(store.sessions).toHaveLength(0);
  });

  test("--parent <id> launches under an explicit in-scope parent", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "p_1", name: "parent" }));
    const { deps } = createDeps({ store });

    const { io, code } = await run(
      ["session", "create", "child-1", "--prompt", "go", "--parent", "p_1"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("parent: p_1");
    const child = store.sessions.find((s) => s.name === "child-1");
    expect(child?.parentSessionId).toBe("p_1");
  });

  test("--json prints the created Session as JSON", async () => {
    const { deps } = createDeps();
    const { io, code } = await run(
      ["session", "create", "helper-1", "--prompt", "x", "--root", "--json"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    const parsed = parseJson(io.outText());
    expect(parsed).toMatchObject({
      name: "helper-1",
      status: "running",
      parentSessionId: null,
      workspaceId: SCOPE.workspaceId,
      worktreeRoot: SCOPE.worktreeRoot,
    });
  });

  test("no parent flag and no current Session surfaces a structured error", async () => {
    const { deps, store } = createDeps();
    const { io, code } = await run(
      ["session", "create", "orphan", "--prompt", "x"],
      deps,
    );
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("current_session_not_found");
    // A failed create must never leave a Session row (principle 5).
    expect(store.sessions).toHaveLength(0);
  });

  test("a same-scope name conflict surfaces session_name_conflict (exit 1)", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "dup" }));
    const { deps } = createDeps({ store });

    const { io, code } = await run(
      ["session", "create", "dup", "--prompt", "x", "--root"],
      deps,
    );
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_name_conflict");
  });
});

describe("runCli session create --repo", () => {
  const HERDR_CREATE_JSON = JSON.stringify({
    result: {
      workspace: { workspace_id: "herdr-workspace-1" },
      root_pane: { pane_id: "pane-1" },
      tab: { tab_id: "tab-1" },
    },
  });

  /**
   * Deps whose root `.asem.yaml` declares repo aliases and whose filesystem has
   * the resolved repo directory (and a non-directory file) registered.
   */
  function repoDeps(options: { store?: FakeStore } = {}) {
    const store = options.store ?? new FakeStore();
    const fs = new FakeFileSystem();
    fs.dirs.add("/repo/frontend");
    fs.files.set("/repo/notes.txt", { contents: "x" });
    const deps = makeOpsDeps({
      store,
      fs,
      configLoader: new FakeConfigLoader({
        kind: "found",
        config: makeConfig({
          repos: {
            frontend: { path: "./frontend" },
            ghost: { path: "./ghost" },
            notes: { path: "./notes.txt" },
          },
        }),
        configPath: "/repo/.asem.yaml",
      }),
      scopeResolver: new FakeScopeResolver(SCOPE),
      currentSessionResolver: new FakeCurrentSessionResolver(null),
      templateRunner: new FakeTemplateRunner({
        commands: [{ stdout: "asem" }, { stdout: HERDR_CREATE_JSON }],
      }),
    });
    return { deps, store };
  }

  test("resolves the alias path and creates a Session scoped to it", async () => {
    const { deps, store } = repoDeps();
    const { io, code } = await run(
      [
        "session",
        "create",
        "fe-parent",
        "--repo",
        "frontend",
        "--root",
        "--prompt",
        "go",
        "--json",
      ],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    const session = parseJson(io.outText());
    expect(session.cwd).toBe("/repo/frontend");
    // The operation persisted it with the resolved repo path as the cwd.
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]?.cwd).toBe("/repo/frontend");
    // Workspace id still comes from the alias-declaring root config.
    expect(store.sessions[0]?.workspaceId).toBe(SCOPE.workspaceId);
  });

  test("unknown alias fails as a usage error before any side effects", async () => {
    const { deps, store } = repoDeps();
    const { io, code } = await run(
      [
        "session",
        "create",
        "x",
        "--repo",
        "backend",
        "--root",
        "--prompt",
        "go",
      ],
      deps,
    );
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
    expect(store.sessions).toHaveLength(0);
  });

  test("missing repo path fails before any side effects", async () => {
    const { deps, store } = repoDeps();
    const { io, code } = await run(
      ["session", "create", "x", "--repo", "ghost", "--root", "--prompt", "go"],
      deps,
    );
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("invalid_config");
    expect(store.sessions).toHaveLength(0);
  });

  test("a non-directory repo path fails before any side effects", async () => {
    const { deps, store } = repoDeps();
    const { io, code } = await run(
      ["session", "create", "x", "--repo", "notes", "--root", "--prompt", "go"],
      deps,
    );
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("invalid_config");
    expect(store.sessions).toHaveLength(0);
  });
});

describe("runCli run", () => {
  const HERDR_CREATE_JSON = JSON.stringify({
    result: {
      workspace: { workspace_id: "herdr-workspace-1" },
      root_pane: { pane_id: "pane-1" },
      tab: { tab_id: "tab-1" },
    },
  });

  /** Deps whose mux `create` step yields capturable refs so a launch succeeds. */
  function runDeps(options: { store?: FakeStore } = {}) {
    const store = options.store ?? new FakeStore();
    const fs = new FakeFileSystem();
    const deps = makeOpsDeps({
      store,
      fs,
      configLoader: new FakeConfigLoader(),
      scopeResolver: new FakeScopeResolver(SCOPE),
      currentSessionResolver: new FakeCurrentSessionResolver(null),
      templateRunner: new FakeTemplateRunner({
        commands: [{ stdout: "asem" }, { stdout: HERDR_CREATE_JSON }],
      }),
    });
    return { deps, store, fs };
  }

  /** Run `asem run …` with explicit TTY state and an optional attach runner. */
  async function runRun(
    argv: string[],
    deps: ReturnType<typeof runDeps>["deps"],
    options: {
      isTty?: boolean;
      attachRunner?: (command: { argv: string[] }) => Promise<number>;
    } = {},
  ) {
    const io = new BufferIo();
    const code = await runCli({
      argv,
      cwd: CWD,
      deps,
      io,
      isTty: options.isTty ?? false,
      ...(options.attachRunner !== undefined
        ? { attachRunner: options.attachRunner }
        : {}),
    });
    return { io, code };
  }

  test("creates a root Session whose name defaults to the agent", async () => {
    const { deps, store } = runDeps();
    const { io, code } = await runRun(["run", "claude"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("created claude");
    expect(store.sessions).toHaveLength(1);
    const session = requiredAt(store.sessions, 0, "session");
    expect(session.name).toBe("claude");
    expect(session.agent).toBe("claude");
    // Every run-created Session is root; there is no parent inference.
    expect(session.parentSessionId).toBeNull();
  });

  test("--name overrides the default Session name", async () => {
    const { deps, store } = runDeps();
    const { code } = await runRun(["run", "claude", "--name", "helper"], deps);
    expect(code).toBe(EXIT_OK);
    expect(store.sessions[0]?.name).toBe("helper");
  });

  test("an unknown agent fails the exact Template lookup with no Session", async () => {
    const { deps, store } = runDeps();
    const { io, code } = await runRun(["run", "ghost"], deps);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("agent_template_not_found");
    expect(store.sessions).toHaveLength(0);
  });

  test("a duplicate default name surfaces session_name_conflict", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "claude" }));
    const { deps } = runDeps({ store });
    const { io, code } = await runRun(["run", "claude"], deps);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_name_conflict");
    expect(store.sessions).toHaveLength(1);
  });

  test("writes the English bootstrap prompt without a User request section", async () => {
    const { deps, fs } = runDeps();
    const { code } = await runRun(["run", "claude"], deps);
    expect(code).toBe(EXIT_OK);
    const prompt = fs.files.get(
      `${SCOPE.worktreeRoot}/.asem/sessions/s_0001/prompt.md`,
    )?.contents;
    if (prompt === undefined) throw new Error("prompt.md not written");
    // The bootstrap teaches the shipped Message protocol in stable English.
    expect(prompt).toContain("root asem Session");
    expect(prompt).toContain("asem session create");
    expect(prompt).toContain("asem message list --inbox");
    expect(prompt).toContain("asem message wait --cursor");
    expect(prompt).not.toContain("## User request");
  });

  test("--prompt appends a User request section after the bootstrap", async () => {
    const { deps, fs } = runDeps();
    const { code } = await runRun(
      ["run", "claude", "--prompt", "fix the flaky build"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    const prompt = fs.files.get(
      `${SCOPE.worktreeRoot}/.asem/sessions/s_0001/prompt.md`,
    )?.contents;
    if (prompt === undefined) throw new Error("prompt.md not written");
    expect(prompt).toContain("## User request");
    expect(prompt).toContain("fix the flaky build");
    // Bootstrap first, user request second.
    expect(prompt.indexOf("root asem Session")).toBeLessThan(
      prompt.indexOf("## User request"),
    );
  });

  test("a TTY auto-attaches after a successful create", async () => {
    const { deps } = runDeps();
    const commands: string[][] = [];
    const { code } = await runRun(["run", "claude"], deps, {
      isTty: true,
      attachRunner: async (command) => {
        commands.push(command.argv);
        return EXIT_OK;
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(commands).toHaveLength(1);
  });

  test("--no-attach skips the attach even on a TTY", async () => {
    const { deps, store } = runDeps();
    const commands: string[][] = [];
    const { code } = await runRun(["run", "claude", "--no-attach"], deps, {
      isTty: true,
      attachRunner: async (command) => {
        commands.push(command.argv);
        return EXIT_OK;
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(commands).toHaveLength(0);
    expect(store.sessions).toHaveLength(1);
  });

  test("a non-TTY never attaches", async () => {
    const { deps, store } = runDeps();
    const commands: string[][] = [];
    const { code } = await runRun(["run", "claude"], deps, {
      isTty: false,
      attachRunner: async (command) => {
        commands.push(command.argv);
        return EXIT_OK;
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(commands).toHaveLength(0);
    expect(store.sessions).toHaveLength(1);
  });

  test("attach failure preserves the Session and returns nonzero", async () => {
    const { deps, store } = runDeps();
    const { io, code } = await runRun(["run", "claude"], deps, {
      isTty: true,
      attachRunner: async () => 3,
    });
    expect(code).toBe(3);
    // The created Session must survive a failed attach.
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]?.status).toBe("running");
    expect(io.errText()).toContain("attach");
  });
});

describe("runCli workspace repo list", () => {
  /** Deps whose root config declares aliases; store throws if touched. */
  function listDeps() {
    const fs = new FakeFileSystem();
    fs.dirs.add("/repo/frontend");
    const throwingStore = new Proxy({} as FakeStore, {
      get() {
        throw new Error("workspace repo list must not touch Session state");
      },
    });
    return makeOpsDeps({
      store: throwingStore,
      fs,
      configLoader: new FakeConfigLoader({
        kind: "found",
        config: makeConfig({
          repos: {
            frontend: { path: "./frontend" },
            ghost: { path: "./ghost" },
          },
        }),
        configPath: "/repo/.asem.yaml",
      }),
    });
  }

  test("lists aliases with configured path, resolved path, and status", async () => {
    const { io, code } = await run(["workspace", "repo", "list"], listDeps());
    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("frontend");
    expect(out).toContain("./frontend");
    expect(out).toContain("/repo/frontend");
    expect(out).toContain("ghost");
  });

  test("--json reports alias, paths, and status without touching the store", async () => {
    const { io, code } = await run(
      ["workspace", "repo", "list", "--json"],
      listDeps(),
    );
    expect(code).toBe(EXIT_OK);
    const parsed = parseJson(io.outText());
    expect(parsed).toEqual([
      {
        alias: "frontend",
        configuredPath: "./frontend",
        resolvedPath: "/repo/frontend",
        exists: true,
        directory: true,
      },
      {
        alias: "ghost",
        configuredPath: "./ghost",
        resolvedPath: "/repo/ghost",
        exists: false,
        directory: false,
      },
    ]);
  });

  test("renders an empty notice when no repo aliases are configured", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({
        kind: "found",
        config: makeConfig(),
        configPath: "/repo/.asem.yaml",
      }),
    });
    const { io, code } = await run(["workspace", "repo", "list"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("no repo aliases");
  });

  test("surfaces config_not_found when no config is discovered", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    const { io, code } = await run(["workspace", "repo", "list"], deps);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("config_not_found");
  });
});

describe("runCli profile list/get", () => {
  test("profile list renders builtin profiles with id, source, agent, model", async () => {
    const { io, code } = await run(["profile", "list"]);
    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("reviewer");
    expect(out).toContain("[builtin]");
    // agent/model columns are always shown (design lists them), `-` when null.
    expect(out).toContain("agent=-");
    expect(out).toContain("model=-");
  });

  test("profile list --json returns the resolved profiles", async () => {
    const { io, code } = await run(["profile", "list", "--json"]);
    expect(code).toBe(EXIT_OK);
    const profiles = parseJson(io.outText());
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.map((p: { id: string }) => p.id)).toContain("scout");
  });

  test("profile get renders metadata and full instructions", async () => {
    const { io, code } = await run(["profile", "get", "reviewer"]);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("id:          reviewer");
    expect(io.outText()).toContain("source:      builtin");
    expect(io.outText()).toContain("instructions:");
  });

  test("profile get with an unknown id fails as a usage error", async () => {
    const { code } = await run(["profile", "get", "nope"]);
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("runCli session list/get", () => {
  test("renders one row per session in scope", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ name: "alpha" }),
      makeSession({ name: "beta" }),
    );
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "list"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("alpha");
    expect(io.outText()).toContain("beta");
  });

  test("lists sessions from sibling worktrees in the same Workspace", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "here" }));
    store.sessions.push(
      makeSession({
        name: "there",
        workspaceId: SCOPE_SIBLING.workspaceId,
        worktreeRoot: SCOPE_SIBLING.worktreeRoot,
      }),
    );
    const { deps } = makeCliFixture({ store });

    const { io } = await run(["session", "list"], deps);
    expect(io.outText()).toContain("here");
    expect(io.outText()).toContain("there");
  });

  test("empty scope renders a friendly message", async () => {
    const { io } = await run(["session", "list"]);
    expect(io.outText()).toContain("no sessions in scope");
  });

  test("--refresh delegates liveness to the probe (no CLI-side status logic)", async () => {
    const store = new FakeStore();
    const s = makeSession({ status: "running" });
    store.sessions.push(s);
    const probe = new FakeLivenessProbe().set(s.id, "exited");
    const deps = makeOpsDeps({
      store,
      scopeResolver: new FakeScopeResolver(SCOPE),
      livenessProbe: probe,
    });

    const { io } = await run(["session", "get", s.id, "--refresh"], deps);
    expect(probe.probed).toEqual([s.id]);
    expect(io.outText()).toContain("exited");
  });

  test("get renders detail and omits the token hash", async () => {
    const store = new FakeStore();
    const s = makeSession({
      name: "detail-1",
      tokenHash: "sha256:secret-hash",
    });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "get", s.id], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("detail-1");
    expect(io.outText()).not.toContain("secret-hash");
  });

  test("get of an unknown id surfaces session_not_found (exit 1)", async () => {
    const { io, code } = await run(["session", "get", "ghost"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli session peek", () => {
  function peekDeps(store: FakeStore, runner: FakeTemplateRunner) {
    return makeOpsDeps({
      store,
      templateRunner: runner,
      scopeResolver: new FakeScopeResolver(SCOPE),
      configLoader: new FakeConfigLoader({
        kind: "found",
        config: makeConfig({
          mux: {
            default: "herdr",
            templates: {
              herdr: {
                peek: [
                  {
                    type: "run",
                    command: "peek {{pane_id}} {{peek_source}} {{peek_lines}}",
                  },
                ],
              },
            },
          },
        }),
        configPath: "/repo/.asem.yaml",
      }),
    });
  }

  test("prints snapshot content only by default", async () => {
    const store = new FakeStore();
    const s = makeSession({ muxRef: { pane_id: "p1" } });
    store.sessions.push(s);
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "child output\n" }],
    });

    const { io, code } = await run(
      ["session", "peek", s.id],
      peekDeps(store, runner),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toBe("child output\n");
    expect(runner.commands[0]?.command).toBe("peek p1 recent-unwrapped 80");
  });

  test("preserves content without adding a trailing newline", async () => {
    const store = new FakeStore();
    const s = makeSession({ muxRef: { pane_id: "p1" } });
    store.sessions.push(s);
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "no trailing newline" }],
    });

    const { io, code } = await run(
      ["session", "peek", s.id],
      peekDeps(store, runner),
    );

    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toBe("no trailing newline");
  });

  test("rejects an invalid source as usage", async () => {
    const { io, code } = await run([
      "session",
      "peek",
      "s_1",
      "--source",
      "tail",
    ]);

    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
    expect(io.errText()).toContain("--source");
  });

  test("rejects an invalid lines value as usage", async () => {
    const { io, code } = await run([
      "session",
      "peek",
      "s_1",
      "--lines",
      "abc",
    ]);

    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
    expect(io.errText()).toContain("lines");
  });

  test("rejects too many lines through operation validation", async () => {
    const store = new FakeStore();
    const s = makeSession({ muxRef: { pane_id: "p1" } });
    store.sessions.push(s);
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "should not run" }],
    });

    const { io, code } = await run(
      ["session", "peek", s.id, "--lines", "301"],
      peekDeps(store, runner),
    );

    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
    expect(runner.commands).toHaveLength(0);
  });

  test("renders structured json when requested", async () => {
    const store = new FakeStore();
    const s = makeSession({ muxRef: { pane_id: "p1" } });
    store.sessions.push(s);
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "visible" }],
    });

    const { io, code } = await run(
      [
        "session",
        "peek",
        s.id,
        "--source",
        "visible",
        "--lines",
        "12",
        "--json",
      ],
      peekDeps(store, runner),
    );

    expect(code).toBe(EXIT_OK);
    const parsed = parseJson(io.outText());
    expect(parsed).toMatchObject({
      session: { id: s.id },
      source: "visible",
      lines: 12,
      content: "visible",
    });
  });
});

describe("runCli session attach", () => {
  test("renders human attach guidance via get_session (no MCP attach)", async () => {
    const store = new FakeStore();
    const s = makeSession({ name: "att-1", mux: "tmux" });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "attach", s.id], deps);
    expect(code).toBe(EXIT_OK);
    // No attach operation exists; the CLI renders what get_session returns.
    expect(io.outText()).toContain(s.id);
    expect(io.outText()).toContain("tmux");
  });

  test("renders the rendered attach hint when no attach runner is injected", async () => {
    const store = new FakeStore();
    const s = makeSession({ mux: "herdr", muxRef: HERDR_REF });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "attach", s.id], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("herdr --session 'asem'");
    expect(io.outText()).toContain("workspace focus 'herdr-workspace-1'");
    expect(io.outText()).toContain("tab focus 'tab-1'");
    expect(io.outText()).toContain("exec herdr session attach 'asem'");
  });

  test("executes the rendered attach hint when an attach runner is injected", async () => {
    const store = new FakeStore();
    const s = makeSession({ mux: "herdr", muxRef: HERDR_REF });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });
    const io = new BufferIo();
    const commands: string[][] = [];

    const code = await runCli({
      argv: ["session", "attach", s.id],
      cwd: CWD,
      deps,
      io,
      attachRunner: async (command) => {
        commands.push(command.argv);
        return EXIT_OK;
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toBe("");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual([
      "sh",
      "-c",
      "herdr --session 'asem' workspace focus 'herdr-workspace-1' >/dev/null && herdr --session 'asem' tab focus 'tab-1' >/dev/null && if [ \"$" +
        "{HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach 'asem'; fi",
    ]);
  });

  test("propagates the attach runner's external exit code", async () => {
    const store = new FakeStore();
    const s = makeSession({ mux: "herdr", muxRef: HERDR_REF });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });
    const io = new BufferIo();

    const code = await runCli({
      argv: ["session", "attach", s.id],
      cwd: CWD,
      deps,
      io,
      attachRunner: async () => 5,
    });

    // The external attach process's exit status is the command's exit status.
    expect(code).toBe(5);
  });

  test("attach of an unknown id surfaces session_not_found (exit 1)", async () => {
    const { code, io } = await run(["session", "attach", "ghost"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli session close", () => {
  test("delegates to close_session and renders the closed result", async () => {
    const store = new FakeStore();
    const s = makeSession({
      name: "to-close",
      mux: "herdr",
      muxRef: HERDR_REF,
    });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "close", s.id], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain(s.id);
    expect(io.outText()).toContain("closed");
    // The operation — not the CLI — updated the stored status.
    const session = requiredAt(store.sessions, 0, "session");
    expect(session.status).toBe("closed");
    expect(session.closedAt).not.toBeNull();
  });

  test("force close warns when mux cleanup may need manual follow-up", async () => {
    const store = new FakeStore();
    const s = makeSession({
      name: "stale-herdr",
      mux: "herdr",
      muxRef: HERDR_REF,
    });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });
    deps.templateRunner = new FakeTemplateRunner({
      commands: [{ exitCode: 1, stderr: "workspace close failed" }],
    });

    const { io, code } = await run(["session", "close", s.id, "--force"], deps);

    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("warning: mux close failed");
    expect(io.outText()).toContain("Herdr workspace may still exist");
    expect(io.outText()).toContain(
      "herdr --session 'asem' workspace close 'herdr-workspace-1'",
    );
  });

  test("close of an unknown id surfaces session_not_found (exit 1)", async () => {
    const { io, code } = await run(["session", "close", "ghost"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli session delete", () => {
  test("--force deletes the Session and its related Messages", async () => {
    const store = new FakeStore();
    const s = makeSession({ id: "s_del", name: "to-delete", status: "closed" });
    store.sessions.push(s);
    store.messages.push(
      makeMessage({ id: "m1", toSessionId: "s_del" }),
      makeMessage({ id: "m2", fromSessionId: "s_del", toSessionId: "s_o" }),
    );
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(
      ["session", "delete", "s_del", "--force"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("s_del");
    expect(io.outText()).toContain("2 related message");
    expect(store.sessions).toHaveLength(0);
    expect(store.messages).toHaveLength(0);
  });

  test("without --force the operation refuses (confirmation maps at surface)", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s_del", name: "to-delete" }));
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "delete", "s_del"], deps);
    // The CLI passes force=false through; the operation owns the refusal.
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
    expect(store.sessions).toHaveLength(1);
  });

  test("delete of an unknown id with --force surfaces session_not_found", async () => {
    const { io, code } = await run(["session", "delete", "ghost", "--force"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli message list", () => {
  test("renders scoped history", async () => {
    const store = new FakeStore();
    store.messages.push(makeMessage({ body: "first" }));
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["message", "list"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("first");
  });

  test("--inbox returns only messages addressed to the current Session", async () => {
    const store = new FakeStore();
    const me = seedCurrentSession(store);
    store.messages.push(
      makeMessage({ toSessionId: me.id, body: "for-me" }),
      makeMessage({ toSessionId: "s_other", body: "not-me" }),
    );
    const { deps } = makeCliFixture({ store, current: { sessionId: me.id } });

    const { io, code } = await run(["message", "list", "--inbox"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("for-me");
    expect(io.outText()).not.toContain("not-me");
  });

  test("--inbox without a current Session surfaces the auth error (exit 1)", async () => {
    const { io, code } = await run(["message", "list", "--inbox"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("current_session_not_found");
  });

  test("--undelivered includes both undelivered and failed, never delivered", async () => {
    const store = new FakeStore();
    store.messages.push(
      makeMessage({ body: "pending", deliveredAt: null }),
      makeMessage({
        body: "broken",
        deliveredAt: null,
        deliveryError: "notification_failed: pane gone",
      }),
      makeMessage({ body: "done", deliveredAt: "2026-06-05T12:30:00.000Z" }),
    );
    const { deps } = makeCliFixture({ store });

    const { io } = await run(["message", "list", "--undelivered"], deps);
    expect(io.outText()).toContain("pending");
    expect(io.outText()).toContain("broken");
    expect(io.outText()).not.toContain("done");
  });

  test("--json prints the shared page envelope with only public Message fields", async () => {
    const store = new FakeStore();
    store.messages.push(
      makeMessage({
        body: "failed-one",
        deliveredAt: null,
        deliveryError: "notification_failed: pane gone",
      }),
    );
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["message", "list", "--json"], deps);
    expect(code).toBe(EXIT_OK);
    const page = parseJson(io.outText());
    expect(Object.keys(page).sort()).toEqual([
      "hasMore",
      "messages",
      "nextCursor",
    ]);
    expect(page.hasMore).toBe(false);
    expect(typeof page.nextCursor).toBe("string");
    expect(Object.keys(page.messages[0]).sort()).toEqual([
      "body",
      "createdAt",
      "delivery",
      "fromSessionId",
      "id",
      "kind",
      "toSessionId",
    ]);
    // Internal fields never cross the surface, in any spelling.
    expect(io.outText()).not.toContain("formattedBody");
    expect(io.outText()).not.toContain("workspaceId");
    expect(io.outText()).not.toContain("worktreeRoot");
    expect(io.outText()).not.toContain("sequence");
  });

  test("--json equals the shared ops page envelope (surface parity)", async () => {
    const store = new FakeStore();
    store.messages.push(makeMessage({ body: "parity" }));
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["message", "list", "--json"], deps);
    expect(code).toBe(EXIT_OK);
    const direct = await listMessages(deps, {}, { cwd: CWD });
    if (!direct.ok) throw new Error("direct listMessages failed");
    expect(parseJson(io.outText())).toEqual(direct.value);
  });

  test("--limit pages and --cursor continues without duplicates", async () => {
    const store = new FakeStore();
    store.messages.push(
      makeMessage({ id: "m_page_0", body: "body-0" }),
      makeMessage({ id: "m_page_1", body: "body-1" }),
      makeMessage({ id: "m_page_2", body: "body-2" }),
    );
    const { deps } = makeCliFixture({ store });

    const first = await run(
      ["message", "list", "--limit", "2", "--json"],
      deps,
    );
    expect(first.code).toBe(EXIT_OK);
    const page1 = parseJson(first.io.outText());
    expect(page1.messages.map((m: { id: string }) => m.id)).toEqual([
      "m_page_0",
      "m_page_1",
    ]);
    expect(page1.hasMore).toBe(true);

    const second = await run(
      [
        "message",
        "list",
        "--limit",
        "2",
        "--cursor",
        page1.nextCursor,
        "--json",
      ],
      deps,
    );
    expect(second.code).toBe(EXIT_OK);
    const page2 = parseJson(second.io.outText());
    expect(page2.messages.map((m: { id: string }) => m.id)).toEqual([
      "m_page_2",
    ]);
    expect(page2.hasMore).toBe(false);
  });

  test("--cursor latest returns an explicit empty tail page", async () => {
    const store = new FakeStore();
    store.messages.push(makeMessage({ body: "old-history" }));
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(
      ["message", "list", "--cursor", "latest", "--json"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    const page = parseJson(io.outText());
    expect(page.messages).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(typeof page.nextCursor).toBe("string");
  });

  test("human output renders a pagination footer only when more pages remain", async () => {
    const store = new FakeStore();
    store.messages.push(
      makeMessage({ body: "row-0" }),
      makeMessage({ body: "row-1" }),
      makeMessage({ body: "row-2" }),
    );
    const { deps } = makeCliFixture({ store });

    const paged = await run(["message", "list", "--limit", "2"], deps);
    expect(paged.code).toBe(EXIT_OK);
    expect(paged.io.outText()).toContain("has more");
    expect(paged.io.outText()).toContain("--cursor");
    // The footer shows the opaque cursor only, never formatted bodies.
    expect(paged.io.outText()).not.toContain("[asem message]");

    const full = await run(["message", "list"], deps);
    expect(full.io.outText()).not.toContain("has more");
  });

  test("--limit beyond the shared max is rejected by the shared op", async () => {
    const { io, code } = await run(["message", "list", "--limit", "100"]);
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
  });

  test("a tampered --cursor is rejected by the shared op", async () => {
    const store = new FakeStore();
    store.messages.push(makeMessage({ body: "row" }));
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(
      ["message", "list", "--cursor", "not-a-real-cursor"],
      deps,
    );
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
  });
});

describe("runCli message wait", () => {
  /** Fixture with a registered current Session and its high-water Inbox cursor. */
  async function waitFixture() {
    const store = new FakeStore();
    const me = seedCurrentSession(store);
    const { deps } = makeCliFixture({ store, current: { sessionId: me.id } });
    const anchor = await run(["message", "list", "--inbox", "--json"], deps);
    expect(anchor.code).toBe(EXIT_OK);
    const cursor = parseJson(anchor.io.outText()).nextCursor as string;
    return { store, me, deps, cursor, sleeper: deps.sleeper as FakeSleeper };
  }

  test("returns a delayed Inbox arrival as a successful page", async () => {
    const { store, me, deps, cursor, sleeper } = await waitFixture();
    sleeper.onSleep = async (_ms, count) => {
      if (count === 2) {
        store.messages.push(
          makeMessage({ id: "m_late", toSessionId: me.id, body: "late" }),
        );
      }
    };

    const { io, code } = await run(
      ["message", "wait", "--cursor", cursor, "--json"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    const page = parseJson(io.outText());
    expect(page.messages.map((m: { id: string }) => m.id)).toEqual(["m_late"]);
    expect(page.timedOut).toBe(false);
  });

  test("timeout is a successful empty page, not an error", async () => {
    const { deps, cursor } = await waitFixture();

    const { io, code } = await run(
      ["message", "wait", "--cursor", cursor, "--timeout-ms", "2000", "--json"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    const page = parseJson(io.outText());
    expect(page.messages).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.timedOut).toBe(true);
    expect(page.nextCursor).toBe(cursor);
  });

  test("human output renders no new Messages plus a cursor footer on timeout", async () => {
    const { deps, cursor } = await waitFixture();

    const { io, code } = await run(
      ["message", "wait", "--cursor", cursor, "--timeout-ms", "1000"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("no new Messages");
    expect(io.outText()).toContain(`--cursor ${cursor}`);
  });

  test("requires a registered current Session", async () => {
    const { cursor } = await waitFixture();
    // Fresh deps with no current-Session pointer: the wait must not fall back
    // to anonymous local trust or any arbitrary-history view.
    const { deps } = makeCliFixture();

    const { io, code } = await run(
      ["message", "wait", "--cursor", cursor],
      deps,
    );
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("current_session_not_found");
  });

  test("a cursor bound to another view is rejected by the shared op", async () => {
    const store = new FakeStore();
    const me = seedCurrentSession(store);
    const { deps } = makeCliFixture({ store, current: { sessionId: me.id } });
    // A non-Inbox (unfiltered history) cursor is a different query identity.
    const history = await run(["message", "list", "--json"], deps);
    const cursor = parseJson(history.io.outText()).nextCursor as string;

    const { io, code } = await run(
      ["message", "wait", "--cursor", cursor],
      deps,
    );
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
  });

  test("the legacy --to wait surface is gone", async () => {
    const { io, code } = await run(["message", "wait", "--to", "s_parent"]);
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
  });
});

describe("runCli message send", () => {
  test("delegates to send_message and renders the delivered result", async () => {
    const store = new FakeStore();
    // A deliverable herdr target (its builtin `send` sequence resolves pane_id).
    const target = makeSession({
      name: "reviewer-1",
      mux: "herdr",
      muxRef: HERDR_REF,
    });
    store.sessions.push(target);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(
      ["message", "send", target.id, "--body", "ping"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain(target.id);
    expect(io.outText()).toContain("delivered at");
    // The operation — not the CLI — recorded the Message.
    expect(store.messages).toHaveLength(1);
    expect(requiredAt(store.messages, 0, "message").body).toBe("ping");
  });

  test("an unknown target surfaces session_not_found (exit 1)", async () => {
    const { io, code } = await run(["message", "send", "ghost", "--body", "x"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli report parent", () => {
  test("delivers a report to the current Session's parent", async () => {
    const store = new FakeStore();
    const parent = makeSession({
      name: "parent",
      mux: "herdr",
      muxRef: HERDR_REF,
    });
    store.sessions.push(parent);
    // Seed a current Session whose token verifies and whose parent is `parent`.
    const me = seedCurrentSession(store);
    me.parentSessionId = parent.id;
    const { deps } = makeCliFixture({ store, current: { sessionId: me.id } });

    const { io, code } = await run(["report", "parent", "--body", "wip"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("report");
    expect(io.outText()).toContain(parent.id);
    expect(store.messages).toHaveLength(1);
    const message = requiredAt(store.messages, 0, "message");
    expect(message.kind).toBe("report");
    expect(message.formattedBody).toContain("[asem report from");
  });

  test("no current Session surfaces current_session_not_found (exit 1)", async () => {
    const { io, code } = await run(["report", "parent", "--body", "x"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("current_session_not_found");
  });
});

describe("runCli integrations", () => {
  const unreachableMcp = () => {
    throw new Error("MCP installer must not run");
  };
  const unreachableSkill = () => {
    throw new Error("Skill installer must not run");
  };

  test("mcp add installs MCP registration and renders target/path/scope", async () => {
    const io = new BufferIo();
    const calls: Array<{ target: string; options: InstallOptions }> = [];
    const code = await runCli({
      argv: ["mcp", "add", "--for", "pi"],
      cwd: "/repo",
      deps: makeCliFixture().deps,
      io,
      home: "/home/test",
      integrations: {
        installMcpServerForTarget: (target, options) => {
          calls.push({ target, options });
          return {
            target: "pi",
            path: `${options.home}/.config/mcp/mcp.json`,
            scope: "global",
            serverName: "asem",
          };
        },
        installSkillForTarget: unreachableSkill,
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain(
      "Registered MCP server 'asem' for pi (global): /home/test/.config/mcp/mcp.json",
    );
    expect(calls).toEqual([
      {
        target: "pi",
        options: { cwd: "/repo", home: "/home/test", global: true },
      },
    ]);
  });

  test("skills add installs the Skill and forwards --no-global as workspace", async () => {
    const io = new BufferIo();
    const calls: Array<{ target: string; options: InstallOptions }> = [];
    const code = await runCli({
      argv: ["skills", "add", "--for", "pi", "--no-global"],
      cwd: "/repo",
      deps: makeCliFixture().deps,
      io,
      integrations: {
        installMcpServerForTarget: unreachableMcp,
        installSkillForTarget: (target, options) => {
          calls.push({ target, options });
          return {
            target: "pi",
            path: `${options.cwd}/.pi/skills/asem/SKILL.md`,
            scope: "workspace",
          };
        },
      },
    });
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain(
      "Installed asem Skill for pi (workspace): /repo/.pi/skills/asem/SKILL.md",
    );
    expect(calls[0]?.options.global).toBe(false);
  });

  test("an unsupported-scope error renders a usage error (exit 2)", async () => {
    const io = new BufferIo();
    const code = await runCli({
      argv: ["mcp", "add", "--for", "codex", "--no-global"],
      cwd: "/repo",
      deps: makeCliFixture().deps,
      io,
      integrations: {
        installMcpServerForTarget: () => {
          throw integrationTargetError(
            "unsupported_scope",
            "codex does not support workspace MCP scope",
          );
        },
        installSkillForTarget: unreachableSkill,
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain(
      "codex does not support workspace MCP scope",
    );
  });

  test("a malformed existing config renders invalid_config (exit 1)", async () => {
    const io = new BufferIo();
    const code = await runCli({
      argv: ["mcp", "add", "--for", "pi"],
      cwd: "/repo",
      deps: makeCliFixture().deps,
      io,
      integrations: {
        installMcpServerForTarget: () => {
          throw integrationTargetError(
            "invalid_config",
            "Invalid JSON config at /home/test/.config/mcp/mcp.json",
          );
        },
        installSkillForTarget: unreachableSkill,
      },
    });
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("invalid_config");
  });

  test("uses the production installers by default", async () => {
    const home = join(tmpdir(), `asem-cli-${crypto.randomUUID()}`);
    const io = new BufferIo();
    const code = await runCli({
      argv: ["mcp", "add", "--for", "pi"],
      cwd: join(home, "repo"),
      deps: makeCliFixture().deps,
      io,
      home,
    });
    expect(code).toBe(EXIT_OK);
    const path = join(home, ".config", "mcp", "mcp.json");
    expect(parseJson(readFileSync(path, "utf8"))).toEqual({
      mcpServers: { asem: { command: "asem", args: ["mcp"] } },
    });
  });
});
