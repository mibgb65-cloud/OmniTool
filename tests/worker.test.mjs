import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

test("serves assets with the required security headers", async () => {
  const environment = {
    ASSETS: {
      fetch: async () =>
        new Response("<h1>OmniTool</h1>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    },
  };

  const response = await worker.fetch(new Request("https://omnitool.example/"), environment);

  assert.equal(await response.text(), "<h1>OmniTool</h1>");
  assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'none'/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
});

