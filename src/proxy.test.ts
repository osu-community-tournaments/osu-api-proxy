import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { isPathAllowed, checkSecret, stripProxySecret, buildForwardHeaders, registerProxy } from "./proxy.ts";

async function makeApp(env: { PROXY_SECRET?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const stubFetch: typeof fetch = async () =>
    new Response("stub", { status: 200, headers: { "content-type": "text/plain" } });
  registerProxy(app, { proxySecret: env.PROXY_SECRET, fetchImpl: stubFetch });
  await app.ready();
  return app;
}

test("isPathAllowed accepts /api/v2/users/123", () => {
  assert.equal(isPathAllowed("/api/v2/users/123"), true);
});

test("isPathAllowed accepts /oauth/token", () => {
  assert.equal(isPathAllowed("/oauth/token"), true);
});

test("isPathAllowed accepts /api/get_beatmaps (legacy v1)", () => {
  assert.equal(isPathAllowed("/api/get_beatmaps"), true);
});

test("isPathAllowed rejects /admin", () => {
  assert.equal(isPathAllowed("/admin"), false);
});

test("isPathAllowed rejects empty path", () => {
  assert.equal(isPathAllowed(""), false);
});

test("checkSecret returns true when no expected secret configured", () => {
  assert.equal(checkSecret({ expected: undefined, header: null, query: null }), true);
});

test("checkSecret returns true when header matches", () => {
  assert.equal(checkSecret({ expected: "abc", header: "abc", query: null }), true);
});

test("checkSecret returns true when query matches", () => {
  assert.equal(checkSecret({ expected: "abc", header: null, query: "abc" }), true);
});

test("checkSecret returns false when neither matches", () => {
  assert.equal(checkSecret({ expected: "abc", header: "wrong", query: null }), false);
});

test("checkSecret returns false when expected set but both missing", () => {
  assert.equal(checkSecret({ expected: "abc", header: null, query: null }), false);
});

test("stripProxySecret removes proxy_secret param", () => {
  const u = new URL("https://x.test/api/v2/foo?bar=1&proxy_secret=abc&baz=2");
  const out = stripProxySecret(u);
  assert.equal(out.searchParams.has("proxy_secret"), false);
  assert.equal(out.searchParams.get("bar"), "1");
  assert.equal(out.searchParams.get("baz"), "2");
});

test("stripProxySecret is a no-op when param absent", () => {
  const u = new URL("https://x.test/api/v2/foo?bar=1");
  const out = stripProxySecret(u);
  assert.equal(out.search, "?bar=1");
});

test("buildForwardHeaders strips host, x-proxy-secret, cf-* and cdn-loop", () => {
  const h = new Headers({
    "host": "osu-proxy.play-osu.ru",
    "x-proxy-secret": "abc",
    "cf-connecting-ip": "1.2.3.4",
    "cf-ray": "x",
    "cf-visitor": "x",
    "cf-ipcountry": "x",
    "cf-worker": "x",
    "cdn-loop": "x",
    "authorization": "Bearer token",
    "accept": "application/json",
  });
  const out = buildForwardHeaders(h);
  assert.equal(out.get("authorization"), "Bearer token");
  assert.equal(out.get("accept"), "application/json");
  assert.equal(out.get("host"), null);
  assert.equal(out.get("x-proxy-secret"), null);
  assert.equal(out.get("cf-connecting-ip"), null);
  assert.equal(out.get("cf-ray"), null);
  assert.equal(out.get("cf-visitor"), null);
  assert.equal(out.get("cf-ipcountry"), null);
  assert.equal(out.get("cf-worker"), null);
  assert.equal(out.get("cdn-loop"), null);
});

test("buildForwardHeaders is case-insensitive on the strip set", () => {
  const h = new Headers({ "Host": "x", "X-Proxy-Secret": "y", "CF-Ray": "z" });
  const out = buildForwardHeaders(h);
  assert.equal(out.get("host"), null);
  assert.equal(out.get("x-proxy-secret"), null);
  assert.equal(out.get("cf-ray"), null);
});

test("GET /health returns 200 ok", async () => {
  const app = await makeApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.proxy, "osu-api-proxy");
  await app.close();
});

test("GET / returns 200 ok", async () => {
  const app = await makeApp();
  const res = await app.inject({ method: "GET", url: "/" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("GET /admin returns 404 with allowlist message", async () => {
  const app = await makeApp();
  const res = await app.inject({ method: "GET", url: "/admin" });
  assert.equal(res.statusCode, 404);
  assert.match(res.json().error, /only forwards/);
  await app.close();
});

test("with PROXY_SECRET set, missing header returns 401", async () => {
  const app = await makeApp({ PROXY_SECRET: "s3cret" });
  const res = await app.inject({ method: "GET", url: "/api/v2/users/1" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("with PROXY_SECRET set, wrong header returns 401", async () => {
  const app = await makeApp({ PROXY_SECRET: "s3cret" });
  const res = await app.inject({
    method: "GET",
    url: "/api/v2/users/1",
    headers: { "x-proxy-secret": "nope" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("with PROXY_SECRET set, correct header passes auth", async () => {
  const app = await makeApp({ PROXY_SECRET: "s3cret" });
  const res = await app.inject({
    method: "GET",
    url: "/api/v2/users/1",
    headers: { "x-proxy-secret": "s3cret" },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("with PROXY_SECRET set, correct query param passes auth", async () => {
  const app = await makeApp({ PROXY_SECRET: "s3cret" });
  const res = await app.inject({
    method: "GET",
    url: "/api/v2/users/1?proxy_secret=s3cret",
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("without PROXY_SECRET set, no header is fine", async () => {
  const app = await makeApp();
  const res = await app.inject({ method: "GET", url: "/api/v2/users/1" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("forwards GET to osu.ppy.sh with proxy_secret stripped and headers cleaned", async () => {
  let capturedUrl: string | null = null;
  let capturedHeaders: Headers | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    capturedHeaders = new Headers(init?.headers);
    return new Response("upstream-body", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  const app = Fastify({ logger: false });
  registerProxy(app, { proxySecret: "s3cret", fetchImpl });
  await app.ready();

  const res = await app.inject({
    method: "GET",
    url: "/api/v2/users/42?key=value&proxy_secret=s3cret",
    headers: {
      "x-proxy-secret": "s3cret",
      "authorization": "Bearer abc",
      "cf-connecting-ip": "1.2.3.4",
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "upstream-body");
  assert.equal(res.headers["content-type"], "text/plain");
  assert.equal(capturedUrl, "https://osu.ppy.sh/api/v2/users/42?key=value");
  assert.equal(capturedHeaders!.get("authorization"), "Bearer abc");
  assert.equal(capturedHeaders!.get("x-proxy-secret"), null);
  assert.equal(capturedHeaders!.get("cf-connecting-ip"), null);

  await app.close();
});

test("returns 502 when upstream fetch throws", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("dns boom");
  };
  const app = Fastify({ logger: false });
  registerProxy(app, { proxySecret: undefined, fetchImpl });
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/v2/users/1" });
  assert.equal(res.statusCode, 502);
  const body = res.json();
  assert.equal(body.error, "Failed to reach osu.ppy.sh");
  assert.equal(body.detail, "dns boom");
  await app.close();
});
