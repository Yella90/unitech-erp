const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const targets = [
  path.resolve(__dirname, "..", "public", "js", "main.js"),
  path.resolve(__dirname, "..", "public", "js", "ui.js")
];

function obfuscateFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const source = fs.readFileSync(filePath, "utf8");
  const obfuscated = JavaScriptObfuscator.obfuscate(source, {
    compact: true,
    controlFlowFlattening: true,
    deadCodeInjection: false,
    stringArray: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    splitStrings: false,
    simplify: true,
    identifierNamesGenerator: "hexadecimal"
  }).getObfuscatedCode();
  fs.writeFileSync(filePath, obfuscated, "utf8");
  return true;
}

function main() {
  const done = [];
  for (const target of targets) {
    if (obfuscateFile(target)) {
      done.push(path.basename(target));
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Obfuscated JS files: ${done.join(", ") || "none"}`);
}

main();
