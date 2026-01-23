import fs from "node:fs";
import path from "node:path";

import pngjs from "pngjs";

const { PNG } = pngjs;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--src") {
      args.src = argv[i + 1];
      i++;
      continue;
    }
    if (token === "--out") {
      args.out = argv[i + 1];
      i++;
      continue;
    }
    if (token === "--size") {
      args.size = argv[i + 1];
      i++;
      continue;
    }
  }
  return args;
}

function buildIcoFromPng(pngBuffer, width, height) {
  const count = 1;
  const headerSize = 6;
  const entrySize = 16;
  const offset = headerSize + entrySize * count;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entry = Buffer.alloc(entrySize);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2); // color count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(offset, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

function resizePngNearest(srcPng, size) {
  const dst = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    const srcY = Math.floor((y * srcPng.height) / size);
    for (let x = 0; x < size; x++) {
      const srcX = Math.floor((x * srcPng.width) / size);
      const srcIndex = (srcY * srcPng.width + srcX) * 4;
      const dstIndex = (y * size + x) * 4;
      dst.data[dstIndex] = srcPng.data[srcIndex];
      dst.data[dstIndex + 1] = srcPng.data[srcIndex + 1];
      dst.data[dstIndex + 2] = srcPng.data[srcIndex + 2];
      dst.data[dstIndex + 3] = srcPng.data[srcIndex + 3];
    }
  }
  return dst;
}

const args = parseArgs(process.argv.slice(2));
const srcPath = args.src;
const outPath = args.out;
const size = Math.max(16, Math.min(256, Number.parseInt(args.size ?? "256", 10) || 256));

if (!srcPath || !outPath) {
  console.error('Usage: node scripts/generate-ico.mjs --src "TrayIcon.png" --out "dist/app-icon.ico"');
  process.exit(1);
}

const srcBuffer = fs.readFileSync(srcPath);
const srcPng = PNG.sync.read(srcBuffer);
const resized = resizePngNearest(srcPng, size);
const resizedPngBuffer = PNG.sync.write(resized);

const icoBuffer = buildIcoFromPng(resizedPngBuffer, size, size);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, icoBuffer);
console.log(`Wrote ICO: ${outPath}`);
