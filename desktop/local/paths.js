// Pure path + origin helpers for the desktop local-tools bridge.
//
// This module deliberately requires ONLY node built-ins (no electron), so its
// containment/origin logic can be unit-tested in plain `node --test`. The
// electron-dependent pieces (granted-roots persistence, IPC) live in
// roots.js / ipc.js and build on top of these primitives.

const fs = require('node:fs');
const path = require('node:path');

// SKIP_DIRS are never indexed or descended into during grep (build noise + VCS
// internals). Dotfile directories are also skipped (see index.js / executors).
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'target',
  'vendor',
  '__pycache__',
]);

// isAppOrigin reports whether a frame URL's origin equals the app origin. The
// SOLE gate for every IPC handler (guardIpc): the renderer is a remotely-loaded
// web page, so we trust an IPC call only when it demonstrably came from the
// app's own origin. Malformed URLs fail closed.
function isAppOrigin(frameURL, appOrigin) {
  try {
    return new URL(frameURL).origin === appOrigin;
  } catch {
    return false;
  }
}

// realpathDeepest resolves symlinks in `candidate`. For a path that does not
// exist yet (a write target), it realpaths the deepest EXISTING ancestor and
// re-joins the non-existent tail — so a symlinked parent directory can never be
// used to escape the granted roots when creating a new file.
function realpathDeepest(candidate) {
  let dir = candidate;
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync(dir);
      tail.reverse();
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return candidate; // hit the filesystem root; nothing exists
      tail.push(path.basename(dir));
      dir = parent;
    }
  }
}

// containedIn reports whether a REALPATH'd candidate is inside one of the
// (already realpath'd) granted roots — equal to a root, or under it with a path
// separator boundary (so "/a/foobar" is NOT considered inside "/a/foo"). Pure.
function containedIn(realCandidate, roots) {
  for (const root of roots) {
    if (realCandidate === root || realCandidate.startsWith(root + path.sep)) {
      return true;
    }
  }
  return false;
}

// resolveWithin realpaths `candidate` (handling not-yet-existing write targets
// via realpathDeepest) and checks containment against `roots`. Returns
// { ok, real }. An absolute path is required — a relative path can't be reasoned
// about safely, so it is rejected.
function resolveWithin(candidate, roots) {
  if (typeof candidate !== 'string' || candidate === '' || !path.isAbsolute(candidate)) {
    return { ok: false, real: '' };
  }
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    real = realpathDeepest(candidate);
  }
  return { ok: containedIn(real, roots), real };
}

module.exports = { SKIP_DIRS, isAppOrigin, realpathDeepest, containedIn, resolveWithin };
