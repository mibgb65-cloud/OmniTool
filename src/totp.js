const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SUPPORTED_ALGORITHMS = new Set(["SHA-1", "SHA-256", "SHA-512"]);

export function normalizeBase32(value) {
  const normalized = value.replace(/[\s-]/g, "").replace(/=+$/g, "").toUpperCase();

  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("INVALID_SECRET");
  }

  return normalized;
}

export function decodeBase32(value) {
  const normalized = normalizeBase32(value);
  let bits = "";
  const bytes = [];

  for (const character of normalized) {
    bits += BASE32_ALPHABET.indexOf(character).toString(2).padStart(5, "0");
  }

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return new Uint8Array(bytes);
}

function normalizeAlgorithm(value = "SHA1") {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const algorithm = compact.replace(/^SHA(\d+)$/, "SHA-$1");

  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new Error("INVALID_ALGORITHM");
  }

  return algorithm;
}

function encodeCounter(counter) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;

  view.setUint32(0, high);
  view.setUint32(4, low);
  return buffer;
}

export async function generateHotp(secret, counter, options = {}) {
  const digits = Number(options.digits ?? 6);
  const algorithm = normalizeAlgorithm(options.algorithm);

  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error("INVALID_COUNTER");
  }

  if (![6, 8].includes(digits)) {
    throw new Error("INVALID_DIGITS");
  }

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    decodeBase32(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", key, encodeCounter(counter)),
  );
  const offset = signature.at(-1) & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export async function generateTotp(secret, options = {}) {
  const period = Number(options.period ?? 30);
  const timestamp = Number(options.timestamp ?? Date.now());

  if (!Number.isFinite(timestamp) || !Number.isInteger(period) || period <= 0) {
    throw new Error("INVALID_PERIOD");
  }

  return generateHotp(secret, Math.floor(timestamp / 1000 / period), options);
}

export function getRemainingSeconds(period = 30, timestamp = Date.now()) {
  const elapsed = Math.floor(timestamp / 1000) % period;
  return period - elapsed;
}

export function parseOtpAuthUri(value) {
  const url = new URL(value);

  if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp") {
    throw new Error("INVALID_URI");
  }

  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const separatorIndex = label.indexOf(":");
  const labelIssuer = separatorIndex >= 0 ? label.slice(0, separatorIndex).trim() : "";
  const labelAccount = separatorIndex >= 0 ? label.slice(separatorIndex + 1).trim() : label.trim();
  const issuer = (url.searchParams.get("issuer") || labelIssuer).trim();
  const account = labelAccount || url.searchParams.get("account")?.trim() || "";
  const secret = normalizeBase32(url.searchParams.get("secret") || "");
  const digits = Number(url.searchParams.get("digits") || 6);
  const period = Number(url.searchParams.get("period") || 30);
  const algorithm = normalizeAlgorithm(url.searchParams.get("algorithm") || "SHA1");

  if (!issuer || !account || ![6, 8].includes(digits) || !Number.isInteger(period) || period <= 0) {
    throw new Error("INVALID_URI");
  }

  return { issuer, account, secret, digits, period, algorithm };
}
