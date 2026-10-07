import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";

const executablePath = resolve(
  process.env.ANIMA_DESKTOP_EXECUTABLE || "release/win-unpacked/Anima Connect.exe",
);
const application = await electron.launch({ executablePath });
try {
  const window = await application.firstWindow();
  await window.waitForLoadState("load");
  assert.match(await window.title(), /Anima Connect/i);
  await window.getByRole("button", { name: "Tableau de bord" }).waitFor({ state: "visible" });

  const bootstrap = await window.evaluate(() =>
    window.anima.request({
      method: "GET",
      path: "/api/bootstrap?demo=1",
    }),
  );
  assert.equal(bootstrap.status, 200);
  assert.equal(JSON.parse(bootstrap.body).demo, true);
  const backup = await window.evaluate(() =>
    window.anima.request({
      method: "GET",
      path: "/api/backup?demo=1",
    }),
  );
  assert.equal(backup.status, 200);
  assert.equal(backup.base64, true);
  assert.equal(Buffer.from(backup.body, "base64").subarray(0, 16).toString("ascii"), "SQLite format 3\0");
  assert.doesNotMatch(await window.locator("body").innerText(), /requêtes API locales|ne répond pas/);
  assert.deepEqual(
    await window.evaluate(() =>
      performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/i.test(url)),
    ),
    [],
  );
  if (process.env.ANIMA_CAPTURE_DESKTOP_PREVIEW === "1") {
    await mkdir("artifacts", { recursive: true });
    await window.screenshot({ path: "artifacts/anima-connect-desktop.png", timeout: 60_000 });
  }
  console.log("Electron UI opened from file://; bootstrap succeeded over IPC with no HTTP requests.");
} finally {
  await application.close();
}
