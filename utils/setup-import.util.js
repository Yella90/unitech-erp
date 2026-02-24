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

async function extractTextFromImageOcr(filePath) {
  let Tesseract = null;
  try {
    Tesseract = require("tesseract.js");
  } catch (err) {
    throw new Error("Package tesseract.js manquant. Installez-le pour l'import OCR.");
  }

  const result = await Tesseract.recognize(filePath, "fra+eng");
  const text = result && result.data ? String(result.data.text || "") : "";
  return text;
}

function parseStudentsFromOcrText(rawText) {
  const lines = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  lines.forEach((line) => {
    // format attendu simple: Nom;Prenom;Sexe;Date_naissance;Classe
    const sep = line.includes(";") ? ";" : (line.includes(",") ? "," : null);
    if (!sep) return;
    const parts = line.split(sep).map((p) => p.trim());
    if (parts.length < 5) return;
    rows.push({
      Nom: parts[0],
      Prenom: parts[1],
      Sexe: parts[2],
      Date_naissance: parts[3],
      Classe: parts[4]
    });
  });
  return rows;
}

function parseNotesFromOcrText(rawText) {
  const lines = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  lines.forEach((line) => {
    // format simple: Matricule;Note
    const sep = line.includes(";") ? ";" : (line.includes(",") ? "," : null);
    if (!sep) return;
    const parts = line.split(sep).map((p) => p.trim());
    if (parts.length < 2) return;
    rows.push({
      Matricule: parts[0],
      Note: parts[1]
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
