const PublicVisitModel = require("../../models/public-visit.model");

function cleanText(value, maxLen = 255) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizePagePath(rawPath) {
  const p = cleanText(rawPath, 120).toLowerCase();
  if (p === "/" || p === "/vitrine") return "/vitrine";
  if (p === "/entreprise") return "/entreprise";
  return null;
}

function parseIpFromRequest(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const candidate = xff || String(req.ip || req.socket?.remoteAddress || "").trim();
  return candidate.replace(/^::ffff:/, "");
}

function anonymizeIp(ip) {
  const value = String(ip || "").trim();
  if (!value) return null;
  if (value.includes(".")) {
    const parts = value.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    return value;
  }
  if (value.includes(":")) {
    const parts = value.split(":").filter(Boolean);
    if (!parts.length) return value;
    return `${parts.slice(0, 4).join(":")}::`;
  }
  return value;
}

function parseNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function extractGeoHeaders(req) {
  const h = req.headers || {};
  const countryCode = cleanText(
    h["x-vercel-ip-country"] || h["cf-ipcountry"] || h["x-country-code"] || "",
    8
  ).toUpperCase();
  const countryName = cleanText(h["x-vercel-ip-country-name"] || h["x-country-name"] || "", 80);
  const region = cleanText(h["x-vercel-ip-country-region"] || h["x-region"] || "", 80);
  const city = cleanText(h["x-vercel-ip-city"] || h["x-city"] || "", 120);
  return {
    countryCode: countryCode || null,
    countryName: countryName || null,
    region: region || null,
    city: city || null
  };
}

const VisitorTrackingService = {
  trackPublicVisit: async ({ req, body }) => {
    const pagePath = normalizePagePath(body && body.page_path ? body.page_path : req.path);
    if (!pagePath) return { tracked: false };

    const ipAddress = parseIpFromRequest(req);
    const ipAnonymized = anonymizeIp(ipAddress);
    const headerGeo = extractGeoHeaders(req);

    const geo = body && typeof body === "object" ? body.geo || {} : {};
    const latitude = parseNumber(geo.lat, -90, 90);
    const longitude = parseNumber(geo.lng, -180, 180);
    const accuracyM = parseNumber(geo.accuracy, 0, 1_000_000);

    await PublicVisitModel.create({
      pagePath,
      visitorToken: cleanText(body && body.visitor_token, 96) || null,
      ipAddress: cleanText(ipAddress, 80) || null,
      ipAnonymized: cleanText(ipAnonymized, 80) || null,
      countryCode: headerGeo.countryCode,
      countryName: headerGeo.countryName,
      region: headerGeo.region,
      city: headerGeo.city,
      latitude,
      longitude,
      accuracyM,
      source: latitude !== null && longitude !== null ? "browser_geo" : "header_geo",
      userAgent: cleanText(req.headers["user-agent"], 500) || null,
      referer: cleanText(req.headers.referer, 500) || null,
      timezone: cleanText(body && body.timezone, 120) || null,
      locale: cleanText(body && body.locale, 80) || null
    });

    return { tracked: true };
  },

  getLandingStats: async () => {
    return PublicVisitModel.getLandingStats();
  },

  getAdminAnalytics: async () => {
    return PublicVisitModel.getAdminStats();
  }
};

module.exports = VisitorTrackingService;
