# Anima Connect Desktop (Windows)

Electron opens the Vite build from disk (`file://`); it does not start or listen on a web server. Renderer calls go through the sandboxed preload bridge (`anima:request`) to the existing application API running in the Electron main process. SQLite files and the persistent Playwright profile live under Electron's per-user `userData` directory.

## Local development

Requires Node 24 and pnpm. Install dependencies, then run `pnpm desktop:dev`. To create a Windows NSIS installer, run `pnpm desktop:dist`; this downloads the matching Playwright Chromium into `.playwright-browsers` and packages it next to the app. The installer is written to `release/`.

The existing Node API module is loaded only with `ANIMA_ELECTRON_MODE=1`, which prevents construction/listening of its HTTP server. IPC invokes its handler directly with in-memory request/response adapters. No localhost port is opened.

The installer must be tested on a clean Windows user profile before release. In particular, verify Chromium extraction/launch, resume and SQLite backup downloads, restore, vault data persistence, and shutdown. Electron packaging, code signing, and a real installed-app smoke test are not covered by `pnpm test`.
