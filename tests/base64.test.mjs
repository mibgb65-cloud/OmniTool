import test from "node:test";
import assert from "node:assert/strict";
import { decodeBase64, encodeBase64 } from "../src/base64.js";

test("matches the RFC 4648 vectors", () => {
  const vectors = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];

  for (const [text, encoded] of vectors) {
    assert.equal(encodeBase64(text), encoded);
    assert.equal(decodeBase64(encoded), text);
  }
});

test("round-trips UTF-8 text", () => {
  const values = ["你好，世界", "🔐 coffee", "日本語のテキスト", "aéèê"];

  for (const value of values) {
    assert.equal(decodeBase64(encodeBase64(value)), value);
  }
});

test("decodes unpadded base64", () => {
  assert.equal(decodeBase64("Zm8"), "fo");
  assert.equal(decodeBase64("Zm9v"), "foo");
  assert.equal(decodeBase64("Zm9vYg"), "foob");
});

test("ignores whitespace and repeated padding", () => {
  assert.equal(decodeBase64("Zm9v\nZm9v"), "foofoo");
  assert.equal(decodeBase64("Z m 9 v"), "foo");
  assert.equal(decodeBase64("Zm9vYg===="), "foob");
});

test("rejects invalid input", () => {
  assert.throws(() => decodeBase64("!!!!"));
  assert.throws(() => decodeBase64("A"));
  assert.throws(() => decodeBase64("Zm9v!!"));
});
