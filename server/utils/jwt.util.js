const crypto = require("crypto");

function base64urlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function sign(payload, options = {}) {
  const secret = String(options.secret || process.env.JWT_SECRET || process.env.SESSION_SECRET || "change_me");
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number(options.ttlSeconds || 60 * 60 * 8);
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const headerPart = base64urlEncode(JSON.stringify(header));
  const payloadPart = base64urlEncode(JSON.stringify(body));
  const data = `${headerPart}.${payloadPart}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${signature}`;
}

function verify(token, options = {}) {
  const secret = String(options.secret || process.env.JWT_SECRET || process.env.SESSION_SECRET || "change_me");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [headerPart, payloadPart, signature] = parts;
  const data = `${headerPart}.${payloadPart}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64urlDecode(payloadPart));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now >= Number(payload.exp)) {
    throw new Error("Token expired");
  }

  return payload;
}

module.exports = { sign, verify };
