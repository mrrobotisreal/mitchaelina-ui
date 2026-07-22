// Tool executors (Electron main). Each returns { ok, resultText, detail?, diff? }
// — a RESULT, never a thrown error: containment violations, missing files,
// non-zero exits, and binary files are all reported as tool results the model
// can react to. Every filesystem path and every run_command cwd is validated
// through resolveWithin against the granted roots before any access.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createTwoFilesPatch } = require('diff');
const { resolveWithin, SKIP_DIRS } = require('./paths');
const { listRoots } = require('./roots');
const indexStore = require('./index-store');

const READ_CAP = 192 * 1024; // read_file content cap
const GREP_MATCH_CAP = 500;
const GREP_TIME_BUDGET_MS = 2000;
const CMD_OUTPUT_CAP = 128 * 1024;
const CMD_TIMEOUT_MS = 60000;

function outsideRoots() {
  return { ok: false, resultText: 'Error: path is outside the granted folders.' };
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A minimal glob → RegExp for filename filters ('*' and '?'); anchored to the
// whole basename.
function globToRegExp(glob) {
  const re = glob
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*';
      if (ch === '?') return '.';
      return escapeRegExp(ch);
    })
    .join('');
  return new RegExp(`^${re}$`);
}

async function readFile(args) {
  const r = resolveWithin(args.path, listRoots());
  if (!r.ok) return outsideRoots();
  let buf;
  try {
    buf = await fsp.readFile(r.real);
  } catch (e) {
    return { ok: false, resultText: `Error: could not read file (${e.code || e.message}).` };
  }
  if (isBinary(buf)) {
    return { ok: true, resultText: `binary file (${humanSize(buf.length)})`, detail: 'binary' };
  }
  let truncated = false;
  let bytes = buf;
  if (bytes.length > READ_CAP) {
    bytes = bytes.subarray(0, READ_CAP);
    truncated = true;
  }
  const allLines = bytes.toString('utf8').split('\n');
  const offset = Number.isInteger(args.offset) && args.offset > 0 ? args.offset : 1;
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : allLines.length;
  const start = Math.min(offset - 1, allLines.length);
  const selected = allLines.slice(start, start + limit);
  const numbered = selected.map((line, i) => `${start + i + 1}\t${line}`).join('\n');
  const text = truncated ? `${numbered}\n…[truncated at ${READ_CAP / 1024} KiB]` : numbered;
  return { ok: true, resultText: text, detail: `${selected.length} lines` };
}

async function listDirectory(args) {
  const r = resolveWithin(args.path, listRoots());
  if (!r.ok) return outsideRoots();
  let dirents;
  try {
    dirents = await fsp.readdir(r.real, { withFileTypes: true });
  } catch (e) {
    return { ok: false, resultText: `Error: could not list directory (${e.code || e.message}).` };
  }
  const names = dirents
    .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
    .sort((a, b) => a.localeCompare(b));
  return { ok: true, resultText: names.join('\n') || '(empty)', detail: `${names.length} entries` };
}

async function grepFiles(args) {
  const r = resolveWithin(args.path, listRoots());
  if (!r.ok) return outsideRoots();
  let regex;
  try {
    regex = new RegExp(args.pattern);
  } catch {
    regex = new RegExp(escapeRegExp(String(args.pattern ?? '')));
  }
  const nameFilter = args.glob ? globToRegExp(String(args.glob)) : null;
  const matches = [];
  const deadline = Date.now() + GREP_TIME_BUDGET_MS;
  let capped = false;
  let timedOut = false;
  const stack = [r.real];
  while (stack.length) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const dir = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) stack.push(full);
        continue;
      }
      if (!d.isFile()) continue;
      if (nameFilter && !nameFilter.test(d.name)) continue;
      let content;
      try {
        content = fs.readFileSync(full);
      } catch {
        continue;
      }
      if (isBinary(content)) continue;
      const lines = content.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
          if (matches.length >= GREP_MATCH_CAP) {
            capped = true;
            break;
          }
        }
      }
      if (capped || Date.now() > deadline) {
        if (!capped) timedOut = true;
        break;
      }
    }
    if (capped || timedOut) break;
  }
  let detail = `${matches.length} matches`;
  if (capped) detail += ' (capped)';
  if (timedOut) detail += ' (time limit)';
  return { ok: true, resultText: matches.join('\n') || 'No matches.', detail };
}

function searchFilesTool(args) {
  const results = indexStore.search(String(args.query ?? ''), 50);
  const text = results.map((res) => (res.isDir ? `${res.path}/` : res.path)).join('\n');
  return { ok: true, resultText: text || 'No matches.', detail: `${results.length} results` };
}

async function editFile(args) {
  const r = resolveWithin(args.path, listRoots());
  if (!r.ok) return outsideRoots();
  let before;
  try {
    before = await fsp.readFile(r.real, 'utf8');
  } catch (e) {
    return {
      ok: false,
      resultText: `Error: could not read file to edit (${e.code || e.message}). Re-read the file first.`,
    };
  }
  const occurrences = countOccurrences(before, String(args.old_str ?? ''));
  if (occurrences === 0) {
    return {
      ok: false,
      resultText: 'Error: old_str was not found. Re-read the file and copy the exact current text.',
    };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      resultText: `Error: old_str matched ${occurrences} times — add more surrounding context so it is unique.`,
    };
  }
  const after = before.replace(String(args.old_str), String(args.new_str ?? ''));
  try {
    await fsp.writeFile(r.real, after, 'utf8');
  } catch (e) {
    return { ok: false, resultText: `Error: could not write file (${e.code || e.message}).` };
  }
  const diff = createTwoFilesPatch(args.path, args.path, before, after);
  return { ok: true, resultText: `Edited ${args.path}.`, detail: '1 change', diff };
}

async function writeFile(args) {
  const r = resolveWithin(args.path, listRoots());
  if (!r.ok) return outsideRoots();
  // The parent directory (mkdir -p target) must also stay within the roots.
  const parent = path.dirname(r.real);
  if (!resolveWithin(parent, listRoots()).ok) return outsideRoots();

  let before = '';
  let existed = false;
  try {
    before = await fsp.readFile(r.real, 'utf8');
    existed = true;
  } catch {
    // new file
  }
  try {
    await fsp.mkdir(parent, { recursive: true });
    await fsp.writeFile(r.real, String(args.content ?? ''), 'utf8');
  } catch (e) {
    return { ok: false, resultText: `Error: could not write file (${e.code || e.message}).` };
  }
  const diff = createTwoFilesPatch(args.path, args.path, before, String(args.content ?? ''));
  return {
    ok: true,
    resultText: `${existed ? 'Overwrote' : 'Created'} ${args.path}.`,
    detail: existed ? 'overwrote' : 'created',
    diff,
  };
}

function runCommand(args) {
  const r = resolveWithin(args.cwd, listRoots());
  if (!r.ok) return Promise.resolve(outsideRoots());
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(String(args.command ?? ''), { shell: true, cwd: r.real, timeout: CMD_TIMEOUT_MS });
    } catch (e) {
      resolve({ ok: false, resultText: `Error: failed to start command (${e.message}).` });
      return;
    }
    let out = Buffer.alloc(0);
    let capped = false;
    const onData = (chunk) => {
      if (capped) return;
      out = Buffer.concat([out, chunk]);
      if (out.length > CMD_OUTPUT_CAP) {
        out = out.subarray(0, CMD_OUTPUT_CAP);
        capped = true;
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => resolve({ ok: false, resultText: `Error: command failed to run (${e.message}).` }));
    child.on('close', (code) => {
      let text = out.toString('utf8');
      if (capped) text += '\n…[output truncated at 128 KiB]';
      const exit = code == null ? 'null (killed/timeout)' : String(code);
      text += `\nexit ${exit}`;
      resolve({ ok: code === 0, resultText: text, detail: `exit ${exit}` });
    });
  });
}

// runTool dispatches to the executor for `name`. Unknown tools are refused.
async function runTool(name, args) {
  switch (name) {
    case 'read_file':
      return readFile(args);
    case 'list_directory':
      return listDirectory(args);
    case 'grep_files':
      return grepFiles(args);
    case 'search_files':
      return searchFilesTool(args);
    case 'edit_file':
      return editFile(args);
    case 'write_file':
      return writeFile(args);
    case 'run_command':
      return runCommand(args);
    default:
      return { ok: false, resultText: `Error: unknown tool "${name}".` };
  }
}

// readMention reads an @-mentioned file's content for up-front context (256 KiB
// cap). A mentioned DIRECTORY is rendered as a one-level listing (as text).
// Returns { content, truncated } or throws a plain Error the bridge maps to a
// pill error state.
const MENTION_CAP = 256 * 1024;
async function readMention(target) {
  const r = resolveWithin(target, listRoots());
  if (!r.ok) throw new Error('outside granted folders');
  const stat = await fsp.stat(r.real);
  if (stat.isDirectory()) {
    const dirents = await fsp.readdir(r.real, { withFileTypes: true });
    const names = dirents.map((d) => (d.isDirectory() ? `${d.name}/` : d.name)).sort((a, b) => a.localeCompare(b));
    return { content: `Directory listing of ${target}:\n${names.join('\n')}`, truncated: false };
  }
  const buf = await fsp.readFile(r.real);
  if (isBinary(buf)) return { content: `binary file (${humanSize(buf.length)})`, truncated: false };
  let truncated = false;
  let bytes = buf;
  if (bytes.length > MENTION_CAP) {
    bytes = bytes.subarray(0, MENTION_CAP);
    truncated = true;
  }
  return { content: bytes.toString('utf8'), truncated };
}

module.exports = { runTool, readMention };
