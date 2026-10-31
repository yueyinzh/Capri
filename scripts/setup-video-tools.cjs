const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const API_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

function platformFolder() {
  return `${process.platform}-${process.arch}`;
}

function assetName() {
  if (process.platform === "win32") {
    if (process.arch === "arm64") return "yt-dlp_arm64.exe";
    if (process.arch === "ia32") return "yt-dlp_x86.exe";
    return "yt-dlp.exe";
  }
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  }
  throw new Error(`不支持的平台：${process.platform}-${process.arch}`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function fetchChecked(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "follow",
    signal: AbortSignal.timeout(180000),
    headers: {
      "User-Agent": "capri-desktop-pet",
      ...options.headers
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}：${url}`);
  }
  return response;
}

async function main() {
  const commandName =
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const outputDir = path.join(ROOT, "tools", "bin", platformFolder());
  const outputPath = path.join(outputDir, commandName);
  const manifestPath = path.join(outputDir, "manifest.json");

  const releaseResponse = await fetchChecked(API_URL, {
    headers: { Accept: "application/vnd.github+json" }
  });
  const release = await releaseResponse.json();
  const asset = release.assets.find((item) => item.name === assetName());
  if (!asset) {
    throw new Error(`官方发布中找不到 ${assetName()}`);
  }
  if (!asset.digest?.startsWith("sha256:")) {
    throw new Error("官方发布未提供 SHA-256 摘要，拒绝安装");
  }
  const expectedHash = asset.digest.slice("sha256:".length).toLowerCase();

  if (fs.existsSync(outputPath)) {
    const existingHash = sha256(await fsp.readFile(outputPath));
    if (existingHash === expectedHash) {
      console.log(`yt-dlp 已是最新版本：${release.tag_name}`);
      await writeManifest(manifestPath, release, asset, expectedHash);
      await ensureExecutable(outputPath);
      return;
    }
  }

  await fsp.mkdir(outputDir, { recursive: true });
  const assetResponse = await fetchChecked(asset.url, {
    headers: { Accept: "application/octet-stream" }
  });
  const advertisedSize = Number(assetResponse.headers.get("content-length"));
  if (advertisedSize > MAX_DOWNLOAD_BYTES) {
    throw new Error("yt-dlp 下载文件大小异常");
  }
  const buffer = Buffer.from(await assetResponse.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new Error("yt-dlp 下载文件大小异常");
  }
  const actualHash = sha256(buffer);
  if (actualHash !== expectedHash) {
    throw new Error("yt-dlp SHA-256 校验失败，未写入磁盘");
  }

  const tempPath = `${outputPath}.download`;
  await fsp.writeFile(tempPath, buffer, { mode: 0o755 });
  await fsp.rename(tempPath, outputPath);
  await ensureExecutable(outputPath);
  await writeManifest(manifestPath, release, asset, expectedHash);
  console.log(
    `已安装 yt-dlp ${release.tag_name}：${path.relative(ROOT, outputPath)}`
  );
}

async function ensureExecutable(filePath) {
  if (process.platform !== "win32") {
    await fsp.chmod(filePath, 0o755);
  }
}

async function writeManifest(manifestPath, release, asset, hash) {
  const manifest = {
    name: "yt-dlp",
    release: release.tag_name,
    asset: asset.name,
    sha256: hash,
    source: asset.browser_download_url,
    license: "Unlicense; see https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE"
  };
  await fsp.writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

main().catch((error) => {
  console.error(`视频工具安装失败：${error.message}`);
  process.exitCode = 1;
});
