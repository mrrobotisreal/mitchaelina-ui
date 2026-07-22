// Mitchaelina desktop shell.
//
// This is a THIN Electron wrapper around the deployed web app — it loads a
// remote URL (https://www.mitchaelina.com by default) and bundles no Next.js
// server or static export. Every Vercel deploy — including the new per-user
// privacy features — therefore ships to the desktop automatically; there is
// nothing to rebuild here when the web app changes.
//
// Security posture (hard requirement): the renderer runs with
// contextIsolation ON, nodeIntegration OFF, and the sandbox ON, so the remote
// page has no access to Node or Electron internals. External links open in the
// user's real browser rather than as in-app popups.

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const { registerLocalIpc } = require('./local/ipc');
const { initAutoUpdate, checkForUpdatesManually } = require('./local/updater');

// The site to load. ELECTRON_START_URL lets the dev loop point at a local
// `next dev` server (http://localhost:3000); production uses the deployed app.
const START_URL = process.env.ELECTRON_START_URL || 'https://www.mitchaelina.com';

// The app's own origin — links to it navigate in-app; everything else opens
// externally. Falls back gracefully if START_URL is somehow unparseable.
function appOrigin() {
  try {
    return new URL(START_URL).origin;
  } catch {
    return 'https://www.mitchaelina.com';
  }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'Mitchaelina',
    icon: path.join(__dirname, 'build', 'icon.png'), // used on Linux/Windows dev runs; packaged apps use the derived .icns/.ico
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The preload exposes ONLY window.mitchaelinaDesktop (thin IPC wrappers).
      // All filesystem/exec enforcement lives in main (see local/ipc.js).
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  void mainWindow.loadURL(START_URL);

  // Route external origins to the default browser; deny in-app popups. Anything
  // on the app's own origin is allowed to navigate in the existing window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== appOrigin()) {
        void shell.openExternal(url);
        return { action: 'deny' };
      }
    } catch {
      return { action: 'deny' };
    }
    return { action: 'deny' }; // never spawn a second window; same-origin links load in-place
  });

  // A same-origin in-page link should navigate the window; an off-origin
  // top-level navigation should hand off to the browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== appOrigin()) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// A minimal application menu so the standard shortcuts work: ⌘R reload,
// zoom, and ⌘Q quit (Electron's default menu is otherwise dropped on some
// platforms once we call setApplicationMenu).
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const checkForUpdatesItem = {
    label: 'Check for Updates…',
    click: () => checkForUpdatesManually(),
  };
  const template = [
    // On macOS the "Check for Updates…" item conventionally lives in the app
    // menu, just under "About"; elsewhere it goes in Help.
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              checkForUpdatesItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [...(isMac ? [] : [checkForUpdatesItem])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  // Register the origin-guarded local-tools IPC handlers before any window
  // loads. appOrigin is the single source of truth for the origin check.
  registerLocalIpc(appOrigin);
  createWindow();

  // Background auto-update (packaged builds only; see local/updater.js).
  initAutoUpdate();

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS where apps stay resident
// until the user explicitly quits (⌘Q).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
