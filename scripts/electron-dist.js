const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const mainJsPath = path.join(root, "public", "js", "main.js");
const uiJsPath = path.join(root, "public", "js", "ui.js");
const obfuscatorScript = path.join(root, "scripts", "obfuscate-js.js");

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`Script failed: ${scriptPath}`);
  }
}

function runElectronBuilder() {
  const builderCmd = process.platform === "win32"
    ? path.join(root, "node_modules", ".bin", "electron-builder.cmd")
    : path.join(root, "node_modules", ".bin", "electron-builder");
  const result = spawnSync(
    builderCmd,
    ["--win", "nsis", "--config.win.signAndEditExecutable=false"],
    {
      cwd: root,
      stdio: "inherit",
      shell: false
    }
  );
  if (result.status !== 0) {
    throw new Error("electron-builder failed");
  }
}

function main() {
  const backup = {
    main: fs.readFileSync(mainJsPath, "utf8"),
    ui: fs.readFileSync(uiJsPath, "utf8")
  };

  try {
    runNodeScript(obfuscatorScript);
    runElectronBuilder();
  } finally {
    fs.writeFileSync(mainJsPath, backup.main, "utf8");
    fs.writeFileSync(uiJsPath, backup.ui, "utf8");
  }
}

main();
