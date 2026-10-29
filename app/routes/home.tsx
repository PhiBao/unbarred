import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { IconArrowUpRight, IconLock } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Wordmark } from "@/components/unbarred/Mark";
import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = "Unbarred — find it, fix it, prove it";
const SEO_DESCRIPTION =
  "An accessibility remediation workspace: audit a real page, approve fixes with human judgment, then re-scan to prove what changed.";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
  ];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function statusTone(status: string): "verified" | "amber" | "critical" | "neutral" {
  if (status === "verified") return "verified";
  if (status === "failed") return "critical";
  if (status === "complete" || status === "verifying" || status === "running") {
    return "amber";
  }
  return "neutral";
}

function statusLabel(status: string): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "verifying":
      return "Re-scanning";
    case "complete":
      return "Needs review";
    case "running":
    case "queued":
      return "Scanning";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export default function HomeRoute() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dashboard = useActionQuery("get-dashboard", {});
  const start = useActionMutation("start-audit");

  const totals = dashboard.data?.totals;
  const recent = dashboard.data?.recent ?? [];
  const latest = recent[0];

  const runAudit = (target?: string) => {
    const value = (target ?? url).trim();
    if (!value) {
      setError("Enter a URL to audit.");
      return;
    }
    setError(null);
    start.mutate(
      { url: value, maxPages: 3 },
      {
        onSuccess: (result) => {
          if (result.engineError) {
            setError(result.engineError);
            return;
          }
          navigate(`/workbench/${result.auditId}`);
        },
        onError: (mutationError) => {
          setError(
            actionErrorMessage(mutationError) ??
              "The audit could not start. Check the engine and try again.",
          );
        },
      },
    );
  };

  return (
    <div className="u-landing">
      <div className="u-wrap">
        <header className="u-topbar">
          <Link to="/home" aria-label={`${APP_TITLE} home`}>
            <Wordmark />
          </Link>
          <nav className="u-topbar-links" aria-label="Primary">
            <a href="#method">Method</a>
            <a href="#inspections">Inspections</a>
            <Link to="/chat">Open chat</Link>
          </nav>
        </header>

        <section className="u-hero">
          <div>
            <p className="u-kicker">Accessibility remediation workspace</p>
            <h1>
              Find it.
              <br />
              Fix it.
              <br />
              <em>Prove it.</em>
            </h1>
            <p className="u-hero-lede">
              Unbarred turns an accessibility scan into a reviewable fix
              queue — then re-scans the page to prove what actually changed.
              Judgment stays with you. Receipts stay with the work.
            </p>
            <form
              className="u-intake"
              onSubmit={(event) => {
                event.preventDefault();
                runAudit();
              }}
            >
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="yourclient.com"
                aria-label="Site URL to audit"
                autoComplete="url"
                spellCheck={false}
              />
              <button type="submit" disabled={start.isPending}>
                {start.isPending ? "Starting…" : "Run baseline audit"}
              </button>
            </form>
            <p className="u-sample">
              No site handy?{" "}
              <button
                type="button"
                onClick={() =>
                  runAudit(`${window.location.origin}/fixture/`)
                }
                disabled={start.isPending}
              >
                Audit the demo bakery →
              </button>
            </p>
            {error ? (
              <p className="u-alert" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <aside className="u-docket" aria-label="Latest inspection">
            {latest ? (
              <>
                <div className="u-docket-head">
                  <span className="u-kicker">Latest inspection</span>
                  <span className="u-mono" style={{ fontSize: 10 }}>
                    {formatDate(latest.createdAt)}
                  </span>
                </div>
                <p className="u-docket-title">{latest.projectName}</p>
                <p className="u-wb-url" style={{ marginTop: 4 }}>
                  {latest.url}
                </p>
                <div style={{ marginTop: 16 }}>
                  <div className="u-docket-row">
                    <span>Barriers found</span>
                    <span>{latest.issueCount}</span>
                  </div>
                  <div className="u-docket-row">
                    <span>Fixes verified</span>
                    <span>{latest.verifiedCount}</span>
                  </div>
                  <div className="u-docket-row">
                    <span>Still open</span>
                    <span>{latest.remainingCount}</span>
                  </div>
                  <div className="u-docket-row">
                    <span>Patterns</span>
                    <span>{latest.clusterCount}</span>
                  </div>
                </div>
                <div className="u-docket-foot">
                  <span
                    className="u-stamp"
                    data-tone={statusTone(latest.status)}
                  >
                    {statusLabel(latest.status)}
                  </span>
                  <Link
                    className="u-btn u-btn-sm"
                    to={`/workbench/${latest.id}`}
                  >
                    Open <IconArrowUpRight size={12} stroke={2} />
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="u-docket-head">
                  <span className="u-kicker">The method</span>
                  <span className="u-mono" style={{ fontSize: 10 }}>
                    No. U-001
                  </span>
                </div>
                <p className="u-docket-title">Every fix has a receipt.</p>
                <div style={{ marginTop: 16 }}>
                  <div className="u-docket-row">
                    <span>1 · Render the real page</span>
                    <span>axe 4.10.2</span>
                  </div>
                  <div className="u-docket-row">
                    <span>2 · Approve the change</span>
                    <span>human</span>
                  </div>
                  <div className="u-docket-row">
                    <span>3 · Re-scan independently</span>
                    <span>proof</span>
                  </div>
                </div>
                <div className="u-docket-foot">
                  <span className="u-docket-note">WCAG 2.1 A / AA</span>
                  <span className="u-stamp" data-tone="verified">
                    Evidence led
                  </span>
                </div>
              </>
            )}
          </aside>
        </section>

        {totals && totals.audits > 0 ? (
          <section className="u-stat-strip" aria-label="Workspace totals">
            <div className="u-stat">
              <span className="u-stat-num">{totals.sites}</span>
              <span className="u-stat-label">
                {totals.sites === 1 ? "site inspected" : "sites inspected"}
              </span>
            </div>
            <div className="u-stat">
              <span className="u-stat-num">{totals.barriers}</span>
              <span className="u-stat-label">barriers found</span>
            </div>
            <div className="u-stat">
              <span className="u-stat-num">{totals.verified}</span>
              <span className="u-stat-label">fixes verified</span>
            </div>
          </section>
        ) : null}

        <section className="u-section" id="inspections">
          <div className="u-section-head">
            <h2>Recent inspections</h2>
            <span className="u-mono u-muted" style={{ fontSize: 10 }}>
              {recent.length} on record
            </span>
          </div>
          {recent.length === 0 ? (
            <div className="u-empty">
              No inspections yet. Paste a URL above, or audit the demo bakery
              to see the whole loop.
            </div>
          ) : (
            <div className="u-table">
              {recent.map((audit) => (
                <Link
                  key={audit.id}
                  className="u-row"
                  to={`/workbench/${audit.id}`}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="u-row-site">{audit.projectName}</div>
                    <div className="u-row-url">{audit.url}</div>
                  </div>
                  <div className="u-row-num">
                    {audit.issueCount}
                    <small>found</small>
                  </div>
                  <div className="u-row-num">
                    {audit.verifiedCount}
                    <small>verified</small>
                  </div>
                  <div>
                    <span
                      className="u-stamp"
                      data-tone={statusTone(audit.status)}
                    >
                      {statusLabel(audit.status)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="u-section" id="method">
          <div className="u-section-head">
            <h2>Method</h2>
            <span className="u-mono u-muted" style={{ fontSize: 10 }}>
              Fix at the source. Verify after.
            </span>
          </div>
          <div className="u-steps">
            <div className="u-step">
              <div className="u-step-num">01 — RENDER</div>
              <h3>Scan the real page</h3>
              <p>
                A headless browser renders up to four same-origin pages and
                runs a pinned axe-core build. Pins land on the elements that
                actually failed, not a source-code guess.
              </p>
            </div>
            <div className="u-step">
              <div className="u-step-num">02 — JUDGE</div>
              <h3>Fix with judgment</h3>
              <p>
                Deterministic patterns get computed corrections. Alt text,
                labels, and page language wait for a human decision — because
                automation cannot know what an image means.
              </p>
            </div>
            <div className="u-step">
              <div className="u-step-num">03 — PROVE</div>
              <h3>Re-scan, then sign</h3>
              <p>
                Approved fixes are applied to a fresh render and scanned
                again. The ledger records what changed, what passed, and what
                still needs a person. No compliance claims.
              </p>
            </div>
          </div>
        </section>

        <footer className="u-foot">
          <p>
            Automated checks cover a subset of WCAG. Unbarred documents the
            work and the evidence; it does not certify compliance. Sites are
            audited only with permission, and previews are served inert.
          </p>
          <span className="u-mono">
            axe-core 4.10.2 · WCAG 2.1 A/AA · built with Agent-Native
          </span>
        </footer>
        <p className="u-mono u-muted" style={{ fontSize: 9, paddingBottom: 24 }}>
          <IconLock size={10} style={{ display: "inline", marginRight: 4 }} />
          Public pages only. Private networks are refused.
        </p>
      </div>
    </div>
  );
}
