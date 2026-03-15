const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const http = require("http");
const dns = require("dns").promises;
const { URL } = require("url");
const { app, BrowserWindow, dialog, session } = require("electron");
const { autoUpdater } = require("electron-updater");

app.commandLine.appendSwitch("disable-http-cache");
app.setPath("sessionData", path.join(app.getPath("userData"), "session-data"));

let backendBooted = false;
let mainWindow = null;

function loadEnvFile() {
  const candidates = [];
  const cwdEnv = path.join(process.cwd(), ".env");
  candidates.push(cwdEnv);

  if (app && typeof app.getPath === "function") {
    const userDataEnv = path.join(app.getPath("userData"), ".env");
    candidates.unshift(userDataEnv);
  }

  if (app && app.isPackaged) {
    const exeDirEnv = path.join(path.dirname(process.execPath), ".env");
    const resourcesEnv = path.join(process.resourcesPath, ".env");
    const asarEnv = path.join(process.resourcesPath, "app.asar", ".env");
    candidates.push(exeDirEnv, resourcesEnv, asarEnv);
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        dotenv.config({ path: candidate });
        return candidate;
      }
    } catch (_) {
      // ignore fs errors and continue to next candidate
    }
  }

  dotenv.config();
  return null;
}

function readPackagedRuntimeConfig() {
  try {
    const packageJsonPath = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar", "package.json")
      : path.join(__dirname, "..", "package.json");
    const appPackage = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return appPackage && appPackage.unitechRuntime ? appPackage.unitechRuntime : {};
  } catch (_) {
    return {};
  }
}

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

function extractPgHost() {
  if (process.env.PGHOST) return String(process.env.PGHOST).trim();
  if (process.env.DATABASE_URL) {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch (_) {
      return null;
    }
  }
  return null;
}

async function ensureDbClient() {
  const client = String(process.env.DB_CLIENT || "").trim().toLowerCase();
  if (client !== "postgres") return "sqlite";
  const host = extractPgHost();
  if (!host) return "postgres";
  try {
    await dns.lookup(host);
    return "postgres";
  } catch (_) {
    console.warn(`PostgreSQL host unreachable (${host}), falling back to SQLite.`);
    process.env.DB_CLIENT = "sqlite";
    return "sqlite";
  }
}

async function bootBackend() {
  if (backendBooted) return;
  backendBooted = true;

  loadEnvFile();

  process.env.ELECTRON_DESKTOP = "1";

  const userDataDir = app.getPath("userData");
  // Respect explicit env (e.g., Postgres) but provide sane defaults for offline mode.
  process.env.SQLITE_PATH = process.env.SQLITE_PATH || path.join(userDataDir, "unitech.sqlite");
  process.env.DB_CLIENT = process.env.DB_CLIENT || "sqlite";
  const resolvedClient = await ensureDbClient();
  if (!process.env.DB_MINIMAL_BOOTSTRAP) {
    process.env.DB_MINIMAL_BOOTSTRAP = resolvedClient === "postgres" ? "0" : "1";
  }
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

function waitForServer(url, timeoutMs = 60_000) {
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

  bootBackend()
    .then(() => waitForServer(`${baseUrl}/api/v1/health`))
    .then(() => win.loadURL(baseUrl))
    .catch((err) => {
      const userDataDir = app.getPath("userData");
      const logPath = path.join(userDataDir, "backend-error.log");
      const details = err && (err.stack || err.message || String(err));
      try {
        fs.writeFileSync(
          logPath,
          `[${new Date().toISOString()}] Backend startup failed\n${details || "Unknown error"}\n`,
          "utf8"
        );
      } catch (_) {
        // ignore logging failures
      }

      const safeDetails = details ? String(details).replace(/[<>]/g, "") : "Erreur inconnue";
      win.loadURL(`data:text/html,
        <html><body style="font-family:sans-serif;padding:24px">
          <h2>Backend non demarre</h2>
          <p>Impossible de demarrer le serveur local.</p>
          <p>URL attendue: ${baseUrl}</p>
          <p>Details: ${safeDetails}</p>
          <p>Log: ${logPath}</p>
        </body></html>`);
    });

  return win;
}

function sendUpdateStatus(status, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("unitech:update-status", { status, ...payload });
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;

  const runtimeConfig = readPackagedRuntimeConfig();
  const updateProvider = String(
    process.env.ELECTRON_UPDATE_PROVIDER || runtimeConfig.electronUpdateProvider || ""
  ).trim().toLowerCase();
  const updateUrl = String(
    process.env.ELECTRON_UPDATE_URL || runtimeConfig.electronUpdateUrl || ""
  ).trim();
  const ghOwner = String(process.env.GH_OWNER || runtimeConfig.ghOwner || "").trim();
  const ghRepo = String(process.env.GH_REPO || runtimeConfig.ghRepo || "").trim();
  const ghToken = process.env.GH_TOKEN;
  const useGithubProvider = updateProvider === "github" && ghOwner && ghRepo;
  const useGenericProvider = !useGithubProvider && updateUrl;

  if (useGithubProvider) {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: ghOwner,
      repo: ghRepo
    });
  } else if (useGenericProvider) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: updateUrl
    });
  }

  if (updateProvider === "github" && ghToken) {
    autoUpdater.requestHeaders = {
      Authorization: `token ${ghToken}`
    };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus("checking");
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus("available", { version: info?.version });
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus("not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus("downloading", {
      percent: progress?.percent,
      bytesPerSecond: progress?.bytesPerSecond
    });
  });

  autoUpdater.on("error", (error) => {
    sendUpdateStatus("error", { message: error?.message || "Erreur inconnue" });
  });

  autoUpdater.on("update-downloaded", async () => {
    sendUpdateStatus("downloaded");
    const response = await dialog.showMessageBox({
      type: "info",
      buttons: ["Installer maintenant", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
      title: "Mise a jour disponible",
      message: "Une nouvelle version a ete telechargee.",
      detail: "L'application doit redemarrer pour finaliser l'installation."
    });

    if (response.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    sendUpdateStatus("error", { message: error?.message || "Echec de verification des mises a jour" });
  });
}

app.whenReady().then(() => {
  cleanupBrokenCache();
  session.defaultSession.clearCache().catch(() => {});
  mainWindow = createWindow();
  configureAutoUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
