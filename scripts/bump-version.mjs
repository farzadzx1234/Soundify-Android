import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const pkgPath = path.join(rootDir, "package.json");
const gradlePath = path.join(rootDir, "android", "app", "build.gradle");
const appVersionPath = path.join(rootDir, "src", "lib", "appVersion.ts");
const swPath = path.join(rootDir, "public", "sw.js");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const parts = String(pkg.version || "1.0.0")
  .split(".")
  .map((n) => parseInt(n, 10) || 0);
while (parts.length < 3) parts.push(0);
parts[2] += 1;
const nextVersion = parts.join(".");

// Read current versionCode from build.gradle and increment
let gradleText = fs.readFileSync(gradlePath, "utf8");
const codeMatch = gradleText.match(/versionCode\s+(\d+)/);
const nextBuildCode = (codeMatch ? parseInt(codeMatch[1], 10) : 1) + 1;

// 1. Update package.json
pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

// 2. Update android/app/build.gradle
gradleText = gradleText
  .replace(/versionCode\s+\d+/, `versionCode ${nextBuildCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${nextVersion}"`);
fs.writeFileSync(gradlePath, gradleText, "utf8");

// 3. Update src/lib/appVersion.ts
const tsContent = `/**
 * Single Source of Truth for Soundify Android Application Version.
 * Automatically kept in sync with package.json, android/app/build.gradle, and public/sw.js
 * via \`scripts/bump-version.mjs\`.
 */
export const APP_VERSION = "${nextVersion}";
export const APP_BUILD_NUMBER = ${nextBuildCode};
export const APP_CHANNEL = "Android";
`;
fs.writeFileSync(appVersionPath, tsContent, "utf8");

// 4. Update public/sw.js CACHE_VERSION
if (fs.existsSync(swPath)) {
  let swText = fs.readFileSync(swPath, "utf8");
  swText = swText.replace(
    /const CACHE_VERSION = "[^"]+";/,
    `const CACHE_VERSION = "soundify-v${nextVersion}-b${nextBuildCode}";`,
  );
  fs.writeFileSync(swPath, swText, "utf8");
}

console.log(`Bumped Soundify Android version to v${nextVersion} (versionCode ${nextBuildCode})`);
