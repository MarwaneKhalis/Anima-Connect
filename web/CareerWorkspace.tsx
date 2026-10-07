import { useEffect, useRef, useState } from "react";
import { apiFetch, downloadResponse } from "./api.ts";
import Legacy, { type Tab as LegacyTab } from "./App.tsx";
import type {
  Application,
  AnswerValue,
  CareerProfile,
  CareerSnapshot,
  JobOffer,
  RunMode,
} from "../src/shared/career.ts";

type Tab =
  "home" | "jobs" | "applications" | "profile" | "vault" | "prospecting";
const navigation: [Tab, string, string][] = [
  ["home", "◈", "Tableau de bord"],
  ["jobs", "⌕", "Offres"],
  ["applications", "▤", "Candidatures"],
  ["profile", "◉", "Profil & CV"],
  ["vault", "◇", "Comptes carrière"],
  ["prospecting", "↗", "Prospection"],
];
const states: Record<string, string> = {
  draft: "À préparer",
  running: "En cours",
  ready: "Prête",
  needs_input: "Réponse requise",
  blocked: "Action requise",
  submitting: "Envoi en cours",
  submitted: "Envoyée",
  uncertain: "Envoi à vérifier",
  failed: "À reprendre",
};
const outcomes: Record<string, string> = {
  active: "En attente",
  interview: "Entretien",
  offer: "Offre reçue",
  rejected: "Refus",
  withdrawn: "Retirée",
};
const split = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const date = (s: string) =>
  s
    ? new Date(s).toLocaleString("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const labelJob = (snapshot: CareerSnapshot, a: Application) =>
  snapshot.jobs.find((j) => j.id === a.jobId);
const active = (a: Application) => ["running", "submitting"].includes(a.state);

export default function CareerWorkspace() {
  const [tab, setTab] = useState<Tab>("home"),
    [legacyTab, setLegacyTab] = useState<LegacyTab>("recherches");
  const [demo, setDemo] = useState(
    () => localStorage.getItem("anima-demo") === "1",
  );
  const [data, setData] = useState<CareerSnapshot | null>(null),
    [profile, setProfile] = useState<CareerProfile | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [source, setSource] = useState(""),
    [jobDraft, setJobDraft] = useState({
      url: "",
      title: "",
      company: "",
      location: "",
      description: "",
    });
  const [resumeId, setResumeId] = useState(""),
    [credentialId, setCredentialId] = useState(""),
    [detail, setDetail] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]),
    [batch, setBatch] = useState(false),
    cancelBatch = useRef(false);
  const [passphrase, setPassphrase] = useState(""),
    [account, setAccount] = useState({
      origin: "",
      label: "",
      username: "",
      password: "",
    });
  const [answerKey, setAnswerKey] = useState(""),
    [answerValue, setAnswerValue] = useState(""),
    [answerBoolean, setAnswerBoolean] = useState(false);
  const [prospects, setProspects] = useState<
    { id: string; firstName: string; lastName: string; company: string }[]
  >([]);
  const modeRef = useRef(demo);
  modeRef.current = demo;
  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await apiFetch(`/api/career${path}?demo=${demo ? 1 : 0}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Anima-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Action impossible.");
    return value;
  }
  async function load(resetProfile = false) {
    const currentMode = demo;
    const value = await api<CareerSnapshot>("/bootstrap");
    if (currentMode !== modeRef.current) return;
    setData(value);
    if (resetProfile) setProfile(structuredClone(value.profile));
    setResumeId((id) =>
      value.resumes.some((r) => r.id === id) ? id : value.resumes[0]?.id || "",
    );
  }
  useEffect(() => {
    setData(null);
    setProfile(null);
    setDetail(null);
    setSelected([]);
    setError("");
    cancelBatch.current = true;
    load(true).catch((e) => setError(e.message));
    apiFetch(`/api/bootstrap?demo=${demo ? 1 : 0}`)
      .then((r) => r.json())
      .then((v) => setProspects(v.prospects || []))
      .catch(() => {});
  }, [demo]);
  useEffect(() => {
    const timer = setInterval(
      () => load().catch((e) => setError(e.message)),
      2500,
    );
    return () => clearInterval(timer);
  }, [demo]);
  async function action(fn: () => Promise<unknown>, message = "Enregistré.") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      await load();
      setNotice(typeof result === "string" ? result : message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function run(id: string, mode: RunMode) {
    await api(`/applications/${id}/run`, "POST", {
      mode,
      ...(credentialId ? { credentialId } : {}),
    });
  }
  async function runBatch() {
    cancelBatch.current = false;
    setBatch(true);
    setError("");
    try {
      const latest = await api<CareerSnapshot>("/bootstrap");
      const ids = selected.filter((id) =>
        latest.applications.some(
          (a) =>
            a.id === id &&
            !["submitted", "uncertain", "running", "submitting"].includes(
              a.state,
            ),
        ),
      );
      setSelected(ids);
      for (const id of ids) {
        if (cancelBatch.current) break;
        await run(id, "submit");
        let result: Application;
        do {
          await new Promise((r) => setTimeout(r, 650));
          result = await api<Application>(`/applications/${id}`);
          await load();
        } while (active(result));
        if (result.state === "submitted")
          setSelected((items) => items.filter((item) => item !== id));
        else {
          setNotice(
            `Lot arrêté : ${states[result.state]}. Ouvrez la candidature pour continuer.`,
          );
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatch(false);
      await load();
    }
  }
  async function upload(file: File) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await api("/resumes", "POST", {
      name: file.name.replace(/\.[^.]+$/, ""),
      filename: file.name,
      mime: file.name.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64,
    });
  }
  const field = (key: keyof CareerProfile, name: string, type = "text") =>
    profile && (
      <label>
        {name}
        <input
          type={type}
          value={String(profile[key])}
          onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
        />
      </label>
    );
  const current = data?.applications.find((a) => a.id === detail),
    currentJob = current && data ? labelJob(data, current) : undefined;
  const runnable =
    data?.applications.filter(
      (a) =>
        !["submitted", "uncertain", "running", "submitting"].includes(a.state),
    ) || [];
  const attention =
    data?.applications.filter((a) =>
      ["needs_input", "blocked", "uncertain", "failed"].includes(a.state),
    ) || [];
  const completion = data
    ? [
        !!data.profile.firstName && !!data.profile.lastName,
        !!data.profile.email,
        !!data.profile.phone,
        !!data.resumes.length,
      ].filter(Boolean).length
    : 0;
  const initials = data
    ? `${data.profile.firstName[0] || "A"}${data.profile.lastName[0] || "C"}`
    : "AC";
  const profileTools = (
    <div className="cw-tools">
      <label>
        CV pour les candidatures
        <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
          <option value="">Choisir un CV</option>
          {data?.resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Compte de connexion
        <select
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
        >
          <option value="">Sans compte / accès public</option>
          {data?.credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label || c.origin} · {c.username}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  return (
    <div className="cw-shell">
      <aside className="cw-sidebar">
        <a
          className="cw-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("home");
          }}
        >
          <span className="cw-logo">
            a<span>✳</span>
          </span>
          <strong>
            anima<span>connect</span>
          </strong>
        </a>
        <p className="cw-caption">Votre prochain chapitre.</p>
        <div className="cw-nav-label">ESPACE CARRIÈRE</div>
        <nav>
          {navigation.map(([key, icon, name]) => (
            <button
              key={key}
              className={tab === key ? "current" : ""}
              onClick={() => {
                setTab(key);
                setError("");
                setNotice("");
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {name}
              {key === "applications" && !!attention.length && (
                <b>{attention.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="cw-bottom">
          <div className="cw-private">
            <span>●</span>
            <div>
              <strong>Local & personnel</strong>
              <small>CV et comptes sur cet ordinateur</small>
            </div>
          </div>
          <button
            disabled={busy || batch || !!data?.applications.some(active)}
            onClick={() => {
              cancelBatch.current = true;
              localStorage.setItem("anima-demo", demo ? "0" : "1");
              setDemo(!demo);
              setCredentialId("");
              setPassphrase("");
            }}
          >
            {" "}
            {demo ? "● Démo · quitter" : "○ Explorer la démo"} <span>→</span>
          </button>
          <div className="cw-user">
            <span>{initials}</span>
            <div>
              <strong>{data?.profile.firstName || "Votre espace"}</strong>
              <small>{data?.profile.headline || "Prêt pour la suite"}</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="cw-main">
        <header className="cw-top">
          <div>
            Mon espace <span>/</span>{" "}
            {navigation.find((n) => n[0] === tab)?.[2]}
          </div>
          <div>
            <span className="cw-local">
              ●{" "}
              {data?.applications.some(active)
                ? "Automatisation en cours"
                : "Données locales"}
            </span>
            <span className="cw-avatar">{initials}</span>
          </div>
        </header>
        <div className="cw-content">
          {demo && (
            <div className="cw-banner">
              Données fictives · découvrez le parcours. Connexions et envois
              externes désactivés.
            </div>
          )}
          {error && (
            <div className="cw-alert" role="alert">
              {error}
              <button aria-label="Fermer l’erreur" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="cw-notice" role="status">
              {notice}
            </div>
          )}
          {!data ? (
            <div className="cw-empty">
              {error
                ? "Anima Connect ne répond pas. Vérifiez que l’application est démarrée."
                : "Ouverture de votre espace…"}
            </div>
          ) : (
            <>
              {tab === "home" && (
                <>
                  <div className="cw-heading">
                    <div>
                      <span className="cw-eyebrow">
                        UN PEU MOINS DE FRICTION. PLUS D’OPPORTUNITÉS.
                      </span>
                      <h1>
                        {data.profile.firstName
                          ? `Bonjour ${data.profile.firstName}.`
                          : "Place à votre prochaine opportunité."}
                      </h1>
                      <p>
                        Vos offres, vos candidatures et votre réseau. Au même
                        endroit.
                      </p>
                    </div>
                    <button
                      className="cw-primary"
                      onClick={() => setTab("jobs")}
                    >
                      Trouver des offres <span>↗</span>
                    </button>
                  </div>
                  <div className="cw-metrics">
                    {[
                      ["Offres enregistrées", data.metrics.savedJobs, "⌕"],
                      ["Candidatures envoyées", data.metrics.submitted, "↗"],
                      ["Entretiens", data.metrics.interviews, "◷"],
                      ["À débloquer", data.metrics.needsAttention, "◇"],
                    ].map(([name, value, icon]) => (
                      <div className="cw-metric" key={String(name)}>
                        <span>
                          {name}
                          <i>{icon}</i>
                        </span>
                        <strong>{value}</strong>
                        <small>
                          {name === "À débloquer"
                            ? "Une réponse permet de reprendre"
                            : "Calculé depuis votre suivi"}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="cw-dashboard">
                    <section className="cw-panel">
                      <div className="cw-section-head">
                        <h2>Du premier lien au premier entretien</h2>
                        <span className="cw-pill">Votre parcours</span>
                      </div>
                      <div className="cw-flow">
                        {[
                          [
                            "01",
                            "Vos ressources",
                            "Profil, CV et réponses",
                            "Vous",
                          ],
                          [
                            "02",
                            "Vos opportunités",
                            "Import & dédoublonnage",
                            "Auto",
                          ],
                          [
                            "03",
                            "Votre candidature",
                            "Connexion, formulaire, CV, envoi",
                            "Auto",
                          ],
                          [
                            "04",
                            "La suite",
                            "Reçu, historique et suivi",
                            "Mixte",
                          ],
                        ].map(([num, title, desc, tag]) => (
                          <div key={num}>
                            <span className="cw-step">{num}</span>
                            <h3>{title}</h3>
                            <p>{desc}</p>
                            <small className={tag === "Auto" ? "cw-auto" : ""}>
                              {tag}
                            </small>
                          </div>
                        ))}
                      </div>
                      <p className="cw-muted">
                        Une information manquante, une vérification de sécurité
                        ou un envoi incertain ouvre une action à traiter.
                      </p>
                    </section>
                    <section className="cw-panel cw-setup">
                      <span className="cw-eyebrow">PRÊT À POSTULER</span>
                      <h2>Votre profil, votre avantage.</h2>
                      <p>
                        Renseignez une fois. Réutilisez à chaque candidature.
                      </p>
                      <div className="cw-progress">
                        <i style={{ width: `${completion * 25}%` }} />
                      </div>
                      <div className="cw-section-head">
                        <small>{completion}/4 ressources essentielles</small>
                        <strong>{completion * 25}%</strong>
                      </div>
                      <button onClick={() => setTab("profile")}>
                        Compléter mon profil →
                      </button>
                    </section>
                  </div>
                  <div className="cw-dashboard">
                    <section className="cw-panel">
                      <div className="cw-section-head">
                        <h2>Candidatures récentes</h2>
                        <button
                          className="cw-link"
                          onClick={() => setTab("applications")}
                        >
                          Tout voir →
                        </button>
                      </div>
                      {data.applications.slice(0, 5).map((a) => (
                        <button
                          key={a.id}
                          className="cw-row"
                          onClick={() => {
                            setDetail(a.id);
                            setTab("applications");
                          }}
                        >
                          <span className="cw-company">
                            {labelJob(data, a)
                              ?.company.slice(0, 2)
                              .toUpperCase() || "↗"}
                          </span>
                          <span>
                            <strong>{labelJob(data, a)?.title}</strong>
                            <small>
                              {labelJob(data, a)?.company} ·{" "}
                              {labelJob(data, a)?.location}
                            </small>
                          </span>
                          <span className={`cw-status ${a.state}`}>
                            {states[a.state]}
                          </span>
                        </button>
                      ))}
                      {!data.applications.length && (
                        <div className="cw-empty">
                          Votre première candidature commence avec une offre.
                          <button onClick={() => setTab("jobs")}>
                            Ajouter une offre →
                          </button>
                        </div>
                      )}
                    </section>
                    <section className="cw-panel">
                      <div className="cw-section-head">
                        <h2>À ne pas laisser passer</h2>
                        <span className="cw-pill">{attention.length}</span>
                      </div>
                      {attention.slice(0, 3).map((a) => (
                        <button
                          className="cw-row"
                          key={a.id}
                          onClick={() => {
                            setDetail(a.id);
                            setTab("applications");
                          }}
                        >
                          <span>
                            <strong>{labelJob(data, a)?.title}</strong>
                            <small>{a.lastError || states[a.state]}</small>
                          </span>
                          <span>→</span>
                        </button>
                      ))}
                      {data.applications
                        .filter((a) => a.nextActionAt && a.outcome === "active")
                        .slice(0, 3)
                        .map((a) => (
                          <button
                            className="cw-row"
                            key={a.id}
                            onClick={() => {
                              setDetail(a.id);
                              setTab("applications");
                            }}
                          >
                            <span>
                              <strong>
                                Relance · {labelJob(data, a)?.company}
                              </strong>
                              <small>{date(a.nextActionAt)}</small>
                            </span>
                            <span>◷</span>
                          </button>
                        ))}
                      {!attention.length && (
                        <p className="cw-muted">
                          Aucun blocage à traiter. Retrouvez ici les questions
                          manquantes et vos relances.
                        </p>
                      )}
                      <div className="cw-network">
                        <span>↗</span>
                        <strong>Le réseau ouvre aussi des portes.</strong>
                        <p>
                          {prospects.length} prospect(s) dans votre espace
                          LinkedIn.
                        </p>
                        <button onClick={() => setTab("prospecting")}>
                          Ouvrir la prospection →
                        </button>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === "jobs" && (
                <>
                  <div className="cw-heading">
                    <div>
                      <span className="cw-eyebrow">
                        DÉCOUVRIR & CENTRALISER
                      </span>
                      <h1>Les bonnes opportunités.</h1>
                      <p>
                        Importez un tableau Greenhouse, Lever ou une offre avec
                        données structurées.
                      </p>
                    </div>
                    <span className="cw-pill">{data.jobs.length} offres</span>
                  </div>
                  <section className="cw-panel">
                    <form
                      className="cw-inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        action(async () => {
                          const result = await api<{ note: string }>(
                            "/discover",
                            "POST",
                            { url: source },
                          );
                          return result.note;
                        }, "Import terminé.");
                      }}
                    >
                      <label>
                        URL du tableau ou de l’offre
                        <input
                          type="url"
                          required
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                          placeholder="https://jobs.lever.co/entreprise"
                        />
                      </label>
                      <button className="cw-primary" disabled={busy}>
                        Importer les offres ↗
                      </button>
                    </form>
                    <details className="cw-details">
                      <summary>Ajouter une offre avec son lien</summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          action(async () => {
                            await api("/jobs", "POST", jobDraft);
                            setJobDraft({
                              url: "",
                              title: "",
                              company: "",
                              location: "",
                              description: "",
                            });
                          }, "Offre enregistrée.");
                        }}
                      >
                        <div className="cw-grid">
                          {[
                            ["url", "URL de l’offre"],
                            ["title", "Intitulé"],
                            ["company", "Entreprise"],
                            ["location", "Lieu"],
                          ].map(([key, name]) => (
                            <label key={key}>
                              {name}
                              <input
                                type={key === "url" ? "url" : "text"}
                                required={key === "url" || key === "title"}
                                value={jobDraft[key as keyof typeof jobDraft]}
                                onChange={(e) =>
                                  setJobDraft({
                                    ...jobDraft,
                                    [key]: e.target.value,
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <label>
                          Description
                          <textarea
                            value={jobDraft.description}
                            onChange={(e) =>
                              setJobDraft({
                                ...jobDraft,
                                description: e.target.value,
                              })
                            }
                          />
                        </label>
                        <button disabled={busy} className="cw-primary">
                          Enregistrer l’offre
                        </button>
                      </form>
                    </details>
                  </section>
                  {profileTools}
                  <div className="cw-section-head">
                    <h2>Votre sélection</h2>
                    <input
                      className="cw-search"
                      aria-label="Rechercher une offre"
                      placeholder="Poste, entreprise, lieu…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="cw-jobs">
                    {data.jobs
                      .filter((j) =>
                        `${j.title} ${j.company} ${j.location}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((j) => (
                        <article className="cw-panel cw-job" key={j.id}>
                          <div className="cw-section-head">
                            <span className="cw-company">
                              {j.company.slice(0, 2).toUpperCase() || "↗"}
                            </span>
                            <span className="cw-pill">
                              {new URL(j.url).hostname}
                            </span>
                          </div>
                          <h2>{j.title}</h2>
                          <p>
                            {j.company} <span>·</span>{" "}
                            {j.location || "Lieu non précisé"}
                          </p>
                          <div className="cw-job-description">
                            {j.description ||
                              "Consultez la source pour le détail de cette offre."}
                          </div>
                          <div className="cw-section-head">
                            <a href={j.url} target="_blank" rel="noreferrer">
                              Voir l’offre ↗
                            </a>
                            {data.applications.some((a) => a.jobId === j.id) ? (
                              <button
                                onClick={() => {
                                  setDetail(
                                    data.applications.find(
                                      (a) => a.jobId === j.id,
                                    )!.id,
                                  );
                                  setTab("applications");
                                }}
                              >
                                Suivre →
                              </button>
                            ) : (
                              <button
                                className="cw-primary"
                                disabled={busy || !resumeId}
                                onClick={() =>
                                  action(async () => {
                                    const a = await api<Application>(
                                      "/applications",
                                      "POST",
                                      { jobId: j.id, resumeId },
                                    );
                                    setDetail(a.id);
                                    setTab("applications");
                                  }, "Candidature créée. Vous pouvez lancer son envoi automatique.")
                                }
                              >
                                Créer une candidature
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                  </div>
                  {!data.jobs.length && (
                    <div className="cw-empty">
                      Importez des offres ou ajoutez votre premier lien pour
                      commencer.
                    </div>
                  )}
                </>
              )}
              {tab === "applications" && (
                <>
                  <div className="cw-heading">
                    <div>
                      <span className="cw-eyebrow">CANDIDATER & AVANCER</span>
                      <h1>Chaque candidature compte.</h1>
                      <p>
                        Un seul lancement pour la connexion, le formulaire, le
                        CV et l’envoi.
                      </p>
                    </div>
                    <button onClick={() => setTab("jobs")}>
                      + Nouvelle candidature
                    </button>
                  </div>
                  {profileTools}
                  <div className="cw-panel cw-batch">
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          !!runnable.length &&
                          runnable.every((a) => selected.includes(a.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? runnable.map((a) => a.id) : [],
                          )
                        }
                      />
                      Sélectionner les candidatures disponibles
                    </label>
                    <button
                      className="cw-primary"
                      disabled={busy || batch || demo || !selected.length}
                      onClick={runBatch}
                    >
                      Postuler au lot ({selected.length}) ↗
                    </button>
                    {batch && (
                      <button
                        onClick={() => {
                          cancelBatch.current = true;
                          setNotice(
                            "Le lot s’arrêtera après la candidature en cours.",
                          );
                        }}
                      >
                        Arrêter le lot
                      </button>
                    )}
                  </div>
                  <div className="cw-applications">
                    {data.applications.map((a) => (
                      <article key={a.id} className="cw-panel cw-application">
                        <div className="cw-section-head">
                          <label className="cw-check">
                            <input
                              aria-label={`Sélectionner ${labelJob(data, a)?.title}`}
                              type="checkbox"
                              disabled={
                                !runnable.some((r) => r.id === a.id) || batch
                              }
                              checked={selected.includes(a.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, a.id]
                                    : selected.filter((id) => id !== a.id),
                                )
                              }
                            />
                            <span className="cw-company">
                              {labelJob(data, a)
                                ?.company.slice(0, 2)
                                .toUpperCase() || "↗"}
                            </span>
                            <span>
                              <strong>{labelJob(data, a)?.title}</strong>
                              <small>
                                {labelJob(data, a)?.company} ·{" "}
                                {labelJob(data, a)?.location}
                              </small>
                            </span>
                          </label>
                          <span className={`cw-status ${a.state}`}>
                            {states[a.state]}
                          </span>
                        </div>
                        <div className="cw-section-head">
                          <small>
                            {
                              data.resumes.find((r) => r.id === a.resumeId)
                                ?.name
                            }{" "}
                            · {outcomes[a.outcome]}
                          </small>
                          <button onClick={() => setDetail(a.id)}>
                            Ouvrir le suivi →
                          </button>
                        </div>
                        {a.lastError && (
                          <p className="cw-muted">{a.lastError}</p>
                        )}
                      </article>
                    ))}
                  </div>
                  {!data.applications.length && (
                    <div className="cw-empty">
                      Choisissez une offre et un CV. Le moteur s’occupe du
                      parcours pris en charge.
                    </div>
                  )}
                </>
              )}
              {tab === "profile" && profile && (
                <>
                  <div className="cw-heading">
                    <div>
                      <span className="cw-eyebrow">RENSEIGNER UNE FOIS</span>
                      <h1>Votre profil. Vos possibilités.</h1>
                      <p>
                        Le moteur utilise vos informations et vos réponses
                        explicites.
                      </p>
                    </div>
                    <button
                      className="cw-primary"
                      disabled={busy}
                      onClick={() =>
                        action(
                          () => api("/profile", "PUT", profile),
                          "Profil enregistré.",
                        )
                      }
                    >
                      Enregistrer le profil
                    </button>
                  </div>
                  <div className="cw-dashboard">
                    <section className="cw-panel">
                      <h2>Informations personnelles</h2>
                      <div className="cw-grid">
                        {field("firstName", "Prénom")}
                        {field("lastName", "Nom")}
                        {field("email", "Email", "email")}
                        {field("phone", "Téléphone", "tel")}
                        {field("city", "Ville")}
                        {field("country", "Pays")}
                        {field("address", "Adresse")}
                        {field("postalCode", "Code postal")}
                        {field("linkedinUrl", "URL LinkedIn", "url")}
                        {field("websiteUrl", "Site personnel", "url")}
                      </div>
                    </section>
                    <section className="cw-panel">
                      <h2>Votre bibliothèque de CV</h2>
                      <p className="cw-muted">
                        PDF ou DOCX, 10 Mo maximum. Le fichier choisi est
                        transmis au formulaire.
                      </p>
                      <label className="cw-upload">
                        + Ajouter un CV
                        <input
                          aria-label="Ajouter un CV"
                          type="file"
                          accept=".pdf,.docx"
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) action(() => upload(file), "CV ajouté.");
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {data.resumes.map((r) => (
                        <div className="cw-resume" key={r.id}>
                          <span>▤</span>
                          <div>
                            <strong>{r.name}</strong>
                            <small>
                              {r.filename} · {(r.size / 1024).toFixed(0)} Ko
                            </small>
                          </div>
                          <a
                            href="#download"
                            aria-label={`Télécharger ${r.name}`}
                            onClick={async (event) => {
                              event.preventDefault();
                              try {
                                const response = await apiFetch(
                                  `/api/career/resumes/${r.id}/download?demo=${demo ? 1 : 0}`,
                                );
                                if (!response.ok) throw new Error("Téléchargement impossible.");
                                await downloadResponse(response, r.filename);
                              } catch (e) {
                                setError(e instanceof Error ? e.message : String(e));
                              }
                            }}
                          >
                            ↓
                          </a>
                          <button
                            aria-label={`Supprimer ${r.name}`}
                            disabled={busy}
                            onClick={() =>
                              action(
                                () => api(`/resumes/${r.id}`, "DELETE"),
                                "CV supprimé.",
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </section>
                  </div>
                  <section className="cw-panel">
                    <h2>Parcours & recherche</h2>
                    <div className="cw-grid">
                      {field("headline", "Titre professionnel")}
                      <label>
                        Compétences
                        <input
                          value={profile.skills.join(", ")}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              skills: split(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Langues
                        <input
                          value={profile.languages.join(", ")}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              languages: split(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Postes recherchés
                        <input
                          value={profile.preferences.titles.join(", ")}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              preferences: {
                                ...profile.preferences,
                                titles: split(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Lieux recherchés
                        <input
                          value={profile.preferences.locations.join(", ")}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              preferences: {
                                ...profile.preferences,
                                locations: split(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Type de contrat
                        <input
                          value={profile.preferences.contract}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              preferences: {
                                ...profile.preferences,
                                contract: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="cw-checkbox">
                      <input
                        type="checkbox"
                        checked={profile.preferences.remote}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            preferences: {
                              ...profile.preferences,
                              remote: e.target.checked,
                            },
                          })
                        }
                      />
                      Télétravail recherché
                    </label>
                    <label>
                      Présentation
                      <textarea
                        value={profile.summary}
                        onChange={(e) =>
                          setProfile({ ...profile, summary: e.target.value })
                        }
                      />
                    </label>
                    <h3>Expériences</h3>
                    {profile.experiences.map((experience, i) => (
                      <div className="cw-repeat" key={i}>
                        <div className="cw-grid">
                          {(
                            [
                              "company",
                              "title",
                              "start",
                              "end",
                              "description",
                            ] as const
                          ).map((key, index) => (
                            <label key={key}>
                              {
                                [
                                  "Entreprise",
                                  "Poste",
                                  "Début",
                                  "Fin",
                                  "Description",
                                ][index]
                              }
                              <input
                                value={experience[key]}
                                onChange={(e) =>
                                  setProfile({
                                    ...profile,
                                    experiences: profile.experiences.map(
                                      (item, n) =>
                                        n === i
                                          ? { ...item, [key]: e.target.value }
                                          : item,
                                    ),
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          onClick={() =>
                            setProfile({
                              ...profile,
                              experiences: profile.experiences.filter(
                                (_, n) => n !== i,
                              ),
                            })
                          }
                        >
                          Retirer
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        setProfile({
                          ...profile,
                          experiences: [
                            ...profile.experiences,
                            {
                              company: "",
                              title: "",
                              start: "",
                              end: "",
                              description: "",
                            },
                          ],
                        })
                      }
                    >
                      + Ajouter une expérience
                    </button>
                    <h3>Formation</h3>
                    {profile.education.map((education, i) => (
                      <div className="cw-repeat" key={i}>
                        <div className="cw-grid">
                          {(["school", "degree", "start", "end"] as const).map(
                            (key, index) => (
                              <label key={key}>
                                {
                                  ["Établissement", "Diplôme", "Début", "Fin"][
                                    index
                                  ]
                                }
                                <input
                                  value={education[key]}
                                  onChange={(e) =>
                                    setProfile({
                                      ...profile,
                                      education: profile.education.map(
                                        (item, n) =>
                                          n === i
                                            ? { ...item, [key]: e.target.value }
                                            : item,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            ),
                          )}
                        </div>
                        <button
                          onClick={() =>
                            setProfile({
                              ...profile,
                              education: profile.education.filter(
                                (_, n) => n !== i,
                              ),
                            })
                          }
                        >
                          Retirer
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        setProfile({
                          ...profile,
                          education: [
                            ...profile.education,
                            { school: "", degree: "", start: "", end: "" },
                          ],
                        })
                      }
                    >
                      + Ajouter une formation
                    </button>
                  </section>
                  <section className="cw-panel">
                    <h2>Réponses réutilisables</h2>
                    <p className="cw-muted">
                      Utilisez le libellé ou la clé de la question. Une réponse
                      oui/non est enregistrée comme un booléen.
                    </p>
                    {Object.entries(profile.answers).map(([key, value]) => (
                      <div className="cw-row" key={key}>
                        <span>
                          <strong>{key}</strong>
                          <small>
                            {typeof value === "boolean"
                              ? value
                                ? "Oui"
                                : "Non"
                              : value}
                          </small>
                        </span>
                        <button
                          onClick={() => {
                            const answers = { ...profile.answers };
                            delete answers[key];
                            setProfile({ ...profile, answers });
                          }}
                        >
                          Retirer
                        </button>
                      </div>
                    ))}
                    <div className="cw-inline">
                      <label>
                        Question
                        <input
                          value={answerKey}
                          onChange={(e) => setAnswerKey(e.target.value)}
                        />
                      </label>
                      <label>
                        Réponse
                        {answerBoolean ? (
                          <select
                            value={answerValue}
                            onChange={(e) => setAnswerValue(e.target.value)}
                          >
                            <option value="">Choisir</option>
                            <option value="true">Oui</option>
                            <option value="false">Non</option>
                          </select>
                        ) : (
                          <input
                            value={answerValue}
                            onChange={(e) => setAnswerValue(e.target.value)}
                          />
                        )}
                      </label>
                      <label className="cw-checkbox">
                        <input
                          type="checkbox"
                          checked={answerBoolean}
                          onChange={(e) => {
                            setAnswerBoolean(e.target.checked);
                            setAnswerValue("");
                          }}
                        />
                        Oui / non
                      </label>
                      <button
                        disabled={!answerKey.trim() || !answerValue}
                        onClick={() => {
                          setProfile({
                            ...profile,
                            answers: {
                              ...profile.answers,
                              [answerKey.trim()]: answerBoolean
                                ? answerValue === "true"
                                : answerValue,
                            },
                          });
                          setAnswerKey("");
                          setAnswerValue("");
                        }}
                      >
                        Ajouter la réponse
                      </button>
                    </div>
                  </section>
                </>
              )}
              {tab === "vault" && (
                <>
                  <div className="cw-heading">
                    <div>
                      <span className="cw-eyebrow">
                        CONNEXIONS RÉUTILISABLES
                      </span>
                      <h1>Les comptes, sans la répétition.</h1>
                      <p>
                        Les mots de passe sont chiffrés. Déverrouillez le coffre
                        pour les connexions automatiques.
                      </p>
                    </div>
                    <span className="cw-pill">
                      {data.vault.unlocked ? "● Déverrouillé" : "◇ Verrouillé"}
                    </span>
                  </div>
                  <section className="cw-panel">
                    <h2>
                      {!data.vault.initialized
                        ? "Créer votre coffre"
                        : "Votre coffre"}
                    </h2>
                    {!data.vault.unlocked ? (
                      <form
                        className="cw-inline"
                        onSubmit={(e) => {
                          e.preventDefault();
                          action(async () => {
                            await api(
                              data.vault.initialized
                                ? "/vault/unlock"
                                : "/vault/initialize",
                              "POST",
                              { passphrase },
                            );
                            setPassphrase("");
                          }, "Coffre déverrouillé.");
                        }}
                      >
                        <label>
                          Phrase secrète du coffre
                          <input
                            type="password"
                            autoComplete="off"
                            minLength={12}
                            required
                            value={passphrase}
                            disabled={demo}
                            onChange={(e) => setPassphrase(e.target.value)}
                            placeholder="12 caractères minimum"
                          />
                        </label>
                        <button className="cw-primary" disabled={busy || demo}>
                          {data.vault.initialized
                            ? "Déverrouiller"
                            : "Créer le coffre"}
                        </button>
                      </form>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() =>
                          action(
                            () => api("/vault/lock", "POST", {}),
                            "Coffre verrouillé et automatisation arrêtée.",
                          )
                        }
                      >
                        Verrouiller le coffre
                      </button>
                    )}
                    <p className="cw-muted">
                      Gardez cette phrase : elle est nécessaire pour retrouver
                      vos mots de passe.
                    </p>
                  </section>
                  <section className="cw-panel">
                    <h2>Ajouter un compte carrière</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        action(async () => {
                          await api("/credentials", "POST", account);
                          setAccount({ ...account, password: "" });
                        }, "Compte enregistré.");
                      }}
                    >
                      <div className="cw-grid">
                        {(
                          ["origin", "label", "username", "password"] as const
                        ).map((key, i) => (
                          <label key={key}>
                            {
                              [
                                "Origine du site (https://…)",
                                "Nom du compte",
                                "Identifiant",
                                "Mot de passe",
                              ][i]
                            }
                            <input
                              required
                              type={
                                key === "password"
                                  ? "password"
                                  : key === "origin"
                                    ? "url"
                                    : "text"
                              }
                              autoComplete="off"
                              disabled={!data.vault.unlocked || demo}
                              value={account[key]}
                              onChange={(e) =>
                                setAccount({
                                  ...account,
                                  [key]: e.target.value,
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        className="cw-primary"
                        disabled={busy || !data.vault.unlocked || demo}
                      >
                        Enregistrer le compte
                      </button>
                    </form>
                  </section>
                  <section className="cw-panel">
                    <h2>Vos comptes</h2>
                    {data.credentials.map((c) => (
                      <div className="cw-row" key={c.id}>
                        <span>
                          <strong>{c.label || c.origin}</strong>
                          <small>
                            {c.origin} · {c.username}
                          </small>
                        </span>
                        <button
                          disabled={busy || demo}
                          onClick={() =>
                            action(
                              () => api(`/credentials/${c.id}`, "DELETE"),
                              "Compte supprimé.",
                            )
                          }
                        >
                          Supprimer
                        </button>
                      </div>
                    ))}
                    {!data.credentials.length && (
                      <p className="cw-muted">
                        Ajoutez les comptes existants des sites sur lesquels
                        vous postulez.
                      </p>
                    )}
                  </section>
                </>
              )}
              {tab === "prospecting" && (
                <>
                  <div className="cw-heading">
                    <div>
                      <span className="cw-eyebrow">
                        LA PROSPECTION ANIMA CONNECT
                      </span>
                      <h1>Vos prochaines conversations.</h1>
                      <p>
                        Recherches LinkedIn, prospects, modèles et suivi réunis
                        avec vos candidatures.
                      </p>
                    </div>
                  </div>
                  <div className="cw-subnav">
                    {(
                      [
                        ["recherches", "Recherches"],
                        ["prospects", "Prospects"],
                        ["pipeline", "Pipeline"],
                        ["file", "File de contact"],
                        ["modeles", "Modèles"],
                        ["activite", "Activité"],
                        ["parametres", "Sauvegardes"],
                      ] as [LegacyTab, string][]
                    ).map(([key, name]) => (
                      <button
                        className={legacyTab === key ? "current" : ""}
                        key={key}
                        onClick={() => setLegacyTab(key)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <Legacy embedded initialTab={legacyTab} demoMode={demo} />
                </>
              )}
            </>
          )}
        </div>
      </main>
      {current && data && (
        <div className="cw-overlay" onClick={() => setDetail(null)}>
          <aside className="cw-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cw-section-head">
              <span className={`cw-status ${current.state}`}>
                {states[current.state]}
              </span>
              <button
                aria-label="Fermer la candidature"
                onClick={() => setDetail(null)}
              >
                ×
              </button>
            </div>
            <h2>{currentJob?.title}</h2>
            <p>
              {currentJob?.company} · {currentJob?.location}
            </p>
            <a href={currentJob?.url} target="_blank" rel="noreferrer">
              Voir l’offre ↗
            </a>
            <div className="cw-section-head cw-run-actions">
              <button
                disabled={
                  busy ||
                  demo ||
                  batch ||
                  !runnable.some((a) => a.id === current.id)
                }
                onClick={() =>
                  action(
                    () => run(current.id, "prepare"),
                    "Préparation lancée. Aucun envoi dans ce mode.",
                  )
                }
              >
                Préparer sans envoyer
              </button>
              <button
                className="cw-primary"
                disabled={
                  busy ||
                  demo ||
                  batch ||
                  !runnable.some((a) => a.id === current.id)
                }
                onClick={() =>
                  action(
                    () => run(current.id, "submit"),
                    "Automatisation lancée. Le suivi se met à jour ici.",
                  )
                }
              >
                Postuler automatiquement
              </button>
            </div>
            {current.lastError && (
              <p className="cw-callout">{current.lastError}</p>
            )}
            {current.receipt && (
              <div className="cw-receipt">
                <strong>✓ Candidature reçue</strong>
                <p>{current.receipt.text}</p>
                <small>
                  {current.receipt.reference} ·{" "}
                  {date(current.receipt.observedAt)}
                </small>
                <a href={current.receipt.url} target="_blank" rel="noreferrer">
                  Page de confirmation ↗
                </a>
              </div>
            )}
            {!!current.missingFields.length && (
              <section>
                <h3>Une réponse et ça repart.</h3>
                {current.missingFields.map((m) => (
                  <label key={m.key}>
                    {m.label}
                    {m.type === "boolean" ? (
                      <select
                        value={
                          current.answers[m.key] === undefined
                            ? ""
                            : String(current.answers[m.key])
                        }
                        onChange={(e) => {
                          if (e.target.value)
                            action(
                              () =>
                                api(`/applications/${current.id}`, "PATCH", {
                                  answers: {
                                    ...current.answers,
                                    [m.key]: e.target.value === "true",
                                  },
                                }),
                              "Réponse enregistrée.",
                            );
                        }}
                      >
                        <option value="">Choisir votre réponse</option>
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </select>
                    ) : m.type === "select" ? (
                      <select
                        value={String(current.answers[m.key] || "")}
                        onChange={(e) =>
                          action(
                            () =>
                              api(`/applications/${current.id}`, "PATCH", {
                                answers: {
                                  ...current.answers,
                                  [m.key]: e.target.value,
                                },
                              }),
                            "Réponse enregistrée.",
                          )
                        }
                      >
                        <option value="">Choisir</option>
                        {m.options?.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        defaultValue={String(current.answers[m.key] || "")}
                        onBlur={(e) => {
                          if (e.target.value !== current.answers[m.key])
                            action(
                              () =>
                                api(`/applications/${current.id}`, "PATCH", {
                                  answers: {
                                    ...current.answers,
                                    [m.key]: e.target.value,
                                  },
                                }),
                              "Réponse enregistrée.",
                            );
                        }}
                      />
                    )}
                  </label>
                ))}
              </section>
            )}
            {current.state === "uncertain" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  action(
                    () =>
                      api(`/applications/${current.id}/resolve`, "POST", {
                        resolution: f.get("resolution"),
                        detail: f.get("detail"),
                      }),
                    "Vérification enregistrée.",
                  );
                }}
              >
                <h3>Vérifier avant tout nouvel envoi</h3>
                <label>
                  Résultat
                  <select name="resolution">
                    <option value="submitted">Candidature bien envoyée</option>
                    <option value="not_submitted">
                      Candidature non envoyée
                    </option>
                  </select>
                </label>
                <label>
                  Ce que vous avez vérifié
                  <textarea name="detail" required minLength={3} />
                </label>
                <button disabled={busy}>Enregistrer la vérification</button>
              </form>
            )}
            <section>
              <h3>Votre suivi</h3>
              <label>
                Résultat
                <select
                  value={current.outcome}
                  disabled={busy}
                  onChange={(e) =>
                    action(
                      () =>
                        api(`/applications/${current.id}`, "PATCH", {
                          outcome: e.target.value,
                        }),
                      "Suivi mis à jour.",
                    )
                  }
                >
                  {Object.entries(outcomes).map(([key, name]) => (
                    <option value={key} key={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                CV
                <select
                  value={current.resumeId}
                  disabled={
                    busy || active(current) || current.state === "submitted"
                  }
                  onChange={(e) =>
                    action(
                      () =>
                        api(`/applications/${current.id}`, "PATCH", {
                          resumeId: e.target.value,
                        }),
                      "CV mis à jour.",
                    )
                  }
                >
                  {data.resumes.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prospect lié
                <select
                  value={current.prospectId || ""}
                  disabled={busy}
                  onChange={(e) =>
                    action(
                      () =>
                        api(`/applications/${current.id}`, "PATCH", {
                          prospectId: e.target.value || null,
                        }),
                      "Prospect lié.",
                    )
                  }
                >
                  <option value="">Aucun prospect</option>
                  {prospects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} · {p.company}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prochaine action
                <input
                  type="datetime-local"
                  defaultValue={
                    current.nextActionAt
                      ? new Date(
                          new Date(current.nextActionAt).getTime() -
                            new Date(current.nextActionAt).getTimezoneOffset() *
                              60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ""
                  }
                  key={`${current.id}-date`}
                  onBlur={(e) =>
                    action(
                      () =>
                        api(`/applications/${current.id}`, "PATCH", {
                          nextActionAt: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : "",
                        }),
                      "Relance enregistrée.",
                    )
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  key={`${current.id}-notes`}
                  defaultValue={current.notes}
                  onBlur={(e) => {
                    if (e.target.value !== current.notes)
                      action(
                        () =>
                          api(`/applications/${current.id}`, "PATCH", {
                            notes: e.target.value,
                          }),
                        "Notes enregistrées.",
                      );
                  }}
                />
              </label>
            </section>
            <section>
              <h3>Historique vérifiable</h3>
              <div className="cw-timeline">
                {data.events
                  .filter((event) => event.applicationId === current.id)
                  .map((event) => (
                    <div key={event.id}>
                      <span>●</span>
                      <div>
                        <strong>{event.detail || event.kind}</strong>
                        <small>
                          {date(event.happenedAt)} ·{" "}
                          {event.source === "automation"
                            ? "Automatisation"
                            : "Vous"}
                        </small>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
