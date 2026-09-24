export const STATUSES = [
  "À examiner",
  "Qualifié",
  "Brouillon à valider",
  "Invitation prête",
  "Invitation envoyée",
  "Invitation acceptée",
  "Message de suivi à valider",
  "Message envoyé",
  "Réponse reçue",
  "Échange en cours",
  "Rendez-vous prévu",
  "Converti",
  "Sans suite",
  "À ne pas contacter",
] as const;

export type Status = (typeof STATUSES)[number];
export type ActionKind = "invitation" | "suivi";

export interface SearchFilters {
  titles: string[];
  keywords: string[];
  locations: string[];
  schools: string[];
  companies: string[];
  industries: string[];
  experience: string;
}
export interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters;
  linkedinUrl: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface Prospect {
  id: string;
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  location: string;
  school: string;
  status: Status;
  tags: string[];
  notes: string;
  nextAction: string;
  nextActionAt: string;
  createdAt: string;
  updatedAt: string;
  sources?: {
    searchId: string;
    searchName: string;
    filters: SearchFilters;
    importedAt: string;
  }[];
  events?: ActivityEvent[];
  messages?: Message[];
}
export interface ActivityEvent {
  id: string;
  prospectId: string;
  kind: string;
  detail: string;
  happenedAt: string;
  createdAt: string;
  prospectName?: string;
}
export interface Message {
  id: string;
  prospectId: string;
  kind: ActionKind;
  content: string;
  state: "draft" | "sent";
  createdAt: string;
  sentAt: string;
}
export interface Template {
  id: string;
  name: string;
  kind: ActionKind;
  content: string;
  createdAt: string;
}
export interface QueueItem {
  id: string;
  prospectId: string;
  prospectName: string;
  linkedinUrl: string;
  messageId: string;
  kind: ActionKind;
  content: string;
  state: "pending" | "open" | "sent" | "uncertain" | "cancelled";
  error: string;
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_FILTERS: SearchFilters = {
  titles: [],
  keywords: [],
  locations: [],
  schools: [],
  companies: [],
  industries: [],
  experience: "",
};

