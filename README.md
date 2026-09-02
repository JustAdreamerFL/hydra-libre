# Hydra Libre

Hydra Libre is a free, local-first distribution of [Hydra Launcher](https://github.com/hydralauncher/hydra). It keeps the launcher's library, downloads, achievements, playtime, social profile, and save-backup features while making local profile synchronization available without a subscription.

> This project is community-maintained. It is not an official Hydra Launcher release.

## Highlights

- **Free local save backups** — choose any folder for Ludusavi archives and metadata.
- **Portable profile synchronization** — the selected folder also contains `hydra-libre-profile.json`, a readable, atomic snapshot of games, playtime, favorites, pins, achievements, artwork, and safe launcher preferences. It works with Dropbox, OneDrive, Syncthing, Nextcloud, a NAS, or a USB drive.
- **Local-first behavior** — profile sync is best-effort at startup, after sign-in, and periodically while the launcher is running. An unavailable drive never prevents offline use.
- **Achievements and profile data for everyone** — profile achievement browsing is not hidden behind Hydra Cloud.
- **Optional Hydra Cloud** — the hosted provider remains available for users who choose it; it is separate from free folder sync.
- **Windows, Linux, and macOS releases** — the release workflow builds installers/packages for all three platforms.
- **Complete product website** — see [`website/`](website/) for the Overview, Features, Achievements, Social, Cloud saves, Download, and FAQ tabs.

## Profile synchronization

1. Open **Settings → Backups**.
2. Select a folder you control. Hydra Libre switches to the free local provider and creates the folder when it first syncs.
3. Use **Sync now** to merge this device with the shared snapshot, or **Restore** to import it without replacing the shared file.
4. Point your file synchronization tool at the same folder on another device and repeat the setup.

The merge is intentionally conservative: playtime and unlock timestamps use the newest/largest value, favorites and pins are retained, and device-specific paths, executables, Wine prefixes, and downloads are never copied between computers. Authenticated profile files are checked against the local account ID before they are merged.

## Development

Requirements:

- Node.js 22 or newer
- Yarn 1.22 (Corepack can activate the pinned version)
- Python 3.9 for the packaged Python RPC helper
- Platform packaging prerequisites for Electron Builder

```bash
corepack enable
yarn install
yarn typecheck
yarn test
yarn dev
```

The install hook downloads the matching Ludusavi binary. If package or release dependencies are unavailable, checks can still be run with `yarn install --ignore-scripts`.

To preview the static site:

```bash
python3 -m http.server 4173 --bind 0.0.0.0 --directory website
```

## Releases and upstream updates

- Push a `v*` tag to run `.github/workflows/release.yml`. It builds Windows, Linux, and macOS artifacts in parallel and publishes them together on one GitHub release.
- `.github/workflows/ci.yml` runs typechecks and tests for pushes and pull requests.
- `.github/workflows/sync-upstream.yml` checks `hydralauncher/hydra` weekly and opens a reviewable pull request. Non-conflicting changes are merged automatically; conflicts favor Hydra Libre's local changes and are called out for review.
- `.github/workflows/website.yml` deploys the static `website/` directory through GitHub Pages.

## Project layout

```text
src/main/services/profile-sync.ts       portable profile snapshot/merge service
src/main/events/profile-sync/            profile-sync IPC endpoints
src/main/services/local-backup.ts       free Ludusavi archive provider
src/renderer/src/pages/settings/        backup and profile-sync controls
website/                                static Hydra Libre product website
.github/workflows/                      checks, release, website, upstream sync
```

## License

See [LICENSE](LICENSE). Hydra Libre builds on the open-source Hydra Launcher project and retains its upstream license and notices.
