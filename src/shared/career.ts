export type ApplicationState = 'draft' | 'running' | 'ready' | 'needs_input' | 'blocked' | 'submitting' | 'submitted' | 'uncertain' | 'failed';
export type Outcome = 'active' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
export type RunMode = 'prepare' | 'submit';
export type AnswerValue = string | boolean;

export interface CareerProfile {
  firstName: string; lastName: string; email: string; phone: string;
  city: string; country: string; address: string; postalCode: string;
  headline: string; summary: string; linkedinUrl: string; websiteUrl: string;
  skills: string[]; languages: string[];
  experiences: { company: string; title: string; start: string; end: string; description: string }[];
  education: { school: string; degree: string; start: string; end: string }[];
  preferences: { titles: string[]; locations: string[]; remote: boolean; contract: string };
  answers: Record<string, AnswerValue>;
  updatedAt: string;
}
export interface Resume {
  id: string; name: string; filename: string; mime: string; size: number;
  sha256: string; createdAt: string;
}
export interface CredentialSummary {
  id: string; origin: string; label: string; username: string; updatedAt: string;
}
export interface VaultStatus { initialized: boolean; unlocked: boolean; }
export interface JobOffer {
  id: string; url: string; title: string; company: string; location: string;
  description: string; sourceUrl: string; discoveredAt: string; updatedAt: string;
}
export type CareerSourceStatus = 'idle' | 'running' | 'succeeded' | 'failed';
export interface CareerSource {
  id: string; label: string; url: string; cadenceHours: number; enabled: boolean;
  status: CareerSourceStatus; lastRunAt: string; nextRunAt: string; lastError: string;
  lastFound: number; lastNew: number; lastUpdated: number; createdAt: string;
}
export interface MissingField {
  key: string; label: string; required: boolean;
  type: 'text' | 'boolean' | 'select' | 'file' | 'unknown';
  options?: string[];
}
export interface Receipt {
  url: string; text: string; reference: string; observedAt: string;
}
export interface Application {
  id: string; jobId: string; resumeId: string; prospectId: string | null;
  state: ApplicationState; outcome: Outcome;
  answers: Record<string, AnswerValue>;
  missingFields: MissingField[]; notes: string; nextActionAt: string;
  lastError: string; receipt: Receipt | null;
  createdAt: string; updatedAt: string; submittedAt: string | null;
}
export interface CareerEvent {
  id: string; applicationId: string; kind: string; detail: string;
  source: 'automation' | 'user'; happenedAt: string;
}
export interface EmployerResponse {
  id: string; applicationId: string; receivedAt: string; channel: 'email' | 'phone' | 'portal' | 'other';
  summary: string; nextStep: string; replyDraft: string; createdAt: string;
}
export interface CareerMetrics {
  savedJobs: number; applications: number; submitted: number;
  needsAttention: number; interviews: number; offers: number; rejected: number;
}
export interface CareerSnapshot {
  profile: CareerProfile; resumes: Resume[]; credentials: CredentialSummary[];
  jobs: JobOffer[]; sources: CareerSource[]; applications: Application[]; events: CareerEvent[]; responses: EmployerResponse[];
  metrics: CareerMetrics; vault: VaultStatus; manualSessionApplicationId: string | null;
}
export type CareerQueueStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
export type CareerQueueItemStatus = 'queued' | 'running' | 'submitted' | 'blocked' | 'cancelled';
export interface CareerQueueItem {
  position: number; applicationId: string; credentialId: string | null; status: CareerQueueItemStatus;
  lastError: string; updatedAt: string;
}
export interface CareerQueueSnapshot {
  status: CareerQueueStatus; activeApplicationId: string | null;
  pauseRequested: boolean; lastError: string; updatedAt: string;
  items: CareerQueueItem[];
}
export interface RunResult {
  state: 'ready' | 'needs_input' | 'blocked' | 'submitted' | 'uncertain' | 'failed';
  missingFields: MissingField[]; message: string; receipt: Receipt | null;
}
export interface DiscoveryResult { jobs: JobOffer[]; note: string; }
export interface CareerDiscovery {
  validate?(url: string): Promise<URL>;
  discover(url: string): Promise<{ offers: Omit<JobOffer, 'id' | 'discoveredAt' | 'updatedAt'>[]; note: string }>;
}
