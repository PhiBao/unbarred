import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconArrowUpRight, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Wordmark } from "@/components/unbarred/Mark";

export function meta() {
  return [{ title: "Sites — Unbarred" }];
}

function statusTone(
  status: string | null,
): "verified" | "amber" | "critical" | "neutral" {
  if (status === "verified") return "verified";
  if (status === "failed") return "critical";
  if (status === "complete" || status === "verifying" || status === "running") {
    return "amber";
  }
  return "neutral";
}

function statusLabel(status: string | null): string {
  if (!status) return "Not audited";
  if (status === "verified") return "Verified";
  if (status === "verifying") return "Re-scanning";
  if (status === "complete") return "Needs review";
  if (status === "running" || status === "queued") return "Scanning";
  if (status === "failed") return "Failed";
  return status;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function SitesRoute() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sitesQuery = useActionQuery("list-sites", {});
  const startAudit = useActionMutation("start-audit");
  const sites = sitesQuery.data?.sites ?? [];

  const run = (target: string, projectId?: string) => {
    if (!target.trim()) {
      setError("Enter a URL to audit.");
      return;
    }
    setError(null);
    startAudit.mutate(
      { url: target, maxPages: 3, ...(projectId ? { projectId } : {}) },
      {
        onSuccess: (result) => {
          if (result.engineError) {
            setError(result.engineError);
            return;
          }
          navigate(`/workbench/${result.auditId}`);
        },
        onError: (mutationError) =>
          setError(
            actionErrorMessage(mutationError) ?? "The audit could not start.",
          ),
      },
    );
  };

  return (
    <div className="u-landing">
      <div className="u-wrap">
        <header className="u-topbar">
          <Link to="/home" aria-label="Unbarred home">
            <Wordmark />
          </Link>
          <nav className="u-topbar-links" aria-label="Primary">
            <Link to="/home">Inspections</Link>
            <Link to="/sites">Sites</Link>
            <Link to="/chat">Open chat</Link>
          </nav>
        </header>

        <section className="u-section" style={{ paddingTop: 56 }}>
          <div className="u-section-head">
            <div>
              <p className="u-kicker">Portfolio</p>
              <h2 style={{ fontSize: 44 }}>Your client sites</h2>
            </div>
            <span className="u-mono u-muted" style={{ fontSize: 10 }}>
              {sites.length} on record
            </span>
          </div>

          <form
            className="u-intake"
            onSubmit={(event) => {
              event.preventDefault();
              run(url);
            }}
          >
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Add a site to audit — yourclient.com"
              aria-label="Site URL to audit"
              autoComplete="url"
              spellCheck={false}
            />
            <button type="submit" disabled={startAudit.isPending}>
              {startAudit.isPending ? "Starting…" : "Run baseline audit"}
            </button>
          </form>
          {error ? (
            <p className="u-alert" role="alert">
              {error}
            </p>
          ) : null}

          {sites.length === 0 ? (
            <div className="u-empty" style={{ marginTop: 30 }}>
              No sites yet. Add one above, or audit the demo bakery from
              Inspections.
            </div>
          ) : (
            <div className="u-table" style={{ marginTop: 30 }}>
              {sites.map((site) => (
                <div className="u-row u-site-row" key={site.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="u-row-site">{site.name}</div>
                    <div className="u-row-url">{site.url}</div>
                  </div>
                  <div className="u-row-num">
                    {site.issueCount}
                    <small>found</small>
                  </div>
                  <div className="u-row-num">
                    {site.verifiedCount}
                    <small>verified</small>
                  </div>
                  <div className="u-row-num">
                    {site.remainingCount}
                    <small>remaining</small>
                  </div>
                  <div>
                    <span
                      className="u-stamp"
                      data-tone={statusTone(site.latestStatus)}
                    >
                      {statusLabel(site.latestStatus)}
                    </span>
                    <div className="u-site-date">
                      {formatDate(site.lastAuditAt)} · {site.auditCount}{" "}
                      {site.auditCount === 1 ? "run" : "runs"}
                      {site.manualOpen > 0
                        ? ` · ${site.manualOpen} manual open`
                        : ""}
                    </div>
                  </div>
                  <div className="u-site-actions">
                    {site.latestAuditId ? (
                      <Link
                        className="u-btn u-btn-sm"
                        to={`/workbench/${site.latestAuditId}`}
                      >
                        Open <IconArrowUpRight size={12} />
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="u-btn u-btn-sm"
                      disabled={startAudit.isPending}
                      onClick={() => run(site.url, site.id)}
                    >
                      <IconRefresh size={12} /> Re-audit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="u-foot">
          <p>
            Re-auditing a site creates a new baseline. Compare it with the
            previous ledger before sending the client an update.
          </p>
          <span className="u-mono">One workspace for every client site.</span>
        </footer>
      </div>
    </div>
  );
}
