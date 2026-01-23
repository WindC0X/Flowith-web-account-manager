import fs from "node:fs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--exe") {
      args.exe = argv[i + 1];
      i++;
      continue;
    }
    if (token === "--icon") {
      args.icon = argv[i + 1];
      i++;
      continue;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (process.platform !== "win32") {
  console.log("Skip: set-win-exe-icon is Windows-only.");
  process.exit(0);
}

if (!args.exe || !args.icon) {
  console.error(
    'Usage: node scripts/set-win-exe-icon.mjs --exe "dist/win-unpacked/flowith-web-account-manager.exe" --icon "dist/app-icon.ico"'
  );
  process.exit(1);
}

if (!fs.existsSync(args.exe)) {
  console.error(`Missing exe: ${args.exe}`);
  process.exit(1);
}

if (!fs.existsSync(args.icon)) {
  console.error(`Missing ico: ${args.icon}`);
  process.exit(1);
}

const mod = await import("rcedit");
const rcedit = mod.rcedit;
if (typeof rcedit !== "function") {
  throw new Error("Invalid rcedit export: expected a function");
}

await rcedit(args.exe, { icon: args.icon });
console.log(`Updated exe icon: ${args.exe}`);
