const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const CASE_INSENSITIVE = process.platform === "win32";

function normalizeForCompare(value) {
  const resolved = path.resolve(value);
  return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved;
}

function isPathWithinOrEqual(candidate, root) {
  const normalizedCandidate = normalizeForCompare(candidate);
  const normalizedRoot = normalizeForCompare(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function isSamePath(left, right) {
  return normalizeForCompare(left) === normalizeForCompare(right);
}

function hardDeniedRoots() {
  const roots = [];
  const home = os.homedir();
  const volumeRoot = path.parse(home).root;

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    roots.push(
      systemRoot,
      path.join(systemRoot, "System32"),
      process.env.ProgramFiles || "C:\\Program Files",
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      process.env.ProgramData || "C:\\ProgramData"
    );
  } else {
    roots.push(
      "/etc",
      "/usr",
      "/bin",
      "/sbin",
      "/System",
      "/Library",
      "/private/etc",
      "/private/var/root",
      "/dev",
      "/proc",
      "/sys"
    );
  }

  return {
    forbiddenTrees: roots.map((item) => path.resolve(item)),
    forbiddenExact: [volumeRoot, home].map((item) => path.resolve(item))
  };
}

function isHardDeniedPath(candidate) {
  const resolved = path.resolve(candidate);
  const { forbiddenTrees, forbiddenExact } = hardDeniedRoots();

  if (forbiddenExact.some((root) => isSamePath(root, resolved))) {
    return true;
  }
  return forbiddenTrees.some((root) => isPathWithinOrEqual(resolved, root));
}

async function safeRealDirectory(candidate) {
  if (!candidate || typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    return null;
  }

  try {
    const resolved = path.resolve(candidate);
    const linkStat = await fs.lstat(resolved);
    if (!linkStat.isDirectory() || linkStat.isSymbolicLink()) return null;
    const realPath = await fs.realpath(resolved);
    const realStat = await fs.lstat(realPath);
    if (!realStat.isDirectory() || isHardDeniedPath(realPath)) return null;
    return realPath;
  } catch {
    return null;
  }
}

async function uniqueSafeDirectories(candidates) {
  const result = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const safePath = await safeRealDirectory(candidate);
    if (!safePath) continue;
    const key = normalizeForCompare(safePath);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(safePath);
  }

  return result;
}

async function getTempDirectories() {
  const candidates = [];
  try {
    candidates.push(app.getPath("temp"));
  } catch {
    // Continue with os.tmpdir().
  }
  candidates.push(os.tmpdir());
  return uniqueSafeDirectories(candidates);
}

function browserDataBases() {
  const home = os.homedir();
  const appData = app.getPath("appData");
  const localAppData =
    process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");

  if (process.platform === "win32") {
    return [
      {
        browser: "Chrome",
        category: "chrome-cache",
        bases: [path.join(localAppData, "Google", "Chrome", "User Data")]
      },
      {
        browser: "Edge",
        category: "edge-cache",
        bases: [path.join(localAppData, "Microsoft", "Edge", "User Data")]
      }
    ];
  }

  if (process.platform === "darwin") {
    return [
      {
        browser: "Chrome",
        category: "chrome-cache",
        bases: [
          path.join(home, "Library", "Application Support", "Google", "Chrome"),
          path.join(home, "Library", "Caches", "Google", "Chrome")
        ]
      },
      {
        browser: "Edge",
        category: "edge-cache",
        bases: [
          path.join(home, "Library", "Application Support", "Microsoft Edge"),
          path.join(home, "Library", "Caches", "Microsoft Edge")
        ]
      }
    ];
  }

  return [
    {
      browser: "Chrome",
      category: "chrome-cache",
      bases: [
        path.join(home, ".config", "google-chrome"),
        path.join(home, ".cache", "google-chrome")
      ]
    },
    {
      browser: "Edge",
      category: "edge-cache",
      bases: [
        path.join(home, ".config", "microsoft-edge"),
        path.join(home, ".cache", "microsoft-edge")
      ]
    }
  ];
}

async function discoverBrowserCacheDirectories() {
  const result = [];
  const seen = new Set();
  const cacheNames = ["Cache", "Code Cache", "GPUCache"];

  for (const vendor of browserDataBases()) {
    for (const base of vendor.bases) {
      const safeBase = await safeRealDirectory(base);
      if (!safeBase) continue;

      let entries = [];
      try {
        entries = await fs.readdir(safeBase, { withFileTypes: true });
      } catch {
        continue;
      }

      const profileNames = entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            (entry.name === "Default" ||
              entry.name === "Guest Profile" ||
              /^Profile \d+$/.test(entry.name))
        )
        .map((entry) => entry.name);

      for (const profileName of profileNames) {
        for (const cacheName of cacheNames) {
          const candidate = path.join(safeBase, profileName, cacheName);
          const safePath = await safeRealDirectory(candidate);
          if (!safePath) continue;
          const key = normalizeForCompare(safePath);
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({
            category: vendor.category,
            browser: vendor.browser,
            profile: profileName,
            path: safePath
          });
        }
      }
    }
  }

  return result;
}

async function getLogDirectories() {
  const candidates = [];
  try {
    candidates.push(app.getPath("logs"));
  } catch {
    // userData/logs remains a safe fallback.
  }
  candidates.push(path.join(app.getPath("userData"), "logs"));
  return uniqueSafeDirectories(candidates);
}

module.exports = {
  discoverBrowserCacheDirectories,
  getLogDirectories,
  getTempDirectories,
  isHardDeniedPath,
  isPathWithinOrEqual,
  isSamePath,
  normalizeForCompare,
  safeRealDirectory
};
