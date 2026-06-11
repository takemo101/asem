import { describe, expect, test } from "bun:test";
import type { EffectiveScope } from "@asem/core";
import { FakeFileSystem } from "../../ops/src/testing/fakes.ts";
import { FileCurrentSessionResolver } from "../src/runtime/adapters.ts";

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
