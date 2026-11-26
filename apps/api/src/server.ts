import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { APP_NAME } from "@adaiyalam/config";
import { categoryName, CATEGORIES } from "@adaiyalam/schema";
import { buildRuleQualityReport, getRuleset, replayScan, scanUrlFast } from "@adaiyalam/orchestrator";
import { deleteSite, getFacts, getScan, listScans, listSites, noteSite, reportFalsePositive, tagSite } from "@adaiyalam/store";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export interface CreateServerOptions {
  /** Allowed origins for localhost-only CORS. Defaults to none needed since the dashboard is served from the same origin. */
  logger?: boolean;
}

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/" });

  app.get("/api/health", async () => ({ ok: true, app: APP_NAME, rulesetVersion: getRuleset().version, technologyCount: getRuleset().rules.length }));

  app.get("/api/categories", async () => CATEGORIES.map((c) => ({ ...c, label: categoryName(c.id) })));

  app.post<{ Body: { url: string; globalRps?: number; hostDelayMs?: number; allowPrivateHosts?: boolean; save?: boolean } }>("/api/scans", async (request, reply) => {
    const { url, globalRps, hostDelayMs, allowPrivateHosts, save } = request.body ?? ({} as never);
    if (!url || typeof url !== "string") {
      reply.code(400);
      return { error: "body must include a string `url`" };
    }
    try {
      const report = await scanUrlFast(url, {
        rateLimit: { globalRps: globalRps ?? 5, perHostDelayMs: hostDelayMs ?? 1500 },
        ssrf: { allowPrivateHosts: Boolean(allowPrivateHosts) },
        save: save !== false,
      });
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get<{ Querystring: { host?: string } }>("/api/scans", async (request) => {
    return listScans(request.query.host ? { hostname: request.query.host } : undefined);
  });

  app.get<{ Params: { id: string } }>("/api/scans/:id", async (request, reply) => {
    const scan = getScan(request.params.id);
    if (!scan) {
      reply.code(404);
      return { error: "not found" };
    }
    return scan;
  });

  app.get<{ Params: { id: string } }>("/api/scans/:id/replay", async (request, reply) => {
    const facts = getFacts(request.params.id);
    if (!facts) {
      reply.code(404);
      return { error: "not found" };
    }
    return replayScan(facts);
  });

  app.get<{ Params: { id: string } }>("/api/scans/:id/facts", async (request, reply) => {
    const facts = getFacts(request.params.id);
    if (!facts) {
      reply.code(404);
      return { error: "not found" };
    }
    return facts;
  });

  app.get("/api/sites", async () => listSites());

  app.get<{ Params: { hostname: string } }>("/api/sites/:hostname", async (request, reply) => {
    const site = listSites().find((s) => s.hostname === request.params.hostname);
    if (!site) {
      reply.code(404);
      return { error: "not found" };
    }
    return { ...site, scans: listScans({ hostname: site.hostname }) };
  });

  app.patch<{ Params: { hostname: string }; Body: { tags?: string[]; notes?: string } }>("/api/sites/:hostname", async (request) => {
    if (request.body?.tags) tagSite(request.params.hostname, request.body.tags);
    if (request.body?.notes !== undefined) noteSite(request.params.hostname, request.body.notes);
    return { ok: true };
  });

  app.delete<{ Params: { hostname: string } }>("/api/sites/:hostname", async (request) => {
    deleteSite(request.params.hostname);
    return { ok: true };
  });

  app.get("/api/rule-quality", async () => buildRuleQualityReport());

  app.post<{ Body: { scanId: string; techId: string; note?: string } }>("/api/feedback/false-positive", async (request, reply) => {
    const { scanId, techId, note } = request.body ?? ({} as never);
    if (!scanId || !techId) {
      reply.code(400);
      return { error: "body must include `scanId` and `techId`" };
    }
    const scan = getScan(scanId);
    if (!scan) {
      reply.code(404);
      return { error: "no saved scan with that id" };
    }
    if (!scan.techIds.includes(techId)) {
      reply.code(400);
      return { error: `scan ${scanId} did not detect "${techId}"` };
    }
    return reportFalsePositive({ scanId, techId, url: scan.url, note });
  });

  return app;
}
