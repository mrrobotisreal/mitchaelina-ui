// Pure unit tests for the electron-free local-tools logic (run with
// `npm test` → `node --test local`). These cover the trust-critical decisions:
// the IPC origin check (the core of guardIpc), granted-roots containment
// (symlink-escape boundary), and the approval policy.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { isAppOrigin, containedIn } = require('./paths');
const { isSafeCommand, evaluateTool } = require('./policy');

const APP = 'https://www.mitchaelina.com';

test('isAppOrigin — the guardIpc gate', () => {
  assert.equal(isAppOrigin('https://www.mitchaelina.com/', APP), true);
  assert.equal(isAppOrigin('https://www.mitchaelina.com/chatlab/x', APP), true);
  assert.equal(isAppOrigin('https://evil.example.com/', APP), false);
  assert.equal(isAppOrigin('http://www.mitchaelina.com/', APP), false); // scheme differs
  assert.equal(isAppOrigin('not a url', APP), false); // malformed → fail closed
  assert.equal(isAppOrigin('', APP), false);
  assert.equal(isAppOrigin(undefined, APP), false);
});

test('containedIn — root boundary + sibling-prefix rejection', () => {
  const roots = [path.join(path.sep, 'home', 'me', 'proj')];
  assert.equal(containedIn(path.join(path.sep, 'home', 'me', 'proj'), roots), true); // the root itself
  assert.equal(containedIn(path.join(path.sep, 'home', 'me', 'proj', 'a', 'b.go'), roots), true);
  assert.equal(containedIn(path.join(path.sep, 'home', 'me', 'proj-evil', 'x'), roots), false); // sibling prefix
  assert.equal(containedIn(path.join(path.sep, 'etc', 'passwd'), roots), false);
  assert.equal(containedIn(path.join(path.sep, 'home', 'me'), roots), false); // parent, not inside
  assert.equal(containedIn('/anything', []), false); // no roots → nothing contained
});

test('isSafeCommand — allowlist + metachar rejection', () => {
  assert.equal(isSafeCommand('ls -la'), true);
  assert.equal(isSafeCommand('git status'), true);
  assert.equal(isSafeCommand('git diff HEAD'), true);
  assert.equal(isSafeCommand('cat file.txt'), true);
  // git write subcommands are NOT safe
  assert.equal(isSafeCommand('git push'), false);
  assert.equal(isSafeCommand('git commit -m x'), false);
  // non-allowlisted first token
  assert.equal(isSafeCommand('rm -rf /'), false);
  assert.equal(isSafeCommand('node script.js'), false);
  // metacharacters force approval even with a safe first token
  assert.equal(isSafeCommand('ls; rm -rf /'), false);
  assert.equal(isSafeCommand('cat a | sh'), false);
  assert.equal(isSafeCommand('ls > out.txt'), false);
  assert.equal(isSafeCommand('echo $(whoami)'), false);
  assert.equal(isSafeCommand('ls\nrm x'), false);
  assert.equal(isSafeCommand(''), false);
});

test('evaluateTool — read-only auto, mutations gated, unknown denied', () => {
  const noAuto = { writes: false, commands: false };
  assert.equal(evaluateTool('read_file', { path: '/x' }, noAuto).decision, 'auto');
  assert.equal(evaluateTool('list_directory', { path: '/x' }, noAuto).decision, 'auto');
  assert.equal(evaluateTool('grep_files', { pattern: 'x', path: '/x' }, noAuto).decision, 'auto');
  assert.equal(evaluateTool('search_files', { query: 'x' }, noAuto).decision, 'auto');

  assert.equal(evaluateTool('edit_file', { path: '/x' }, noAuto).decision, 'approve');
  assert.equal(evaluateTool('write_file', { path: '/x' }, noAuto).decision, 'approve');
  // session always-allow for writes flips them to auto
  assert.equal(evaluateTool('edit_file', { path: '/x' }, { writes: true }).decision, 'auto');

  // run_command: safe → auto, unsafe → approve, unless session-commands allowed
  assert.equal(evaluateTool('run_command', { command: 'ls' }, noAuto).decision, 'auto');
  assert.equal(evaluateTool('run_command', { command: 'npm install' }, noAuto).decision, 'approve');
  assert.equal(evaluateTool('run_command', { command: 'npm install' }, { commands: true }).decision, 'auto');

  assert.equal(evaluateTool('totally_unknown', {}, noAuto).decision, 'deny');
});
