import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconArrowLeft, IconDownload, IconPrinter } from "@tabler/icons-react";
import { Link, useParams } from "react-router";

import { UnbarredMark } from "@/components/unbarred/Mark";

export function meta() {
  return [{ title: "Evidence pack — Unbarred" }];
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" ? "/" : parsed.pathname;
  } catch {
    return url;
  }
}

export default function ReportRoute() {
  const { auditId = "" } = useParams();
  const detailQuery = useActionQuery(
    "get-audit",
    { auditId },
    { enabled: Boolean(auditId) },
  );
  const issuesQuery = useActionQuery(
    "list-issues",
    { auditId },
    { enabled: Boolean(auditId) },
  );
  const exportQuery = useActionQuery(
    "export-evidence",
    { auditId },
    { enabled: Boolean(auditId) },
  );

  const detail = detailQuery.data;
  const issues = issuesQuery.data?.issues ?? [];
  if (!detail) {
    return (
      <div className="u-report">
        <p className="u-kicker">Evidence pack</p>
        <p className="u-serif" style={{ fontSize: 34 }}>
          {detailQuery.isLoading ? "Building the record…" : "Audit not found."}
        </p>
        <Link className="u-btn" to="/home">
          Back to inspections
        </Link>
      </div>
    );
  }

  const audit = detail.audit;
  const manualOpen = detail.manualChecks.filter(
    (check) => check.status === "open",
  ).length;
  const slug = audit.projectName.replace(/\s+/g, "-").toLowerCase();
  const generated = new Date().toLocaleString();

  return (
    <div className="u-report">
      <div className="u-no-print" style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        <Link className="u-btn" to={`/workbench/${auditId}`}>
          <IconArrowLeft size={13} /> Workbench
        </Link>
        <button type="button" className="u-btn" onClick={() => window.print()}>
          <IconPrinter size={13} /> Print
        </button>
        <button
          type="button"
          className="u-btn"
          disabled={!exportQuery.data}
          onClick={() =>
            exportQuery.data &&
            download(`${slug}-evidence.json`, exportQuery.data.json, "application/json")
          }
        >
          <IconDownload size={13} /> JSON
        </button>
        <button
          type="button"
          className="u-btn"
          disabled={!exportQuery.data}
          onClick={() =>
            exportQuery.data &&
            download(`${slug}-barriers.csv`, exportQuery.data.csv, "text/csv")
          }
        >
          <IconDownload size={13} /> CSV
        </button>
      </div>

      <header className="u-report-head">
        <div>
          <div className="u-wordmark">
            <UnbarredMark size={26} />
            <span className="u-wordmark-text">unbarred</span>
          </div>
          <h1>Evidence pack</h1>
          <p className="u-mono u-muted" style={{ fontSize: 10.5, margin: 0 }}>
            {audit.projectName} · {audit.url}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <span
            className="u-stamp u-stamp-lg"
            data-tone={audit.status === "verified" ? "verified" : "amber"}
          >
            {audit.status === "verified" ? "Re-scan verified" : "Baseline only"}
          </span>
          <p className="u-mono u-muted" style={{ fontSize: 9, marginTop: 10 }}>
            Generated {generated}
            <br />
            axe-core {audit.axeVersion ?? "4.10.2"}
          </p>
        </div>
      </header>

      <div className="u-report-grid">
        <div>
          <div className="u-stat-num">{audit.issueCount}</div>
          <div className="u-stat-label">barriers found</div>
        </div>
        <div>
          <div
            className="u-stat-num"
            style={{ color: "hsl(var(--u-verified))" }}
          >
            {audit.verifiedCount}
          </div>
          <div className="u-stat-label">verified by re-scan</div>
        </div>
        <div>
          <div className="u-stat-num">{audit.remainingCount}</div>
          <div className="u-stat-label">still open</div>
        </div>
        <div>
          <div className="u-stat-num">{manualOpen}</div>
          <div className="u-stat-label">manual checks open</div>
        </div>
      </div>

      <div className="u-report-disclaimer">
        <strong>What this record is.</strong> A list of barriers found by a
        pinned axe-core build, the fixes a person approved, and what an
        independent re-scan observed afterwards. Automated checks cover a
        subset of WCAG. This is not a certification of compliance, and it is
        not legal advice.
      </div>

      <h2>Patterns</h2>
      <table>
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Impact</th>
            <th>Found</th>
            <th>Verified</th>
            <th>Pages</th>
          </tr>
        </thead>
        <tbody>
          {detail.clusters.map((cluster) => (
            <tr key={cluster.ruleId}>
              <td>{cluster.title}</td>
              <td className="u-mono">{cluster.impact}</td>
              <td className="u-mono">{cluster.count}</td>
              <td className="u-mono">{cluster.verifiedCount}</td>
              <td className="u-mono">{cluster.pageUrls.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Barriers and fixes</h2>
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Rule</th>
            <th>Selector</th>
            <th>Status</th>
            <th>Approved fix</th>
            <th>Approved by</th>
            <th>Verified</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id}>
              <td className="u-mono">{pathOf(issue.pageUrl)}</td>
              <td className="u-mono">{issue.ruleId}</td>
              <td className="u-mono" style={{ wordBreak: "break-all" }}>
                {issue.selector}
              </td>
              <td className="u-mono">{issue.status}</td>
              <td style={{ wordBreak: "break-word" }}>
                {issue.fix
                  ? issue.fix.decorative
                    ? "(decorative image)"
                    : issue.fix.value
                  : issue.proposal?.needsHuman
                    ? "Needs a person"
                    : "—"}
              </td>
              <td className="u-mono">{issue.fix?.approvedBy ?? "—"}</td>
              <td className="u-mono">
                {issue.fix?.verifiedAt
                  ? new Date(issue.fix.verifiedAt).toLocaleDateString()
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Manual checks</h2>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>Result</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {detail.manualChecks.map((check) => (
            <tr key={check.key}>
              <td>{check.label}</td>
              <td className="u-mono">{check.status}</td>
              <td className="u-mono">
                {check.completedAt
                  ? new Date(check.completedAt).toLocaleDateString()
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Ledger</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Summary</th>
            <th>Actor</th>
          </tr>
        </thead>
        <tbody>
          {detail.evidence.map((event) => (
            <tr key={event.id}>
              <td className="u-mono">
                {new Date(event.createdAt).toLocaleString()}
              </td>
              <td className="u-mono">{event.type}</td>
              <td>{event.summary}</td>
              <td className="u-mono">{event.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="u-report-disclaimer">
        Unbarred · find it, fix it, prove it. Generated from the audit record;
        the JSON export contains the same data in machine-readable form. Sites
        were audited only with permission. Previews are served inert and
        scripts are stripped.
      </footer>
    </div>
  );
}
