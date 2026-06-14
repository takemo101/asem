import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  homePath,
  integrationTargetError,
  readJsonObject,
  workspacePath,
  writeJsonObjectAtomic,
} from "../src/shared.ts";

describe("integration shared helpers", () => {
  test("resolves home and workspace paths from injected roots", () => {
    expect(homePath({ home: "/home/test" }, ".config", "mcp", "mcp.json")).toBe(
      "/home/test/.config/mcp/mcp.json",
    );
    expect(workspacePath({ cwd: "/repo" }, ".mcp.json")).toBe(
      "/repo/.mcp.json",
    );
  });

  test("readJsonObject returns an empty object for a missing file", () => {
    const dir = mktemp();
    expect(readJsonObject(join(dir, "missing.json"))).toEqual({});
  });

  test("readJsonObject rejects invalid JSON", async () => {
    const dir = mktemp();
    const path = join(dir, "bad.json");
    await Bun.write(path, "{");
    expect(() => readJsonObject(path)).toThrow("Invalid JSON");
  });

  test("writeJsonObjectAtomic creates parents and preserves existing mode", () => {
    const dir = mktemp();
    const path = join(dir, "nested", "config.json");
    writeJsonObjectAtomic(path, { a: 1 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ a: 1 });
    chmodSync(path, 0o640);
    writeJsonObjectAtomic(path, { b: 2 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ b: 2 });
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
  });

  test("integrationTargetError carries a stable code", () => {
    const error = integrationTargetError(
      "unknown_target",
      "Unknown Integration Target: nope",
    );
    expect(error.code).toBe("unknown_target");
    expect(error.message).toBe("Unknown Integration Target: nope");
  });
});

function mktemp(): string {
  return join(tmpdir(), `asem-integrations-${crypto.randomUUID()}`);
}
