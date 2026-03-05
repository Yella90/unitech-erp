const fs = require("fs");
const path = require("path");

function readCsvRows(fileContent) {
  const lines = String(fileContent || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const out = {};
    headers.forEach((key, idx) => {
      out[key] = String(values[idx] || "").trim();
    });
    return out;
  });
}

function parseWorkbookRows(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);

  if (ext === ".csv") {
    return readCsvRows(fileBuffer.toString("utf8"));
  }

  let XLSX = null;
  try {
    XLSX = require("xlsx");
  } catch (err) {
    throw new Error("Package xlsx manquant. Installez-le pour importer les fichiers Excel.");
  }

  const wb = XLSX.read(fileBuffer, { type: "buffer" });
  const firstSheet = wb.SheetNames && wb.SheetNames.length ? wb.SheetNames[0] : null;
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function normalizeOcrText(raw) {
  return String(raw || "")
    .replace(/\u00A0/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[’`]/g, "'")
    .replace(/[|]/g, ";")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeOcrNumberToken(raw) {
  const value = String(raw || "")
    .trim()
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(",", ".")
    .replace(/[^0-9.]/g, "");
  return value;
}

function normalizeOcrDateToken(raw) {
  const value = String(raw || "")
    .trim()
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/[^\d/.-]/g, "");
  return value;
}

function likelyHeaderLine(line) {
  const v = String(line || "").toLowerCase();
  return (
    v.includes("matricule") ||
    v.includes("prenom") ||
    v.includes("prenom") ||
    v.includes("eleve") ||
    v.includes("nom") && (v.includes("classe") || v.includes("note"))
  );
}

function parseSex(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "";
  if (["m", "masculin", "male", "homme", "garcon"].includes(v)) return "M";
  if (["f", "feminin", "female", "femme", "fille"].includes(v)) return "F";
  return "";
}

function normalizeClassToken(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[Oo]/g, "0");
}

function splitFlexible(line) {
  const bySep = String(line || "").split(/[;,\t]+/).map((p) => p.trim()).filter(Boolean);
  if (bySep.length >= 2) return bySep;
  return String(line || "").split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
}

function splitNotesFlexible(line) {
  const bySep = String(line || "").split(/[;\t|]+/).map((p) => p.trim()).filter(Boolean);
  if (bySep.length >= 2) return bySep;
  return String(line || "").split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
}

function parseDateFromToken(raw) {
  const value = normalizeOcrDateToken(raw);
  if (!value) return "";

  let m = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;

  m = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;

  return "";
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function extractTextFromImageOcr(filePath) {
  let Tesseract = null;
  try {
    Tesseract = require("tesseract.js");
  } catch (err) {
    throw new Error("Package tesseract.js manquant. Installez-le pour l'import OCR.");
  }

  const lang = String(process.env.OCR_LANG || "fra+eng").trim() || "fra+eng";
  const result = await Tesseract.recognize(filePath, lang, {
    tessedit_pageseg_mode: String(process.env.OCR_PSM || "6"),
    preserve_interword_spaces: "1"
  });

  const text = result && result.data ? String(result.data.text || "") : "";
  return normalizeOcrText(text);
}

function parseStudentsFromOcrText(rawText) {
  const lines = normalizeOcrText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  lines.forEach((line) => {
    if (likelyHeaderLine(line)) return;
    const parts = splitFlexible(line);

    if (parts.length >= 5) {
      const sex = parseSex(parts[2]) || parseSex(parts[3]);
      const date = parseDateFromToken(parts[3]) || parseDateFromToken(parts[2]) || parseDateFromToken(parts[4]);
      const classe = normalizeClassToken(parts[4] || parts[parts.length - 1]);
      if (!parts[0] || !parts[1] || !classe) return;
      rows.push({
        Nom: parts[0],
        Prenom: parts[1],
        Sexe: sex,
        Date_naissance: date,
        Classe: classe
      });
      return;
    }

    // Fallback ligne libre: on tente d'extraire nom/prenom/sexe/date/classe.
    const dateMatch = line.match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/);
    const sexMatch = line.match(/\b(M|F|Masculin|Feminin|Male|Female)\b/i);
    const classMatch = line.match(/\b(jardin|terminale|(?:[1-9]|1[0-2])(?:ere|eme)(?:\s*[A-Za-z])?)\b/i);

    if (!classMatch) return;
    const date = dateMatch ? parseDateFromToken(dateMatch[1]) : "";
    const sexe = sexMatch ? parseSex(sexMatch[1]) : "";

    let base = line;
    if (dateMatch) base = base.replace(dateMatch[0], " ");
    if (sexMatch) {
      const sexPattern = new RegExp(`\\b${escapeRegex(sexMatch[0])}\\b`, "i");
      base = base.replace(sexPattern, " ");
    }
    base = base.replace(classMatch[0], " ").replace(/\s+/g, " ").trim();

    const nameParts = base.split(" ").filter(Boolean);
    if (nameParts.length < 2) return;

    rows.push({
      Nom: nameParts[0],
      Prenom: nameParts.slice(1).join(" "),
      Sexe: sexe,
      Date_naissance: date,
      Classe: normalizeClassToken(classMatch[1])
    });
  });
  return rows;
}

function parseNotesFromOcrText(rawText) {
  const lines = normalizeOcrText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  lines.forEach((line) => {
    if (likelyHeaderLine(line)) return;
    const parts = splitNotesFlexible(line);

    if (parts.length >= 2) {
      const maybeNote = Number(normalizeOcrNumberToken(parts[parts.length - 1]));
      if (Number.isFinite(maybeNote) && maybeNote >= 0 && maybeNote <= 20) {
        const matricule = String(parts[0] || "").replace(/[^A-Za-z0-9/_-]/g, "").trim();
        if (!matricule) return;
        rows.push({
          Matricule: matricule,
          Note: String(maybeNote)
        });
        return;
      }
    }

    // Fallback: extrait un matricule + une note numerique.
    const noteMatch = line.match(/(\d{1,2}(?:[.,]\d{1,2})?)/g);
    if (!noteMatch || !noteMatch.length) return;
    const candidate = Number(normalizeOcrNumberToken(noteMatch[noteMatch.length - 1]));
    if (!Number.isFinite(candidate) || candidate < 0 || candidate > 20) return;

    const matriculeMatch = line.match(/\b[A-Za-z0-9][A-Za-z0-9/_-]{1,}\b/);
    if (!matriculeMatch) return;
    rows.push({
      Matricule: matriculeMatch[0],
      Note: String(candidate)
    });
  });
  return rows;
}

module.exports = {
  parseWorkbookRows,
  extractTextFromImageOcr,
  parseStudentsFromOcrText,
  parseNotesFromOcrText
};
