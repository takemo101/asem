import { expect } from "bun:test";
import type { OperationError, OperationResult } from "@asem/core";
import type { ProfileFs } from "../src/index.ts";

/** Assert an OperationResult is ok and return its value. */
export function expectOk<T>(result: OperationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Assert an OperationResult failed with `code` and return the error. */
export function expectErr<T>(
  result: OperationResult<T>,
  code: OperationError["code"],
): OperationError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected error ${code}, got ok`);
  }
  expect(result.error.code).toBe(code);
  return result.error;
}

/** In-memory {@link ProfileFs} keyed by absolute file path. */
export class FakeProfileFs implements ProfileFs {
  readonly files = new Map<string, string>();
  /** Directories that `exists` reports present even with no files (e.g. unreadable). */
  readonly emptyDirs = new Set<string>();
  /** Paths whose `readDir` should throw, simulating an unreadable directory. */
  readonly readDirErrors = new Set<string>();
  /** Paths whose `readFile` should throw, simulating an unreadable file. */
  readonly readFileErrors = new Set<string>();

  set(path: string, contents: string): this {
    this.files.set(path, contents);
    return this;
  }

  failReadDir(path: string): this {
    this.emptyDirs.add(path);
    this.readDirErrors.add(path);
    return this;
  }

  failReadFile(path: string): this {
    this.readFileErrors.add(path);
    return this;
  }

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path) || this.emptyDirs.has(path)) return true;
    const prefix = `${path.replace(/\/+$/, "")}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async readFile(path: string): Promise<string> {
    if (this.readFileErrors.has(path)) {
      throw Object.assign(new Error(`EACCES: permission denied: ${path}`), {
        code: "EACCES",
      });
    }
    const contents = this.files.get(path);
    if (contents === undefined) {
      throw new Error(`FakeProfileFs: no such file: ${path}`);
    }
    return contents;
  }

  async readDir(path: string): Promise<string[]> {
    if (this.readDirErrors.has(path)) {
      throw Object.assign(new Error(`EACCES: permission denied: ${path}`), {
        code: "EACCES",
      });
    }
    const prefix = `${path.replace(/\/+$/, "")}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
      }
    }
    return [...names];
  }
}

/** A minimal valid profile file body. */
export function profileFile(
  frontmatter: Record<string, string>,
  body = "do the thing",
): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}
