import { describe, expect, test } from "bun:test";
import {
  configSchema,
  effectiveScopeSchema,
  MAX_MESSAGE_BODY_BYTES,
  messageBodySchema,
  messageSchema,
  operationErrorSchema,
  peekSessionInputSchema,
  publicMessageSchema,
  type Session,
  sessionSchema,
  sessionStatusSchema,
} from "../src/index.ts";

const baseSession: Session = {
  id: "s_1",
  workspaceId: "ws_1",
  worktreeRoot: "/repo/.worktrees/a",
  name: "reviewer-1",
  cwd: "/repo/.worktrees/a",
  agent: "claude",
  mux: "herdr",
  model: null,
  profile: null,
  profileSource: null,
  parentSessionId: null,
  status: "running",
  muxRef: { workspace: "w1", tab: "t1", pane: "p1" },
  sessionDir: "/repo/.worktrees/a/.asem/sessions/s_1",
  tokenHash: "sha256:deadbeef",
  createdAt: "2026-06-05T12:00:00Z",
  updatedAt: "2026-06-05T12:00:00Z",
  closedAt: null,
};

describe("sessionStatusSchema", () => {
  test("accepts all process states", () => {
    for (const s of ["starting", "running", "exited", "missing", "closed"]) {
      expect(sessionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  test("rejects task-outcome-like states", () => {
    for (const s of ["completed", "failed", "blocked", "done"]) {
      expect(sessionStatusSchema.safeParse(s).success).toBe(false);
    }
  });
});

describe("sessionSchema", () => {
  test("parses a valid Session", () => {
    const parsed = sessionSchema.safeParse(baseSession);
    expect(parsed.success).toBe(true);
  });

  test("allows a parent Session id", () => {
    const parsed = sessionSchema.safeParse({
      ...baseSession,
      parentSessionId: "s_parent",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects an empty required field", () => {
    const parsed = sessionSchema.safeParse({ ...baseSession, name: "" });
    expect(parsed.success).toBe(false);
  });

  test("rejects an invalid status", () => {
    const parsed = sessionSchema.safeParse({
      ...baseSession,
      status: "completed",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects a non-ISO timestamp", () => {
    const parsed = sessionSchema.safeParse({
      ...baseSession,
      createdAt: "yesterday",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects unknown keys (strict)", () => {
    const parsed = sessionSchema.safeParse({ ...baseSession, role: "lead" });
    expect(parsed.success).toBe(false);
  });
});

describe("messageSchema", () => {
  const baseMessage = {
    id: "m_1",
    workspaceId: "ws_1",
    worktreeRoot: "/repo/.worktrees/a",
    fromSessionId: "s_1",
    toSessionId: "s_2",
    kind: "message" as const,
    body: "hello",
    formattedBody: "[asem message from reviewer-1]\nhello",
    deliveredAt: null,
    deliveryError: null,
    createdAt: "2026-06-05T12:00:00Z",
  };

  test("parses a valid message", () => {
    expect(messageSchema.safeParse(baseMessage).success).toBe(true);
  });

  test("parses a report kind", () => {
    expect(
      messageSchema.safeParse({ ...baseMessage, kind: "report" }).success,
    ).toBe(true);
  });

  test("allows a null sender", () => {
    expect(
      messageSchema.safeParse({ ...baseMessage, fromSessionId: null }).success,
    ).toBe(true);
  });

  test("records delivery success", () => {
    const parsed = messageSchema.safeParse({
      ...baseMessage,
      deliveredAt: "2026-06-05T12:00:01Z",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects an invalid kind", () => {
    expect(
      messageSchema.safeParse({ ...baseMessage, kind: "event" }).success,
    ).toBe(false);
  });

  test("rejects a missing target", () => {
    const { toSessionId, ...withoutTarget } = baseMessage;
    void toSessionId;
    expect(messageSchema.safeParse(withoutTarget).success).toBe(false);
  });

  test("accepts a body at the UTF-8 byte limit and rejects one byte over", () => {
    expect(
      messageBodySchema.safeParse("a".repeat(MAX_MESSAGE_BODY_BYTES)).success,
    ).toBe(true);
    expect(
      messageBodySchema.safeParse("a".repeat(MAX_MESSAGE_BODY_BYTES + 1))
        .success,
    ).toBe(false);
    expect(messageBodySchema.safeParse("😀".repeat(16_384)).success).toBe(true);
    expect(messageBodySchema.safeParse("😀".repeat(16_385)).success).toBe(
      false,
    );
  });

  test("public Message envelope excludes internal audit and location fields", () => {
    expect(
      publicMessageSchema.safeParse({
        id: "m_1",
        fromSessionId: null,
        toSessionId: "s_2",
        kind: "message",
        body: "hello",
        createdAt: "2026-06-05T12:00:00Z",
        delivery: { status: "undelivered" },
      }).success,
    ).toBe(true);
    expect(
      publicMessageSchema.safeParse({
        id: "m_1",
        fromSessionId: null,
        toSessionId: "s_2",
        kind: "message",
        body: "hello",
        createdAt: "2026-06-05T12:00:00Z",
        delivery: { status: "undelivered" },
        formattedBody: "internal",
      }).success,
    ).toBe(false);
  });
});

describe("configSchema", () => {
  test("parses minimal config and applies mux/agent defaults", () => {
    const parsed = configSchema.safeParse({ workspace: { id: "my-ws" } });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mux.default).toBe("herdr");
      expect(parsed.data.agent.default).toBe("claude");
      expect(parsed.data.mux.templates).toEqual({});
    }
  });

  test("parses a fully specified config", () => {
    const parsed = configSchema.safeParse({
      workspace: { id: "my-ws" },
      mux: { default: "tmux", templates: {} },
      agent: { default: "codex", templates: {} },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mux.default).toBe("tmux");
      expect(parsed.data.agent.default).toBe("codex");
    }
  });

  test("requires workspace.id", () => {
    expect(configSchema.safeParse({ mux: { default: "tmux" } }).success).toBe(
      false,
    );
  });

  test("rejects an empty workspace id", () => {
    expect(configSchema.safeParse({ workspace: { id: "" } }).success).toBe(
      false,
    );
  });

  test("parses an optional repos map", () => {
    const parsed = configSchema.safeParse({
      workspace: { id: "my-ws" },
      repos: {
        frontend: { path: "./frontend" },
        backend: { path: "./backend" },
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.repos).toEqual({
        frontend: { path: "./frontend" },
        backend: { path: "./backend" },
      });
    }
  });

  test("leaves repos undefined when omitted", () => {
    const parsed = configSchema.safeParse({ workspace: { id: "my-ws" } });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.repos).toBeUndefined();
    }
  });

  test("rejects a repo entry without a path", () => {
    expect(
      configSchema.safeParse({
        workspace: { id: "my-ws" },
        repos: { frontend: {} },
      }).success,
    ).toBe(false);
  });

  test("rejects a repo entry with an empty path", () => {
    expect(
      configSchema.safeParse({
        workspace: { id: "my-ws" },
        repos: { frontend: { path: "" } },
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown key in a repo entry", () => {
    expect(
      configSchema.safeParse({
        workspace: { id: "my-ws" },
        repos: { frontend: { path: "./frontend", extra: true } },
      }).success,
    ).toBe(false);
  });
});

describe("effectiveScopeSchema", () => {
  test("parses a valid scope", () => {
    expect(
      effectiveScopeSchema.safeParse({
        workspaceId: "ws_1",
        worktreeRoot: "/repo",
      }).success,
    ).toBe(true);
  });

  test("requires both fields", () => {
    expect(
      effectiveScopeSchema.safeParse({ workspaceId: "ws_1" }).success,
    ).toBe(false);
  });
});

describe("peekSessionInputSchema", () => {
  test("defaults to recent-unwrapped and 80 lines", () => {
    const parsed = peekSessionInputSchema.parse({ id: "s_1" });
    expect(parsed).toEqual({
      id: "s_1",
      source: "recent-unwrapped",
      lines: 80,
    });
  });

  test("accepts explicit source and lines", () => {
    const parsed = peekSessionInputSchema.parse({
      id: "s_1",
      source: "visible",
      lines: 120,
    });
    expect(parsed).toEqual({ id: "s_1", source: "visible", lines: 120 });
  });

  test("rejects non-positive and too-large line counts", () => {
    expect(
      peekSessionInputSchema.safeParse({ id: "s_1", lines: 0 }).success,
    ).toBe(false);
    expect(
      peekSessionInputSchema.safeParse({ id: "s_1", lines: 301 }).success,
    ).toBe(false);
  });
});

describe("operationErrorSchema", () => {
  test("parses a structured error with a known code", () => {
    const parsed = operationErrorSchema.safeParse({
      code: "scope_mismatch",
      message: "session is in a different scope",
      details: { sessionId: "s_1" },
    });
    expect(parsed.success).toBe(true);
  });

  test("parses peek-specific structured error codes", () => {
    for (const code of [
      "mux_peek_unsupported",
      "unsupported_source",
      "peek_failed",
    ]) {
      expect(
        operationErrorSchema.safeParse({ code, message: "peek" }).success,
      ).toBe(true);
    }
  });

  test("rejects an unknown code", () => {
    expect(
      operationErrorSchema.safeParse({
        code: "kaboom",
        message: "nope",
      }).success,
    ).toBe(false);
  });
});
