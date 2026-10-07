const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const { Readable } = require("node:stream");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MAX_JSON_BODY_BYTES = 15 * 1024 * 1024;
const MAX_BINARY_BODY_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 100 * 1024 * 1024;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let backend;
let mainWindow;

if (!gotSingleInstanceLock) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.animaconnect.desktop");

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function bodyBytes(body) {
  if (body == null) return Buffer.alloc(0);
  if (typeof body === "string") {
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > MAX_JSON_BODY_BYTES) throw new Error("Requête IPC trop volumineuse.");
    return Buffer.from(body, "utf8");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.base64 !== "string") {
    throw new Error("Format de corps IPC invalide.");
  }
  const encoded = body.base64;
  if (encoded.length > Math.ceil(MAX_BINARY_BODY_BYTES / 3) * 4 + 4 ||
      encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("Corps binaire IPC invalide ou trop volumineux.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_BINARY_BODY_BYTES || bytes.toString("base64") !== encoded)
    throw new Error("Corps binaire IPC invalide ou trop volumineux.");
  return bytes;
}

function makeRequest(input) {
  const bytes = bodyBytes(input.body);
  const req = Readable.from(bytes.length ? [bytes] : []);
  req.method = input.method.toUpperCase();
  req.url = input.path;
  req.headers = Object.fromEntries(Object.entries(input.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v).slice(0, 4096)]));
  req.headers["content-length"] = String(bytes.length);
  req.headers.host = `127.0.0.1:${process.env.PORT || 4174}`;
  return req;
}

function makeResponse() {
  return {
    status: 200,
    headers: {},
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    end(value = "") { this.value = value; },
  };
}

async function handleApiRequest(_event, input) {
  const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  const pathIsSmall = typeof input?.path === "string" && input.path.length <= 4096;
  const methodIsSmall = typeof input?.method === "string" && input.method.length <= 10;
  if (!mainWindow || _event.sender !== mainWindow.webContents ||
      _event.senderFrame !== mainWindow.webContents.mainFrame || !input ||
      !pathIsSmall || !/^\/api\/[A-Za-z0-9_./?=&%-]*$/.test(input.path) ||
      !methodIsSmall ||
      !methods.has(input.method.toUpperCase()) ||
      (input.headers !== undefined && (!input.headers || typeof input.headers !== "object" || Array.isArray(input.headers) || Object.keys(input.headers).length > 32)))
    throw new Error("Requête Anima Connect invalide.");
  const req = makeRequest(input);
  const res = makeResponse();
  await backend.handleRequest(req, res);
  const value = Buffer.isBuffer(res.value) ? res.value : Buffer.from(String(res.value ?? ""));
  if (value.length > MAX_RESPONSE_BYTES) throw new Error("Réponse IPC trop volumineuse.");
  const binary = !String(res.headers["Content-Type"] || "").includes("json") &&
    !String(res.headers["Content-Type"] || "").startsWith("text/");
  return {
    status: res.status,
    headers: res.headers,
    body: binary ? value.toString("base64") : value.toString("utf8"),
    ...(binary ? { base64: true } : {}),
  };
}

async function createWindow() {
  const rendererUrl = pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

if (gotSingleInstanceLock) app.whenReady().then(async () => {
  process.env.ANIMA_ELECTRON_MODE = "1";
  process.env.ANIMA_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "playwright-browsers")
    : path.join(__dirname, "..", ".playwright-browsers");
  backend = await import(pathToFileURL(path.join(__dirname, "..", ".desktop-build", "server", "index.js")).href);
  ipcMain.handle("anima:request", handleApiRequest);
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
          shell.openExternal(parsed.href).catch(() => {});
      } catch { /* Ignore malformed or unsupported external destinations. */ }
      return { action: "deny" };
    });
    const rendererUrl = pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;
    contents.on("will-navigate", (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
    contents.on("will-redirect", (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error("Impossible de démarrer Anima Connect", error);
  app.quit();
});

let shutdownStarted = false;
app.on("before-quit", async (event) => {
  if (!backend || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  try { await backend.shutdown(); } finally { app.exit(0); }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
