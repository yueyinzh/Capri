const fs = require("node:fs/promises");
const path = require("node:path");
const { isPathWithinOrEqual } = require("./paths");

function failureRecord(error, filePath) {
  return {
    path: filePath,
    code: error.code || "DELETE_FAILED",
    message: error.message || String(error)
  };
}

async function executePlan({ groups, isCancelled, onProgress }) {
  const startedAt = Date.now();
  let deletedFiles = 0;
  let deletedDirectories = 0;
  let skippedEntries = 0;
  let freedBytes = 0;
  let failureCount = 0;
  let cancelled = false;
  const failures = [];
  const totalBytes = groups.reduce((sum, group) => sum + group.totalBytes, 0);
  const totalFiles = groups.reduce((sum, group) => sum + group.fileCount, 0);
  let lastProgressAt = 0;

  const reportFailure = (error, filePath) => {
    failureCount += 1;
    if (failures.length < 200) {
      failures.push(failureRecord(error, filePath));
    }
  };

  const reportProgress = (currentPath, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 120) return;
    lastProgressAt = now;
    onProgress({
      phase: "delete",
      currentPath,
      processedBytes: freedBytes,
      totalBytes,
      processedFiles: deletedFiles,
      totalFiles
    });
  };

  for (const group of groups) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }

    for (const file of group.files) {
      if (isCancelled()) {
        cancelled = true;
        break;
      }

      const resolvedFile = path.resolve(file.path);
      if (!isPathWithinOrEqual(resolvedFile, group.path)) {
        skippedEntries += 1;
        continue;
      }

      try {
        const realFile = await fs.realpath(resolvedFile);
        if (!isPathWithinOrEqual(realFile, group.path)) {
          skippedEntries += 1;
          continue;
        }
        const stat = await fs.lstat(realFile);
        if (stat.isSymbolicLink()) {
          skippedEntries += 1;
          continue;
        }
        if (!stat.isFile()) {
          skippedEntries += 1;
          continue;
        }
        await fs.unlink(realFile);
        deletedFiles += 1;
        freedBytes += stat.size;
      } catch (error) {
        if (error.code === "ENOENT") {
          skippedEntries += 1;
        } else {
          reportFailure(error, resolvedFile);
        }
      }
      reportProgress(resolvedFile);
    }

    if (cancelled) break;

    const directories = [...group.directories].sort(
      (left, right) => right.path.length - left.path.length
    );
    for (const directory of directories) {
      if (isCancelled()) {
        cancelled = true;
        break;
      }
      if (!isPathWithinOrEqual(directory.path, group.path)) {
        skippedEntries += 1;
        continue;
      }
      try {
        const realDirectory = await fs.realpath(directory.path);
        if (!isPathWithinOrEqual(realDirectory, group.path)) {
          skippedEntries += 1;
          continue;
        }
        const stat = await fs.lstat(realDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          skippedEntries += 1;
          continue;
        }
        await fs.rmdir(realDirectory);
        deletedDirectories += 1;
      } catch (error) {
        if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code)) {
          reportFailure(error, directory.path);
        } else {
          skippedEntries += 1;
        }
      }
    }

    if (!cancelled && group.removeRoot) {
      try {
        const rootStat = await fs.lstat(group.path);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
          throw new Error("清理根目录已变为不可安全删除的类型");
        }
        await fs.rmdir(group.path);
        deletedDirectories += 1;
      } catch (error) {
        if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code)) {
          reportFailure(error, group.path);
        } else {
          skippedEntries += 1;
        }
      }
    }

    reportProgress(group.path, true);
  }

  reportProgress("", true);
  return {
    cancelled,
    deletedFiles,
    deletedDirectories,
    skippedEntries: skippedEntries + groups.reduce((sum, group) => sum + group.skippedEntries, 0),
    freedBytes,
    failureCount,
    failures,
    durationMs: Date.now() - startedAt
  };
}

module.exports = {
  executePlan
};
