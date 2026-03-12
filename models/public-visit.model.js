const { all, get, run } = require("../utils/dbAsync");
const usePostgres = String(process.env.DB_CLIENT || "").trim().toLowerCase() === "postgres";
const { randomUUID } = require("crypto");

const PublicVisitModel = {
  create: async ({
    pagePath,
    visitorToken,
    ipAddress,
    ipAnonymized,
    countryCode,
    countryName,
    region,
    city,
    latitude,
    longitude,
    accuracyM,
    source,
    userAgent,
    referer,
    timezone,
    locale
  }) => {
    return run(
      `
      INSERT INTO public_visits (
        school_id, page_path, visitor_token, ip_address, ip_anonymized,
        country_code, country_name, region, city,
        latitude, longitude, accuracy_m, source,
        user_agent, referer, timezone, locale, uuid, updated_at, version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
      `,
      [
        0,
        pagePath || null,
        visitorToken || null,
        ipAddress || null,
        ipAnonymized || null,
        countryCode || null,
        countryName || null,
        region || null,
        city || null,
        latitude === null || latitude === undefined ? null : Number(latitude),
        longitude === null || longitude === undefined ? null : Number(longitude),
        accuracyM === null || accuracyM === undefined ? null : Number(accuracyM),
        source || "server",
        userAgent || null,
        referer || null,
        timezone || null,
        locale || null,
        randomUUID().replace(/-/g, "")
      ]
    );
  },

  getLandingStats: async () => {
    const todayExpr = usePostgres
      ? "date(created_at) = CURRENT_DATE"
      : "date(created_at) = date('now')";
    const row = await get(
      `
      SELECT
        COUNT(*) AS total_visits,
        COUNT(DISTINCT COALESCE(NULLIF(visitor_token, ''), NULLIF(ip_anonymized, ''), 'anon-' || id)) AS unique_visitors,
        SUM(CASE WHEN ${todayExpr} THEN 1 ELSE 0 END) AS visits_today
      FROM public_visits
      WHERE page_path IN ('/vitrine', '/entreprise')
      `
    );
    return {
      totalVisits: Number((row && row.total_visits) || 0),
      uniqueVisitors: Number((row && row.unique_visitors) || 0),
      visitsToday: Number((row && row.visits_today) || 0)
    };
  },

  getAdminStats: async () => {
    const todayExpr = usePostgres
      ? "date(created_at) = CURRENT_DATE"
      : "date(created_at) = date('now')";
    const last7DaysExpr = usePostgres
      ? "created_at >= (CURRENT_TIMESTAMP - INTERVAL '7 day')"
      : "date(created_at) >= date('now', '-7 day')";

    const [global, byPage, locations] = await Promise.all([
      get(
        `
        SELECT
          COUNT(*) AS total_visits,
          COUNT(DISTINCT COALESCE(NULLIF(visitor_token, ''), NULLIF(ip_anonymized, ''), 'anon-' || id)) AS unique_visitors,
          SUM(CASE WHEN ${todayExpr} THEN 1 ELSE 0 END) AS visits_today,
          SUM(CASE WHEN ${last7DaysExpr} THEN 1 ELSE 0 END) AS visits_7d
        FROM public_visits
        `
      ),
      all(
        `
        SELECT page_path, COUNT(*) AS visits
        FROM public_visits
        GROUP BY page_path
        ORDER BY visits DESC, page_path ASC
        `
      ),
      all(
        `
        SELECT *
        FROM (
          SELECT
            COALESCE(country_code, '-') AS country_code,
            COALESCE(country_name, '-') AS country_name,
            COALESCE(region, '-') AS region,
            COALESCE(city, '-') AS city,
            latitude,
            longitude,
            COUNT(*) AS visits,
            MAX(created_at) AS last_visit_at
          FROM public_visits
          WHERE page_path IN ('/vitrine', '/entreprise')
          GROUP BY country_code, country_name, region, city, latitude, longitude
        ) agg
        ORDER BY agg.last_visit_at DESC
        LIMIT 200
        `
      )
    ]);

    return {
      totalVisits: Number((global && global.total_visits) || 0),
      uniqueVisitors: Number((global && global.unique_visitors) || 0),
      visitsToday: Number((global && global.visits_today) || 0),
      visits7d: Number((global && global.visits_7d) || 0),
      byPage: (byPage || []).map((row) => ({
        pagePath: row.page_path || "-",
        visits: Number(row.visits || 0)
      })),
      locations: (locations || []).map((row) => ({
        countryCode: row.country_code || "-",
        countryName: row.country_name || "-",
        region: row.region || "-",
        city: row.city || "-",
        latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
        longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
        visits: Number(row.visits || 0),
        lastVisitAt: row.last_visit_at || null
      }))
    };
  }
};

module.exports = PublicVisitModel;
