import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CareerStore } from "../server/career-store.ts";
import { CareerRunner } from "../server/career-runner.ts";
import { Vault } from "../server/vault.ts";

test("a missing CV fails before the application is claimed as running", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE prospects (id TEXT PRIMARY KEY);");
  const store = new CareerStore(db);
  const resume = store.saveResume({
    name: "CV", filename: "cv.pdf", mime: "application/pdf",
    bytes: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"),
  });
  const job = store.saveJob({ url: "https://jobs.example.org/role/2", title: "Engineer", company: "Fixture" });
  const application = store.createApplication({ jobId: job.id, resumeId: resume.id });
  db.exec("PRAGMA foreign_keys=OFF;");
  db.prepare("DELETE FROM career_resumes WHERE id=?").run(resume.id);
  const runner = new CareerRunner(store, new Vault(db), {
    pendingApplicationId: () => null,
    run: async () => { throw new Error("Browser should not start"); },
    close: async () => {},
  } as any);

  assert.throws(() => runner.start(application.id, "submit"), { code: "not_found" });
  assert.equal(store.getApplication(application.id).state, "draft");
  db.close();
});
