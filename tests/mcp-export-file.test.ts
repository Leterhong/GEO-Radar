import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { safeCsvFilename, writeCsvFile } from "../packages/geo-radar-mcp/export-file.mjs";

describe("MCP CSV file export safety", () => {
  it("rejects path separators and unsafe names", () => {
    expect(() => safeCsvFilename("../escape.csv")).toThrow();
    expect(() => safeCsvFilename("a/b.csv")).toThrow();
    expect(() => safeCsvFilename("a.txt")).toThrow();
    expect(safeCsvFilename("geo-2026.csv")).toBe("geo-2026.csv");
  });

  it("writes inside the allowed directory without overwriting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "geo-export-"));
    try {
      const first = await writeCsvFile({ csv: "\uFEFFa,b\n中文,1\n", exportDir: dir, filename: "same.csv" });
      const second = await writeCsvFile({ csv: "a,b\n2,3\n", exportDir: dir, filename: "same.csv" });
      expect(first.path).not.toBe(second.path);
      expect(await readFile(first.path, "utf8")).toBe("\uFEFFa,b\n中文,1\n");
      expect(second.filename).toBe("same-1.csv");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a directory outside the configured root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "geo-export-"));
    try {
      await expect(
        writeCsvFile({ csv: "a,b\n", exportDir: dir, outputDirectory: resolve(dir, "..") })
      ).rejects.toThrow(/inside GEO_RADAR_EXPORT_DIR/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
