const fs = require("node:fs/promises");
const path = require("node:path");
const { isPathWithinOrEqual } = require("./paths");

class ScanLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScanLimitError";
    this.code = "SCAN_LIMIT_EXCEEDED";
  }
}

async function scanGroup(group, options) {
  const files = [];
  const directories = [];
  const warnings = [];
  const stack = [group.path];
  let fileCount = 0;
  let directoryCount = 0;
  let totalBytes = 0;
  let skippedEntries = 0;
  let lastProgressAt = 0;

  while (stack.length > 0) {
    if (options.isCancelled()) {
      throw new Error("扫描已取消");
    }
    if (Date.now() - options.startedAt > options.maxDurationMs) {
      throw new ScanLimitError("扫描超时，请缩小清理范围后重试");
    }

    const currentDirectory = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      skippedEntries += 1;
      if (warnings.length < 20) {
        warnings.push({
          path: currentDirectory,
          code: error.code || "READ_FAILED",
          message: error.message
        });
      }
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (!isPathWithinOrEqual(entryPath, group.path)) {
        skippedEntries += 1;
        continue;
      }

      if (entry.isSymbolicLink()) {
        skippedEntries += 1;
        if (warnings.length < 20) {
          warnings.push({
            path: entryPath,
            code: "SYMLINK_SKIPPED",
            message: "符号链接或目录联接不会被跟随"
          });
        }
        continue;
      }

      let stat;
      try {
        stat = await fs.lstat(entryPath);
      } catch (error) {
        skippedEntries += 1;
        continue;
      }

      if (stat.isSymbolicLink()) {
        skippedEntries += 1;
        continue;
      }

      if (stat.isDirectory()) {
        directoryCount += 1;
        directories.push({ path: entryPath });
        stack.push(entryPath);
      } else if (stat.isFile()) {
        if (
          group.minAgeMs > 0 &&
          Date.now() - stat.mtimeMs < group.minAgeMs
        ) {
          skippedEntries += 1;
          continue;
        }
        fileCount += 1;
        totalBytes += stat.size;
        files.push({ path: entryPath, size: stat.size });
      } else {
        skippedEntries += 1;
      }

      if (fileCount > options.maxFiles) {
        throw new ScanLimitError(
          `文件数量超过安全上限 ${options.maxFiles}，未生成可执行清理计划`
        );
      }

      const now = Date.now();
      if (now - lastProgressAt >= 120) {
        lastProgressAt = now;
        options.onProgress({
          phase: "scan",
          groupId: group.id,
          groupLabel: group.label,
          currentPath: currentDirectory,
          scannedFiles: fileCount,
          discoveredBytes: totalBytes
        });
      }
    }
  }

  return {
    ...group,
    files,
    directories,
    fileCount,
    directoryCount,
    totalBytes,
    skippedEntries,
    warnings
  };
}

async function scanGroups(groups, options) {
  const scanned = [];
  const startedAt = Date.now();

  for (const group of groups) {
    const result = await scanGroup(group, {
      ...options,
      startedAt,
      maxDurationMs: options.maxDurationMs || 120000,
      maxFiles: options.maxFiles || 500000
    });
    scanned.push(result);
  }

  return scanned;
}

module.exports = {
  ScanLimitError,
  scanGroups
};
