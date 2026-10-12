import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CareerStore } from "../server/career-store.ts";

test("reimport refreshes an offer's collection timestamp without changing its identity", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE prospects (id TEXT PRIMARY KEY);");
  const store = new CareerStore(db);
  const first = store.saveJob({ url: "https://example.org/jobs/1", title: "Engineer", company: "Example" });
  await new Promise((resolve) => setTimeout(resolve, 3));
  const second = store.saveJob({ url: "https://example.org/jobs/1", title: "Senior Engineer", company: "Example" });

  assert.equal(second.id, first.id);
  assert.ok(second.discoveredAt > first.discoveredAt);
  assert.equal(second.title, "Senior Engineer");
  db.close();
});
