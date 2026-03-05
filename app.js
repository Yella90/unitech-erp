require("dotenv").config();
require("./config/db");

const express = require("express");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");

const { injectTenantContext } = require("./middlewares/tenant.middleware");
const { notFound, errorHandler } = require("./middlewares/error.middleware");
const AuthService = require("./services/auth/auth.service");
const RealtimeSyncService = require("./services/sync/realtime-sync.service");
const { mountServerApi } = require("./server");

const app = express();
const DISPLAY_TIMEZONE = process.env.DISPLAY_TIMEZONE || "Africa/Bamako";
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: DISPLAY_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: DISPLAY_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function parseAnyDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const ms = n > 10_000_000_000 ? n : n * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = parseAnyDate(value);
  return d ? dateFormatter.format(d) : "-";
}

function formatDateTime(value) {
  const d = parseAnyDate(value);
  return d ? dateTimeFormatter.format(d) : "-";
}

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0 }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_me_in_prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use(flash());
app.use((req, res, next) => {
  res.locals.error = req.flash("error")[0] || null;
  res.locals.warning = req.flash("warning")[0] || null;
  res.locals.success = req.flash("success")[0] || null;
  res.locals.requestPath = req.originalUrl || "/";
  res.locals.realtimeSyncStatus = RealtimeSyncService.getStatusSnapshot();
  res.locals.fmtDate = formatDate;
  res.locals.fmtDateTime = formatDateTime;
  next();
});

app.use(injectTenantContext);

app.use("/", require("./routes/home.routes"));
app.use("/auth", require("./routes/auth/auth.routes"));
app.use("/classes", require("./routes/classes.routes"));
app.use("/eleves", require("./routes/eleves.routes"));
app.use("/connexion", require("./routes/connexion.routes"));
app.use("/superadmin", require("./routes/superadmin/superadmin.routes"));
app.use("/admin", require("./routes/admin.routes"));
app.use("/finance", require("./routes/finance.routes"));
app.use("/modules", require("./routes/modules.routes"));
app.use("/setup", require("./routes/setup.routes"));
app.use("/", require("./routes/system/system.routes"));
mountServerApi(app);

app.use(notFound);
app.use(errorHandler);

AuthService.ensureSuperAdmin().catch((err) => {
  console.error("Unable to seed superadmin:", err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
