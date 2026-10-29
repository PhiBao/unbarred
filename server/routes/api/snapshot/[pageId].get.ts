import { getSession } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { getDb } from "../../../db/index.js";
import { audits, pages } from "../../../db/schema.js";

/**
 * Serve a stored page snapshot to the sandboxed preview iframe.
 *
 * This is a custom route, not an action, because the response is an HTML
 * document rather than JSON. The snapshot is untrusted third-party markup:
 * scripts were stripped at capture time, and the response also carries a
 * `sandbox` CSP plus `script-src 'none'`, so opening the URL directly cannot
 * execute anything from the audited site.
 */
export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return "Sign in to view this preview.";
  }
  const pageId = getRouterParam(event, "pageId") ?? "";
  if (!pageId) {
    setResponseStatus(event, 404);
    return "Not found.";
  }

  const db = getDb();
  const [row] = await db
    .select({ page: pages })
    .from(pages)
    .innerJoin(audits, eq(pages.auditId, audits.id))
    .where(and(eq(pages.id, pageId), eq(audits.ownerEmail, session.email)))
    .limit(1);
  if (!row) {
    setResponseStatus(event, 404);
    return "Not found.";
  }

  const variant = getQuery(event).v === "after" && row.page.patchedHtml;
  const html = variant ? row.page.patchedHtml! : row.page.html;

  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  setResponseHeader(event, "cache-control", "private, no-store");
  setResponseHeader(event, "x-content-type-options", "nosniff");
  setResponseHeader(event, "referrer-policy", "no-referrer");
  setResponseHeader(
    event,
    "content-security-policy",
    [
      "sandbox",
      "default-src 'none'",
      "script-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "img-src https: http: data:",
      "style-src 'unsafe-inline' https: http:",
      "font-src https: http: data:",
      "frame-ancestors 'self'",
    ].join("; "),
  );
  return html;
});
