import { execFileSync } from "node:child_process";

const BASE_VERSION = "0.1";
const BASE_REF = "36bcbf8642423f9983a21b5aed91c6c2b959947b";

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

export function getAppVersion(): string {
  try {
    const commitsSinceBase = Number(runGit(["rev-list", "--count", `${BASE_REF}..HEAD`]));
    const shortSha = runGit(["rev-parse", "--short", "HEAD"]);
    const dirty = runGit(["status", "--porcelain"]).length > 0;

    if (!Number.isFinite(commitsSinceBase) || commitsSinceBase <= 0) {
      return dirty ? `v${BASE_VERSION}-dev` : `v${BASE_VERSION}`;
    }

    return `v${BASE_VERSION}.${commitsSinceBase}+${shortSha}${dirty ? ".dev" : ""}`;
  } catch {
    return `v${BASE_VERSION}`;
  }
}
