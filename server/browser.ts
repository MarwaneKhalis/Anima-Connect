import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { normalizeLinkedInUrl, validateLinkedInPageUrl } from "./domain.ts";

export interface VisibleCandidate {
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  location: string;
  school: string;
  visibleText: string;
}

export function candidateFromVisibleText(
  href: string,
  name: string,
  lines: string[],
): VisibleCandidate {
  const linkedinUrl = normalizeLinkedInUrl(href);
  const [firstName, ...last] = name
    .replace(/\s+·.*$/, "")
    .trim()
    .split(/\s+/);
  const useful = lines
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        line !== name &&
        !/^(?:1st|2nd|3rd|1er|2e|3e|relation|connexion|connect|se connecter|message|follow|suivre)$/i.test(
          line,
        ),
    );
  const headline = useful[0] || "";
  const match = headline.match(/^(.+?)\s+(?:chez|at|@)\s+(.+)$/i);
  const school =
    useful.find((line) =>
      /universit|école|school|university|college|institut/i.test(line),
    ) || "";
  const location =
    useful
      .slice(1)
      .find(
        (line) =>
          line !== school &&
          !/^(?:à propos|about|followers|abonnés)/i.test(line),
      ) || "";
  return {
    linkedinUrl,
    firstName: firstName || "",
    lastName: last.join(" "),
    title: match ? match[1].trim() : headline,
    company: match ? match[2].trim() : "",
    location,
    school,
    visibleText: lines.join(" · ").slice(0, 500),
  };
}

export class LocalBrowser {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private profileDir: string;
  constructor(profileDir: string) {
    this.profileDir = profileDir;
  }

  private async currentPage(): Promise<Page> {
    if (!this.context) {
      mkdirSync(this.profileDir, { recursive: true });
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, {
          headless: false,
          viewport: { width: 1380, height: 920 },
        });
      } catch (error) {
        throw new Error(
          `Impossible d’ouvrir Chromium. Exécutez « npx playwright install chromium ». ${String(error)}`,
        );
      }
      this.context.on("close", () => {
        this.context = undefined;
        this.page = undefined;
      });
    }
    if (!this.page || this.page.isClosed())
      this.page = this.context.pages()[0] || (await this.context.newPage());
    return this.page;
  }

  async open(url: string) {
    const page = await this.currentPage();
    try {
      await page.goto(validateLinkedInPageUrl(url), {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await this.assertSafePage(page);
    } catch (error) {
      throw new Error(
        `Navigation interrompue. Vérifiez la page dans le navigateur avant de continuer. ${String(error)}`,
      );
    }
    await page.bringToFront();
    return { url: page.url() };
  }

  private async assertSafePage(page: Page) {
    const url = page.url();
    if (
      !url.startsWith("https://www.linkedin.com/") &&
      !url.startsWith("https://linkedin.com/")
    )
      throw new Error("La page courante n’est pas LinkedIn.");
    const snapshot = (
      await page
        .locator("body")
        .innerText({ timeout: 5000 })
        .catch(() => "")
    ).slice(0, 5000);
    if (
      /captcha|security verification|security check|vérification de sécurité|vérifiez votre identité|unusual activity|activité inhabituelle|challenge/i.test(
        snapshot + url,
      )
    ) {
      throw new Error(
        "LinkedIn affiche un contrôle de sécurité. L’action est arrêtée ; reprenez la main dans le navigateur.",
      );
    }
  }

  async currentUrl() {
    const page = await this.currentPage();
    await this.assertSafePage(page);
    return validateLinkedInPageUrl(page.url());
  }

  async visibleCandidates(): Promise<{
    url: string;
    candidates: VisibleCandidate[];
    note: string;
  }> {
    const page = await this.currentPage();
    await this.assertSafePage(page);
    const url = page.url();
    if (/\/in\/[^/]+/.test(new URL(url).pathname)) {
      const profile = await page.evaluate(() => {
        const name = document.querySelector("h1")?.textContent?.trim() || "";
        const lines = (document.querySelector("main")?.innerText || "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        return { name, lines: lines.slice(0, 20) };
      });
      return {
        url,
        candidates: [
          candidateFromVisibleText(url, profile.name, profile.lines),
        ],
        note: "Profil ouvert : vérifiez et corrigez les champs avant import.",
      };
    }
    if (!new URL(url).pathname.includes("/search/results/people"))
      throw new Error(
        "Ouvrez une page de résultats « Personnes » ou un profil LinkedIn.",
      );
    const raw = await page.evaluate(() => {
      const output: { href: string; name: string; lines: string[] }[] = [];
      const seen = new Set<string>();
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/in/"]',
      )) {
        const rect = anchor.getBoundingClientRect();
        if (
          !rect.width ||
          !rect.height ||
          rect.bottom < 0 ||
          rect.top > innerHeight ||
          rect.right < 0 ||
          rect.left > innerWidth
        )
          continue;
        const href = anchor.href.split("?")[0];
        if (seen.has(href)) continue;
        const card =
          anchor.closest(
            "li, .reusable-search__result-container, .search-results-container > div",
          ) || anchor.parentElement?.parentElement;
        const visibleText =
          (card as HTMLElement | null)?.innerText || anchor.innerText || "";
        const lines = visibleText
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 12);
        const name = anchor.innerText.trim().split("\n")[0] || lines[0] || "";
        if (!name || name.length > 100) continue;
        output.push({ href, name, lines });
        seen.add(href);
        if (output.length >= 25) break;
      }
      return output;
    });
    const candidates: VisibleCandidate[] = [];
    for (const item of raw) {
      try {
        candidates.push(
          candidateFromVisibleText(item.href, item.name, item.lines),
        );
      } catch {
        /* Ignore non-profile links. */
      }
    }
    return {
      url,
      candidates,
      note: "Seuls les liens de profil visibles à l’écran ont été lus. Vérifiez les champs proposés ; la structure de LinkedIn peut changer.",
    };
  }

  async close() {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }
}

