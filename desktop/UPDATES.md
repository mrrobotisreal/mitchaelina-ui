# Mitchaelina Desktop — Auto-Updates

How the desktop app updates itself for your family, the way Claude Desktop /
Cursor / VS Code do it — plus the one macOS gotcha that decides whether it's
truly seamless or "notify + one-click download."

TL;DR: the app now checks a small **update feed** you publish to, downloads new
versions in the background, and prompts **"Update ready — Restart now / Later."**
On macOS that silent install **requires code signing + notarization**; without
it the app gracefully falls back to a **"Download"** dialog so nobody has to go
hunting. No UI (web) changes were needed — the whole thing lives in the Electron
main process.

---

## 1. How it works (what's already wired)

Powered by [`electron-updater`](https://www.electron.build/auto-update)
(`ui/desktop/local/updater.js`, initialized from `main.js`):

- **On launch** (4s in) and **every 6 hours** while open, the app checks the
  feed configured in `package.json → build.publish`.
- If a **newer `version`** exists, it downloads the new build **in the
  background** (`autoDownload = true`).
- When the download finishes, a native dialog appears:

  > **Mitchaelina 1.2.0 is ready to install**
  > The update has been downloaded. Restart to apply it — your chats live on the
  > server, so nothing is lost.
  > **[ Restart now ]   [ Later ]**

  "Restart now" calls `quitAndInstall()`. "Later" still installs on next quit
  (`autoInstallOnAppQuit = true`).
- There's a **Check for Updates…** menu item (macOS app menu / Help elsewhere)
  for an on-demand check.
- **Dev runs never auto-update** — it's gated on `app.isPackaged`, so
  `ELECTRON_START_URL=… npm start` is unaffected.

**Version detection = the `version` field in `ui/desktop/package.json`.** An
update is "available" purely because the feed advertises a higher semver than
the running app. Bump it every release.

---

## 2. The macOS reality: signing decides "seamless" vs "notify" ⚠️

This is the single most important thing to understand.

On macOS, `electron-updater` installs via **Squirrel.Mac**, which **refuses to
apply an update to an unsigned app** — it can't verify the code signature and
errors out. Claude Desktop, Cursor, and VS Code all feel seamless because they
are **signed with an Apple Developer ID and notarized by Apple**. That's the
price of the magic.

So you have two honest paths:

| | Signed + notarized (Apple Developer, $99/yr) | Unsigned (free) |
|---|---|---|
| macOS update | **Silent background download → "Restart now"** ✅ | App detects the update and shows a **"Download"** dialog → user replaces the app manually |
| First install | Double-click the `.dmg`, drag to Applications | Right-click → **Open** the first time (Gatekeeper) |
| Windows | Silent auto-update ✅ | Silent auto-update ✅ (SmartScreen warns on first run) |

**The app handles both automatically.** If Squirrel.Mac can't install (unsigned),
`updater.js` catches the error and, because it already knows a newer version
exists, shows:

> **Mitchaelina 1.2.0 is available**
> This build can't install updates automatically. Click Download to get the new
> version, then drag it into your Applications folder (replacing the old one)
> and reopen the app.
> **[ Download ]   [ Later ]**

"Download" opens `MITCHAELINA_DOWNLOAD_URL` (default
`https://www.mitchaelina.com/download`) in the browser.

**Recommendation:** for a handful of family Macs, either
1. **pay the $99/yr Apple Developer Program** and get the real seamless
   experience (setup in §6), or
2. **stay unsigned** and live with the one-click "Download → drag to
   Applications" fallback. It's still a world better than emailing DMGs — the app
   tells them, links them, and they never hunt for anything.

Windows is seamless either way.

---

## 3. What your family actually sees

**Signed (or Windows):** they use the app normally. Some launch later a small
"Update ready — Restart now / Later" box appears. They click Restart. Done. They
never think about versions.

**Unsigned macOS:** some launch later a "New version available — Download" box
appears. They click Download, the browser fetches the new `.dmg`/`.zip`, they
drag the app into Applications replacing the old one, reopen. ~30 seconds, no
account/re-login needed (auth + chats live on the server).

---

## 4. Where to host the update feed

`electron-updater` just needs a URL serving a few files:

- `latest-mac.yml` (macOS) / `latest.yml` (Windows) — a tiny manifest listing
  the newest version, artifact filenames, sizes, and SHA-512 hashes.
- The artifacts themselves: **`.zip` for the macOS updater** (dmg is only for
  first-time human download), `.exe`/nsis for Windows.
- The `.blockmap` files (enable fast **delta** downloads — only changed bytes).

Pick one host. The app currently ships pointing at **option A**.

### A) Self-host on your API (default, most private) — already wired

`package.json → build.publish` is set to:

```json
{ "provider": "generic", "url": "https://api.mitchaelina.com/desktop" }
```

The Go API serves a directory publicly at `/desktop/` when you set an env var
(implemented in this change):

```bash
# api/.env
CHATLAB_DESKTOP_FEED_DIR=/srv/mitchaelina/desktop-updates
```

Then each release, copy the feed files into that directory:

```bash
# from ui/desktop, after building (see §5)
rsync -av \
  dist/latest-mac.yml \
  dist/*.zip dist/*.zip.blockmap \
  dist/*.dmg \
  youruser@yourserver:/srv/mitchaelina/desktop-updates/
# (add dist/latest.yml + dist/*.exe* for Windows releases)
```

**Caveat — the reverse proxy.** `api.mitchaelina.com` is fronted by your reverse
proxy. It must forward **`/desktop/`** (not just `/api/`) to the Go service, the
same way `/health` is reachable. If your proxy only routes `/api/*`, either add a
`/desktop/` location block (a system-config change — do it yourself; I won't
touch nginx) or use option B/C, which need no proxy change.

Pros: fully self-contained + private (no third party sees the binaries), no
extra cloud. Cons: needs the proxy rule; your home uplink serves the ~100 MB
artifacts (fine for a few Macs).

### B) Amazon S3 / CloudFront (smoothest "real app" workflow)

You already use S3. Put the feed in a **public-read** prefix or a dedicated
bucket, and let `electron-builder` upload it for you on build:

```json
// package.json → build.publish
{ "provider": "s3", "bucket": "mitchaelina-desktop", "path": "/", "acl": "public-read" }
```

```bash
# uploads artifacts + yml automatically after building
npm run dist:mac -- --publish always     # needs AWS creds in env
```

electron-updater then fetches from the bucket's URL (or a CloudFront
distribution in front of it for HTTPS + caching). No reverse-proxy changes, and
bandwidth is off your home box. Keep this bucket/prefix **separate** from the
private attachments bucket — these objects are public.

### C) GitHub Releases (least infra)

```json
{ "provider": "github", "owner": "mrrobotisreal", "repo": "mitchaelina-desktop-releases" }
```

```bash
GH_TOKEN=… npm run dist:mac -- --publish always
```

`electron-builder` creates the GitHub Release and uploads everything;
`electron-updater` reads it with zero server code. **Caveat:** for a *private*
repo the client needs an embedded token (awkward to distribute), so use a
**dedicated public "releases" repo** — it holds only binaries, never source.

---

## 5. The release workflow (every update)

1. **Make your changes.** Web-only changes ship via Vercel and need **no desktop
   release**. Only changes to `main.js`, `preload.js`, or `local/**` require a
   new desktop build.
2. **Bump the version** in `ui/desktop/package.json` (e.g. `1.1.0 → 1.2.0`).
   This is what triggers the update for everyone.
3. **Build** the distributables (these emit `latest-mac.yml` + `.zip` +
   `.blockmap`, which `--dir` does **not**):

   ```bash
   cd ui/desktop
   npm install
   npm run dist:mac        # .dmg + .zip (arm64 + x64) + latest-mac.yml
   # npm run dist:win      # on Windows, for a Windows release
   ```
4. **Publish the feed** — whichever host from §4:
   - A) `rsync` `dist/*.yml`, `dist/*.zip`, `dist/*.blockmap` (+ `.dmg` for the
     download page) to `CHATLAB_DESKTOP_FEED_DIR` on the server.
   - B/C) `-- --publish always` did it during the build.
5. **Done.** Open apps pick it up within 6h (or on next launch / "Check for
   Updates…").

**Always upload the `.yml` and `.blockmap` alongside the artifact**, and never
delete the currently-referenced artifact until everyone has moved past it — a
client mid-download needs it to still exist.

---

## 6. Enabling signed + notarized macOS builds (for true seamless updates)

**The build config is already wired.** `package.json → build.mac` has
`hardenedRuntime`, `gatekeeperAssess: false`, `entitlements` +
`entitlementsInherit` → `build/entitlements.mac.plist` (created, with the
JIT/unsigned-memory entitlements Electron needs under the hardened runtime), and
`notarize: true`. You don't need to add anything to the config.

What's left is the two things only you can provide:

1. **A "Developer ID Application" certificate in your login keychain.** Your
   $99 account alone isn't it — being signed into Xcode manages App Store certs,
   not this one. Verify:

   ```bash
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```

   If nothing prints, create it: Xcode → Settings → Accounts → Manage
   Certificates → **+** → **Developer ID Application** (or on
   developer.apple.com). Once it's in the keychain, electron-builder
   auto-discovers and signs with it — no config needed
   (`CSC_IDENTITY_AUTO_DISCOVERY` defaults on). If you have several identities,
   pin one with `mac.identity` or `CSC_NAME`.

2. **Notarization credentials in the environment** (an app-specific password
   generated at appleid.apple.com — NOT your Apple ID login password — plus your
   Team ID).

Then build **on your Mac**. With the cert in your keychain you only need the
three notarization vars — signing is picked up from the keychain automatically:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"   # from appleid.apple.com
export APPLE_TEAM_ID="XXXXXXXXXX"                          # 10-char Team ID
npm run dist:mac
```

(Only if you're building somewhere WITHOUT the cert in a keychain — e.g. CI —
also export `CSC_LINK` = path/base64 of your exported `DeveloperID.p12` and
`CSC_KEY_PASSWORD`.)

Expect the notarization step to add a few minutes on the first build (Apple's
notary service runs server-side; electron-builder waits and then "staples" the
ticket). Once signed + notarized, macOS silent auto-update "just works" and the
§2 fallback dialog never fires. **Never commit these secrets** (same rule as the
API's `.env`).

---

## 7. Testing the updater without shipping to anyone

`electron-updater` won't run in a dev (`npm start`) session — it needs a packaged
build. To exercise it end-to-end:

1. Build **1.1.0**, publish it to the feed, install that build locally.
2. Bump to **1.2.0**, build, publish it to the same feed.
3. Launch the installed 1.1.0. Within a few seconds it should detect 1.2.0.
   - Signed: it downloads and shows "Restart now."
   - Unsigned macOS: you'll see the "Download" fallback dialog.
4. Use **Check for Updates…** to force a check instead of waiting.

Tip: to watch what's happening, run the installed binary from a terminal and
read the `[updater]` console logs, or add `electron-log` and set
`autoUpdater.logger`.

---

## 8. Rollback

Re-publish the previous artifacts and **restore the previous `latest-mac.yml`**
(it points at the older version). Clients only ever move to the version the
`.yml` advertises — so the manifest is the source of truth. Keep the last couple
of releases' artifacts around so a rollback (or a slow client) never 404s.

---

## 9. What changed in the codebase

**Desktop (`ui/desktop/`)** — a new desktop release is required for these:
- `local/updater.js` — the auto-update logic (checks, background download,
  restart prompt, unsigned-macOS "Download" fallback, manual check).
- `main.js` — initializes the updater on ready; adds the "Check for Updates…"
  menu item.
- `package.json` — `electron-updater` dependency + `build.publish` feed config.

**API (`api/`)** — optional, only for self-hosting the feed (§4A):
- `internal/config/config.go` + `.env.example` — `CHATLAB_DESKTOP_FEED_DIR`.
- `cmd/api/main.go` — serves that directory publicly at `/desktop/` when set.

**UI (web, Vercel)** — **nothing.** The updater is entirely main-process +
native dialogs, independent of the remote page.
