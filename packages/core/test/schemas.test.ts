import { describe, expect, test } from "bun:test";
import {
  configSchema,
  effectiveScopeSchema,
  messageSchema,
  operationErrorSchema,
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

describe("operationErrorSchema", () => {
  test("parses a structured error with a known code", () => {
    const parsed = operationErrorSchema.safeParse({
      code: "scope_mismatch",
      message: "session is in a different scope",
      details: { sessionId: "s_1" },
    });
    expect(parsed.success).toBe(true);
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
