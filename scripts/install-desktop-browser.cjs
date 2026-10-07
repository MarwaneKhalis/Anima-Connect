const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, ".playwright-browsers") },
});
process.exit(result.status ?? 1);
