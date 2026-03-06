const fs = require("fs");
const path = require("path");

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

function cleanFileName(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseContentDisposition(dispositionLine) {
  const out = { name: "", filename: "" };
  const nameMatch = dispositionLine.match(/name="([^"]+)"/i);
  const fileMatch = dispositionLine.match(/filename="([^"]*)"/i);
  out.name = nameMatch ? nameMatch[1] : "";
  out.filename = fileMatch ? fileMatch[1] : "";
  return out;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function saveUploadFile({ fieldName, fileName, mimeType, fileBuffer }) {
  if (!ALLOWED_MIME.has(String(mimeType || "").toLowerCase())) {
    throw new Error("Format image non supporte (jpg, png, webp uniquement)");
  }

  const extFromName = path.extname(fileName || "").toLowerCase();
  const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(extFromName) ? extFromName : ".jpg";
  const uniqueName = `${fieldName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const safeName = cleanFileName(uniqueName);
  const relativePath = path.posix.join("/uploads/eleves", safeName);
  const diskPath = path.join(process.cwd(), "public", "uploads", "eleves", safeName);

  ensureDir(path.dirname(diskPath));
  fs.writeFileSync(diskPath, fileBuffer);

  return relativePath;
}

function parseMultipartBody(reqBuffer, boundary) {
  const raw = reqBuffer.toString("binary");
  const delimiter = `--${boundary}`;
  const segments = raw.split(delimiter);
  const parts = [];

  for (let i = 1; i < segments.length; i += 1) {
    let segment = segments[i];
    if (!segment || segment === "--" || segment === "--\r\n") continue;
    if (segment.startsWith("\r\n")) segment = segment.slice(2);
    if (segment.endsWith("\r\n")) segment = segment.slice(0, -2);
    if (segment.endsWith("--")) segment = segment.slice(0, -2);
    if (!segment.trim()) continue;

    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;

    const rawHeaders = segment.slice(0, headerEnd);
    const rawBody = segment.slice(headerEnd + 4);
    const lines = rawHeaders.split("\r\n");
    const dispositionLine = lines.find((line) => /^content-disposition:/i.test(line)) || "";
    const typeLine = lines.find((line) => /^content-type:/i.test(line)) || "";
    const disposition = parseContentDisposition(dispositionLine);
    const contentType = typeLine.split(":")[1] ? typeLine.split(":")[1].trim() : "";
    const bodyBuffer = Buffer.from(rawBody, "binary");

    parts.push({
      fieldName: disposition.name,
      fileName: disposition.filename,
      contentType,
      bodyBuffer
    });
  }

  return parts;
}

function multipartUpload(req, res, next) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.startsWith("multipart/form-data")) {
    return next();
  }

  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i);
  if (!boundaryMatch) {
    req.flash("error", "Formulaire invalide: boundary manquant");
    return res.redirect(req.get("referer") || "/eleves/liste");
  }

  const boundary = boundaryMatch[1];
  const chunks = [];
  let total = 0;

  req.on("data", (chunk) => {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      req.destroy(new Error("Upload trop volumineux (max 8 MB)"));
      return;
    }
    chunks.push(chunk);
  });

  req.on("error", (err) => {
    req.flash("error", err.message || "Erreur upload");
    return res.redirect(req.get("referer") || "/eleves/liste");
  });

  req.on("end", () => {
    try {
      const buffer = Buffer.concat(chunks);
      const parts = parseMultipartBody(buffer, boundary);
      req.body = req.body || {};
      req.files = req.files || {};

      parts.forEach((part) => {
        if (!part.fieldName) return;
        if (part.fileName) {
          if (!part.bodyBuffer || part.bodyBuffer.length === 0) return;
          const uploadedPath = saveUploadFile({
            fieldName: part.fieldName,
            fileName: part.fileName,
            mimeType: part.contentType,
            fileBuffer: part.bodyBuffer
          });
          req.files[part.fieldName] = {
            path: uploadedPath,
            originalname: part.fileName,
            mimetype: part.contentType,
            size: part.bodyBuffer.length
          };
          return;
        }

        req.body[part.fieldName] = part.bodyBuffer.toString("utf8");
      });

      return next();
    } catch (err) {
      req.flash("error", err.message || "Erreur traitement upload");
      return res.redirect(req.get("referer") || "/eleves/liste");
    }
  });
}

module.exports = {
  multipartUpload
};
