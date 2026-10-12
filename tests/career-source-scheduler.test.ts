import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CareerStore } from "../server/career-store.ts";
import { CareerSourceScheduler } from "../server/career-source-scheduler.ts";

test("saved sources persist cadence, pause state, run counts and errors without expiring missing offers", async () => {
  const db = new DatabaseSync(":memory:");
  const store = new CareerStore(db);
  const source = store.createSource({ label: "Greenhouse board", url: "https://boards.greenhouse.io/acme", cadenceHours: 24 });
  const listings = [{ url: "https://jobs.example.org/1", title: "Engineer", company: "Acme", location: "Paris", description: "", sourceUrl: source.url }];
  let fail = false;
  const scheduler = new CareerSourceScheduler(store, { async discover() { if (fail) throw new Error("Offline"); return { offers: listings, note: "ok" }; } });
  try {
    const first = await scheduler.runNow(source.id);
    assert.equal(first.status, "succeeded");
    assert.equal(first.lastFound, 1);
    assert.equal(first.lastNew, 1);
    assert.equal(store.listJobs().length, 1);
    listings[0] = { ...listings[0], title: "Senior Engineer" };
    const second = await scheduler.runNow(source.id);
    assert.equal(second.lastNew, 0);
    assert.equal(second.lastUpdated, 1);
    assert.equal(store.listJobs()[0].title, "Senior Engineer");
    const cadenceChanged = store.updateSource(source.id, { cadenceHours: 168 });
    assert.ok(Date.parse(cadenceChanged.nextRunAt) <= Date.now(), "a cadence change takes effect immediately");
    listings.splice(0, 1);
    const empty = await scheduler.runNow(source.id);
    assert.equal(empty.lastFound, 0);
    assert.equal(store.listJobs().length, 1, "a successful empty scan must not delete an older offer");
    fail = true;
    await assert.rejects(scheduler.runNow(source.id), /Offline/);
    assert.equal(store.getSource(source.id).status, "failed");
    assert.match(store.getSource(source.id).lastError, /Offline/);
    assert.equal(store.updateSource(source.id, { enabled: false }).enabled, false);
    await assert.rejects(scheduler.runNow(source.id), { code: "source_disabled" });
    const duplicate = store.createSource({ label: "Acme careers", url: "https://boards.greenhouse.io/acme", cadenceHours: 6 });
    assert.equal(duplicate.id, source.id);
    assert.equal(duplicate.label, "Acme careers");
    assert.equal(duplicate.cadenceHours, 6);
    assert.equal(duplicate.enabled, false, "upserting source details must preserve the user's paused state");
    const resumed = store.updateSource(source.id, { enabled: true });
    assert.ok(Date.parse(resumed.nextRunAt) <= Date.now());
    assert.throws(() => store.deleteSource("invalid"));
  } finally { db.close(); }
});

test("scheduler recovers interrupted collections and refreshes due sources while active", async () => {
  const db = new DatabaseSync(":memory:");
  const store = new CareerStore(db);
  const source = store.createSource({ label: "Due source", url: "https://boards.greenhouse.io/due", cadenceHours: 6 });
  store.beginSourceRun(source.id);
  store.recoverSourceRuns(new Date().toISOString());
  assert.equal(store.getSource(source.id).status, "failed");
  assert.equal(store.getSource(source.id).enabled, true);
  let calls = 0;
  const scheduler = new CareerSourceScheduler(store, { async discover() { calls++; return { offers: [], note: "empty" }; } });
  scheduler.start();
  try {
    const deadline = Date.now() + 2_000;
    while (store.getSource(source.id).status !== "succeeded" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(store.getSource(source.id).status, "succeeded");
    assert.equal(calls, 1);
  } finally { await scheduler.stop(); db.close(); }
  await assert.rejects(scheduler.runNow(source.id), /maintenance/);
});
