import type { ApplicationState, CareerQueueSnapshot } from '../src/shared/career.ts';
import type { CareerRunner } from './career-runner.ts';
import { CareerStore } from './career-store.ts';

/** Persistent, single-runner queue. Construction never starts browser work. */
export class CareerQueue {
  private readonly store: CareerStore;
  private readonly runner: CareerRunner;
  private worker: Promise<void> | null = null;

  constructor(store: CareerStore, runner: CareerRunner) {
    this.store = store;
    this.runner = runner;
  }

  snapshot(): CareerQueueSnapshot { return this.store.getQueueSnapshot(); }

  enqueue(applicationIds: unknown, credentialId?: unknown): CareerQueueSnapshot {
    const snapshot = this.store.enqueueQueue(applicationIds, credentialId);
    this.startWorker();
    return snapshot;
  }

  pause(): CareerQueueSnapshot {
    return this.store.requestQueuePause();
  }

  resume(): CareerQueueSnapshot {
    const snapshot = this.store.resumeQueue();
    this.startWorker();
    return snapshot;
  }

  async cancel(): Promise<CareerQueueSnapshot> {
    const pendingId = this.runner.pendingApplicationId();
    const snapshot = this.store.cancelQueue();
    if (pendingId && snapshot.items.some(item => item.applicationId === pendingId && item.status === 'cancelled')) {
      await this.runner.closeManualSession();
    }
    return snapshot;
  }

  /** Prevents the next application from starting and waits for the active one. */
  async pauseAfterActive(): Promise<CareerQueueSnapshot> {
    const snapshot = this.store.getQueueSnapshot();
    if (snapshot.status === 'running' || snapshot.status === 'paused') this.store.requestQueuePause();
    await this.worker;
    return this.store.getQueueSnapshot();
  }

  private startWorker(): void {
    if (this.worker) return;
    this.worker = this.run().finally(() => { this.worker = null; });
  }

  private async run(): Promise<void> {
    try {
      while (true) {
        const current = this.store.getQueueSnapshot();
        if (current.status !== 'running') return;
        if (current.pauseRequested) {
          this.store.pauseQueueWorker();
          return;
        }
        if (this.runner.isBusy()) {
          this.store.pauseQueueWorker('Un autre parcours est en cours ; reprenez la file explicitement.');
          return;
        }
        const item = this.store.claimNextQueueItem();
        if (!item) {
          const afterClaim = this.store.getQueueSnapshot();
          if (afterClaim.status === 'running' && !afterClaim.items.some(x => x.status === 'queued')) this.store.completeQueue();
          return;
        }

        try {
          this.runner.start(item.applicationId, 'submit', item.credentialId || undefined);
          while (this.runner.isBusy()) await new Promise(resolve => setTimeout(resolve, 100));
          const application = this.store.getApplication(item.applicationId);
          this.store.finishQueueItem(item.applicationId, application.state, application.lastError);
          if (application.state !== 'submitted') return;
        } catch (error) {
          const application = this.store.getApplication(item.applicationId);
          const state: ApplicationState = application.state;
          this.store.finishQueueItem(item.applicationId, state, error instanceof Error ? error.message : 'Erreur du parcours.');
          return;
        }
      }
    } catch (error) {
      const q = this.store.getQueueSnapshot();
      if (q.activeApplicationId) {
        const app = this.store.getApplication(q.activeApplicationId);
        this.store.finishQueueItem(q.activeApplicationId, app.state, error instanceof Error ? error.message : 'Erreur de file.');
      } else if (q.status === 'running') {
        this.store.pauseQueueWorker(error instanceof Error ? error.message : 'Erreur de file.');
      }
    }
  }
}
