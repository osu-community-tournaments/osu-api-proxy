import Fastify from "fastify";
import { registerProxy } from "./proxy.ts";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const PROXY_SECRET = process.env.PROXY_SECRET || undefined;

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  disableRequestLogging: false,
  trustProxy: true,
});

registerProxy(app, { proxySecret: PROXY_SECRET });

async function main(): Promise<void> {
  try {
    await app.listen({ host: HOST, port: PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
