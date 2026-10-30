export type EngineRect = { x: number; y: number; w: number; h: number };

export type EngineProposal = {
  kind: string;
  op: string;
  name: string;
  value: string;
  needsHuman: boolean;
  rationale: string;
  before: string;
  after: string;
};

export type EngineIssue = {
  id: string;
  ruleId: string;
  impact: string;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  selector: string;
  snippet: string;
  failureSummary: string;
  rect: EngineRect | null;
  text: string;
  tag: string;
  attrs: Record<string, string>;
  data: unknown;
  proposal: EngineProposal | null;
  pageUrl: string;
};

export type EngineCluster = {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  impact: string;
  count: number;
  issueIds: string[];
  pageUrls: string[];
  fixKind: string | null;
  needsHuman: boolean;
};

export type EnginePage = {
  url: string;
  title: string;
  height: number;
  html: string;
  issues: EngineIssue[];
  clusters: EngineCluster[];
};

export type EngineAudit = {
  startUrl: string;
  finalUrl: string;
  axeVersion: string;
  viewportWidth: number;
  pages: EnginePage[];
  clusters: EngineCluster[];
  totals: {
    issues: number;
    clusters: number;
    pages: number;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
};

export type EnginePatch = {
  id: string;
  selector: string;
  op: string;
  name: string;
  value: string;
  ruleId: string;
};

export type EnginePatchOutcome = {
  id: string;
  applied: boolean;
  verified: boolean;
  reason: string;
};

export type EngineRescanPage = {
  url: string;
  title: string;
  height: number;
  html: string;
  issues: EngineIssue[];
  clusters: EngineCluster[];
  patches: EnginePatchOutcome[];
};

export type EngineRescan = { pages: EngineRescanPage[] };

export type EngineJob<T> = {
  id: string;
  kind: "audit" | "rescan";
  status: "queued" | "running" | "complete" | "failed";
  progress: {
    phase: string;
    pagesDone: number;
    pagesTotal: number;
    currentUrl: string;
  };
  result: T | null;
  error: string | null;
};

const ENGINE_URL = () =>
  // guard:allow-env-credential — deployment-level engine endpoint, not a per-user credential
  (process.env.UNBARRED_ENGINE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const ENGINE_SECRET = () =>
  // guard:allow-env-credential — shared deployment secret between this app and the engine
  process.env.UNBARRED_ENGINE_SECRET ?? "devsecret";

export class EngineError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL()}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENGINE_SECRET()}`,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new EngineError(
      "The audit engine is unreachable. Start the Rust engine, then try again.",
    );
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `The audit engine returned ${response.status}.`;
    throw new EngineError(message);
  }
  return body as T;
}

export async function startEngineAudit(
  url: string,
  maxPages: number,
): Promise<{ id: string }> {
  return request<{ id: string }>("/v1/audits", {
    method: "POST",
    body: JSON.stringify({ url, maxPages }),
  });
}

export async function getEngineAuditJob(
  id: string,
): Promise<EngineJob<EngineAudit>> {
  return request<EngineJob<EngineAudit>>(`/v1/audits/${encodeURIComponent(id)}`);
}

export async function startEngineRescan(
  pages: Array<{ url: string; patches: EnginePatch[] }>,
): Promise<{ id: string }> {
  return request<{ id: string }>("/v1/rescans", {
    method: "POST",
    body: JSON.stringify({ pages }),
  });
}

export async function getEngineRescanJob(
  id: string,
): Promise<EngineJob<EngineRescan>> {
  return request<EngineJob<EngineRescan>>(
    `/v1/rescans/${encodeURIComponent(id)}`,
  );
}

export async function engineHealth(): Promise<{
  ok: boolean;
  engine: string;
  error?: string;
}> {
  try {
    await request<{ ok: boolean }>("/healthz", { method: "GET" });
    return { ok: true, engine: ENGINE_URL() };
  } catch (error) {
    return {
      ok: false,
      engine: ENGINE_URL(),
      error: error instanceof Error ? error.message : "Unreachable",
    };
  }
}
