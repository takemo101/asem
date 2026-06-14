import { describe, expect, test } from "bun:test";
import { doctor } from "../src/operations/doctor.ts";
import {
  FakeConfigLoader,
  FakeExecutableResolver,
  makeConfig,
  makeOpsDeps,
} from "../src/testing/fakes.ts";

const CWD = "/repo";

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe("doctor", () => {
  test("reports every builtin agent and mux executable", async () => {
    const executableResolver = new FakeExecutableResolver()
      .set("herdr", "/bin/herdr")
      .set("claude", "/bin/claude")
      .set("rmux", "/bin/rmux");
    const deps = makeOpsDeps({ executableResolver });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.multiplexers.map((c) => c.template)).toEqual([
      "herdr",
      "rmux",
      "tmux",
      "zellij",
    ]);
    expect(output.agents.map((c) => c.template)).toEqual([
      "agy",
      "claude",
      "codex",
      "opencode",
      "pi",
    ]);
    expect(
      output.multiplexers.find((c) => c.template === "herdr"),
    ).toMatchObject({
      status: "ok",
      path: "/bin/herdr",
      isDefault: true,
    });
    expect(
      output.multiplexers.find((c) => c.template === "tmux"),
    ).toMatchObject({
      status: "missing",
      path: null,
      isDefault: false,
    });
    expect(output.agents.find((c) => c.template === "claude")).toMatchObject({
      status: "ok",
      path: "/bin/claude",
      isDefault: true,
    });
    expect([...executableResolver.requests].sort()).toEqual([
      "agy",
      "claude",
      "codex",
      "herdr",
      "opencode",
      "pi",
      "rmux",
      "tmux",
      "zellij",
    ]);
  });

  test("marks configured defaults from a valid config", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({
        kind: "found",
        configPath: "/repo/.asem.yaml",
        config: makeConfig({
          mux: { default: "rmux", templates: {} },
          agent: { default: "pi", templates: {} },
        }),
      }),
      executableResolver: new FakeExecutableResolver()
        .set("rmux", "/bin/rmux")
        .set("pi", "/bin/pi"),
    });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.config).toEqual({
      kind: "found",
      configPath: "/repo/.asem.yaml",
      workspaceId: "ws_1",
      defaultAgent: "pi",
      defaultMux: "rmux",
    });
    expect(
      output.multiplexers.find((c) => c.template === "rmux")?.isDefault,
    ).toBe(true);
    expect(output.agents.find((c) => c.template === "pi")?.isDefault).toBe(
      true,
    );
  });

  test("missing config still returns builtin checks", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
      executableResolver: new FakeExecutableResolver().set(
        "zellij",
        "/bin/zellij",
      ),
    });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.config).toEqual({ kind: "not_found" });
    expect(
      output.multiplexers.find((c) => c.template === "zellij"),
    ).toMatchObject({
      status: "ok",
      isDefault: false,
    });
  });

  test("invalid config still returns builtin checks and issues", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({
        kind: "invalid",
        configPath: "/repo/.asem.yaml",
        issues: ["workspace.id is required"],
      }),
    });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.config).toEqual({
      kind: "invalid",
      configPath: "/repo/.asem.yaml",
      issues: ["workspace.id is required"],
    });
    expect(output.agents).toHaveLength(5);
    expect(output.multiplexers).toHaveLength(4);
  });
});
