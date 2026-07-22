# Mitchaelina — Desktop app

A thin [Electron](https://www.electronjs.org/) shell that wraps the **deployed**
Mitchaelina web app (`https://www.mitchaelina.com`). It bundles no Next.js
server and no static export — it just loads the remote site in a native window.

**This means the desktop app tracks the web app automatically:** every Vercel
deploy — including the per-user privacy / admin view-as features — ships to
desktop with no rebuild here. You only rebuild the desktop app to change the
shell itself (window chrome, icon, menu) or the **local agentic file access**
bridge below.

> **Desktop releases are now required for native changes.** The local file
> access feature adds a preload bridge (`preload.js`) and a main-process tool
> engine (`local/`). Because those run natively, changes to `main.js`,
> `preload.js`, or anything under `local/` require cutting a new desktop
> release — they do NOT ship via Vercel. Purely web-only changes still ship
> automatically through Vercel as before.

This package is intentionally **self-contained** (its own `package.json` and
`node_modules`) so its `electron-builder` config never collides with the
Next.js build. Nothing here is part of the Vercel build — the root
`npm run build` ignores `desktop/`.

## Prerequisites

- Node 18+ and npm.
- **A `.dmg` can only be built on macOS.** DMG assembly relies on macOS-only
  tooling (`hdiutil`, the `dmg-license` native module), which does not exist on
  Linux/Windows — `npm run dist:mac` on Linux fails with
  `Cannot find module 'dmg-license'`. That is expected, not a misconfiguration.
  Windows `.nsis` installers are likewise easiest to build on Windows.
- No code signing / notarization is configured yet (see the note at the
  bottom).

## Build

```bash
cd ui/desktop
npm install
npm run icons        # regenerate build/icon.png from ../public/avatar.webp (committed; only needed if the avatar changes)

# On macOS — the full mac artifacts (.dmg + .zip, arm64 AND x64):
npm run dist:mac

# On Windows — the NSIS installer (x64):
npm run dist:win
```

Artifacts land in **`ui/desktop/dist/`** (git-ignored).

### Building on Linux (this workstation)

You cannot produce a `.dmg` here (see Prerequisites). You *can* still produce
an **unsigned macOS `.zip`** — electron-builder lays out the `.app` from the
downloaded mac Electron binary and zips it; only the DMG step is macOS-only:

```bash
npm run dist:mac-zip     # mac .zip only (arm64 + x64), unsigned
```

The `.app` inside is unsigned, so the first launch on a Mac needs
right-click → **Open** (see the bottom note). For a distributable, signed
`.dmg`, build on a Mac.

## Icon pipeline

`npm run icons` runs `scripts/make-icons.mjs`, which uses
[`sharp`](https://sharp.pixelplumbing.com/) to convert
`../public/avatar.webp` → `build/icon.png` at 1024×1024 (contain-fit on a
transparent background for non-square art). electron-builder derives the
platform icons (`.icns` / `.ico`) from that single PNG automatically. The
generated `build/icon.png` is committed so `dist:*` works without re-running
`icons` first.

## Dev loop (point at a local web server)

Run the Next.js dev server in one terminal and the Electron shell in another,
pointing it at localhost via `ELECTRON_START_URL`:

```bash
# terminal 1 — the web app
cd ui && npm run dev            # http://localhost:3000

# terminal 2 — the desktop shell against the local site
cd ui/desktop && npm install
ELECTRON_START_URL=http://localhost:3000 npm start
```

Without `ELECTRON_START_URL` the shell loads the production site.

## Security posture

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`, and only ever loads a remote URL. External links open in the
user's default browser (`shell.openExternal`); in-app popups are denied.

## Local agentic file access

The desktop shell lets a tool-capable model read and edit files on the user's
machine — but only within folders the user has explicitly granted, and only
through a tightly-guarded bridge.

### Trust model

The renderer is a **remotely-loaded web page** — treat it as semi-trusted. The
Electron **main process is the sole enforcement point**; the renderer and the
server never touch raw filesystem/exec:

- **Origin-checked IPC.** Every `ipcMain.handle` is wrapped in `guardIpc`
  (`local/ipc.js`), which rejects any call whose sender frame is not on the
  app's own origin (`isAppOrigin` in `local/paths.js`).
- **Granted-roots containment.** Every tool path and every `run_command`
  working directory is `realpath`'d and required to sit inside a granted root
  (`resolveWithin`/`containedIn`). Not-yet-existing write targets realpath their
  deepest existing ancestor, so a symlinked parent can't be used to escape.
  Violations return an error *result*, never an exception.
- **Approval policy re-evaluated in main.** `executeTool` re-runs the policy
  and refuses non-approved mutations even if the renderer claims `approved`.

### Granted roots

Users grant folders via the native directory picker (**Local access** button
by the composer). Roots are stored realpath'd in
`app.getPath('userData')/local-roots.json` and persist across launches.

### Approval classes (`local/policy.js`)

| Tool | Decision |
| --- | --- |
| `search_files`, `list_directory`, `read_file`, `grep_files` | **auto** (read-only) |
| `edit_file`, `write_file` | **approve** (unless session always-allow for writes) |
| `run_command` (allowlisted read-only: `ls`/`cat`/`git status`/… with no shell metacharacters) | **auto** |
| `run_command` (anything else) | **approve** (unless session always-allow for commands) |
| unknown | **deny** |

"Session always-allow" is per-app-run and in memory only — there is **no
global persistent auto-approve**. Every mutation needs explicit approval or a
session always-allow the user granted earlier in that run.

### Tests

The trust-critical pure logic (origin check, containment boundary, command
allowlist, policy decisions) is unit-tested without Electron:

```bash
npm test        # node --test local/*.test.js
```

## Auto-updates

The app updates itself via `electron-updater` against a feed you publish to:
background download → "Restart now / Later" (silent on Windows and on
signed/notarized macOS; a "Download" fallback dialog on unsigned macOS). Bumping
`version` in `package.json` is what triggers a release. Full details — hosting
options, the macOS signing requirement, the release workflow, and testing — are
in **[UPDATES.md](./UPDATES.md)**.

## Unsigned builds on macOS

Because signing/notarization is not configured, macOS Gatekeeper will refuse to
open the `.dmg`/`.app` on a double-click the first time. Right-click the app and
choose **Open**, then confirm — after the first launch it opens normally. (Add
an Apple Developer ID + notarization config under `build.mac` when you're ready
to distribute signed builds.)
