import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Application, ApplicationState, JobOffer, RunResult } from "../src/shared/career.ts";
import { CareerCampaignEngine, CareerCampaignStore } from "../server/career-campaign.ts";

const job = (n: number): JobOffer => ({ id: `job-${n}`, url: `https://example.test/${n}`, title: `Role ${n}`, company: "Fixture Corp", location: "Paris", description: "Fixture", sourceUrl: "", discoveredAt: "", updatedAt: "" });
const app = (id: string, state: ApplicationState = "draft"): Application => ({ id, jobId: id.slice(4), resumeId: "resume-fixture", prospectId: null, state, outcome: "active", answers: {}, missingFields: [], notes: "", nextActionAt: "", lastError: "", receipt: null, createdAt: "", updatedAt: "", submittedAt: null });
const submitted: RunResult = { state: "submitted", missingFields: [], message: "fixture receipt", receipt: { url: "https://example.test/thanks", text: "Received", reference: "FIXTURE", observedAt: new Date().toISOString() } };
class FixturePort {
  apps = new Map<string, Application>();
  calls = new Map<string, number>();
  handler: (id: string, signal: AbortSignal) => Promise<RunResult> = async () => submitted;
  createApplication(jobId: string, _resumeId: string) { const id = `app-${jobId}`; const existing = this.apps.get(id); if (existing) return existing; const created = app(id); this.apps.set(id, created); return created; }
  getApplication(id: string) { const value = this.apps.get(id); if (!value) throw new Error("fixture app missing"); return value; }
  async run(id: string, signal: AbortSignal) { this.calls.set(id, (this.calls.get(id) ?? 0) + 1); const result = await this.handler(id, signal); if (result.state === "submitted") this.apps.set(id, { ...this.getApplication(id), state: "submitted" }); else if (result.state === "uncertain") this.apps.set(id, { ...this.getApplication(id), state: "uncertain" }); else if (result.state === "needs_input" || result.state === "blocked") this.apps.set(id, { ...this.getApplication(id), state: result.state }); return result; }
}
function persistent() {
  const dir = mkdtempSync(join(tmpdir(), "anima-campaign-")), path = join(dir, "campaign.sqlite");
  const open = () => { const db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL"); return { db, store: new CareerCampaignStore(db) }; };
  return { open, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
const create = (store: CareerCampaignStore, port: FixturePort, count = 3, cap = 10) => {
  const offers = Array.from({ length: count }, (_, i) => job(i + 1));
  const campaign = new CareerCampaignEngine(store, port).createFromOffers(offers, "resume-fixture", cap, `fixture-${count}-${cap}`);
  return campaign;
};

test("crash/restart preserves queue, maps submitting to uncertain, and never resends it", async () => {
  const disk = persistent(), port = new FixturePort(); let first = disk.open();
  const campaign = create(first.store, port, 2);
  first.store.requestStart(campaign.id);
  first.store.activateRequested(campaign.id);
  const claimed = first.store.claimNext(campaign.id, 1)!;
  port.apps.set(claimed.applicationId, { ...port.getApplication(claimed.applicationId), state: "submitting" });
  first.db.close();
  first = disk.open();
  const engine = new CareerCampaignEngine(first.store, port);
  await engine.recoverAfterRestart();
  assert.equal(first.store.get(campaign.id).state, "completed");
  assert.equal(first.store.listItems(campaign.id)[0].state, "uncertain");
  assert.equal(port.calls.size, 1);
  assert.equal(port.calls.get(claimed.applicationId), undefined);
  assert.equal(first.store.listItems(campaign.id).filter(x => x.state === "submitted").length, 1);
  first.db.close(); disk.dispose();
});

test("one item requiring input and one thrown error do not stop the following applications", async () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  port.handler = async id => { if (id === "app-job-1") return { state: "needs_input", missingFields: [], message: "MFA fixture", receipt: null }; if (id === "app-job-2") throw new Error("fixture timeout"); return submitted; };
  const campaign = create(store, port);
  await new CareerCampaignEngine(store, port).start(campaign.id);
  assert.deepEqual(store.listItems(campaign.id).map(x => x.state), ["needs_input", "failed", "submitted"]);
  db.close(); disk.dispose();
});

test("offers and application creation are idempotent when a crash separates persistence steps", () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  const campaign = store.create("resume-fixture", 5), engine = new CareerCampaignEngine(store, port);
  assert.equal(engine.addOffers(campaign.id, [job(1), job(2)]), 2);
  assert.equal(engine.addOffers(campaign.id, [job(1), job(2)]), 0);
  assert.equal(port.apps.size, 2); assert.equal(store.listItems(campaign.id).length, 2);
  db.close(); disk.dispose();
});

test("retry with the same idempotency key completes one partially built batch", () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  const engine = new CareerCampaignEngine(store, port), offers = [job(1), job(2), job(3)];
  const createApplication = port.createApplication.bind(port); let crash = true;
  port.createApplication = (jobId, resumeId) => { if (jobId === "job-2" && crash) { crash = false; throw new Error("simulated crash"); } return createApplication(jobId, resumeId); };
  assert.throws(() => engine.createFromOffers(offers, "resume-fixture", 5, "stable-batch-key"), /simulated crash/);
  const partial = store.get(store.create("resume-fixture", 5, "stable-batch-key").id);
  assert.equal(partial.state, "building"); assert.equal(store.listItems(partial.id).length, 1);
  const completed = engine.createFromOffers(offers, "resume-fixture", 5, "stable-batch-key");
  assert.equal(completed.id, partial.id); assert.equal(completed.state, "queued");
  assert.equal(store.listItems(completed.id).length, 3); assert.equal(port.apps.size, 3);
  assert.equal(engine.createFromOffers(offers, "resume-fixture", 5, "stable-batch-key").id, completed.id);
  assert.throws(() => engine.createFromOffers([job(4)], "resume-fixture", 5, "stable-batch-key"), /file différente/);
  assert.throws(() => store.create("another-resume", 5, "stable-batch-key"), /autre CV ou plafond/);
  db.close(); disk.dispose();
});

test("an acknowledged start persisted while queued is recovered and resumed after restart", async () => {
  const disk = persistent(), port = new FixturePort(); let first = disk.open();
  const campaign = create(first.store, port, 2);
  first.store.requestStart(campaign.id); // crash in the gap before activation/first queue claim
  assert.equal(first.store.get(campaign.id).state, "queued");
  first.db.close(); first = disk.open();
  await new CareerCampaignEngine(first.store, port).recoverAfterRestart();
  assert.equal(first.store.get(campaign.id).state, "completed");
  assert.equal(first.store.listItems(campaign.id).filter(x => x.state === "submitted").length, 2);
  first.db.close(); disk.dispose();
});

test("a manually paused campaign reconciles interrupted items but stays paused", async () => {
  const disk = persistent(), port = new FixturePort(); let first = disk.open();
  const campaign = create(first.store, port, 2);
  first.store.requestStart(campaign.id); first.store.activateRequested(campaign.id);
  const one = first.store.claimNext(campaign.id, 2)!, two = first.store.claimNext(campaign.id, 2)!;
  port.apps.set(one.applicationId, { ...port.getApplication(one.applicationId), state: "submitting" });
  port.apps.set(two.applicationId, { ...port.getApplication(two.applicationId), state: "running" });
  first.store.setState(campaign.id, "paused");
  first.db.close(); first = disk.open();
  const engine = new CareerCampaignEngine(first.store, port);
  await engine.recoverAfterRestart();
  assert.equal(first.store.get(campaign.id).state, "paused");
  assert.deepEqual(first.store.listItems(campaign.id).map(item => item.state), ["uncertain", "pending"]);
  assert.equal(port.calls.size, 0);
  first.db.close(); disk.dispose();
});

test("restart request while a paused pump still has a worker is not lost", async () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  const releases: ((value: RunResult) => void)[] = [];
  port.handler = () => new Promise(resolve => releases.push(resolve));
  const campaign = create(store, port, 2), engine = new CareerCampaignEngine(store, port);
  const original = engine.start(campaign.id);
  while (releases.length < 1) await new Promise(resolve => setTimeout(resolve, 1));
  engine.pause(campaign.id);
  const resumed = engine.start(campaign.id);
  assert.equal(store.get(campaign.id).state, "running");
  releases[0](submitted);
  while (releases.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
  releases[1](submitted);
  await Promise.all([original, resumed]);
  assert.equal(store.get(campaign.id).state, "completed");
  assert.equal(store.listItems(campaign.id).filter(x => x.state === "submitted").length, 2);
  db.close(); disk.dispose();
});

test("ready without a submission cannot be re-queued into an endless loop", async () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  let calls = 0;
  port.handler = async () => { calls++; return { state: "ready", missingFields: [], message: "Fill completed, send not attempted", receipt: null }; };
  const campaign = create(store, port, 1);
  await new CareerCampaignEngine(store, port).start(campaign.id);
  assert.equal(calls, 1); assert.equal(store.listItems(campaign.id)[0].state, "failed");
  db.close(); disk.dispose();
});

test("pause finishes only active work and explicit stop never restarts", async () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  let release!: (value: RunResult) => void;
  port.handler = () => new Promise(resolve => { release = resolve; });
  const campaign = create(store, port, 2), engine = new CareerCampaignEngine(store, port);
  const running = engine.start(campaign.id);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  engine.pause(campaign.id); release(submitted); await running;
  assert.equal(store.get(campaign.id).state, "paused"); assert.equal(store.listItems(campaign.id)[1].state, "pending");
  const resume = engine.start(campaign.id); while (store.listItems(campaign.id)[1].state !== "running") await new Promise(resolve => setTimeout(resolve, 1));
  const stopping = engine.stop(campaign.id); release(submitted); await stopping; await resume;
  assert.equal(store.get(campaign.id).state, "stopped");
  await engine.start(campaign.id); // terminal start retries are idempotent no-ops
  assert.equal(port.calls.size, 2);
  assert.throws(() => engine.addOffers(campaign.id, [job(9)]), /refusé/);
  db.close(); disk.dispose();
});

test("submission ceiling is enforced and concurrent workers never exceed configured limit", async () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  let active = 0, peak = 0;
  port.handler = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 4)); active--; return submitted; };
  const campaign = create(store, port, 5, 2);
  await new CareerCampaignEngine(store, port, { concurrency: 2 }).start(campaign.id);
  assert.equal(peak, 2); assert.equal(store.get(campaign.id).state, "limit_reached");
  assert.equal(store.listItems(campaign.id).filter(x => x.state === "submitted").length, 2);
  assert.equal(store.listItems(campaign.id).filter(x => x.state === "pending").length, 3);
  db.close(); disk.dispose();
});

test("concurrency limit is global across campaigns", async () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  let active = 0, peak = 0;
  port.handler = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return submitted; };
  const engine = new CareerCampaignEngine(store, port, { concurrency: 2 });
  const first = engine.createFromOffers([job(1), job(2), job(3)], "resume-fixture", 5, "global-one");
  const second = engine.createFromOffers([job(11), job(12), job(13)], "resume-fixture", 5, "global-two");
  await Promise.all([engine.start(first.id), engine.start(second.id)]);
  assert.equal(peak, 2);
  assert.equal(store.listItems(first.id).filter(x => x.state === "submitted").length, 3);
  assert.equal(store.listItems(second.id).filter(x => x.state === "submitted").length, 3);
  db.close(); disk.dispose();
});

test("pauseAll persists pause for every active campaign and waitAll drains workers", async () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  let release!: (value: RunResult) => void;
  port.handler = () => new Promise(resolve => { release = resolve; });
  const engine = new CareerCampaignEngine(store, port, { concurrency: 1 });
  const first = engine.createFromOffers([job(1)], "resume-fixture", 1, "shutdown-one");
  const second = engine.createFromOffers([job(2)], "resume-fixture", 1, "shutdown-two");
  void engine.start(first.id); void engine.start(second.id);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  engine.pauseAll();
  assert.equal(store.get(first.id).state, "paused"); assert.equal(store.get(second.id).state, "paused");
  let drained = false; const wait = engine.waitAll().then(() => { drained = true; });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(drained, false);
  release(submitted); await wait;
  assert.equal(drained, true); assert.equal(store.listItems(second.id)[0].state, "pending");
  db.close(); disk.dispose();
});

test("configuration rejects invalid concurrency and submission ceilings", () => {
  const disk = persistent(), { db, store } = disk.open(), port = new FixturePort();
  assert.throws(() => new CareerCampaignEngine(store, port, { concurrency: 5 }));
  assert.throws(() => store.create("resume", 0)); assert.throws(() => store.create("resume", 501));
  db.close(); disk.dispose();
});

test("campaign schema migration adds durable idempotency and start-intent columns", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE career_campaigns(id TEXT PRIMARY KEY,resume_id TEXT NOT NULL,max_submissions INTEGER NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE career_campaign_items(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES career_campaigns(id) ON DELETE CASCADE,application_id TEXT NOT NULL,job_id TEXT NOT NULL,state TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(campaign_id,job_id),UNIQUE(campaign_id,application_id));
    INSERT INTO career_campaigns VALUES ('legacy','resume-fixture',4,'queued','2026-10-01','2026-10-01');`);
  const store = new CareerCampaignStore(db);
  assert.equal(store.get("legacy").idempotencyKey, "");
  assert.equal(store.get("legacy").startRequested, false);
  assert.equal(store.create("resume-fixture", 2, "new-uuid-key").state, "building");
  db.close();
});

test("list ordering, hard limit and durable per-state counts", () => {
  const db = new DatabaseSync(":memory:"), store = new CareerCampaignStore(db), port = new FixturePort();
  for (let i = 0; i < 101; i++) store.create("resume-fixture", 1, `list-key-${i}`);
  assert.equal(store.list().length, 50);
  assert.equal(store.list(100).length, 100);
  assert.throws(() => store.list(101), /1–100/);
  const campaign = new CareerCampaignEngine(store, port).createFromOffers([job(1), job(2)], "resume-fixture", 5, "count-key");
  const counts = store.counts(campaign.id);
  assert.equal(counts.total, 2); assert.equal(counts.pending, 2); assert.equal(counts.submitted, 0);
  db.close();
});
