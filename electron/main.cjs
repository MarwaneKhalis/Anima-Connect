const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { Readable } = require("node:stream");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let backend;
let mainWindow;

function makeRequest(input) {
  const body = input.body;
  const bytes = body && typeof body === "object" && typeof body.base64 === "string"
    ? Buffer.from(body.base64, "base64")
    : Buffer.from(typeof body === "string" ? body : "", "utf8");
  const req = Readable.from(bytes.length ? [bytes] : []);
  req.method = input.method;
  req.url = input.path;
  req.headers = Object.fromEntries(Object.entries(input.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
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
  if (!mainWindow || _event.sender !== mainWindow.webContents ||
      _event.senderFrame !== mainWindow.webContents.mainFrame || !input ||
      typeof input.path !== "string" || !input.path.startsWith("/api/") ||
      typeof input.method !== "string" || input.path.length > 4096)
    throw new Error("Requête Anima Connect invalide.");
  const req = makeRequest(input);
  const res = makeResponse();
  await backend.handleRequest(req, res);
  const value = Buffer.isBuffer(res.value) ? res.value : Buffer.from(String(res.value ?? ""));
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(async () => {
  process.env.ANIMA_ELECTRON_MODE = "1";
  process.env.ANIMA_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "playwright-browsers")
    : path.join(__dirname, "..", ".playwright-browsers");
  backend = await import(pathToFileURL(path.join(__dirname, "..", ".desktop-build", "server", "index.js")).href);
  ipcMain.handle("anima:request", handleApiRequest);
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
