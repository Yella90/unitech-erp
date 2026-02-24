require("dotenv").config();
require("./config/db");

const express = require("express");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");

const { injectTenantContext } = require("./middlewares/tenant.middleware");
const { notFound, errorHandler } = require("./middlewares/error.middleware");
const AuthService = require("./services/auth/auth.service");

const app = express();

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

app.use(notFound);
app.use(errorHandler);

AuthService.ensureSuperAdmin().catch((err) => {
  console.error("Unable to seed superadmin:", err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
