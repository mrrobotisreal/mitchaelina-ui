// Auto-update for the Mitchaelina desktop shell (Electron main).
//
// Uses electron-updater against the feed configured in package.json →
// build.publish (a "generic" URL by default). The whole flow lives in main +
// native dialogs, so the remotely-loaded web page needs no changes.
//
// Behavior (matches a real desktop app like Cursor / VS Code):
//   • On launch (and every 6h while open) it checks the feed.
//   • If a newer version exists it downloads it in the background.
//   • When the download finishes it shows "Update ready — Restart now / Later".
//     "Later" still installs on next quit (autoInstallOnAppQuit).
//   • A "Check for Updates…" menu item forces an immediate check.
//
// IMPORTANT — macOS code signing. Squirrel.Mac (what electron-updater uses on
// macOS) will NOT install an update to an UNSIGNED app: it can't verify the
// code signature and errors out. So seamless auto-update on the family's Macs
// requires signing + notarization (see UPDATES.md). When install isn't
// possible we DON'T fail silently — we fall back to a "Download" dialog that
// opens the download page so the user can grab the new build manually.

const { autoUpdater } = require('electron-updater');
const { dialog, shell, app } = require('electron');

// A human-facing page/folder to open when automatic install isn't possible.
// Override with MITCHAELINA_DOWNLOAD_URL at build/run time if you host a nicer
// landing page than the raw feed directory.
const DOWNLOAD_PAGE = process.env.MITCHAELINA_DOWNLOAD_URL || 'https://www.mitchaelina.com/download';

let initialized = false;
let manualCheck = false; // true when the user clicked "Check for Updates…"
let fallbackPrompted = false; // avoid spamming the manual-download dialog per check
let latestInfo = null; // last "update-available" info, for the fallback prompt

function notifyUpToDate() {
  if (!manualCheck) return; // only speak up for an explicit user-triggered check
  void dialog.showMessageBox({
    type: 'info',
    buttons: ['OK'],
    title: 'Up to date',
    message: 'You’re on the latest version',
    detail: `Mitchaelina ${app.getVersion()} is the newest version available.`,
  });
}

async function promptRestart(info) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update ready',
    message: `Mitchaelina ${info.version} is ready to install`,
    detail:
      'The update has been downloaded. Restart to apply it — your chats live on the server, so nothing is lost.',
  });
  if (response === 0) {
    // isSilent=false so the installer UI shows on Windows; forceRunAfter=true
    // reopens the app after installing.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }
}

async function promptManualDownload(info) {
  if (fallbackPrompted) return;
  fallbackPrompted = true;
  const version = (info && info.version) || 'A new version';
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update available',
    message: `Mitchaelina ${version} is available`,
    detail:
      'This build can’t install updates automatically. Click Download to get the new version, then drag it into your Applications folder (replacing the old one) and reopen the app.',
  });
  if (response === 0) void shell.openExternal(DOWNLOAD_PAGE);
}

function wireEvents() {
  autoUpdater.on('update-available', (info) => {
    latestInfo = info;
  });
  autoUpdater.on('update-not-available', () => {
    notifyUpToDate();
  });
  autoUpdater.on('update-downloaded', (info) => {
    void promptRestart(info);
  });
  autoUpdater.on('error', (err) => {
    // Most common cause on macOS: an UNSIGNED app Squirrel.Mac won't verify.
    // If we already know an update exists, degrade to the manual-download
    // prompt rather than failing silently.
    console.error('[updater] error:', err && err.message ? err.message : err);
    if (latestInfo) {
      void promptManualDownload(latestInfo);
    } else if (manualCheck && !fallbackPrompted) {
      fallbackPrompted = true;
      void dialog.showMessageBox({
        type: 'warning',
        buttons: ['OK'],
        title: 'Update check failed',
        message: 'Could not check for updates',
        detail: String((err && err.message) || err),
      });
    }
  });
}

function check(isManual) {
  manualCheck = !!isManual;
  fallbackPrompted = false;
  autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed:', e));
}

// initAutoUpdate wires the automatic background checks. No-op in a dev run
// (app.isPackaged === false) — you only auto-update real installed builds.
function initAutoUpdate() {
  if (initialized) return;
  initialized = true;
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  wireEvents();

  setTimeout(() => check(false), 4000); // shortly after launch
  setInterval(() => check(false), 6 * 60 * 60 * 1000); // every 6h while open
}

// checkForUpdatesManually backs the "Check for Updates…" menu item.
function checkForUpdatesManually() {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      title: 'Updates disabled in development',
      message: 'Auto-update only runs in a packaged build',
      detail: 'Build and install the app to exercise the updater.',
    });
    return;
  }
  check(true);
}

module.exports = { initAutoUpdate, checkForUpdatesManually };
