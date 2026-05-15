import type { FastifyInstance } from "fastify";

const ALLOWED_PREFIXES = ["/api/v2/", "/api/v2", "/oauth/token", "/api", "/api/"];

export function isPathAllowed(path: string): boolean {
  return ALLOWED_PREFIXES.some(
    (p) => path === p || path.startsWith(p + (p.endsWith("/") ? "" : "/")),
  );
}

export interface SecretArgs {
  expected: string | undefined;
  header: string | null;
  query: string | null;
}

export function checkSecret({ expected, header, query }: SecretArgs): boolean {
  if (!expected) return true;
  const provided = header ?? query;
  return provided === expected;
}
export function stripProxySecret(url: URL): URL {
  const out = new URL(url.toString());
  out.searchParams.delete("proxy_secret");
  return out;
}
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "x-proxy-secret",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "cf-ipcountry",
  "cf-worker",
  "cdn-loop",
]);

export function buildForwardHeaders(input: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of input) {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      out.set(key, value);
    }
  }
  return out;
}

export interface ProxyOptions {
  proxySecret: string | undefined;
  fetchImpl?: typeof fetch;
}

export function registerProxy(app: FastifyInstance, opts: ProxyOptions): void {
  const okBody = {
    status: "ok",
    proxy: "osu-api-proxy",
    usage: "Replace https://osu.ppy.sh with this proxy's URL in your requests.",
  };
  app.get("/health", async () => okBody);
  app.get("/", async () => okBody);

  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/*",
    handler: async (req, reply) => {
      const url = new URL(req.url, "http://internal");
      const path = url.pathname;
      if (!isPathAllowed(path)) {
        return reply.code(404).send({
          error: "This proxy only forwards /api/v2/* and /oauth/token.",
        });
      }

      const provided =
        (req.headers["x-proxy-secret"] as string | undefined) ?? null;
      const queryProvided = url.searchParams.get("proxy_secret");
      if (!checkSecret({ expected: opts.proxySecret, header: provided, query: queryProvided })) {
        return reply.code(401).send({ error: "Invalid or missing X-Proxy-Secret header." });
      }

      const cleaned = stripProxySecret(url);
      const target = `https://osu.ppy.sh${path}${cleaned.search}`;

      const reqHeaders = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) reqHeaders.append(k, item);
        } else if (typeof v === "string") {
          reqHeaders.set(k, v);
        }
      }
      const forwardHeaders = buildForwardHeaders(reqHeaders);

      const init: RequestInit = {
        method: req.method,
        headers: forwardHeaders,
        redirect: "follow",
      };
      if (!["GET", "HEAD"].includes(req.method)) {
        init.body = req.body as BodyInit | null | undefined;
      }

      const doFetch = opts.fetchImpl ?? fetch;
      let upstream: Response;
      try {
        upstream = await doFetch(target, init);
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: "Failed to reach osu.ppy.sh", detail });
      }

      reply.code(upstream.status);
      upstream.headers.forEach((value, key) => {
        reply.header(key, value);
      });

      if (!upstream.body) {
        return reply.send();
      }
      const { Readable } = await import("node:stream");
      const nodeStream = Readable.fromWeb(upstream.body as never);
      return reply.send(nodeStream);
    },
  });
}
