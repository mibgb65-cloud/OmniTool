import test from "node:test";
import assert from "node:assert/strict";
import worker, { StatsCounter } from "../src/worker.js";

function createEnvironment() {
  const stats = { visits: 4, uses: 2 };
  const stub = {
    async fetch(input) {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname;

      if (path === "/increment/visit") {
        stats.visits += 1;
      }

      if (path === "/increment/use") {
        stats.uses += 1;
      }

      return Response.json(stats);
    },
  };

  return {
    ASSETS: {
      fetch: async () =>
        new Response("<h1>OmniTool</h1>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    },
    STATS: {
      get: () => stub,
      idFromName: (name) => name,
    },
  };
}

test("serves assets with the required security headers", async () => {
  const environment = createEnvironment();

  const response = await worker.fetch(new Request("https://omnitool.example/"), environment);

  assert.equal(await response.text(), "<h1>OmniTool</h1>");
  assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self'/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
});

test("routes visit and use increments to the site counter", async () => {
  const environment = createEnvironment();

  const visitResponse = await worker.fetch(
    new Request("https://omnitool.example/api/stats/visit", { method: "POST" }),
    environment,
  );
  const useResponse = await worker.fetch(
    new Request("https://omnitool.example/api/stats/use", { method: "POST" }),
    environment,
  );

  assert.deepEqual(await visitResponse.json(), { visits: 5, uses: 2 });
  assert.deepEqual(await useResponse.json(), { visits: 5, uses: 3 });
});

test("rejects unsupported methods on the stats API", async () => {
  const response = await worker.fetch(
    new Request("https://omnitool.example/api/stats/visit"),
    createEnvironment(),
  );

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "METHOD_NOT_ALLOWED" });
});

test("stores aggregate counts in the durable object", async () => {
  const stats = { visits: 0, uses: 0 };
  const state = {
    storage: {
      sql: {
        exec(statement) {
          if (statement.startsWith("UPDATE stats SET visits")) {
            stats.visits += 1;
          }

          if (statement.startsWith("UPDATE stats SET uses")) {
            stats.uses += 1;
          }

          return {
            toArray: () => [{ ...stats }],
          };
        },
      },
    },
  };
  const counter = new StatsCounter(state);

  await counter.fetch(
    new Request("https://stats.internal/increment/visit", { method: "POST" }),
  );
  const useResponse = await counter.fetch(
    new Request("https://stats.internal/increment/use", { method: "POST" }),
  );

  assert.deepEqual(await useResponse.json(), { visits: 1, uses: 1 });
});
