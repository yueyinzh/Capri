const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const root = path.join(__dirname, "..");
const emotionPath = path.join(root, "config", "emotions.json");
const dialoguePath = path.join(root, "config", "dialogues.json");
const settingsPath = path.join(root, "config", "default-settings.json");

const emotions = JSON.parse(fs.readFileSync(emotionPath, "utf8"));
const dialogues = JSON.parse(fs.readFileSync(dialoguePath, "utf8"));
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

const frameIds = new Set(Object.keys(emotions.frames));
const stateEntries = Object.entries(emotions.states);
const requiredStates = [
  "idle",
  "blink",
  "click",
  "drag",
  "sleep",
  "happy",
  "angry",
  "sad",
  "surprised"
];

if (!stateEntries.length) {
  throw new Error("emotions.json 没有状态定义");
}

for (const stateName of requiredStates) {
  if (!emotions.states[stateName]) {
    throw new Error(`缺少必要状态 ${stateName}`);
  }
}

for (const [stateName, state] of stateEntries) {
  if (!Array.isArray(state.frames) || state.frames.length === 0) {
    throw new Error(`状态 ${stateName} 没有表情帧`);
  }
  for (const frameId of state.frames) {
    if (!frameIds.has(frameId)) {
      throw new Error(`状态 ${stateName} 引用了不存在的帧 ${frameId}`);
    }
  }
  if (state.onEnd && state.onEnd !== "idle" && state.onEnd !== "randomEmotion") {
    throw new Error(`状态 ${stateName} 的 onEnd 无效`);
  }
}

for (const [frameId, frame] of Object.entries(emotions.frames)) {
  if (!Array.isArray(frame.rect) || frame.rect.length !== 4) {
    throw new Error(`帧 ${frameId} 的 rect 无效`);
  }
  const assetPath = path.join(root, frame.file);
  if (!fs.existsSync(assetPath)) {
    throw new Error(`缺少表情文件 ${frame.file}，请先运行 npm run prepare:assets`);
  }
  const png = PNG.sync.read(fs.readFileSync(assetPath));
  if (
    png.width !== emotions.canvas.width ||
    png.height !== emotions.canvas.height
  ) {
    throw new Error(`帧 ${frameId} 的画布尺寸不正确`);
  }

  let transparentPixels = 0;
  let opaquePixels = 0;
  for (let offset = 3; offset < png.data.length; offset += 4) {
    if (png.data[offset] === 0) transparentPixels += 1;
    if (png.data[offset] === 255) opaquePixels += 1;
  }
  if (transparentPixels === 0 || opaquePixels === 0) {
    throw new Error(`帧 ${frameId} 没有有效透明通道`);
  }
}

const trayPath = path.join(root, "assets", "tray", "mojie_tray.png");
if (!fs.existsSync(trayPath)) {
  throw new Error("缺少托盘图标");
}
const tray = PNG.sync.read(fs.readFileSync(trayPath));
if (tray.width !== 64 || tray.height !== 64) {
  throw new Error("托盘图标必须是 64 × 64");
}

if (
  !Array.isArray(emotions.blinkIntervalMs) ||
  !Array.isArray(emotions.microActionIntervalMs)
) {
  throw new Error("缺少眨眼或待机动画间隔配置");
}

if (!dialogues.click || !dialogues.drag || !dialogues.sleep) {
  throw new Error("dialogues.json 缺少必要对话组");
}

console.log(`配置检查通过：${frameIds.size} 帧，${stateEntries.length} 个状态`);
