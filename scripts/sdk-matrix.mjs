#!/usr/bin/env node
/**
 * Check and test the source against pinned Pi SDK baselines.
 *
 * The extension is host-agnostic at runtime (dist bundles keep
 * @earendil-works/* external), but the source and tests are compiled and run
 * against the devDependency SDK trio (pi-ai / pi-coding-agent / pi-tui, which
 * release in lockstep). Supported hosts are Pi >=1.4.0 <1.6.0, so CI pins the
 * oldest (1.4.0) and newest tested (1.5.2) baselines instead of drifting with
 * whatever `^` resolves on the day.
 *
 * Each run reinstalls the trio at an exact version with --no-save (neither
 * package.json nor package-lock.json changes), then runs `npm run check` and
 * `npm test` against it. The tests exercise provider registration, message and
 * tool-call event sequences, usage/stopReason and error recovery through the
 * real SDK modules — no live Qoder traffic.
 *
 * Usage:
 *   node scripts/sdk-matrix.mjs                 # pinned baselines: 1.4.0, 1.5.2
 *   node scripts/sdk-matrix.mjs 1.5.1           # explicit versions, in the given order
 *   PI_SDK_VERSIONS=1.4.0,1.5.2 node scripts/sdk-matrix.mjs
 *
 * The default order is ascending, so the tree is left at 1.5.2 — the version
 * package-lock.json resolves. `npm ci` restores that baseline at any time.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TRIO = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];
// Oldest and newest supported hosts. Keep these exact pins: "latest" is not a
// baseline, and 1.6+ is untested (and unsupported) until this list says so.
const DEFAULT_VERSIONS = ["1.4.0", "1.5.2"];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const argVersions = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const envVersions = (process.env.PI_SDK_VERSIONS ?? "")
  .split(",")
  .map((version) => version.trim())
  .filter(Boolean);
const versions = argVersions.length > 0 ? argVersions : envVersions.length > 0 ? envVersions : DEFAULT_VERSIONS;

function run(title, args) {
  console.log(`\n=== ${title} ===`);
  const result = spawnSync(npm, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`${title}: failed to spawn npm: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

function installedVersion(packageName) {
  try {
    return JSON.parse(readFileSync(`node_modules/${packageName}/package.json`, "utf8")).version;
  } catch {
    return undefined;
  }
}

console.log(`Pi SDK matrix: ${versions.join(", ")}`);
const failed = [];

for (const version of versions) {
  const label = `Pi SDK ${version}`;
  const specs = TRIO.map((packageName) => `${packageName}@${version}`);
  const installed =
    run(`${label}: install`, ["install", "--no-save", "--no-audit", "--no-fund", ...specs]) &&
    TRIO.every((packageName) => installedVersion(packageName) === version);
  if (!installed) {
    const resolved = TRIO.map((packageName) => `${packageName}@${installedVersion(packageName) ?? "missing"}`);
    console.error(`${label}: resolved ${resolved.join(", ")}, expected all @${version}`);
    failed.push(`${label}: install`);
    continue;
  }

  if (!run(`${label}: npm run check`, ["run", "check"])) failed.push(`${label}: check`);
  if (!run(`${label}: npm test`, ["test"])) failed.push(`${label}: test`);
}

console.log("");
if (failed.length > 0) {
  console.error(`Pi SDK matrix FAILED:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
console.log(`Pi SDK matrix passed: ${versions.join(", ")}`);
