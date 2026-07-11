import { describe, expect, test } from "bun:test";
import type { EffectiveScope, LogFields } from "@asem/core";
import { FakeFileSystem } from "../../ops/src/testing/fakes.ts";
import {
  createSurfaceLogger,
  FileCurrentSessionResolver,
  runAttachCommand,
} from "../src/runtime/adapters.ts";

const scope: EffectiveScope = {
  workspaceId: "ws_1",
  worktreeRoot: "/repo/a",
};

describe("FileCurrentSessionResolver", () => {
  test("prefers process env current-session over the worktree pointer", async () => {
    const fs = new FakeFileSystem();
    await fs.writeFileAtomic(
      "/repo/a/.asem/current-session.json",
      JSON.stringify({
        sessionId: "s_pointer",
        tokenFile: "/repo/a/.asem/tokens/s_pointer.token",
        workspaceId: "ws_1",
        worktreeRoot: "/repo/a",
      }),
    );
    await fs.writeFileAtomic(
      "/repo/a/.asem/tokens/s_pointer.token",
      "pointer-token\n",
    );

    const previousSessionId = process.env.AS_SESSION_ID;
    const previousToken = process.env.AS_SESSION_TOKEN;
    process.env.AS_SESSION_ID = "s_env";
    process.env.AS_SESSION_TOKEN = "env-token";
    try {
      const resolved = await new FileCurrentSessionResolver(fs).resolve(scope);

      expect(resolved).toEqual({
        sessionId: "s_env",
        token: "env-token",
        scope,
      });
    } finally {
      if (previousSessionId === undefined) {
        delete process.env.AS_SESSION_ID;
      } else {
        process.env.AS_SESSION_ID = previousSessionId;
      }
      if (previousToken === undefined) {
        delete process.env.AS_SESSION_TOKEN;
      } else {
        process.env.AS_SESSION_TOKEN = previousToken;
      }
    }
  });
});

describe("runAttachCommand", () => {
  test("propagates the external attach process exit code", async () => {
    expect(await runAttachCommand({ argv: ["sh", "-c", "exit 7"] })).toBe(7);
  });

  test("returns 0 when the attach process succeeds", async () => {
    expect(await runAttachCommand({ argv: ["sh", "-c", "exit 0"] })).toBe(0);
  });

  test("returns 1 when the program cannot be spawned", async () => {
    expect(
      await runAttachCommand({ argv: ["/nonexistent-asem-attach-binary"] }),
    ).toBe(1);
  });

  test("returns 1 for an empty argv", async () => {
    expect(await runAttachCommand({ argv: [] })).toBe(1);
  });
});

describe("createSurfaceLogger", () => {
  test("cli emits stderr JSON through the injected writer", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("cli", {
      writeStderr: (line) => lines.push(line),
    });

    logger.info("created Session", { sessionId: "s1" });

    expect(lines).toEqual([
      `${JSON.stringify({
        level: "info",
        message: "created Session",
        sessionId: "s1",
      })}\n`,
    ]);
  });

  test("cli logger applies the provided redactor before writing", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("cli", {
      redactor: {
        redact: (value) =>
          value.replaceAll("sample-sensitive-value", "[redacted]"),
      },
      writeStderr: (line) => lines.push(line),
    });

    logger.error("failed", {
      sample: "sample-sensitive-value",
    } satisfies LogFields);

    expect(lines.join("")).toContain("[redacted]");
    expect(lines.join("")).not.toContain("sample-sensitive-value");
  });

  test("mcp is silent by default", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("mcp", {
      writeStderr: (line) => lines.push(line),
    });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(lines).toEqual([]);
  });

  test("tui is silent by default", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("tui", {
      writeStderr: (line) => lines.push(line),
    });

    logger.info("closed Session", { sessionId: "s1" });
    logger.warn("mux close failed", { sessionId: "s1" });

    expect(lines).toEqual([]);
  });
});
