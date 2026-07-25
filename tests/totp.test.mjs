import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeBase32,
  generateHotp,
  generateTotp,
  getRemainingSeconds,
  normalizeBase32,
  parseOtpAuthUri,
  parseSecretPath,
} from "../src/totp.js";

test("normalizes and decodes Base32 secrets", () => {
  assert.equal(normalizeBase32("jbsw y3dp-ehpk3pxp=="), "JBSWY3DPEHPK3PXP");
  assert.equal(new TextDecoder().decode(decodeBase32("JBSWY3DP")), "Hello");
  assert.throws(() => normalizeBase32("not-valid-01"), /INVALID_SECRET/);
});

test("parses a Base32 secret from the 2FA route", () => {
  const secret = "MNFY4TJDXQKT7T5N67XX7D7RO7PIOAPP";

  assert.equal(parseSecretPath(`/2fa/${secret}`), secret);
  assert.equal(parseSecretPath(`/2FA/${secret.toLowerCase()}/`), secret);
  assert.equal(parseSecretPath("/2fa/not-valid-01"), null);
  assert.equal(parseSecretPath("/2fa/secret/extra"), null);
  assert.equal(parseSecretPath("/2fa"), null);
});

test("matches the RFC 4226 HOTP vectors", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const expected = [
    "755224",
    "287082",
    "359152",
    "969429",
    "338314",
    "254676",
    "287922",
    "162583",
    "399871",
    "520489",
  ];

  for (const [counter, code] of expected.entries()) {
    assert.equal(await generateHotp(secret, counter), code);
  }
});

test("matches the RFC 6238 SHA-1 TOTP vectors", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [seconds, code] of vectors) {
    assert.equal(
      await generateTotp(secret, { timestamp: seconds * 1000, digits: 8, algorithm: "SHA1" }),
      code,
    );
  }
});

test("matches the RFC 6238 SHA-256 and SHA-512 vectors", async () => {
  const vectors = [
    {
      algorithm: "SHA256",
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA",
      code: "46119246",
    },
    {
      algorithm: "SHA512",
      secret:
        "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
      code: "90693936",
    },
  ];

  for (const vector of vectors) {
    assert.equal(
      await generateTotp(vector.secret, {
        timestamp: 59_000,
        digits: 8,
        algorithm: vector.algorithm,
      }),
      vector.code,
    );
  }
});

test("parses a complete otpauth URI", () => {
  assert.deepEqual(
    parseOtpAuthUri(
      "otpauth://totp/GitHub:name%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
    ),
    {
      issuer: "GitHub",
      account: "name@example.com",
      secret: "JBSWY3DPEHPK3PXP",
      digits: 6,
      period: 30,
      algorithm: "SHA-1",
    },
  );
});

test("calculates the remaining window", () => {
  assert.equal(getRemainingSeconds(30, 0), 30);
  assert.equal(getRemainingSeconds(30, 29_000), 1);
  assert.equal(getRemainingSeconds(30, 30_000), 30);
});
