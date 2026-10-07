import type { Application, CareerProfile, JobOffer, Resume, RunMode, RunResult } from "../src/shared/career.ts";
import type { CareerStore } from "./career-store.ts";
import { CareerError } from "./career-store.ts";
import type { Vault } from "./vault.ts";
import { CareerBrowser } from "./career-browser.ts";

/** One in-flight application per runner. State is committed before browser work begins. */
export class CareerRunner {
  private active: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private paused: { id: string; mode: RunMode; credentialId?: string } | undefined;
  private store: CareerStore;
  private vault: Vault;
  private browser: CareerBrowser;
  constructor(store: CareerStore, vault: Vault, browser: CareerBrowser) { this.store = store; this.vault = vault; this.browser = browser; }
  isBusy(): boolean { return this.active !== null; }
  hasPausedSession(): boolean { return Boolean(this.paused && this.browser.hasPausedSession()); }

  start(id: string, mode: RunMode, credentialId?: string): Application {
    if (this.active) throw new CareerError(409, "browser_busy", "Un parcours est déjà en cours.");
    if (this.hasPausedSession()) throw new CareerError(409, "browser_paused", "Une candidature attend une intervention. Reprenez-la ou arrêtez le navigateur.");
    this.paused = undefined;
    const application = this.store.claimRun(id);
    this.begin(id, application, mode, credentialId, false);
    return application;
  }

  resume(id: string, credentialId?: string, fileFieldKey?: string, resumeId?: string): Application {
    if (this.active) throw new CareerError(409, "browser_busy", "Un parcours est déjà en cours.");
    if (!this.hasPausedSession() || this.paused?.id !== id) throw new CareerError(409, "resume_unavailable", "Aucune session en attente pour cette candidature. Relancez le parcours depuis l’offre.");
    const previous = this.paused;
    const current = this.store.getApplication(id);
    if (fileFieldKey && !current.missingFields.some(field => field.type === "file" && field.key === fileFieldKey)) throw new CareerError(400, "validation", "Le champ fichier ne correspond pas à la candidature en attente.");
    if (resumeId) this.store.updateApplication(id, { resumeId });
    const application = this.store.claimRun(id);
    this.paused = undefined;
    this.begin(id, application, previous.mode, credentialId ?? previous.credentialId, true, fileFieldKey);
    return application;
  }

  private begin(id: string, application: Application, mode: RunMode, credentialId: string | undefined, resumeSession: boolean, fileFieldKey?: string): void {
    const job: JobOffer = structuredClone(this.store.getJob(application.jobId));
    const profile: CareerProfile = structuredClone(this.store.getProfile());
    const saved = this.store.getResume(application.resumeId);
    const resumeFile: { meta: Resume; bytes: Buffer } = { meta: structuredClone(saved.meta), bytes: Buffer.from(saved.bytes) };
    const snapshot = structuredClone(application);
    const abort = new AbortController();
    this.abort = abort;
    let markedSubmitting = false;
    const work = async () => {
      let outcome: RunResult;
      try {
        const input: Parameters<CareerBrowser["run"]>[0] = {
          application: snapshot, job, profile, resume: resumeFile, mode, signal: abort.signal, ...(fileFieldKey ? { fileFieldKey } : {}),
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
        };
        outcome = resumeSession ? await this.browser.resume(input) : await this.browser.run(input);
      } catch {
        outcome = { state: markedSubmitting ? "uncertain" : "failed", message: markedSubmitting ? "L’envoi est incertain ; vérifiez avant toute nouvelle tentative." : "Parcours interrompu avant l’envoi.", missingFields: [], receipt: null };
      }
      if (markedSubmitting && outcome.state !== "submitted") outcome = { ...outcome, state: "uncertain", receipt: null };
      try { this.store.finishRun(id, outcome); } catch { /* A restored or replaced store owns recovery. */ }
      if (!markedSubmitting && (outcome.state === "needs_input" || outcome.state === "blocked") && this.browser.hasPausedSession()) this.paused = { id, mode, ...(credentialId ? { credentialId } : {}) };
      else if (this.paused?.id === id) this.paused = undefined;
    };
    this.active = work().finally(() => { this.active = null; if (this.abort === abort) this.abort = null; });
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    await this.browser.close();
    await this.active;
    this.paused = undefined;
  }
}
