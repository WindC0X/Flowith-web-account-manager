import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--platform=")) {
      args.platform = token.slice("--platform=".length);
      continue;
    }
    if (token === "--platform") {
      args.platform = argv[i + 1];
      i++;
      continue;
    }
  }
  return args;
}

function pathExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isoStamp() {
  return new Date().toISOString().replace(/\..*$/, "").replace(/:/g, "").replace("T", "-");
}

const { platform } = parseArgs(process.argv.slice(2));
const requestedPlatform = platform ?? process.platform;

if (!["linux", "win32", "darwin"].includes(requestedPlatform)) {
  console.error(`Unsupported platform "${requestedPlatform}". Supported: linux, win32, darwin.`);
  process.exit(1);
}

if (requestedPlatform !== process.platform) {
  console.error(
    `Requested platform "${requestedPlatform}" does not match current host "${process.platform}". ` +
      `Run this on a "${requestedPlatform}" host.`
  );
  process.exit(1);
}

const repoRoot = process.cwd();
const electronDist = path.join(repoRoot, "node_modules", "electron", "dist");
const buildOut = path.join(repoRoot, "out");
const distRoot = path.join(repoRoot, "dist");

if (!pathExists(electronDist)) {
  console.error(`Missing "${electronDist}". Run "npm install" first.`);
  process.exit(1);
}

if (!pathExists(buildOut)) {
  console.error(`Missing "${buildOut}". Run "npm run build" first.`);
  process.exit(1);
}

ensureDir(distRoot);

const executableBaseName = "flowith-web-account-manager";
const platformSlug =
  requestedPlatform === "win32" ? "win" : requestedPlatform === "darwin" ? "mac" : "linux";
const baseName = `${platformSlug}-unpacked`;
let targetDir = path.join(distRoot, baseName);
if (pathExists(targetDir)) targetDir = path.join(distRoot, `${baseName}-${isoStamp()}`);

console.log(`Packaging directory to: ${targetDir}`);

fs.cpSync(electronDist, targetDir, { recursive: true });

let resourcesDir = path.join(targetDir, "resources");
let macAppBundlePath = null;

if (requestedPlatform === "darwin") {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const appDir = entries.find((e) => e.isDirectory() && e.name.endsWith(".app"))?.name ?? null;
  if (!appDir) {
    console.error(`Missing Electron .app bundle in "${targetDir}".`);
    process.exit(1);
  }

  const srcAppBundlePath = path.join(targetDir, appDir);
  const dstAppBundlePath = path.join(targetDir, `${executableBaseName}.app`);
  macAppBundlePath = srcAppBundlePath;
  if (srcAppBundlePath !== dstAppBundlePath && !pathExists(dstAppBundlePath)) {
    fs.renameSync(srcAppBundlePath, dstAppBundlePath);
    macAppBundlePath = dstAppBundlePath;
  }

  resourcesDir = path.join(macAppBundlePath, "Contents", "Resources");
}

if (!pathExists(resourcesDir)) {
  console.error(`Missing "${resourcesDir}" in copied Electron distribution.`);
  process.exit(1);
}

const appDir = path.join(resourcesDir, "app");
ensureDir(appDir);

fs.cpSync(buildOut, path.join(appDir, "out"), { recursive: true });
fs.copyFileSync(path.join(repoRoot, "package.json"), path.join(appDir, "package.json"));

const iconFiles = ["TrayIcon.png", "TrayIconLight.png"];
for (const fileName of iconFiles) {
  const srcIcon = path.join(repoRoot, fileName);
  if (!pathExists(srcIcon)) continue;
  fs.copyFileSync(srcIcon, path.join(appDir, fileName));
}

const srcNodeModules = path.join(repoRoot, "node_modules");
const dstNodeModules = path.join(appDir, "node_modules");

fs.cpSync(srcNodeModules, dstNodeModules, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(srcNodeModules, src);
    if (rel === "") return true;
    const first = rel.split(path.sep)[0];
    if (first === "electron") return false;
    if (first === ".bin") return false;
    return true;
  },
});

if (requestedPlatform === "linux") {
  const srcExe = path.join(targetDir, "electron");
  const dstExe = path.join(targetDir, executableBaseName);
  if (pathExists(srcExe) && !pathExists(dstExe)) fs.renameSync(srcExe, dstExe);
  console.log(`Run: "${dstExe}"`);
} else if (requestedPlatform === "win32") {
  const srcExe = path.join(targetDir, "electron.exe");
  const dstExe = path.join(targetDir, `${executableBaseName}.exe`);
  if (pathExists(srcExe) && !pathExists(dstExe)) fs.renameSync(srcExe, dstExe);
  console.log(`Run: "${dstExe}"`);
} else if (requestedPlatform === "darwin") {
  const appBundlePath = macAppBundlePath ?? path.join(targetDir, `${executableBaseName}.app`);
  console.log(`Run: open "${appBundlePath}"`);
}
