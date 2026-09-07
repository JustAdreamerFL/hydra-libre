const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const run = (args, options = {}) =>
  execFileSync("git", args, { stdio: "inherit", ...options });
const output = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const upstreamUrl = "https://github.com/hydralauncher/hydra.git";
const baseFile = ".github/upstream-base";

try {
  const remotes = output(["remote"]).split(/\s+/).filter(Boolean);
  if (!remotes.includes("upstream"))
    run(["remote", "add", "upstream", upstreamUrl]);
  run(["fetch", "--no-tags", "upstream", "main"]);

  let hasMergeBase = true;
  try {
    output(["merge-base", "HEAD", "upstream/main"]);
  } catch {
    hasMergeBase = false;
  }

  if (hasMergeBase) {
    // Keep local Libre changes when upstream edits the same hunk. The pull
    // request created by the workflow is still reviewed before it lands.
    run(["merge", "--no-edit", "--no-ff", "-X", "ours", "upstream/main"]);
    process.exit(0);
  }

  // The fork was imported as a source snapshot, so there is no shared parent
  // in a fresh hydra-libre clone. The recorded base is the upstream commit
  // from which the imported fork diverged. A three-tree index merge lets us
  // retain non-conflicting upstream work and keep Libre's files on conflicts.
  const base = fs.readFileSync(baseFile, "utf8").trim();
  run(["cat-file", "-e", `${base}^{commit}`]);
  run(["read-tree", "-m", base, "HEAD", "upstream/main"]);

  const unmerged = output(["ls-files", "-u"]);
  if (unmerged) {
    console.log("Resolving bootstrap conflicts in favor of hydra-libre...");
    const stageByPath = new Map();
    for (const entry of unmerged.split("\n")) {
      if (!entry) continue;
      const tab = entry.indexOf("\t");
      if (tab === -1) continue;
      const path = entry.slice(tab + 1);
      if (!path) continue;
      const metadata = entry.slice(0, tab).trim().split(/\s+/);
      const stage = Number(metadata[2]);
      if (!stageByPath.has(path)) stageByPath.set(path, new Set());
      stageByPath.get(path).add(stage);
    }

    const oursPaths = [];
    const theirsOnlyPaths = [];
    for (const [path, stages] of stageByPath) {
      if (stages.has(2)) oursPaths.push(path);
      else theirsOnlyPaths.push(path);
    }

    // Only add conflict paths. The index already contains the merged result
    // for every non-conflicting path; `git add --all` would replace those
    // results with the old working tree and silently drop upstream changes.
    if (oursPaths.length) {
      run(["checkout", "--ours", "--", ...oursPaths]);
      run(["add", "--", ...oursPaths]);
    }
    if (theirsOnlyPaths.length) {
      run(["checkout", "--theirs", "--", ...theirsOnlyPaths]);
      run(["add", "--", ...theirsOnlyPaths]);
    }
  }

  const tree = output(["write-tree"]);
  const commit = execFileSync(
    "git",
    [
      "commit-tree",
      tree,
      "-p",
      "HEAD",
      "-p",
      "upstream/main",
      "-m",
      "chore: bootstrap upstream history",
    ],
    { encoding: "utf8" }
  ).trim();
  run(["reset", "--hard", commit]);
  console.log(`Created upstream bootstrap merge ${commit}.`);
} catch (error) {
  console.error("Unable to synchronize upstream:", error.message);
  try {
    run(["read-tree", "--reset", "HEAD"]);
  } catch {
    // Preserve the original error; the caller can use git merge --abort if
    // another operation had already placed the repository in a merge state.
  }
  process.exitCode = 1;
}
