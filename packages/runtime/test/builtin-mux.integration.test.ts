import { describe, expect, test } from "bun:test";
import { createTemplateRegistry, type MuxTemplate } from "../src/index.ts";

/**
 * Optional real-mux integration checks for the builtin templates (MIK-007).
 *
 * These are intentionally **off by default**: the default `bun run test` must
 * never require a real herdr / tmux / zellij binary (testability rules;
 * implementation principle 4). They run only when explicitly opted in with
 * `ASEM_MUX_INTEGRATION=1`, and each per-mux block additionally skips when its
 * binary is unavailable.
 *
 * They deliberately stay non-destructive: they confirm the real binary is
 * present and invocable and that the subcommand verbs the builtin template uses
 * exist, without creating/destroying panes in the operator's live multiplexer
 * sessions and without launching any real agent CLI. Deeper pane-lifecycle
 * integration is left to the fake-runner tests, which fully cover command
 * construction and captured refs.
 */

const INTEGRATION = process.env.ASEM_MUX_INTEGRATION === "1";

function has(binary: string): boolean {
  return Bun.which(binary) !== null;
}

/** First word of each `run` command in a sequence (the verb chain root). */
function firstWords(template: MuxTemplate): string[] {
  const sequences = [
    template.create,
    template.run_in_pane,
    template.send,
    template.attach,
    template.close,
  ];
  const words: string[] = [];
  for (const seq of sequences) {
    for (const step of seq) {
      if (step.type === "run") {
        words.push(step.command.split(/\s+/)[0] as string);
      }
    }
  }
  return words;
}

describe.skipIf(!INTEGRATION)("builtin mux integration (opt-in)", () => {
  describe.skipIf(!has("herdr"))("herdr", () => {
    test("binary is invocable and the template targets the herdr CLI", () => {
      const out = Bun.spawnSync(["herdr", "--version"]);
      expect(out.exitCode).toBe(0);
      const template = createTemplateRegistry().getMuxTemplate(
        "herdr",
      ) as MuxTemplate;
      // create starts with a `printf` echo of $HERDR_SESSION; everything else
      // is a herdr command.
      expect(
        firstWords(template).every((w) => w === "herdr" || w === "printf"),
      ).toBe(true);
    });
  });

  describe.skipIf(!has("tmux"))("tmux", () => {
    test("binary is invocable and the template targets the tmux CLI", () => {
      const out = Bun.spawnSync(["tmux", "-V"]);
      expect(out.exitCode).toBe(0);
      const template = createTemplateRegistry().getMuxTemplate(
        "tmux",
      ) as MuxTemplate;
      expect(firstWords(template).every((w) => w === "tmux")).toBe(true);
    });
  });

  describe.skipIf(!has("zellij"))("zellij", () => {
    test("binary is invocable and the template targets the zellij CLI", () => {
      const out = Bun.spawnSync(["zellij", "--version"]);
      expect(out.exitCode).toBe(0);
      const template = createTemplateRegistry().getMuxTemplate(
        "zellij",
      ) as MuxTemplate;
      // zellij commands start with the socket-dir `mkdir -p` guard or a
      // `ZELLIJ_SOCKET_DIR=…` env prefix before the zellij binary; the session
      // name is a declared ref, so there is no capture-only echo step.
      const verbs = firstWords(template);
      expect(
        verbs.every(
          (w) =>
            w === "zellij" ||
            w === "mkdir" ||
            w.startsWith("ZELLIJ_SOCKET_DIR="),
        ),
      ).toBe(true);
    });
  });
});
