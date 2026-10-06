import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type {
  Application, CareerProfile, JobOffer, MissingField, Receipt, Resume, RunMode, RunResult,
} from "../src/shared/career.ts";

export interface CareerBrowserOptions { headless?: boolean; allowedTestOrigins?: string[] }
type Control = { index: number; tag: string; type: string; label: string; name: string; key: string; required: boolean; value: string; checked: boolean; options: string[] };
type Button = { index: number; text: string; disabled: boolean };
const tidy = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const safeText = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 240);
const result = (state: RunResult["state"], message: string, missingFields: MissingField[] = [], receipt: Receipt | null = null): RunResult => ({ state, message, missingFields, receipt });

function safeUrl(value: string, testOrigins: Set<string>): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.username || url.password || url.hash) throw new Error("Adresse de candidature non prise en charge.");
  if (testOrigins.has(url.origin) && url.protocol === "http:") return url;
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host) || !host.includes(".")) {
    throw new Error("La candidature exige une adresse HTTPS publique.");
  }
  return url;
}
async function assertPublic(url: URL, testOrigins: Set<string>): Promise<void> {
  safeUrl(url.href, testOrigins);
  if (testOrigins.has(url.origin)) return;
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => {
    const ip = address.toLowerCase();
    return /^10\.|^127\.|^0\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
      || ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:");
  })) throw new Error("Destination réseau privée interdite.");
}

const knownValue = (key: string, p: CareerProfile): string | undefined => {
  const rules: Array<[RegExp, string]> = [
    [/^(first name|given name|prenom)$/, p.firstName],
    [/^(last name|family name|surname|nom de famille|nom)$/, p.lastName],
    [/^(full name|your name|nom complet)$/, [p.firstName, p.lastName].filter(Boolean).join(" ")],
    [/^(e mail|email|email address|adresse e mail|courriel)$/, p.email],
    [/^(phone|phone number|telephone|numero de telephone|mobile)$/, p.phone],
    [/^(city|ville|current city)$/, p.city],
    [/^(country|pays)$/, p.country],
    [/^(address|street address|adresse)$/, p.address],
    [/^(postal code|zip code|code postal)$/, p.postalCode],
    [/^(linkedin|linkedin url|linkedin profile|profil linkedin)$/, p.linkedinUrl],
    [/^(website|website url|personal website|site web)$/, p.websiteUrl],
  ];
  return rules.find(([re]) => re.test(key))?.[1];
};
const missingType = (c: Control): MissingField["type"] => c.type === "file" ? "file" : c.tag === "select" ? "select" : ["checkbox", "radio"].includes(c.type) ? "boolean" : ["text", "email", "tel", "url", "textarea"].includes(c.type) ? "text" : "unknown";
const obstacle = (text: string) => /captcha|recaptcha|hcaptcha|verify you are human|verification humaine|authenticator|two.factor|multi.factor|one.time code|code de verification|mfa/i.test(text);
const loginButton = (s: string) => /^(log in|login|sign in|connexion|se connecter|connecter|submit)$/i.test(s.trim());
const nextButton = (s: string) => /^(next|continue|suivant|suivante|continuer|prochaine etape)$/i.test(tidy(s));
const finalButton = (s: string) => /^(submit( application)?|send( application)?|apply( now)?|complete application|envoyer( ma candidature| la candidature)?|soumettre( ma candidature)?|postuler|valider la candidature)$/i.test(tidy(s));

async function controls(page: Page): Promise<Control[]> {
  return page.locator("input, select, textarea").evaluateAll((nodes) => nodes.flatMap((node, index) => {
    const el = node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const type = el instanceof HTMLInputElement ? el.type.toLowerCase() : el.tagName.toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type) || el.disabled || el.closest('[aria-hidden="true"], [hidden]')) return [];
    const style = getComputedStyle(el);
    if (type !== "file" && (style.display === "none" || style.visibility === "hidden" || el.getClientRects().length === 0)) return [];
    const label = [el.labels && [...el.labels].map(x => {
      const copy = x.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("input, select, textarea").forEach(control => control.remove());
      return copy.textContent?.trim();
    }).filter(Boolean).join(" "), el.getAttribute("aria-label"), el.getAttribute("placeholder")].find(Boolean) || "";
    const name = el.getAttribute("name") || el.id || "";
    const key = [label, name, el.getAttribute("autocomplete")].find(Boolean) || "";
    const options = el instanceof HTMLSelectElement ? [...el.options].map(o => o.textContent?.trim() || o.value) : [];
    return [{ index, tag: el.tagName.toLowerCase(), type, label, name, key, required: el.required || el.getAttribute("aria-required") === "true", value: el.value, checked: el instanceof HTMLInputElement ? el.checked : false, options }];
  }));
}
async function buttons(page: Page): Promise<Button[]> {
  return page.locator('button, input[type="submit"]').evaluateAll(nodes => nodes.map((node, index) => {
    const el = node as HTMLButtonElement | HTMLInputElement;
    return { index, text: (el instanceof HTMLInputElement ? el.value : el.textContent || el.getAttribute("aria-label") || "").trim(), disabled: el.disabled || el.getClientRects().length === 0 };
  }));
}
const receiptPattern = /(?:application (?:received|submitted)|thank you for (?:applying|your application)|candidature (?:recue|reçue|envoyee|envoyée)|merci pour votre candidature)/i;
async function receipt(page: Page, previousText: string): Promise<Receipt | null> {
  const full = await page.locator("body").innerText().catch(() => "");
  const body = safeText(full);
  const matches = receiptPattern.test(full);
  if (!matches || (await buttons(page)).some(b => !b.disabled && finalButton(b.text))) return null;
  const reference = full.match(/(?:reference|référence|confirmation|receipt|reçu)\s*(?:number|no|n°|#|:)?\s*([A-Z0-9-]{4,})/i)?.[1] || "";
  if (receiptPattern.test(previousText) && (!reference || previousText.includes(reference))) return null;
  const url = new URL(page.url()); url.search = ""; url.hash = "";
  return { url: url.href, text: body, reference, observedAt: new Date().toISOString() };
}
async function sameOriginForm(page: Page, control: ReturnType<Page["locator"]>, origin: string): Promise<boolean> {
  const action = await control.evaluate(el => (el as HTMLInputElement).form?.action || location.href);
  return new URL(action).origin === origin;
}
async function advance(page: Page, control: ReturnType<Page["locator"]>): Promise<void> {
  const before = await page.evaluate(() => ({ url: location.href, html: document.body.innerHTML }));
  await Promise.all([
    page.waitForFunction(({ url, html }) => location.href !== url || document.body.innerHTML !== html, before, { timeout: 12_000 }),
    control.click(),
  ]);
}

export class CareerBrowser {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private active = false;
  private options: CareerBrowserOptions;
  private readonly testOrigins: Set<string>;
  constructor(options: CareerBrowserOptions = {}) { this.options = options; this.testOrigins = new Set(options.allowedTestOrigins || []); }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {}); this.context = undefined;
    await this.browser?.close().catch(() => {}); this.browser = undefined;
  }

  async discover(url: string): Promise<{ offers: Omit<JobOffer, "id" | "discoveredAt" | "updatedAt">[]; note: string }> {
    safeUrl(url, this.testOrigins);
    if (this.active) throw new Error("Un parcours navigateur est déjà actif.");
    return { offers: [], note: "Découverte navigateur non prise en charge ; utilisez une page carrière publique compatible." };
  }

  async run(input: { application: Application; job: JobOffer; profile: CareerProfile; resume: {meta: Resume; bytes: Buffer}; mode: RunMode; getCredential: (origin: string) => {username:string; password:string}|null; beforeSubmit: () => void; signal?: AbortSignal }): Promise<RunResult> {
    if (this.active) return result("blocked", "Un autre parcours navigateur est déjà actif.");
    this.active = true;
    let submittedClick = false;
    try {
      const start = safeUrl(input.job.url, this.testOrigins);
      await assertPublic(start, this.testOrigins);
      this.browser = await chromium.launch({ headless: this.options.headless ?? false });
      this.context = await this.browser.newContext({ acceptDownloads: false, viewport: { width: 1365, height: 900 } });
      this.context.setDefaultTimeout(10_000);
      this.context.setDefaultNavigationTimeout(20_000);
      let flowOrigin = start.origin;
      let initialNavigation = true;
      await this.context.route("**/*", async route => {
        const request = route.request();
        let url: URL;
        try { url = new URL(request.url()); } catch { return route.abort(); }
        if (url.origin !== flowOrigin) {
          if (initialNavigation && request.isNavigationRequest() && request.redirectedFrom()) {
            try { await assertPublic(url, this.testOrigins); flowOrigin = url.origin; } catch { return route.abort(); }
          } else return route.abort();
        }
        return route.continue();
      });
      const page = await this.context.newPage();
      await page.goto(start.href, { waitUntil: "domcontentloaded" });
      initialNavigation = false;
      flowOrigin = new URL(page.url()).origin;
      const seen = new Set<string>();
      let loggedIn = false;
      for (let step = 0; step < 10; step++) {
        if (input.signal?.aborted) return result("failed", "Parcours interrompu avant l’envoi.");
        if (new URL(page.url()).origin !== flowOrigin) return result("blocked", "Redirection vers une autre origine : action manuelle requise.");
        const body = await page.locator("body").innerText().catch(() => "");
        if (obstacle(body) || await page.locator('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]').count()) return result("blocked", "Vérification CAPTCHA ou MFA : intervention manuelle requise.");
        const cs = await controls(page);
        if (cs.some(c => c.type === "password")) {
          if (loggedIn) return result("blocked", "Connexion non terminée ; intervention manuelle requise.");
          const credential = input.getCredential(flowOrigin);
          if (!credential) return result("blocked", "Compte requis pour cette origine ; enregistrez ses identifiants dans le coffre.");
          const user = cs.find(c => c.type === "email" || /^(username|user name|email|e mail|identifiant|login)$/i.test(tidy(c.key)));
          const pass = cs.find(c => c.type === "password");
          const action = (await buttons(page)).filter(b => !b.disabled && loginButton(b.text));
          if (!user || !pass || action.length !== 1) return result("blocked", "Formulaire de connexion ambigu.");
          const loginControl = page.locator("input, select, textarea").nth(pass.index);
          if (!await sameOriginForm(page, loginControl, flowOrigin)) return result("blocked", "Connexion vers une origine différente interdite.");
          await page.locator("input, select, textarea").nth(user.index).fill(credential.username);
          await page.locator("input, select, textarea").nth(pass.index).fill(credential.password);
          await advance(page, page.locator('button, input[type="submit"]').nth(action[0].index));
          loggedIn = true;
          continue;
        }
        const missing: MissingField[] = [];
        const explicitFor = (...labels: string[]) => {
          for (const answers of [input.application.answers, input.profile.answers]) {
            const match = Object.entries(answers).find(([answerKey]) => labels.some(label => tidy(answerKey) === tidy(label)));
            if (match) return match[1];
          }
          return undefined;
        };
        const radioGroups = new Map<string, Control[]>();
        for (const c of cs.filter(c => c.type === "radio")) {
          const groupKey = tidy(c.name || c.key);
          radioGroups.set(groupKey, [...(radioGroups.get(groupKey) || []), c]);
        }
        for (const [key, group] of radioGroups) {
          const required = group.some(c => c.required);
          const label = group[0].name || group[0].key;
          const options = group.map(c => c.value || c.label).filter(Boolean);
          const answer = explicitFor(group[0].name || group[0].key);
          const desired = typeof answer === "boolean" ? (answer ? "yes" : "no") : typeof answer === "string" ? tidy(answer) : "";
          const selected = desired ? group.find(c => tidy(c.value) === desired || tidy(c.label) === desired) : undefined;
          if (selected) {
            await page.locator("input, select, textarea").nth(selected.index).check();
          } else if (required || answer !== undefined) {
            missing.push({ key, label, required, type: "select", options });
          } else {
            for (const c of group) await page.locator("input, select, textarea").nth(c.index).evaluate(el => { (el as HTMLInputElement).checked = false; (el as HTMLInputElement).disabled = true; });
          }
        }
        for (const c of cs) {
          if (c.type === "radio") continue;
          const key = tidy(c.name || c.key);
          if (!key || /honeypot|website hidden|do not fill|leave blank/i.test(key)) continue;
          const aliases = new Set([key, tidy(c.label), tidy(c.key)]);
          const explicit = explicitFor(...aliases);
          const value = explicit === undefined ? knownValue(tidy(c.label || c.key), input.profile) : explicit;
          const loc = page.locator("input, select, textarea").nth(c.index);
          if (c.type === "file") {
            if (/\b(cv|resume|curriculum vitae)\b/i.test(key)) await loc.setInputFiles({ name: input.resume.meta.filename, mimeType: input.resume.meta.mime, buffer: input.resume.bytes });
            else if (c.required) missing.push({ key, label: c.label || c.key, required: true, type: "file" });
            continue;
          }
          if (c.type === "checkbox") {
            if (typeof value === "boolean") { if (value) await loc.check(); else await loc.uncheck().catch(() => {}); }
            else await loc.uncheck().catch(() => {});
            if (c.required && value !== true) missing.push({ key, label: c.label || c.key, required: true, type: "boolean" });
            continue;
          }
          if (c.tag === "select") {
            const desired = typeof value === "boolean" ? (value ? "yes" : "no") : typeof value === "string" ? tidy(value) : "";
            if (desired) {
              const match = c.options.find(o => tidy(o) === desired);
              if (match) await loc.selectOption({ label: match });
              else missing.push({ key, label: c.label || c.key, required: c.required, type: "select", options: c.options });
            } else if (c.required) missing.push({ key, label: c.label || c.key, required: true, type: "select", options: c.options });
            else {
              const blank = c.options.find(o => !tidy(o));
              if (blank !== undefined) await loc.selectOption({ label: blank });
              else await loc.evaluate(el => { (el as HTMLSelectElement).disabled = true; });
            }
            continue;
          }
          if (typeof value === "string" && value) await loc.fill(value);
          else if (c.required) missing.push({ key, label: c.label || c.key, required: true, type: missingType(c) });
          else if (c.value) await loc.fill("");
        }
        if (missing.length) return result("needs_input", "Renseignez les champs requis avant l’envoi.", missing);
        const actions = (await buttons(page)).filter(b => !b.disabled);
        const finals = actions.filter(b => finalButton(b.text));
        const nexts = actions.filter(b => nextButton(b.text));
        if (finals.length > 1 || nexts.length > 1 || (finals.length && nexts.length)) return result("blocked", "Plusieurs actions possibles : sélection manuelle requise.");
        if (nexts.length === 1) {
          const nextControl = page.locator('button, input[type="submit"]').nth(nexts[0].index);
          if (!await sameOriginForm(page, nextControl, flowOrigin)) return result("blocked", "Étape suivante vers une origine différente interdite.");
          const fingerprint = `${page.url()}|${cs.map(c => c.key).join("|")}`;
          if (seen.has(fingerprint)) return result("blocked", "Le formulaire tourne en boucle.");
          seen.add(fingerprint);
          await advance(page, nextControl);
          continue;
        }
        if (finals.length !== 1) return result("blocked", "Bouton final de candidature introuvable ou ambigu.");
        const finalControl = page.locator('button, input[type="submit"]').nth(finals[0].index);
        if (!await sameOriginForm(page, finalControl, flowOrigin)) return result("blocked", "Envoi vers une origine différente interdit.");
        if (input.mode === "prepare") return result("ready", "Formulaire prêt à être envoyé.");
        if (input.signal?.aborted) return result("failed", "Parcours interrompu avant l’envoi.");
        const beforeText = await page.locator("body").innerText().catch(() => "");
        // This callback commits the durable submitting marker before any final click.
        input.beforeSubmit();
        submittedClick = true;
        await finalControl.click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        for (let retry = 0; retry < 10; retry++) {
          const proof = await receipt(page, beforeText);
          if (proof) return result("submitted", "Candidature confirmée.", [], proof);
          await page.waitForTimeout(250);
        }
        return result("uncertain", "Le clic a eu lieu mais aucun reçu vérifiable n’est apparu.");
      }
      return result("blocked", "Le formulaire dépasse dix étapes.");
    } catch {
      return result(submittedClick ? "uncertain" : "blocked", submittedClick ? "L’envoi a peut-être eu lieu ; vérifiez manuellement avant toute nouvelle tentative." : "Le navigateur n’a pas pu terminer ce formulaire.");
    } finally {
      await this.close();
      this.active = false;
    }
  }
}
