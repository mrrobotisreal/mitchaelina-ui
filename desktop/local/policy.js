// Approval policy for the desktop local tools. This runs in the Electron MAIN
// process and is the authoritative decision — the renderer's input is advisory
// only. Pure (no electron / no fs), so it is unit-testable.
//
// Decisions:
//   'auto'    — run immediately (read-only tools; allowlisted read-only commands).
//   'approve' — needs explicit user approval, unless a session-scoped
//               always-allow (granted earlier THIS app run) covers its class.
//   'deny'    — never run (unknown tool).

// Read-only tools always auto-run (containment is still enforced by the
// executor).
const AUTO_TOOLS = new Set(['search_files', 'list_directory', 'read_file', 'grep_files']);

// Commands whose first token is read-only. git is allowed only for a read-only
// subcommand (see SAFE_GIT_SUBCOMMANDS).
const SAFE_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'pwd', 'wc', 'tree', 'git']);
const SAFE_GIT_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch']);

// Shell metacharacters that let a command chain/redirect into something the
// allowlist never vetted — their presence forces the command to the approval
// path even when the first token looks safe.
const SHELL_METACHARS = /[;|&><`$()]/;

// isSafeCommand reports whether a run_command string is a read-only,
// no-side-effect invocation that may auto-run. Pure.
function isSafeCommand(command) {
  if (typeof command !== 'string') return false;
  if (command.includes('\n')) return false;
  if (SHELL_METACHARS.test(command)) return false;
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const first = tokens[0];
  if (!SAFE_COMMANDS.has(first)) return false;
  if (first === 'git') {
    return SAFE_GIT_SUBCOMMANDS.has(tokens[1]);
  }
  return true;
}

// summarize is the short, human-facing description of what a tool call will do
// (shown in the approval card / the auto chip).
function summarize(name, args) {
  const a = args || {};
  switch (name) {
    case 'search_files':
      return `Search files for “${a.query ?? ''}”`;
    case 'list_directory':
      return `List ${a.path ?? ''}`;
    case 'read_file':
      return `Read ${a.path ?? ''}`;
    case 'grep_files':
      return `Search “${a.pattern ?? ''}” under ${a.path ?? ''}`;
    case 'edit_file':
      return `Edit ${a.path ?? ''}`;
    case 'write_file':
      return `Write ${a.path ?? ''}`;
    case 'run_command':
      return `Run: ${a.command ?? ''}`;
    default:
      return name;
  }
}

// evaluateTool decides how a tool call should be handled given the per-app-run
// session auto-approve flags ({ writes, commands }). Pure.
function evaluateTool(name, args, session) {
  const sess = session || {};
  const summary = summarize(name, args);
  if (AUTO_TOOLS.has(name)) return { decision: 'auto', summary };
  if (name === 'edit_file' || name === 'write_file') {
    return { decision: sess.writes ? 'auto' : 'approve', summary };
  }
  if (name === 'run_command') {
    if (isSafeCommand(args && args.command)) return { decision: 'auto', summary };
    return { decision: sess.commands ? 'auto' : 'approve', summary };
  }
  return { decision: 'deny', summary };
}

module.exports = {
  AUTO_TOOLS,
  SAFE_COMMANDS,
  SAFE_GIT_SUBCOMMANDS,
  isSafeCommand,
  evaluateTool,
  summarize,
};
