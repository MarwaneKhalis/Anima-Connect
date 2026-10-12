import test from "node:test";
import assert from "node:assert/strict";
import type { CareerProfile, JobOffer } from "../src/shared/career.ts";
import { matchJob } from "../src/shared/job-fit.ts";

const profile = (overrides: Partial<CareerProfile> = {}) => ({
  firstName: "", lastName: "", email: "", phone: "", city: "", country: "",
  address: "", postalCode: "", headline: "", summary: "", linkedinUrl: "", websiteUrl: "",
  skills: [], languages: [], experiences: [], education: [], answers: {}, updatedAt: "",
  preferences: { titles: [], locations: [], remote: false, contract: "" },
  ...overrides,
}) as CareerProfile;
const job = (overrides: Partial<JobOffer> = {}) => ({
  id: "job", url: "https://example.org/job", title: "Ingénieure logiciel", company: "Exemple",
  location: "Paris", description: "TypeScript et React · télétravail", sourceUrl: "",
  discoveredAt: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z", ...overrides,
});

test("profile match uses configured title, location, remote and skill criteria", () => {
  const fit = matchJob(job(), profile({
    skills: ["TypeScript", "Python"],
    preferences: { titles: ["Ingenieure logiciel"], locations: ["Paris"], remote: true, contract: "CDI" },
  }));
  assert.equal(fit?.score, 85);
  assert.deepEqual(fit?.reasons, ["Intitulé correspondant", "Lieu correspondant", "1 compétence correspondante"]);
});

test("no profile criteria means no invented fit score", () => {
  assert.equal(matchJob(job(), profile()), null);
});

test("score only evaluates criteria the person actually configured", () => {
  const fit = matchJob(job(), profile({ skills: ["Rust"] }));
  assert.equal(fit?.score, 0);
  assert.deepEqual(fit?.reasons, ["0 compétences correspondantes"]);
});

test("short skills and technical punctuation do not match substrings or longer tokens", () => {
  const noFalsePositive = matchJob(job({ description: "React and article recommendations" }), profile({ skills: ["C", "art"] }));
  assert.equal(noFalsePositive?.score, 0);
  const exactTerms = matchJob(job({ description: "C++, C#, .NET and Node.js" }), profile({ skills: ["C++", "C#", ".NET", "Node.js", "C"] }));
  assert.equal(exactTerms?.score, 80);
});
