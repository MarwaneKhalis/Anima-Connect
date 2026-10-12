import type { CareerDiscovery } from "../src/shared/career.ts";
import { CareerStore } from "./career-store.ts";

export class CareerSourceScheduler {
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private activeRuns = new Set<Promise<unknown>>();
  private acceptingRuns = true;
  private store: CareerStore;
  private readonly discovery: CareerDiscovery;
  constructor(store: CareerStore, discovery: CareerDiscovery) { this.store = store; this.discovery = discovery; }
  setStore(store: CareerStore): void { this.store = store; }

  start(): void {
    if (this.timer) return;
    this.acceptingRuns = true;
    void this.tick().catch(() => {});
    this.timer = setInterval(() => void this.tick().catch(() => {}), 60_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.acceptingRuns = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
    await Promise.allSettled([...this.activeRuns]);
  }

  async runNow(sourceId: string) {
    if (!this.acceptingRuns) throw new Error("Les collectes sont suspendues pendant une opération de maintenance.");
    const task = this.run(sourceId);
    this.activeRuns.add(task);
    try { return await task; } finally { this.activeRuns.delete(task); }
  }

  private async tick(): Promise<void> {
    if (!this.acceptingRuns) return;
    if (this.ticking) return this.ticking;
    this.ticking = (async () => {
      const due = this.store.listSources().filter((source) => source.enabled && source.status !== "running" && (!source.nextRunAt || Date.parse(source.nextRunAt) <= Date.now()));
      for (const source of due) await this.runNow(source.id).catch(() => {});
    })();
    try { await this.ticking; } finally { this.ticking = undefined; }
  }

  private async run(sourceId: string) {
    const source = this.store.beginSourceRun(sourceId);
    try {
      const before = new Map(this.store.listJobs().map((job) => [job.url, job]));
      const result = await this.discovery.discover(source.url);
      if (!Array.isArray(result.offers) || result.offers.length > 200) throw new Error("Résultat de découverte invalide.");
      let added = 0, updated = 0;
      for (const offer of result.offers) {
        const previous = before.get(offer.url);
        const saved = this.store.saveJob(offer);
        if (!previous) added++;
        else if (["title", "company", "location", "description", "sourceUrl"].some((key) => previous[key as keyof typeof previous] !== saved[key as keyof typeof saved])) updated++;
      }
      return this.store.finishSourceRun(sourceId, { found: result.offers.length, added, updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "La collecte a échoué.";
      this.store.failSourceRun(sourceId, message);
      throw error;
    }
  }
}
