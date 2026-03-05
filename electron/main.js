const path = require("path");
const fs = require("fs");
const http = require("http");
const { app, BrowserWindow, session } = require("electron");

app.commandLine.appendSwitch("disable-http-cache");
app.setPath("sessionData", path.join(app.getPath("userData"), "session-data"));

let backendBooted = false;

function cleanupBrokenCache() {
  const userDataDir = app.getPath("userData");
  const cacheDir = path.join(userDataDir, "Cache");
  const codeCacheDir = path.join(userDataDir, "Code Cache");
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(codeCacheDir, { recursive: true, force: true });
  } catch (_) {
    // Best effort only.
  }
}

function bootBackend() {
  if (backendBooted) return;
  backendBooted = true;

  const userDataDir = app.getPath("userData");
  process.env.SQLITE_PATH = path.join(userDataDir, "unitech.sqlite");
  process.env.DB_CLIENT = process.env.DB_CLIENT || "sqlite";
  process.env.DB_MINIMAL_BOOTSTRAP = "1";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "unitech_desktop_session_secret";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "unitech_desktop_jwt_secret";
  process.env.SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || "superadmin@unitech.local";
  process.env.SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || "Unitech@2026";

  if (app.isPackaged) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(path.join(process.resourcesPath, "app.asar", "app.js"));
    return;
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(path.join(__dirname, "..", "app.js"));
}

function waitForServer(url, timeoutMs = 20_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error("Server did not become ready in time"));
          return;
        }
        setTimeout(tick, 300);
      });

      req.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error("Server did not become ready in time"));
          return;
        }
        setTimeout(tick, 300);
      });
    };

    tick();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const port = Number(process.env.PORT || 3000);
  const baseUrl = process.env.ELECTRON_APP_URL || `http://localhost:${port}`;

  bootBackend();
  waitForServer(`${baseUrl}/api/v1/health`)
    .then(() => win.loadURL(baseUrl))
    .catch(() => {
      win.loadURL(`data:text/html,
        <html><body style="font-family:sans-serif;padding:24px">
          <h2>Backend non demarre</h2>
          <p>Impossible de demarrer le serveur local.</p>
          <p>URL attendue: ${baseUrl}</p>
        </body></html>`);
    });
}

app.whenReady().then(() => {
  cleanupBrokenCache();
  session.defaultSession.clearCache().catch(() => {});
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
