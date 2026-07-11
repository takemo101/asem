/**
 * Human/JSON rendering for CLI operation results.
 *
 * Rendering is pure: each function maps an operation value (or a structured
 * {@link OperationError}) to plain lines the caller writes through {@link CliIo}.
 * No domain decisions live here — the CLI only formats what `@asem/ops` returns.
 */
import {
  type CloseSessionOutput,
  type DeleteSessionOutput,
  type DoctorExecutableCheck,
  type DoctorOutput,
  type InitProjectOutput,
  type InitSessionOutput,
  type Message,
  type OperationError,
  type PublicMessage,
  type Session,
  shellEscape,
} from "@asem/core";
import type { ResolvedProfile } from "@asem/ops";
import type { RepoAliasStatus } from "./repo-alias.ts";

/** Render a structured error as `error: <code>: <message>` plus detail lines. */
export function renderError(error: OperationError): string[] {
  const lines = [`error: ${error.code}: ${error.message}`];
  if (error.details !== undefined) {
    for (const [key, value] of Object.entries(error.details)) {
      lines.push(`  ${key}: ${formatDetail(value)}`);
    }
  }
  return lines;
}

function formatDetail(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// --- doctor ---------------------------------------------------------------

export function renderDoctor(output: DoctorOutput): string[] {
  const lines = ["asem doctor", ""];

  switch (output.config.kind) {
    case "found":
      lines.push(
        `Config: ${output.config.configPath}`,
        `Workspace: ${output.config.workspaceId}`,
        `Default agent: ${output.config.defaultAgent}`,
        `Default mux: ${output.config.defaultMux}`,
      );
      break;
    case "not_found":
      lines.push(
        "Config: not found",
        "Workspace: -",
        "Default agent: -",
        "Default mux: -",
      );
      break;
    case "invalid":
      lines.push(
        `Config: invalid (${output.config.configPath})`,
        `Issue: invalid_config: ${output.config.issues.join("; ")}`,
        "Workspace: -",
        "Default agent: -",
        "Default mux: -",
      );
      break;
  }

  lines.push("", "Multiplexers:");
  lines.push(...output.multiplexers.map(renderDoctorCheck));
  lines.push("", "Agents:");
  lines.push(...output.agents.map(renderDoctorCheck));
  return lines;
}

function renderDoctorCheck(check: DoctorExecutableCheck): string {
  const status = check.status.padEnd(8);
  const template = check.template.padEnd(8);
  const executable = check.executable.padEnd(8);
  const path = (check.path ?? "-").padEnd(28);
  const suffix = check.isDefault ? "default" : "";
  return `  ${status} ${template} ${executable} ${path} ${suffix}`.trimEnd();
}

// --- sessions --------------------------------------------------------------

/** One Session as a compact, scannable row. */
function sessionRow(session: Session): string {
  const parent = session.parentSessionId ?? "-";
  return [
    session.id,
    session.status,
    session.name,
    `${session.agent}/${session.mux}`,
    // Model is shown only when set, to keep the compact row free of noise for
    // the common no-model case (MIK-040).
    ...(session.model !== null ? [`model=${session.model}`] : []),
    `parent=${parent}`,
  ].join("  ");
}

export function renderSessionList(sessions: readonly Session[]): string[] {
  if (sessions.length === 0) {
    return ["no sessions in scope"];
  }
  return sessions.map(sessionRow);
}

/** Full Session detail. `tokenHash` is intentionally omitted from output. */
export function renderSessionDetail(
  session: Session,
  attachHint?: string,
): string[] {
  const lines = [
    `id:            ${session.id}`,
    `name:          ${session.name}`,
    `status:        ${session.status}`,
    `agent:         ${session.agent}`,
    `mux:           ${session.mux}`,
    `model:         ${session.model ?? "-"}`,
    `profile:       ${session.profile ?? "-"}`,
    `profile_src:   ${session.profileSource ?? "-"}`,
    `parent:        ${session.parentSessionId ?? "-"}`,
    `cwd:           ${session.cwd}`,
    `worktree_root: ${session.worktreeRoot}`,
    `session_dir:   ${session.sessionDir}`,
    `created_at:    ${session.createdAt}`,
    `updated_at:    ${session.updatedAt}`,
    `closed_at:     ${session.closedAt ?? "-"}`,
  ];
  if (attachHint !== undefined) {
    lines.push(`attach_hint:   ${attachHint}`);
  }
  return lines;
}

// --- attach ----------------------------------------------------------------

/**
 * Render the human attach guidance for a Session. The CLI never computes attach
 * commands itself; it renders the `attachHint` the operation surfaced. When no
 * hint can be rendered (for example, the mux ref is incomplete or the mux has
 * no attach sequence), it shows the mux coordinates so a human can attach
 * manually. This stays CLI-human only and introduces no MCP attach semantics.
 */
export function renderAttach(session: Session, attachHint?: string): string[] {
  if (attachHint !== undefined && attachHint.length > 0) {
    return [`to attach to ${session.name} (${session.id}), run:`, attachHint];
  }
  return [
    `no attach hint available for ${session.name} (${session.id})`,
    `mux:     ${session.mux}`,
    `mux_ref: ${JSON.stringify(session.muxRef)}`,
  ];
}

// --- create ----------------------------------------------------------------

/**
 * Render the outcome of `session create`. The Session is launched and persisted
 * by the operation; the CLI only reports the new running Session. `status` is
 * process/connection state ("running"), never a work outcome.
 */
export function renderCreatedSession(session: Session): string[] {
  return [
    `created ${session.name} (${session.id})`,
    `status: ${session.status}`,
    `agent:  ${session.agent}`,
    `mux:    ${session.mux}`,
    // Only echo the model line when a model was selected (MIK-040).
    ...(session.model !== null ? [`model:  ${session.model}`] : []),
    `parent: ${session.parentSessionId ?? "-"}`,
  ];
}

// --- close / delete --------------------------------------------------------

/**
 * Render the outcome of `session close`. Close is process/connection state only:
 * the lines report the new `closed` status and the `closed_at` stamp, never a
 * work outcome.
 */
export function renderClosedSession(output: CloseSessionOutput): string[] {
  const lines = [
    `closed ${output.session.name} (${output.session.id})`,
    `status:    ${output.session.status}`,
    `closed_at: ${output.session.closedAt ?? "-"}`,
  ];
  if (output.muxCloseWarning !== undefined) {
    lines.push(`warning: ${output.muxCloseWarning.message}`);
    if (output.muxCloseWarning.cleanupCommand !== undefined) {
      lines.push(`cleanup: ${output.muxCloseWarning.cleanupCommand}`);
    }
  }
  return lines;
}

/**
 * Render the outcome of `session delete`. The destructive removal is owned by
 * the operation; the CLI only reports what it removed.
 */
export function renderDeletedSession(output: DeleteSessionOutput): string[] {
  const plural = output.deletedMessageCount === 1 ? "" : "s";
  return [
    `deleted Session ${output.deletedSessionId}`,
    `removed ${output.deletedMessageCount} related message${plural}`,
  ];
}

// --- profiles --------------------------------------------------------------

/**
 * One Agent Profile as a compact row showing every documented list field —
 * id, source, agent, model, and description — with `-` for absent values so the
 * agent/model defaults are always visible (design "CLI and MCP surfaces": list
 * shows id/source/description/agent/model).
 */
function profileRow(profile: ResolvedProfile): string {
  return [
    profile.id,
    `[${profile.source}]`,
    `agent=${profile.agent ?? "-"}`,
    `model=${profile.model ?? "-"}`,
    `— ${profile.description ?? "-"}`,
  ].join("  ");
}

export function renderProfileList(
  profiles: readonly ResolvedProfile[],
): string[] {
  if (profiles.length === 0) {
    return ["no Agent Profiles available"];
  }
  return profiles.map(profileRow);
}

/** Full Agent Profile detail: metadata then the complete instructions. */
export function renderProfileGet(profile: ResolvedProfile): string[] {
  return [
    `id:          ${profile.id}`,
    `source:      ${profile.source}`,
    `description: ${profile.description ?? "-"}`,
    `agent:       ${profile.agent ?? "-"}`,
    `model:       ${profile.model ?? "-"}`,
    "",
    "instructions:",
    profile.instructions,
  ];
}

// --- repo aliases ----------------------------------------------------------

/**
 * Render `workspace repo list`: one row per Repo Alias with its configured path,
 * resolved path, and current status. Status is path state only (`ok`,
 * `missing`, `not-a-dir`); it says nothing about Sessions, which a Repo Alias
 * never affects (CONTEXT.md "Repo Alias").
 */
export function renderRepoList(rows: readonly RepoAliasStatus[]): string[] {
  if (rows.length === 0) {
    return ["no repo aliases configured"];
  }
  return rows.map((row) => {
    const status = row.directory ? "ok" : row.exists ? "not-a-dir" : "missing";
    return [
      row.alias,
      row.configuredPath,
      `→ ${row.resolvedPath}`,
      `[${status}]`,
    ].join("  ");
  });
}

// --- messages --------------------------------------------------------------

function messageRow(message: Message | PublicMessage): string {
  const from = message.fromSessionId ?? "-";
  const base = `${message.createdAt}  ${from} → ${message.toSessionId}  [${message.kind}]  ${message.body}`;
  if ("delivery" in message) {
    if (message.delivery.status === "failed") {
      return `${base}  ! ${message.delivery.error}`;
    }
    if (message.delivery.status === "undelivered") {
      return `${base}  (undelivered)`;
    }
    return base;
  }
  if (message.deliveryError !== null) {
    return `${base}  ! ${message.deliveryError}`;
  }
  if (message.deliveredAt === null) {
    return `${base}  (undelivered)`;
  }
  return base;
}

export function renderMessageList(
  messages: readonly (Message | PublicMessage)[],
): string[] {
  if (messages.length === 0) {
    return ["no messages in scope"];
  }
  return messages.map(messageRow);
}

/**
 * Render the outcome of a sent Message or Report. Delivery is best-effort, so
 * the second line reflects the truthful recorded state: delivered, failed, or
 * recorded-but-undelivered. No ack/read state is implied.
 */
export function renderSentMessage(message: Message | PublicMessage): string[] {
  const lines = [`${message.kind} ${message.id} → ${message.toSessionId}`];
  if ("delivery" in message) {
    if (message.delivery.status === "failed") {
      lines.push(`delivery failed: ${message.delivery.error}`);
    } else if (message.delivery.status === "delivered") {
      lines.push(`delivered at ${message.delivery.deliveredAt}`);
    } else {
      lines.push("recorded (undelivered)");
    }
  } else if (message.deliveryError !== null) {
    lines.push(`delivery failed: ${message.deliveryError}`);
  } else if (message.deliveredAt !== null) {
    lines.push(`delivered at ${message.deliveredAt}`);
  } else {
    lines.push("recorded (undelivered)");
  }
  return lines;
}

// --- init / init-session ---------------------------------------------------

export function renderInit(output: InitProjectOutput): string[] {
  if (!output.configCreated) {
    return [
      `left existing config unchanged (${output.configPath})`,
      output.gitignoreUpdated
        ? "ensured runtime ignore rules"
        : "runtime ignore rules already present",
    ];
  }

  return [
    `initialized asem project (${output.configPath})`,
    "",
    "Next steps:",
    "  asem init-session --name <name> --mux-ref '<json>' --root",
    "  asem session create <name> --prompt '<text>'",
    "  asem tui",
  ];
}

/**
 * Shell exports for the registered current Session. Values are shell-escaped so
 * the block is safe to `eval "$(asem init-session ...)"`. The raw token appears
 * only here, on stdout for the caller to consume — never in logs (the operation
 * is given no token to log).
 */
export function renderInitSessionExports(output: InitSessionOutput): string[] {
  const { session, token } = output;
  return [
    `export AS_SESSION_ID=${shellEscape(session.id)}`,
    `export AS_SESSION_TOKEN=${shellEscape(token)}`,
    `export AS_WORKSPACE_ID=${shellEscape(session.workspaceId)}`,
    `export AS_WORKTREE_ROOT=${shellEscape(session.worktreeRoot)}`,
  ];
}
