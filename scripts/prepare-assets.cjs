const fs = require("node:fs");
const path = require("node:path");
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const root = path.join(__dirname, "..");
const configPath = path.join(root, "config", "emotions.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const sourcePath = path.join(root, config.source.file);
const outputDir = path.join(root, "assets", "emotions");
const trayPath = path.join(root, "assets", "tray", "mojie_tray.png");

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(trayPath), { recursive: true });

const hexToRgb = (hex) => {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
};

function colorDistance(r, g, b, bg) {
  return Math.max(
    Math.abs(r - bg[0]),
    Math.abs(g - bg[1]),
    Math.abs(b - bg[2])
  );
}

function removeBackground(rgba, width, height, options, bg) {
  const pixelCount = width * height;
  const transparent = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const isBackgroundCandidate = (index) => {
    const offset = index * 4;
    if (rgba[offset + 3] === 0) return true;
    if (colorDistance(rgba[offset], rgba[offset + 1], rgba[offset + 2], bg) > options.tolerance) {
      return false;
    }
    return (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3 > 178;
  };

  const enqueue = (index) => {
    if (!transparent[index] && isBackgroundCandidate(index)) {
      transparent[index] = 1;
      queue[tail++] = index;
    }
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const originalAlpha = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    originalAlpha[index] = transparent[index] ? 0 : 255;
    if (transparent[index]) {
      rgba[index * 4 + 3] = 0;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (originalAlpha[index] === 0) continue;

      const touchesBackground =
        (x > 0 && transparent[index - 1]) ||
        (x + 1 < width && transparent[index + 1]) ||
        (y > 0 && transparent[index - width]) ||
        (y + 1 < height && transparent[index + width]);

      if (!touchesBackground) continue;

      const offset = index * 4;
      const distance = colorDistance(
        rgba[offset],
        rgba[offset + 1],
        rgba[offset + 2],
        bg
      );
      if (distance >= options.featherDistance) continue;

      const alpha = Math.max(0, Math.min(1, (distance - 6) / (options.featherDistance - 6)));
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }

  const alphaComponents = new Uint8Array(pixelCount);
  const componentQueue = new Int32Array(pixelCount);
  const removePixels = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (alphaComponents[start] || rgba[start * 4 + 3] === 0) continue;

    let componentHead = 0;
    let componentTail = 0;
    let componentSize = 0;
    alphaComponents[start] = 1;
    componentQueue[componentTail++] = start;
    const componentPixels = [];

    while (componentHead < componentTail) {
      const index = componentQueue[componentHead++];
      const x = index % width;
      const y = Math.floor(index / width);
      componentPixels.push(index);
      componentSize += rgba[index * 4 + 3] / 255;

      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1
      ];

      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          !alphaComponents[neighbor] &&
          rgba[neighbor * 4 + 3] > 0
        ) {
          alphaComponents[neighbor] = 1;
          componentQueue[componentTail++] = neighbor;
        }
      }
    }

    if (componentSize < options.minimumComponentPixels) {
      removePixels.push(...componentPixels);
    }
  }

  for (const index of removePixels) {
    rgba[index * 4 + 3] = 0;
  }
}

function cropRgba(rgba, width, x, y, cropWidth, cropHeight) {
  const result = Buffer.alloc(cropWidth * cropHeight * 4);
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = ((y + row) * width + x) * 4;
    const sourceEnd = sourceStart + cropWidth * 4;
    rgba.copy(result, row * cropWidth * 4, sourceStart, sourceEnd);
  }
  return result;
}

function alphaBounds(rgba, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error("去背后没有得到前景像素");
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function pasteRgba(target, targetWidth, source, sourceWidth, sourceHeight, left, top) {
  for (let y = 0; y < sourceHeight; y += 1) {
    const targetStart = ((top + y) * targetWidth + left) * 4;
    const sourceStart = y * sourceWidth * 4;
    source.copy(target, targetStart, sourceStart, sourceStart + sourceWidth * 4);
  }
}

function resizeRgba(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const target = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor((y * sourceHeight) / targetHeight)
    );
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor((x * sourceWidth) / targetWidth)
      );
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      source.copy(target, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return target;
}

function containRgba(source, sourceWidth, sourceHeight, size) {
  const ratio = Math.min(size / sourceWidth, size / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const resized = resizeRgba(source, sourceWidth, sourceHeight, width, height);
  const target = Buffer.alloc(size * size * 4);
  pasteRgba(
    target,
    size,
    resized,
    width,
    height,
    Math.floor((size - width) / 2),
    Math.floor((size - height) / 2)
  );
  return target;
}

function writePng(filePath, rgba, width, height) {
  const png = new PNG({ width, height });
  rgba.copy(png.data);
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function readImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  if (isPng) {
    return PNG.sync.read(buffer);
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return jpeg.decode(buffer, { formatAsRGBA: true, useTArray: true });
  }
  throw new Error("源图必须是 PNG 或 JPEG");
}

function main() {
  const sourceImage = readImage(sourcePath);
  const source = Buffer.from(sourceImage.data);
  const info = {
    width: sourceImage.width,
    height: sourceImage.height
  };

  if (info.width !== config.source.width || info.height !== config.source.height) {
    throw new Error("源图尺寸与 emotions.json 不一致");
  }

  const bg = hexToRgb(config.source.background);
  let traySource = null;
  const summary = [];

  for (const [frameId, frame] of Object.entries(config.frames)) {
    const [x, y, width, height] = frame.rect;
    if (x < 0 || y < 0 || x + width > info.width || y + height > info.height) {
      throw new Error(`帧 ${frameId} 超出源图范围`);
    }

    const crop = cropRgba(source, info.width, x, y, width, height);
    removeBackground(crop, width, height, config.matte, bg);
    const bounds = alphaBounds(crop, width, height);

    const padding = config.matte.padding;
    const left = Math.max(0, bounds.left - padding);
    const top = Math.max(0, bounds.top - padding);
    const right = Math.min(width, bounds.left + bounds.width + padding);
    const bottom = Math.min(height, bounds.top + bounds.height + padding);
    const trimmed = cropRgba(crop, width, left, top, right - left, bottom - top);

    let normalized = trimmed;
    let normalizedWidth = right - left;
    let normalizedHeight = bottom - top;
    const maxDimension = Math.max(normalizedWidth, normalizedHeight);

    if (maxDimension > config.canvas.maxContent) {
      const ratio = config.canvas.maxContent / maxDimension;
      const resizedWidth = Math.max(1, Math.round(normalizedWidth * ratio));
      const resizedHeight = Math.max(1, Math.round(normalizedHeight * ratio));
      const resized = resizeRgba(
        trimmed,
        normalizedWidth,
        normalizedHeight,
        resizedWidth,
        resizedHeight
      );
      normalized = resized;
      normalizedWidth = resizedWidth;
      normalizedHeight = resizedHeight;
    }

    const canvas = Buffer.alloc(config.canvas.width * config.canvas.height * 4);
    const targetX = Math.round((config.canvas.width - normalizedWidth) / 2);
    const baseline = frame.baselineY ?? config.canvas.baselineY;
    const targetY = baseline - normalizedHeight;
    if (targetX < 0 || targetY < 0) {
      throw new Error(`帧 ${frameId} 无法放入统一画布`);
    }

    pasteRgba(
      canvas,
      config.canvas.width,
      normalized,
      normalizedWidth,
      normalizedHeight,
      targetX,
      targetY
    );

    const outputPath = path.join(root, frame.file);
    writePng(outputPath, canvas, config.canvas.width, config.canvas.height);

    if (frameId === "A1_idle") {
      traySource = canvas;
    }

    summary.push(`${frameId}: ${normalizedWidth}x${normalizedHeight}`);
  }

  if (!traySource) {
    throw new Error("没有生成托盘图标源帧");
  }

  const trayCanvas = Buffer.from(traySource);
  const trayBounds = alphaBounds(trayCanvas, config.canvas.width, config.canvas.height);
  const trayCrop = cropRgba(
    trayCanvas,
    config.canvas.width,
    trayBounds.left,
    trayBounds.top,
    trayBounds.width,
    trayBounds.height
  );
  writePng(
    trayPath,
    containRgba(trayCrop, trayBounds.width, trayBounds.height, 64),
    64,
    64
  );

  console.log(`已生成 ${summary.length} 个透明表情帧`);
  console.log(summary.join("\n"));
  console.log(`托盘图标：${path.relative(root, trayPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
