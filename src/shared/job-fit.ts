import type { CareerProfile, JobOffer } from "./career.ts";

export interface JobFit {
  score: number;
  reasons: string[];
}

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();

const isTokenCharacter = (value: string | undefined) => !!value && /[a-z0-9+#]/.test(value);
function containsTerm(text: string, term: string): boolean {
  if (!term) return false;
  let from = 0;
  while (true) {
    const index = text.indexOf(term, from);
    if (index < 0) return false;
    const before = text[index - 1];
    const after = text[index + term.length];
    if (!isTokenCharacter(before) && !isTokenCharacter(after)) return true;
    from = index + 1;
  }
}

/** Transparent, local heuristic. It is not an assessment of employer criteria. */
export function matchJob(job: JobOffer, profile: CareerProfile): JobFit | null {
  const titles = profile.preferences.titles.map(normalize).filter(Boolean);
  const locations = profile.preferences.locations.map(normalize).filter(Boolean);
  const skills = profile.skills.map(normalize).filter(Boolean);
  const title = normalize(job.title);
  const place = normalize(`${job.location} ${job.description}`);
  const description = normalize(`${job.title} ${job.description}`);
  const factors: { weight: number; score: number; reason: string }[] = [];

  if (titles.length) {
    const matched = titles.some((preferred) => containsTerm(title, preferred));
    factors.push({ weight: 40, score: matched ? 100 : 0, reason: matched ? "Intitulé correspondant" : "Intitulé à vérifier" });
  }
  if (locations.length || profile.preferences.remote) {
    const locationMatch = locations.some((preferred) => containsTerm(place, preferred));
    const remoteMatch = profile.preferences.remote && /\b(remote|remotely|teletravail|work from home)\b/.test(place);
    const matched = locationMatch || remoteMatch;
    factors.push({ weight: 30, score: matched ? 100 : 0, reason: matched ? "Lieu correspondant" : "Lieu à vérifier" });
  }
  if (skills.length) {
    const matchedSkills = skills.filter((skill) => containsTerm(description, skill));
    factors.push({
      weight: 30,
      score: Math.round((matchedSkills.length / skills.length) * 100),
      reason: `${matchedSkills.length} compétence${matchedSkills.length === 1 ? "" : "s"} correspondante${matchedSkills.length === 1 ? "" : "s"}`,
    });
  }
  if (!factors.length) return null;
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  return {
    score: Math.round(factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight),
    reasons: factors.map((factor) => factor.reason),
  };
}
