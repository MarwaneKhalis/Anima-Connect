import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as requestHttps } from "node:https";
import { request as requestHttp } from "node:http";
import type { CareerDiscovery, JobOffer } from "../src/shared/career.ts";

type Offer = Omit<JobOffer, "id" | "discoveredAt" | "updatedAt">;
const text = (value: unknown) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
function publicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    isIP(ip) === 6 &&
    !/^(::|fc|fd|fe8|fe9|fea|feb|ff)/i.test(ip) &&
    !ip.includes(".")
  );
}
export class JobDiscovery implements CareerDiscovery {
  private allowed: Set<string>;
  constructor(allowedTestOrigins: string[] = []) {
    this.allowed = new Set(allowedTestOrigins);
  }
  async validate(raw: string): Promise<URL> {
    const url = new URL(raw);
    if (url.username || url.password)
      throw new Error("Une URL sans identifiants est requise.");
    if (this.allowed.has(url.origin)) return url;
    if (url.protocol !== "https:" || (url.port && url.port !== "443"))
      throw new Error("Une adresse HTTPS publique est requise.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
      throw new Error("Les adresses réseau privées ne sont pas autorisées.");
    return url;
  }
  private async fetchText(raw: string): Promise<string> {
    let url = await this.validate(raw);
    for (let i = 0; i < 5; i++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await lookup(hostname, { all: true });
      if (
        !this.allowed.has(url.origin) &&
        addresses.some((a) => !publicIp(a.address))
      )
        throw new Error("Les adresses réseau privées ne sont pas autorisées.");
      const target = addresses[0];
      if (!target) throw new Error("Source introuvable.");
      // Connect to the validated IP while preserving TLS hostname verification.
      const response = await new Promise<{
        status: number;
        location?: string;
        body: string;
      }>((resolve, reject) => {
        const request = (
          url.protocol === "https:" ? requestHttps : requestHttp
        )(
          {
            hostname: target.address,
            servername: hostname,
            port: url.port || undefined,
            path: url.pathname + url.search,
            method: "GET",
            headers: {
              Host: url.host,
              Accept: "application/json,text/html",
              "User-Agent": "Anima-Connect/1.0",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            if (Number(res.headers["content-length"] || 0) > 5_000_000) {
              res.destroy();
              reject(new Error("Source trop volumineuse."));
              return;
            }
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 5_000_000) {
                res.destroy();
                reject(new Error("Source trop volumineuse."));
              } else chunks.push(chunk);
            });
            res.on("error", reject);
            res.on("end", () =>
              resolve({
                status: res.statusCode || 0,
                location: res.headers.location,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        request.setTimeout(15000, () =>
          request.destroy(new Error("La source ne répond pas.")),
        );
        request.on("error", reject);
        request.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.location;
        if (!location) throw new Error("Redirection sans destination.");
        url = await this.validate(new URL(location, url).href);
        continue;
      }
      if (response.status < 200 || response.status >= 300)
        throw new Error(`Source indisponible (${response.status}).`);
      return response.body;
    }
    throw new Error("Trop de redirections.");
  }
  async discover(raw: string): Promise<{ offers: Offer[]; note: string }> {
    const url = await this.validate(raw);
    const offers: Offer[] = [];
    const add = (input: Partial<Offer>) => {
      try {
        const link = new URL(input.url || url.href, url);
        if (
          link.username ||
          link.password ||
          (!this.allowed.has(link.origin) && link.protocol !== "https:")
        )
          return;
        for (const key of [...link.searchParams.keys()])
          if (/^utm_|^(gclid|fbclid)$/i.test(key))
            link.searchParams.delete(key);
        link.hash = "";
        if (input.title && !offers.some((o) => o.url === link.href))
          offers.push({
            url: link.href,
            title: text(input.title),
            company: text(input.company),
            location: text(input.location),
            description: text(input.description),
            sourceUrl: url.href,
          });
      } catch {
        /* Invalid source entry is ignored. */
      }
    };
    const green = /(?:^|\.)greenhouse\.io$/.test(url.hostname);
    const lever = /(?:^|\.)lever\.co$/.test(url.hostname);
    if (green) {
      const token = url.pathname.split("/").filter(Boolean)[0];
      if (!token || !/^[\w-]+$/.test(token))
        throw new Error("Adresse de tableau Greenhouse invalide.");
      const data = JSON.parse(
        await this.fetchText(
          `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
        ),
      );
      for (const job of data.jobs || [])
        add({
          url: job.absolute_url,
          title: job.title,
          company: token,
          location: job.location?.name,
          description: job.content,
        });
    } else if (lever) {
      const site = url.pathname.split("/").filter(Boolean)[0];
      if (!site || !/^[\w-]+$/.test(site))
        throw new Error("Adresse de tableau Lever invalide.");
      const host = url.hostname.includes(".eu.")
        ? "api.eu.lever.co"
        : "api.lever.co";
      const data = JSON.parse(
        await this.fetchText(`https://${host}/v0/postings/${site}?mode=json`),
      );
      for (const job of data)
        add({
          url: job.applyUrl || job.hostedUrl,
          title: job.text,
          company: site,
          location: job.categories?.location,
          description: job.descriptionPlain,
        });
    } else {
      const html = await this.fetchText(url.href);
      const walk = (node: any): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!node || typeof node !== "object") return;
        if ([node["@type"]].flat().includes("JobPosting")) {
          const locations = [node.jobLocation]
            .flat()
            .filter(Boolean)
            .map((loc: any) =>
              [loc.address?.addressLocality, loc.address?.addressCountry]
                .filter(Boolean)
                .join(", "),
            )
            .join(" · ");
          add({
            url: node.url || url.href,
            title: node.title,
            company: node.hiringOrganization?.name,
            location: locations || node.jobLocationType,
            description: node.description,
          });
        }
        if (node["@graph"]) walk(node["@graph"]);
      };
      for (const match of html.matchAll(
        /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      )) {
        try {
          walk(JSON.parse(match[1]));
        } catch {
          /* Non-JSON script is not a job. */
        }
      }
    }
    return {
      offers: offers.slice(0, 200),
      note: offers.length
        ? `${Math.min(offers.length, 200)} offre(s) trouvée(s). Les doublons sont regroupés (200 maximum par import).`
        : "Aucune offre structurée trouvée. Ajoutez cette offre avec son URL et son intitulé.",
    };
  }
}
