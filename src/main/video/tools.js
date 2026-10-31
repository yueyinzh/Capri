const fs = require("node:fs");
const path = require("node:path");

function executableName(baseName) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function platformFolder() {
  return `${process.platform}-${process.arch}`;
}

function uniqueExisting(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    if (!candidate || seen.has(candidate)) return false;
    seen.add(candidate);
    return fs.existsSync(candidate);
  });
}

function resolveYtDlp(rootDir, userDataDir) {
  const name = executableName("yt-dlp");
  const candidates = [
    process.env.CAPRI_YTDLP_PATH,
    path.join(rootDir, "tools", "bin", platformFolder(), name),
    process.env.CAPRI_RESOURCES_PATH
      ? path.join(process.env.CAPRI_RESOURCES_PATH, "tools", "bin", platformFolder(), name)
      : null,
    process.resourcesPath
      ? path.join(process.resourcesPath, "tools", "bin", platformFolder(), name)
      : null,
    path.join(userDataDir, "video-tools", name)
  ];
  return uniqueExisting(candidates)[0] || null;
}

function resolveFfmpeg(rootDir, userDataDir) {
  const bundledName = executableName("ffmpeg");
  const candidates = [
    process.env.CAPRI_FFMPEG_PATH,
    path.join(rootDir, "tools", "bin", platformFolder(), bundledName),
    path.join(userDataDir, "video-tools", bundledName)
  ];

  try {
    candidates.push(require("@ffmpeg-installer/ffmpeg").path);
  } catch {
    // The UI will report that the optional ffmpeg dependency is unavailable.
  }

  return uniqueExisting(candidates)[0] || null;
}

function sanitizedEnvironment() {
  const env = { ...process.env };
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "ELECTRON_RUN_AS_NODE"
  ]) {
    delete env[key];
  }
  return env;
}

function resolveTools(rootDir, userDataDir) {
  const ytDlpPath = resolveYtDlp(rootDir, userDataDir);
  const ffmpegPath = resolveFfmpeg(rootDir, userDataDir);
  return {
    ytDlpPath,
    ffmpegPath,
    available: Boolean(ytDlpPath && ffmpegPath),
    missing: [
      !ytDlpPath ? "yt-dlp" : null,
      !ffmpegPath ? "ffmpeg" : null
    ].filter(Boolean)
  };
}

module.exports = {
  resolveTools,
  sanitizedEnvironment
};
