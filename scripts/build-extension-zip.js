// Rebuilds frontend/public/downloads/trademind-extension.zip from
// browser-extension/ whenever the extension source changes. The zip is
// identical for every user (the session token is pasted at runtime into
// the popup, never baked into the files), so this only needs to run when
// browser-extension/'s contents change, not per-user or per-build.
//
// Windows-only (uses PowerShell's Compress-Archive) — matches this repo's
// existing Windows-specific tooling (see frontend/android/gradle.properties).
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const srcDir = path.join(__dirname, "..", "browser-extension");
const destDir = path.join(__dirname, "..", "frontend", "public", "downloads");
const destZip = path.join(destDir, "trademind-extension.zip");

fs.mkdirSync(destDir, { recursive: true });
if (fs.existsSync(destZip)) fs.unlinkSync(destZip);

const psCommand = `Compress-Archive -Path "${srcDir}\\*" -DestinationPath "${destZip}" -CompressionLevel Optimal`;
execFileSync("powershell.exe", ["-NoProfile", "-Command", psCommand], { stdio: "inherit" });

console.log(`Built ${destZip}`);
