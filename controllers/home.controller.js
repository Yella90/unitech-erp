const HomeService = require("../services/home.service");
const SubscriptionService = require("../subscription/subscription.service");
const { get } = require("../utils/dbAsync");
const VisitorTrackingService = require("../services/public/visitor-tracking.service");
const fs = require("fs");
const path = require("path");
const https = require("https");
const appPackage = require("../package.json");
const githubReleaseCache = {
  expiresAt: 0,
  data: null,
  pending: null
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

exports.index = (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect("/auth/login");
  }

  if (req.session.user.role === "superadmin") {
    return res.redirect("/admin/dashboard");
  }

  const selectedMonth = String(req.query.month || "").trim();

  HomeService.indexHome(req.school_id, { selectedMonth }, (err, data) => {
    if (err) {
      console.error("Erreur dans indexHome:", err);
      req.flash("error", "Erreur chargement dashboard");
      return res.redirect("/classes");
    }

    const rows = Array.isArray(data.classes) ? data.classes : [];
    const tt = toNumber(data.stats && data.stats.total_paiements);
    const startDate = data.tuitionForecast && data.tuitionForecast.startDate ? data.tuitionForecast.startDate : null;
    const moisEcoules = toNumber(data.tuitionForecast && data.tuitionForecast.moisEcoules);

    const tta = rows.reduce((sum, classe) => {
      const totalClasse = toNumber(classe.totalapaie);
      if (totalClasse > 0) return sum + totalClasse;
      return sum + toNumber(classe.mensuel) * toNumber(classe.effectif);
    }, 0);

    const datas = {
      d: new Date().getFullYear(),
      totaleleves: Array.isArray(data.eleves) ? data.eleves.length : 0,
      totalclasses: rows.length,
      totalenseignants: 0,
      tt,
      tta,
      reste: Math.max(tta - tt, 0),
      rows,
      finance: {
        startDate,
        moisEcoules,
        revenus: {
          forecastMensuel: toNumber(data.tuitionForecast && data.tuitionForecast.totalMensuelPrevu),
          actualMensuel: toNumber(data.actuals && data.actuals.actual_revenus_mensuel),
          forecastCumule: toNumber(data.tuitionForecast && data.tuitionForecast.totalCumulePrevu),
          actualCumule: toNumber(data.actuals && data.actuals.actual_revenus_cumule)
        },
        depenses: {
          forecastMensuel: toNumber(data.payrollForecast && data.payrollForecast.totalSortiesPrevues),
          actualMensuel: toNumber(data.actuals && data.actuals.actual_depenses_mensuel),
          forecastCumule: toNumber(data.payrollForecast && data.payrollForecast.totalSortiesPrevues) * Math.max(moisEcoules, 1),
          actualCumule: toNumber(data.actuals && data.actuals.actual_depenses_cumule)
        },
        timeline: Array.isArray(data.timeline) ? data.timeline : []
      },
      monthOptions: data.monthData && Array.isArray(data.monthData.monthOptions) ? data.monthData.monthOptions : [],
      activeMonth: data.selectedMonth || (data.monthData && data.monthData.activeMonth ? data.monthData.activeMonth : null),
      subscriptionStatus: res.locals.subscriptionStatus || null
    };

    return res.render("index", { datas });
  });
};

exports.landing = async (req, res) => {
  try {
    const [plans, schoolsRow, elevesRow, activeSchoolsRow, activeSubsRow, visitorStats] = await Promise.all([
      SubscriptionService.listPlans(),
      get("SELECT COUNT(*) AS total FROM schools", []),
      get("SELECT COUNT(*) AS total FROM eleves", []),
      get("SELECT COUNT(*) AS total FROM schools WHERE is_active = 1", []),
      get(
        `
        SELECT COUNT(*) AS total
        FROM schools s
        WHERE EXISTS (
          SELECT 1
          FROM saas_subscriptions ss
          WHERE ss.school_id = s.id
            AND lower(trim(COALESCE(ss.status, ''))) = 'active'
            AND (
              ss.expires_at IS NULL
              OR date(ss.expires_at) >= date('now')
            )
            AND ss.id = (
              SELECT x.id
              FROM saas_subscriptions x
              WHERE x.school_id = s.id
              ORDER BY x.created_at DESC, x.id DESC
              LIMIT 1
            )
        )
        `,
        []
      ),
      VisitorTrackingService.getLandingStats()
    ]);

    const totalSchools = Number((schoolsRow && schoolsRow.total) || 0);
    const totalEleves = Number((elevesRow && elevesRow.total) || 0);
    const activeSchools = Number((activeSchoolsRow && activeSchoolsRow.total) || 0);
    const activeSubscriptions = Number((activeSubsRow && activeSubsRow.total) || 0);
    const safeDenominator = totalSchools > 0 ? totalSchools : 1;

    const metrics = {
      totalSchools,
      totalEleves,
      satisfaction: Math.round((activeSchools / safeDenominator) * 100),
      disponibilite: Math.round((activeSubscriptions / safeDenominator) * 100)
    };

    return res.render("public/index", { plans: plans || [], metrics, visitorStats: visitorStats || {} });
  } catch (err) {
    return res.render("public/index", {
      plans: [],
      metrics: {
        totalSchools: 0,
        totalEleves: 0,
        satisfaction: 0,
        disponibilite: 0
      },
      visitorStats: {
        totalVisits: 0,
        uniqueVisitors: 0,
        visitsToday: 0
      }
    });
  }
};

exports.entreprise = (req, res) => {
  return res.render("public/entreprise");
};

exports.trackPublicVisit = async (req, res) => {
  try {
    const result = await VisitorTrackingService.trackPublicVisit({
      req,
      body: req.body || {}
    });
    return res.status(200).json({ ok: true, tracked: Boolean(result && result.tracked) });
  } catch (err) {
    return res.status(200).json({ ok: false });
  }
};

function downloadInstallerByPattern(req, res, matcher) {
  try {
    const installer = findLatestArtifactByPattern({
      directories: ["logiciel", "dist"],
      matcher
    });

    if (installer) {
      return res.download(installer.fullPath, installer.name);
    }

    return null;
  } catch (err) {
    return res.status(500).send("Erreur lors du telechargement de l'installateur.");
  }
}

function listArtifactsFromDirectory(relativeDir, matcher) {
  const dir = path.resolve(__dirname, "..", relativeDir);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((name) => matcher.test(name))
    .map((name) => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        fullPath,
        mtimeMs: stat.mtimeMs,
        directory: relativeDir
      };
    });
}

function findLatestArtifactByPattern({ directories, matcher }) {
  const candidates = directories
    .flatMap((relativeDir) => listArtifactsFromDirectory(relativeDir, matcher))
    .sort((a, b) => {
      if (a.directory !== b.directory) {
        return directories.indexOf(a.directory) - directories.indexOf(b.directory);
      }
      return b.mtimeMs - a.mtimeMs;
    });

  return candidates[0] || null;
}

function resolveArtifactByName({ directories, artifactName }) {
  const safeName = path.basename(String(artifactName || "").trim());
  if (!safeName) return null;

  for (const relativeDir of directories) {
    const fullPath = path.resolve(__dirname, "..", relativeDir, safeName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return { name: safeName, fullPath, directory: relativeDir };
    }
  }

  return null;
}

function githubReleaseDownloadUrl(artifactName) {
  const owner = String(process.env.GH_OWNER || "").trim();
  const repo = String(process.env.GH_REPO || "").trim();
  const releaseTag = String(process.env.GH_RELEASE_TAG || `v${appPackage.version}`).trim();
  if (!owner || !repo || !releaseTag || !artifactName) return "";
  return `https://github.com/${owner}/${repo}/releases/download/${releaseTag}/${artifactName}`;
}

function shouldUseLatestGithubRelease() {
  const raw = String(process.env.GH_USE_LATEST_RELEASE || "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function fetchGithubLatestRelease() {
  const owner = String(process.env.GH_OWNER || "").trim();
  const repo = String(process.env.GH_REPO || "").trim();
  if (!owner || !repo) return Promise.resolve(null);

  const now = Date.now();
  if (githubReleaseCache.data && githubReleaseCache.expiresAt > now) {
    return Promise.resolve(githubReleaseCache.data);
  }
  if (githubReleaseCache.pending) {
    return githubReleaseCache.pending;
  }

  const token = String(process.env.GH_TOKEN || "").trim();
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  githubReleaseCache.pending = new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "unitech-erp-server",
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        githubReleaseCache.pending = null;
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }

        try {
          const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          githubReleaseCache.data = json;
          githubReleaseCache.expiresAt = Date.now() + (5 * 60 * 1000);
          resolve(json);
        } catch (_) {
          resolve(null);
        }
      });
    });

    req.on("error", () => {
      githubReleaseCache.pending = null;
      resolve(null);
    });
  });

  return githubReleaseCache.pending;
}

function pickAssetDownloadUrl(release, explicitAssetName, extensionRegex) {
  if (!release || !Array.isArray(release.assets)) return "";
  const assets = release.assets || [];
  const exactName = String(explicitAssetName || "").trim();
  if (exactName) {
    const exact = assets.find((asset) => String(asset && asset.name || "").toLowerCase() === exactName.toLowerCase());
    if (exact && exact.browser_download_url) return exact.browser_download_url;
  }

  const candidate = assets.find((asset) => {
    const name = String(asset && asset.name || "");
    if (!name) return false;
    if (/\.blockmap$/i.test(name)) return false;
    return extensionRegex.test(name);
  });

  return candidate && candidate.browser_download_url ? candidate.browser_download_url : "";
}

async function getWindowsInstallerUrl() {
  const explicitUrl = String(process.env.DESKTOP_WINDOWS_INSTALLER_URL || "").trim();
  if (explicitUrl) return explicitUrl;

  const useLatest = shouldUseLatestGithubRelease();
  const releaseTag = String(process.env.GH_RELEASE_TAG || "").trim();
  const artifactName = String(process.env.GH_WINDOWS_ARTIFACT || "").trim();
  if (useLatest || !releaseTag) {
    const release = await fetchGithubLatestRelease();
    const latestUrl = pickAssetDownloadUrl(release, artifactName, /\.exe$/i);
    if (latestUrl) return latestUrl;
  }

  const fallbackArtifactName = artifactName || `Unitech-ERP-${appPackage.version}.exe`;
  return githubReleaseDownloadUrl(fallbackArtifactName);
}

async function getMacInstallerUrl() {
  const explicitUrl = String(process.env.DESKTOP_MAC_INSTALLER_URL || "").trim();
  if (explicitUrl) return explicitUrl;

  const useLatest = shouldUseLatestGithubRelease();
  const releaseTag = String(process.env.GH_RELEASE_TAG || "").trim();
  const artifactName = String(process.env.GH_MAC_ARTIFACT || "").trim();
  if (useLatest || !releaseTag) {
    const release = await fetchGithubLatestRelease();
    const latestUrl = pickAssetDownloadUrl(release, artifactName, /\.dmg$/i);
    if (latestUrl) return latestUrl;
  }

  const fallbackArtifactName = artifactName || `Unitech-ERP-${appPackage.version}.dmg`;
  return githubReleaseDownloadUrl(fallbackArtifactName);
}

exports.downloadDesktopInstallerWindows = async (req, res) => {
  const localResult = downloadInstallerByPattern(
    req,
    res,
    /\.exe$/i
  );
  if (res.headersSent) return localResult;

  const windowsUrl = await getWindowsInstallerUrl();
  if (windowsUrl) return res.redirect(windowsUrl);
  return res.status(404).send("Installateur Windows (.exe) indisponible pour le moment.");
};

exports.downloadDesktopInstallerMac = async (req, res) => {
  const localResult = downloadInstallerByPattern(
    req,
    res,
    /\.dmg$/i
  );
  if (res.headersSent) return localResult;

  const macUrl = await getMacInstallerUrl();
  if (macUrl) return res.redirect(macUrl);
  return res.status(404).send("Installateur macOS (.dmg) indisponible pour le moment.");
};

exports.downloadDesktopWindowsLatestMetadata = (req, res) => {
  const latestYmlPath = path.resolve(__dirname, "..", "dist", "latest.yml");
  if (!fs.existsSync(latestYmlPath)) {
    return res.status(404).send("Fichier latest.yml indisponible pour le moment.");
  }

  return res.type("application/x-yaml").sendFile(latestYmlPath);
};

exports.downloadDesktopWindowsUpdateArtifact = (req, res) => {
  const artifactName = String(req.params.artifactName || "").trim();
  if (!artifactName || /latest\.ya?ml/i.test(artifactName)) {
    return res.status(404).send("Artifact de mise a jour introuvable.");
  }

  const artifact = resolveArtifactByName({
    directories: ["logiciel", "dist"],
    artifactName
  });

  if (!artifact) {
    return res.status(404).send("Artifact de mise a jour introuvable.");
  }

  return res.download(artifact.fullPath, artifact.name);
};
