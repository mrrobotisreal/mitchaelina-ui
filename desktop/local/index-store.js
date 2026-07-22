// File index for @-mention search and the search_files tool.
//
// A flat list of {path, isDir, rel} entries built by walking every granted root
// (skipping SKIP_DIRS + dotfile dirs), capped at ~200k entries. Ranked with
// fuzzysort over the root-relative path. Rebuilt eagerly on root add/remove and
// lazily when older than ~5 minutes at query time.
//
// The walk is a manual fs.readdirSync recursion (deterministic, and it never
// follows symlinked directories — d.isDirectory() is false for a symlink — so
// there are no cycle hazards).

const fs = require('node:fs');
const path = require('node:path');
const fuzzysort = require('fuzzysort');
const { SKIP_DIRS } = require('./paths');
const { listRoots } = require('./roots');

const MAX_ENTRIES = 200000;
const STALE_MS = 5 * 60 * 1000;

let state = { entries: [], builtAt: 0, truncated: false };

function build() {
  const entries = [];
  let truncated = false;
  outer: for (const root of listRoots()) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let dirents;
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable dir — skip
      }
      for (const d of dirents) {
        const full = path.join(dir, d.name);
        const isDir = d.isDirectory();
        if (isDir && (SKIP_DIRS.has(d.name) || d.name.startsWith('.'))) continue;
        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          break outer;
        }
        entries.push({ path: full, isDir, rel: path.relative(root, full) });
        if (isDir) stack.push(full);
      }
    }
  }
  state = { entries, builtAt: Date.now(), truncated };
}

// rebuild forces an immediate rebuild (called on root add/remove).
function rebuild() {
  build();
}

function ensureFresh() {
  if (state.builtAt === 0 || Date.now() - state.builtAt > STALE_MS) build();
}

// search ranks index entries against a fuzzy query. An empty query returns the
// first `limit` entries (useful right after "@"). Returns [{path, isDir, score}].
function search(query, limit = 12) {
  ensureFresh();
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) {
    return state.entries.slice(0, limit).map((e) => ({ path: e.path, isDir: e.isDir, score: 0 }));
  }
  const results = fuzzysort.go(q, state.entries, { key: 'rel', limit });
  return results.map((r) => ({ path: r.obj.path, isDir: r.obj.isDir, score: r.score }));
}

function isTruncated() {
  return state.truncated;
}

module.exports = { rebuild, search, isTruncated };
