/**
 * Markdown + YAML frontmatter parser for user/project Agent Profile files.
 *
 * Parse, don't merely check (implementation principle 1): a profile file is
 * either turned into a typed {@link ResolvedProfile} or a structured
 * `invalid_config` error carrying the offending path. The frontmatter schema is
 * `.strict()`, so unknown fields are rejected in MVP to keep profile files small
 * and intentional (design "Profile file format").
 */
import {
  err,
  type OperationResult,
  ok,
  operationError,
  type ProfileSource,
} from "@asem/core";
import { z } from "zod";
import type { ResolvedProfile } from "./types.ts";

/** Bun's global YAML parser, used the same way as the CLI config loader. */
const yaml = (Bun as unknown as { YAML: { parse(text: string): unknown } })
  .YAML;

const frontmatterSchema = z
  .object({
    id: z.string().min(1, "profile id is required and must be non-empty"),
    description: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();

/** Split a `---\n…\n---\n` frontmatter block from the Markdown body. */
function splitFrontmatter(
  text: string,
): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(text);
  if (match === null) {
    return null;
  }
  return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

/**
 * Parse one profile file's text into a {@link ResolvedProfile} tagged with
 * `source` and the originating `path`. Missing frontmatter, malformed YAML,
 * unknown/invalid frontmatter fields, a missing `id`, or an empty body all fail
 * with `invalid_config` and report the path.
 */
export function parseProfileFile(
  text: string,
  source: ProfileSource,
  path: string,
): OperationResult<ResolvedProfile> {
  const split = splitFrontmatter(text);
  if (split === null) {
    return err(
      operationError(
        "invalid_config",
        "profile file is missing YAML frontmatter",
        { path },
      ),
    );
  }

  let raw: unknown;
  try {
    raw = yaml.parse(split.frontmatter);
  } catch (error) {
    return err(
      operationError(
        "invalid_config",
        "profile frontmatter is not valid YAML",
        {
          path,
          issues: [error instanceof Error ? error.message : String(error)],
        },
      ),
    );
  }

  const parsed = frontmatterSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return err(
      operationError("invalid_config", "invalid profile frontmatter", {
        path,
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }

  const instructions = split.body.trim();
  if (instructions.length === 0) {
    return err(
      operationError(
        "invalid_config",
        "profile body is required and must be non-empty",
        { path },
      ),
    );
  }

  return ok({
    id: parsed.data.id,
    source,
    description: parsed.data.description ?? null,
    agent: parsed.data.agent ?? null,
    model: parsed.data.model ?? null,
    instructions,
  });
}
