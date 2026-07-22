// Preload bridge for the Mitchaelina desktop shell.
//
// Runs with contextIsolation ON and sandbox ON, so it exposes ONLY a thin,
// explicit API on window.mitchaelinaDesktop — every method is a wrapper around
// ipcRenderer.invoke (the only IPC that works under sandbox). No Node, no fs,
// no child_process ever reaches the remote page: all real work happens in the
// Electron main process behind origin-checked handlers, granted-roots
// containment, and the approval policy (see local/ipc.js).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mitchaelinaDesktop', {
  // Platform string (e.g. 'darwin' | 'win32' | 'linux'), used to seed localEnv.
  platform: process.platform,
  // App version (async — read from the main process).
  version: () => ipcRenderer.invoke('ml:version'),

  // Granted-roots management. addRoot opens the native directory picker in main.
  listRoots: () => ipcRenderer.invoke('ml:listRoots'),
  addRoot: () => ipcRenderer.invoke('ml:addRoot'),
  removeRoot: (path) => ipcRenderer.invoke('ml:removeRoot', path),

  // @-mention support: fuzzy file search over the index, and a content read for
  // a selected mention (256 KiB cap; a directory returns a one-level listing).
  searchFiles: (query, limit) => ipcRenderer.invoke('ml:searchFiles', query, limit),
  readMention: (path) => ipcRenderer.invoke('ml:readMention', path),

  // Local tool execution. evaluateTool returns the policy decision
  // ('auto'|'approve'|'deny') + a human summary; executeTool runs it (main
  // re-evaluates policy and refuses non-approved mutations regardless of the
  // `approved` flag). setSessionAutoApprove toggles a per-app-run always-allow.
  evaluateTool: (name, argsJson) => ipcRenderer.invoke('ml:evaluateTool', name, argsJson),
  executeTool: (name, argsJson, opts) => ipcRenderer.invoke('ml:executeTool', name, argsJson, opts),
  setSessionAutoApprove: (kind, on) => ipcRenderer.invoke('ml:setSessionAutoApprove', kind, on),
});
