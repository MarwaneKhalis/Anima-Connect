/** Renderer transport shared by browser preview and the packaged desktop app. */
type NativeRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | { base64: string };
};

type NativeReply = {
  status: number;
  headers?: Record<string, string>;
  body: string;
  base64?: boolean;
};

declare global {
  interface Window {
    anima?: { request: (request: NativeRequest) => Promise<NativeReply> };
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function serializeBody(body: BodyInit | null | undefined) {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return { base64: toBase64(new Uint8Array(await body.arrayBuffer())) };
  if (body instanceof ArrayBuffer) return { base64: toBase64(new Uint8Array(body)) };
  if (ArrayBuffer.isView(body)) {
    return { base64: toBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)) };
  }
  throw new TypeError("Ce format de requête n’est pas pris en charge dans l’application bureau.");
}

/** Uses Electron IPC when available, otherwise preserves the local HTTP dev workflow. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!window.anima?.request) return fetch(input, init);

  const url = input instanceof Request ? input.url : String(input);
  const rootRelativeApi = url.startsWith("/api/");
  const parsed = new URL(url, window.location.href);
  const packagedFile = window.location.protocol === "file:" &&
    parsed.protocol === "file:" &&
    window.location.host === "" &&
    parsed.host === "";
  const requestPath = rootRelativeApi ? url : `${parsed.pathname}${parsed.search}`;
  if ((parsed.origin !== window.location.origin && !packagedFile) || !requestPath.split("?")[0].startsWith("/api/")) {
    throw new TypeError("L’application bureau n’autorise que les requêtes API locales.");
  }
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  let body = init.body ?? (input instanceof Request ? input.body : undefined);
  if (body instanceof ReadableStream) {
    const request = new Request(input, init);
    body = await request.arrayBuffer();
  }
  const reply = await window.anima.request({
    method: (init.method || (input instanceof Request ? input.method : "GET")).toUpperCase(),
    path: requestPath,
    headers: Object.fromEntries(headers.entries()),
    body: await serializeBody(body as BodyInit | null | undefined),
  });
  let responseBody: BodyInit | null = reply.body;
  if ([204, 205, 304].includes(reply.status)) responseBody = null;
  else if (reply.base64) {
    const bytes = fromBase64(reply.body);
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    responseBody = new Blob([buffer]);
  }
  return new Response(responseBody, { status: reply.status, headers: reply.headers });
}

export async function downloadResponse(response: Response, filename: string) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

