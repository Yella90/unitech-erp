const path = require("path");
const fs = require("fs");
const http = require("http");
const { app, BrowserWindow, dialog, session } = require("electron");
const { autoUpdater } = require("electron-updater");

app.commandLine.appendSwitch("disable-http-cache");
app.setPath("sessionData", path.join(app.getPath("userData"), "session-data"));

let backendBooted = false;
let mainWindow = null;

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
