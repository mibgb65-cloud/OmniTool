const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const STAT_FIELDS = {
  use: "uses",
  visit: "visits",
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getStatsStub(environment) {
  const id = environment.STATS.idFromName("global");
  return environment.STATS.get(id);
}

async function handleStatsRequest(request, environment, pathname) {
  const stub = getStatsStub(environment);

  if (pathname === "/api/stats" && request.method === "GET") {
    return stub.fetch("https://stats.internal/");
  }

  const match = pathname.match(/^\/api\/stats\/(visit|use)$/);

  if (match && request.method === "POST") {
    return stub.fetch(`https://stats.internal/increment/${match[1]}`, {
      method: "POST",
    });
  }

  if (pathname === "/api/stats" || match) {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  return jsonResponse({ error: "NOT_FOUND" }, 404);
}

export class StatsCounter {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY CHECK (id = 1), visits INTEGER NOT NULL, uses INTEGER NOT NULL)",
    );
    this.sql.exec("INSERT OR IGNORE INTO stats (id, visits, uses) VALUES (1, 0, 0)");
  }

  fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/increment\/(visit|use)$/);

    if (match && request.method === "POST") {
      const field = STAT_FIELDS[match[1]];
      const result = this.sql
        .exec(
          `UPDATE stats SET ${field} = ${field} + 1 WHERE id = 1 RETURNING visits, uses`,
        )
        .toArray()[0];
      return jsonResponse(result);
    }

    if (url.pathname === "/" && request.method === "GET") {
      const result = this.sql.exec("SELECT visits, uses FROM stats WHERE id = 1").toArray()[0];
      return jsonResponse(result);
    }

    return jsonResponse({ error: "NOT_FOUND" }, 404);
  }
}

export default {
  async fetch(request, environment) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/stats")) {
      return handleStatsRequest(request, environment, url.pathname);
    }

    const response = await environment.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
