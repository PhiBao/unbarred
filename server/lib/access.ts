import type { ActionRunContext } from "@agent-native/core/action";
import { fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { audits, projects } from "../db/schema.js";

export function requireEmail(ctx?: ActionRunContext): string {
  const email = ctx?.userEmail?.trim().toLowerCase();
  if (!email) {
    fail("Sign in to use Unbarred.", {
      errorCode: "unauthenticated",
      statusCode: 401,
    });
  }
  return email;
}

export async function ownedAudit(auditId: string, email: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(audits)
    .where(and(eq(audits.id, auditId), eq(audits.ownerEmail, email)))
    .limit(1);
  if (!row) {
    fail("That audit was not found.", {
      errorCode: "audit_not_found",
      statusCode: 404,
    });
  }
  return row;
}

export async function ownedProject(projectId: string, email: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerEmail, email)))
    .limit(1);
  if (!row) {
    fail("That site was not found.", {
      errorCode: "project_not_found",
      statusCode: 404,
    });
  }
  return row;
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    fail("Enter a site URL to audit.", { errorCode: "invalid_url" });
  }
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    fail("That does not look like a URL.", { errorCode: "invalid_url" });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    fail("Only http and https sites can be audited.", {
      errorCode: "invalid_url",
    });
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function siteName(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

export function impactRank(impact: string): number {
  switch (impact) {
    case "critical":
      return 4;
    case "serious":
      return 3;
    case "moderate":
      return 2;
    default:
      return 1;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
