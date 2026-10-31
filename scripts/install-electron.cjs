const path = require("node:path");
const { spawnSync } = require("node:child_process");

const electronPackage = path.join(
  process.cwd(),
  "node_modules",
  "electron"
);
const installer = path.join(electronPackage, "install.js");
const env = { ...process.env };

for (const key of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy"
]) {
  delete env[key];
}

env.ELECTRON_MIRROR =
  env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";

const result = spawnSync(process.execPath, [installer], {
  env,
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
