import type { FormEvent } from "react";
import type { EmployerResponse } from "../src/shared/career.ts";

interface Props {
  applicationId: string;
  responses: EmployerResponse[];
  busy: boolean;
  formatDate(value: string): string;
  onSave(input: Omit<EmployerResponse, "id" | "applicationId" | "createdAt"> & { nextActionAt?: string }): Promise<boolean>;
  onDelete(responseId: string): Promise<boolean>;
}

const localDateTime = (value: string) => new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const channelLabel = (channel: EmployerResponse["channel"]) => ({ email: "Courriel", portal: "Portail employeur", phone: "Téléphone", other: "Autre" })[channel];

export default function CareerResponseLog({ applicationId, responses, busy, formatDate, onSave, onDelete }: Props) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const receivedAt = new Date(String(fields.get("receivedAt"))).toISOString();
    const nextAction = String(fields.get("nextActionAt") || "");
    const saved = await onSave({
      receivedAt,
      channel: String(fields.get("channel")) as EmployerResponse["channel"],
      summary: String(fields.get("summary")),
      nextStep: String(fields.get("nextStep") || ""),
      replyDraft: String(fields.get("replyDraft") || ""),
      ...(nextAction ? { nextActionAt: new Date(nextAction).toISOString() } : {}),
    });
    if (saved) form.reset();
  }

  return <section>
    <details className="cw-details cw-response-details">
      <summary>Enregistrer une réponse reçue</summary>
      <p className="cw-muted">Journal local : aucun courriel n’est importé ni envoyé.</p>
      <form onSubmit={submit}>
        <label>Date de réception<input type="datetime-local" name="receivedAt" required defaultValue={localDateTime(new Date().toISOString())} /></label>
        <label>Canal<select name="channel"><option value="email">Courriel</option><option value="portal">Portail employeur</option><option value="phone">Téléphone</option><option value="other">Autre</option></select></label>
        <label>Résumé de la réponse<textarea name="summary" required maxLength={5000} /></label>
        <label>Prochaine étape<input name="nextStep" maxLength={1000} placeholder="Ex. préparer un entretien technique" /></label>
        <label>Prochaine action prévue<input type="datetime-local" name="nextActionAt" /></label>
        <label>Brouillon de réponse<textarea name="replyDraft" maxLength={5000} placeholder="Brouillon local, il ne sera pas envoyé." /></label>
        <button className="cw-primary" disabled={busy}>Enregistrer la réponse</button>
      </form>
    </details>
    {responses.map((response) => <article className="cw-response-card" key={response.id}>
      <strong>Réponse reçue · {formatDate(response.receivedAt)}</strong>
      <small className="cw-muted">{channelLabel(response.channel)}</small>
      <p>{response.summary}</p>
      {response.nextStep && <small>Prochaine étape : {response.nextStep}</small>}
      {response.replyDraft && <details><summary>Brouillon local</summary><p>{response.replyDraft}</p></details>}
      <button disabled={busy} onClick={() => { if (window.confirm("Supprimer cette entrée de réponse ? L’événement de suppression restera dans l’historique.")) void onDelete(response.id); }}>Supprimer et ressaisir</button>
    </article>)}
  </section>;
}
