import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CareerStore } from "../server/career-store.ts";

test("recovery completes a queue if the final successful item was committed before shutdown", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE prospects (id TEXT PRIMARY KEY);");
  const store = new CareerStore(db);
  const resume = store.saveResume({
    name: "CV", filename: "cv.pdf", mime: "application/pdf",
    bytes: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"),
  });
  const job = store.saveJob({
    url: "https://jobs.example.org/role/1", title: "Engineer", company: "Fixture",
  });
  const app = store.createApplication({ jobId: job.id, resumeId: resume.id });
  store.enqueueQueue([app.id]);
  const item = store.claimNextQueueItem();
  assert.ok(item);
  store.claimRun(app.id);
  store.markSubmitting(app.id);
  store.finishRun(app.id, {
    state: "submitted", message: "Confirmed", missingFields: [],
    receipt: {
      url: "https://jobs.example.org/role/1/thanks", text: "Application received",
      reference: "REC-1", observedAt: new Date().toISOString(),
    },
  });
  store.finishQueueItem(app.id, "submitted");
  assert.equal(store.getQueueSnapshot().status, "running");

  assert.equal(store.recoverInterruptedQueue().status, "completed");
  db.close();
});
