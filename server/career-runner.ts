import type { Application, CareerProfile, JobOffer, Resume, RunMode, RunResult } from "../src/shared/career.ts";
import type { CareerStore } from "./career-store.ts";
import { CareerError } from "./career-store.ts";
import type { Vault } from "./vault.ts";
import { CareerBrowser } from "./career-browser.ts";

/** One in-flight application per runner. State is committed before browser work begins. */
export class CareerRunner {
  private active: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private store: CareerStore;
  private vault: Vault;
  private browser: CareerBrowser;
  constructor(store: CareerStore, vault: Vault, browser: CareerBrowser) { this.store = store; this.vault = vault; this.browser = browser; }
  isBusy(): boolean { return this.active !== null; }

  start(id: string, mode: RunMode, credentialId?: string): Application {
    if (this.active) throw new CareerError(409, "browser_busy", "Un parcours est déjà en cours.");
    const application = this.store.claimRun(id);
    const job: JobOffer = structuredClone(this.store.getJob(application.jobId));
    const profile: CareerProfile = structuredClone(this.store.getProfile());
    const saved = this.store.getResume(application.resumeId);
    const resume: { meta: Resume; bytes: Buffer } = { meta: structuredClone(saved.meta), bytes: Buffer.from(saved.bytes) };
    const snapshot = structuredClone(application);
    const abort = new AbortController();
    this.abort = abort;
    let markedSubmitting = false;
    const work = async () => {
      let outcome: RunResult;
      try {
        outcome = await this.browser.run({
          application: snapshot, job, profile, resume, mode, signal: abort.signal,
          getCredential: (origin) => {
            if (!credentialId) return null;
            if (!this.vault.status().unlocked) throw new Error("Vault locked");
            return this.vault.getCredential(credentialId, origin);
          },
          beforeSubmit: () => {
            if (abort.signal.aborted || !this.vault.status().unlocked && credentialId) throw new Error("Run interrupted");
            this.store.markSubmitting(id);
            markedSubmitting = true;
          },
        });
      } catch {
        outcome = { state: markedSubmitting ? "uncertain" : "failed", message: markedSubmitting ? "L’envoi est incertain ; vérifiez avant toute nouvelle tentative." : "Parcours interrompu avant l’envoi.", missingFields: [], receipt: null };
      }
      if (markedSubmitting && outcome.state !== "submitted") outcome = { ...outcome, state: "uncertain", receipt: null };
      try { this.store.finishRun(id, outcome); } catch { /* A restored or replaced store owns recovery. */ }
    };
    this.active = work().finally(() => { this.active = null; if (this.abort === abort) this.abort = null; });
    return application;
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    await this.browser.close();
    await this.active;
  }
}
