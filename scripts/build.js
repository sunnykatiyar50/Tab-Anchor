#!/usr/bin/env node
/**
 * Tab Anchor — build script
 *
 * Usage:  npm run build
 *
 * Outputs:
 *   builds/chrome/   — unpacked Chrome extension
 *   builds/firefox/  — unpacked Firefox extension
 *   releases/tab-anchor-chrome-v{version}.zip
 *   releases/tab-anchor-firefox-v{version}.zip
 *
 * Only the latest release zip per browser is kept in releases/.
 */

const fs   = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// ─── Paths ───────────────────────────────────────────────────────────────────

const ROOT     = path.join(__dirname, '..');
const BUILDS   = path.join(ROOT, 'dist');
const RELEASES = path.join(ROOT, 'releases');

// Extension source files and directories to include in every build.
// Any path listed here that doesn't exist on disk is silently skipped.
const INCLUDE = [
  'manifest.json',
  'background.js',
  'content.js',
  'options.html',
  'options.js',
  'styles',
  'icons',
];

// Paths that must never end up inside a build directory.
const EXCLUDE = new Set([
  'build.js',
  'package.json',
  'package-lock.json',
  '.gitignore',
  'node_modules',
  'dist',
  'releases',
  'generate-icons.html',
  '.git',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
}

/** Recursively copy a directory. */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

/** Add all files in a directory to an AdmZip instance, preserving structure. */
function addDirToZip(zip, dirPath, zipRoot) {
  for (const entry of fs.readdirSync(dirPath)) {
    const full    = path.join(dirPath, entry);
    const zipPath = zipRoot ? `${zipRoot}/${entry}` : entry;
    if (fs.statSync(full).isDirectory()) {
      addDirToZip(zip, full, zipPath);
    } else {
      zip.addFile(zipPath, fs.readFileSync(full));
    }
  }
}

/** Remove all release zips for a given browser slug (keeps only latest). */
function pruneOldReleases(browserSlug) {
  if (!fs.existsSync(RELEASES)) return;
  const re = new RegExp(`^tab-anchor-${browserSlug}-v.+\\.zip$`);
  for (const f of fs.readdirSync(RELEASES)) {
    if (re.test(f)) {
      fs.unlinkSync(path.join(RELEASES, f));
      console.log(`  removed old release: ${f}`);
    }
  }
}

// ─── Browser-specific manifest transforms ────────────────────────────────────

/** Chrome — MV3 as-is, no changes needed. */
function chromeManifest(manifest) {
  return manifest;
}

/**
 * Firefox — MV3 with browser_specific_settings required by AMO.
 * Firefox uses background.scripts instead of background.service_worker.
 * Minimum version 109.0 is when Firefox gained MV3 + background scripts support.
 */
function firefoxManifest(manifest) {
  const swFile = manifest.background.service_worker;
  delete manifest.background.service_worker;
  manifest.background.scripts = [swFile];

  manifest.browser_specific_settings = {
    gecko: {
      id: 'tab-anchor@extension',
      strict_min_version: '109.0',
    },
  };
  return manifest;
}

// ─── Core build function ─────────────────────────────────────────────────────

function build(browserSlug, manifestTransform) {
  const manifest = readManifest();
  const version  = readPackageVersion();
  manifest.version = version;

  // 1. Prepare clean build directory
  const buildDir = path.join(BUILDS, browserSlug);
  if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });

  // 2. Copy source files
  let skipped = [];
  for (const item of INCLUDE) {
    if (EXCLUDE.has(item)) continue;
    const src  = path.join(ROOT, item);
    const dest = path.join(buildDir, item);
    if (!fs.existsSync(src)) { skipped.push(item); continue; }
    fs.statSync(src).isDirectory() ? copyDir(src, dest) : fs.copyFileSync(src, dest);
  }

  // 3. Write the transformed manifest (overwrites the copied one)
  const patched = manifestTransform(JSON.parse(JSON.stringify(manifest)));
  fs.writeFileSync(
    path.join(buildDir, 'manifest.json'),
    JSON.stringify(patched, null, 2),
  );

  if (skipped.length) {
    console.log(`  skipped (not found): ${skipped.join(', ')}`);
  }

  // 4. Ensure releases directory exists, then prune old zips for this browser
  fs.mkdirSync(RELEASES, { recursive: true });
  pruneOldReleases(browserSlug);

  // 5. Zip the build
  const zipName = `tab-anchor-${browserSlug}-v${version}.zip`;
  const zipPath = path.join(RELEASES, zipName);
  const zip = new AdmZip();
  addDirToZip(zip, buildDir, '');
  zip.writeZip(zipPath);

  // Report zip size for quick sanity check
  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`  → releases/${zipName}  (${kb} KB)`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const version = readPackageVersion();
console.log(`\nTab Anchor v${version} — building for all browsers\n`);

console.log('Chrome:');
build('chrome', chromeManifest);

console.log('\nFirefox:');
build('firefox', firefoxManifest);

console.log('\nBuild complete.');
console.log(`  Unpacked builds : dist/`);
console.log(`  Release zips    : releases/`);
