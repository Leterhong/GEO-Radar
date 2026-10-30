/**
 * Safe CSV file output for the MCP server.
 *
 * File mode is disabled unless GEO_RADAR_EXPORT_DIR is configured. The MCP
 * server is a stdio process, so this writes on the MCP host machine, not on
 * the GEO Radar web server. It never returns a download URL.
 */
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";

export function isPathInside(root, candidate) {
  const rootResolved = resolve(root);
  const target = resolve(candidate);
  const rootCmp = process.platform === "win32" ? rootResolved.toLowerCase() : rootResolved;
  const targetCmp = process.platform === "win32" ? target.toLowerCase() : target;
  return targetCmp === rootCmp || targetCmp.startsWith(rootCmp + sep);
}

export function safeCsvFilename(filename, now = new Date()) {
  if (filename === undefined || filename === "") {
    return `georadar-evidence-${now.toISOString().slice(0, 10)}.csv`;
  }
  if (basename(filename) !== filename) throw new Error("filename must not contain a path");
  if (!/^[A-Za-z0-9._-]{1,120}\.csv$/i.test(filename)) {
    throw new Error("filename must be 1-120 chars of letters/numbers/dot/underscore/dash and end with .csv");
  }
  return filename;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

/**
 * @param {{ csv: string, exportDir: string, outputDirectory?: string, filename?: string, now?: Date }} options
 */
export async function writeCsvFile(options) {
  const { csv, exportDir, outputDirectory, filename, now = new Date() } = options;
  if (!exportDir || !isAbsolute(exportDir)) {
    throw new Error("File export is disabled: set GEO_RADAR_EXPORT_DIR to an absolute allowed directory.");
  }
  const root = resolve(exportDir);
  const requestedDir = outputDirectory ? resolve(outputDirectory) : root;
  if (!isPathInside(root, requestedDir)) {
    throw new Error("outputDirectory must be inside GEO_RADAR_EXPORT_DIR");
  }
  await mkdir(requestedDir, { recursive: true });
  const rootReal = await realpath(root);
  const dirReal = await realpath(requestedDir);
  if (!isPathInside(rootReal, dirReal)) {
    throw new Error("outputDirectory resolves outside GEO_RADAR_EXPORT_DIR");
  }
  const safeName = safeCsvFilename(filename, now);
  const stem = safeName.replace(/\.csv$/i, "");
  let target = resolve(requestedDir, safeName);
  let suffix = 1;
  while (await exists(target)) {
    target = resolve(requestedDir, `${stem}-${suffix}.csv`);
    suffix += 1;
    if (suffix > 1000) throw new Error("could not allocate a unique CSV filename");
  }
  if (!isPathInside(root, target)) throw new Error("resolved CSV path escaped the allowed directory");
  await writeFile(target, csv, { encoding: "utf8", flag: "wx" });
  return { path: target, filename: target.split(/[\\/]/).pop(), bytes: Buffer.byteLength(csv, "utf8") };
}
