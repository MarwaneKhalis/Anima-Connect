import {
  EMPTY_FILTERS,
  STATUSES,
  type Prospect,
  type SearchFilters,
  type Status,
} from "../src/shared/types.ts";

export function normalizeLinkedInUrl(value: string): string {
  const input = value.trim();
  if (!input) return "";
  let url: URL;
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    throw new Error("URL LinkedIn invalide.");
  }
  if (
    !["linkedin.com", "www.linkedin.com"].includes(url.hostname.toLowerCase())
  )
    throw new Error("Utilisez une URL de profil linkedin.com.");
  const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
  if (!match)
    throw new Error(
      "Utilisez une URL de profil LinkedIn au format /in/identifiant.",
    );
  const slug = decodeURIComponent(match[1]).trim().toLowerCase();
  if (!slug || !/^[\p{L}\p{N}._%-]+$/u.test(slug))
    throw new Error("Identifiant de profil LinkedIn invalide.");
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}

export function validateLinkedInPageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL LinkedIn invalide.");
  }
  if (
    url.protocol !== "https:" ||
    !["linkedin.com", "www.linkedin.com"].includes(url.hostname.toLowerCase())
  )
    throw new Error("Seules les pages LinkedIn HTTPS peuvent être ouvertes.");
  return url.href;
}

export function makeSearchUrl(filters: SearchFilters): string {
  const words = [...filters.titles, ...filters.keywords]
    .filter(Boolean)
    .join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(words)}`;
}

export function cleanFilters(
  value: Partial<SearchFilters> | undefined,
): SearchFilters {
  const input = value || EMPTY_FILTERS;
  const strings = (key: keyof SearchFilters) =>
    Array.isArray(input[key])
      ? (input[key] as string[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
  return {
    titles: strings("titles"),
    keywords: strings("keywords"),
    locations: strings("locations"),
    schools: strings("schools"),
    companies: strings("companies"),
    industries: strings("industries"),
    experience: String(input.experience || "").trim(),
  };
}

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function renderTemplate(
  template: string,
  prospect: Pick<
    Prospect,
    "firstName" | "lastName" | "title" | "company" | "school" | "location"
  >,
): string {
  const values: Record<string, string> = {
    prenom: prospect.firstName,
    nom: prospect.lastName,
    poste: prospect.title,
    entreprise: prospect.company,
    ecole: prospect.school,
    localisation: prospect.location,
  };
  return template.replace(
    /\{(prenom|nom|poste|entreprise|ecole|localisation)\}/gi,
    (match, key: string) => values[key.toLowerCase()] || match,
  );
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvStringify(
  rows: Record<string, unknown>[],
  columns: string[],
): string {
  return (
    "\ufeff" +
    [
      columns.join(","),
      ...rows.map((row) =>
        columns.map((column) => csvEscape(row[column])).join(","),
      ),
    ].join("\r\n")
  );
}

export function csvParse(input: string): Record<string, string>[] {
  const text = input.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV invalide : guillemet non fermé.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header?.length) return [];
  return body
    .filter((cells) => cells.some(Boolean))
    .map((cells) =>
      Object.fromEntries(header.map((key, i) => [key.trim(), cells[i] ?? ""])),
    );
}

export function samePersonKey(
  firstName: string,
  lastName: string,
  company: string,
): string {
  return [firstName, lastName, company]
    .map((x) =>
      x.trim().toLocaleLowerCase("fr").normalize("NFKD").replace(/\p{M}/gu, ""),
    )
    .join("|");
}

