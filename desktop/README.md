# Mitchaelina — Desktop app

A thin [Electron](https://www.electronjs.org/) shell that wraps the **deployed**
Mitchaelina web app (`https://www.mitchaelina.com`). It bundles no Next.js
server and no static export — it just loads the remote site in a native window.

**This means the desktop app tracks the web app automatically:** every Vercel
deploy — including the per-user privacy / admin view-as features — ships to
desktop with no rebuild here. You only rebuild the desktop app to change the
shell itself (window chrome, icon, menu).

This package is intentionally **self-contained** (its own `package.json` and
`node_modules`) so its `electron-builder` config never collides with the
Next.js build. Nothing here is part of the Vercel build — the root
`npm run build` ignores `desktop/`.

## Prerequisites

- Node 18+ and npm.
- Building macOS artifacts requires macOS; building Windows artifacts is
  easiest on Windows (cross-building `.dmg`/`.nsis` off-platform is finicky).
- No code signing / notarization is configured yet (see the note at the
  bottom).

## Build

```bash
cd ui/desktop
npm install
npm run icons        # regenerate build/icon.png from ../public/avatar.webp (committed; only needed if the avatar changes)
npm run dist:mac     # macOS: .dmg + .zip for arm64 AND x64
# or
npm run dist:win     # Windows: NSIS installer (x64)
```

Artifacts land in **`ui/desktop/dist/`** (git-ignored).

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

## Unsigned builds on macOS

Because signing/notarization is not configured, macOS Gatekeeper will refuse to
open the `.dmg`/`.app` on a double-click the first time. Right-click the app and
choose **Open**, then confirm — after the first launch it opens normally. (Add
an Apple Developer ID + notarization config under `build.mac` when you're ready
to distribute signed builds.)
