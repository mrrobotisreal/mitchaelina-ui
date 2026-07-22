// IPC surface for the desktop local-tools bridge (Electron main).
//
// SECURITY: main is the ONLY enforcement point. Every handler is wrapped in
// guardIpc, which rejects any call whose sender frame is not on the app's own
// origin (the renderer is a remotely-loaded web page — semi-trusted). Path
// containment (realpath within granted roots) lives in the executors; approval
// policy is re-evaluated HERE in executeTool, so a renderer claiming
// `approved: true` for an auto-deny/approve-class tool cannot bypass it.

const { ipcMain, dialog, app, BrowserWindow } = require('electron');
const { isAppOrigin } = require('./paths');
const roots = require('./roots');
const indexStore = require('./index-store');
const executors = require('./executors');
const policy = require('./policy');

// Session-scoped always-allow, kept in memory for THIS app run only (never
// persisted — no global auto-approve). Toggled via setSessionAutoApprove.
const sessionAuto = { writes: false, commands: false };

function registerLocalIpc(getAppOrigin) {
  // guardIpc: origin-check on EVERY handle (no exceptions). A failed check
  // returns an error result rather than throwing, so the renderer degrades
  // gracefully. Handler exceptions are also caught and returned as errors.
  const guard = (handler) => async (event, ...args) => {
    const frameURL = event.senderFrame ? event.senderFrame.url : '';
    if (!isAppOrigin(frameURL, getAppOrigin())) {
      return { ok: false, error: 'forbidden-origin' };
    }
    try {
      return await handler(event, ...args);
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };

  ipcMain.handle('ml:version', guard(async () => app.getVersion()));
  ipcMain.handle('ml:listRoots', guard(async () => roots.listRoots()));

  ipcMain.handle(
    'ml:addRoot',
    guard(async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const res = await dialog.showOpenDialog(win, {
        title: 'Grant Mitchaelina access to a folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || res.filePaths.length === 0) return roots.listRoots();
      for (const p of res.filePaths) roots.addRoot(p);
      indexStore.rebuild();
      return roots.listRoots();
    }),
  );

  ipcMain.handle(
    'ml:removeRoot',
    guard(async (_event, p) => {
      const list = roots.removeRoot(p);
      indexStore.rebuild();
      return list;
    }),
  );

  ipcMain.handle('ml:searchFiles', guard(async (_event, query, limit) => indexStore.search(query, limit)));

  ipcMain.handle('ml:readMention', guard(async (_event, p) => executors.readMention(p)));

  ipcMain.handle(
    'ml:evaluateTool',
    guard(async (_event, name, argsJson) => {
      let args = {};
      try {
        args = JSON.parse(argsJson || '{}');
      } catch {
        // fall through with empty args — policy handles it
      }
      return policy.evaluateTool(name, args, sessionAuto);
    }),
  );

  ipcMain.handle(
    'ml:executeTool',
    guard(async (_event, name, argsJson, opts) => {
      let args = {};
      try {
        args = JSON.parse(argsJson || '{}');
      } catch {
        return { ok: false, resultText: 'Error: invalid tool arguments.' };
      }
      const { decision } = policy.evaluateTool(name, args, sessionAuto);
      if (decision === 'deny') {
        return { ok: false, resultText: 'Error: this action is not permitted.' };
      }
      // `approved:true` is honored ONLY for approve-class decisions. Main trusts
      // the click because it arrived via the origin-checked bridge from the
      // app's own UI. auto-class runs freely.
      if (decision === 'approve' && !(opts && opts.approved)) {
        return { ok: false, resultText: 'User denied this action.' };
      }
      return executors.runTool(name, args);
    }),
  );

  ipcMain.handle(
    'ml:setSessionAutoApprove',
    guard(async (_event, kind, on) => {
      if (kind === 'writes') sessionAuto.writes = !!on;
      else if (kind === 'commands') sessionAuto.commands = !!on;
      return { writes: sessionAuto.writes, commands: sessionAuto.commands };
    }),
  );
}

module.exports = { registerLocalIpc };
