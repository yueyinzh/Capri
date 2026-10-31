const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const root = path.join(__dirname, "..");
const pngPath = path.join(root, "assets", "tray", "mojie_tray.png");
const iconPath = path.join(root, "assets", "tray", "mojie.ico");
const source = PNG.sync.read(fs.readFileSync(pngPath));
const sizes = [16, 24, 32, 48, 64, 128, 256];

function createDib(size) {
  const maskStride = Math.ceil(size / 32) * 4;
  const pixelBytes = size * size * 4;
  const maskBytes = maskStride * size;
  const dib = Buffer.alloc(40 + pixelBytes + maskBytes);

  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(pixelBytes + maskBytes, 20);

  let pixelOffset = 40;
  const maskOffset = 40 + pixelBytes;
  for (let y = size - 1; y >= 0; y -= 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / size));
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / size));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      dib[pixelOffset++] = source.data[sourceOffset + 2];
      dib[pixelOffset++] = source.data[sourceOffset + 1];
      dib[pixelOffset++] = source.data[sourceOffset];
      dib[pixelOffset++] = source.data[sourceOffset + 3];
    }
  }

  for (let y = size - 1; y >= 0; y -= 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / size));
    const rowOffset = maskOffset + (size - 1 - y) * maskStride;
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / size));
      const alpha = source.data[(sourceY * source.width + sourceX) * 4 + 3];
      if (alpha < 128) {
        dib[rowOffset + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return dib;
}

const images = sizes.map((size) => createDib(size));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);

let imageOffset = header.length;
for (let index = 0; index < sizes.length; index += 1) {
  const size = sizes[index];
  const image = images[index];
  const entryOffset = 6 + index * 16;
  header[entryOffset] = size === 256 ? 0 : size;
  header[entryOffset + 1] = size === 256 ? 0 : size;
  header[entryOffset + 2] = 0;
  header[entryOffset + 3] = 0;
  header.writeUInt16LE(1, entryOffset + 4);
  header.writeUInt16LE(32, entryOffset + 6);
  header.writeUInt32LE(image.length, entryOffset + 8);
  header.writeUInt32LE(imageOffset, entryOffset + 12);
  imageOffset += image.length;
}

fs.writeFileSync(iconPath, Buffer.concat([header, ...images]));
console.log(`已生成 ${path.relative(root, iconPath)}`);
