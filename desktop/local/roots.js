// Granted-roots persistence (Electron main). The user explicitly grants folders
// via the native directory picker; every granted folder is stored REALPATH'd
// (symlinks resolved once, up front) so containment checks in paths.js compare
// canonical paths. Persisted as a small JSON file in the app's userData dir —
// hand-rolled to avoid an electron-store dependency.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let cache = null; // string[] of realpath'd absolute roots

function storeFile() {
  return path.join(app.getPath('userData'), 'local-roots.json');
}

function load() {
  if (cache) return;
  try {
    const raw = fs.readFileSync(storeFile(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    cache = [];
  }
}

function persist() {
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Best-effort; an unwritable userData dir just means roots don't survive a
    // restart. Not fatal.
  }
}

function listRoots() {
  load();
  return [...cache];
}

// addRoot canonicalizes and stores a granted folder. Returns the updated list.
// A non-directory or unreadable path is ignored (returns the list unchanged).
function addRoot(candidate) {
  load();
  let real;
  try {
    real = fs.realpathSync(candidate);
    if (!fs.statSync(real).isDirectory()) return listRoots();
  } catch {
    return listRoots();
  }
  if (!cache.includes(real)) {
    cache.push(real);
    persist();
  }
  return listRoots();
}

function removeRoot(candidate) {
  load();
  // Match either the raw or the realpath'd form so removal always works.
  let real = candidate;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    // keep the raw candidate
  }
  const before = cache.length;
  cache = cache.filter((r) => r !== candidate && r !== real);
  if (cache.length !== before) persist();
  return listRoots();
}

module.exports = { listRoots, addRoot, removeRoot };
