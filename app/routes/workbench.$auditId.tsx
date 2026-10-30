import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  IconArrowLeft,
  IconCheck,
  IconCode,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconMessage,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { buildFixCode } from "@/lib/fix-code";

export function meta() {
  return [{ title: "Workbench — Unbarred" }];
}

type Rect = { x: number; y: number; w: number; h: number };
type Proposal = {
  kind: string;
  op: string;
  name: string;
  value: string;
  needsHuman: boolean;
  rationale: string;
  before: string;
  after: string;
};
type Fix = {
  id: string;
  kind: string;
  value: string;
  decorative: boolean;
  status: string;
  note: string;
  reason: string;
  approvedBy: string | null;
  approvedAt: string | null;
  verifiedAt: string | null;
};
type Issue = {
  id: string;
  pageId: string;
  pageUrl: string;
  ruleId: string;
  impact: string;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  selector: string;
  snippet: string;
  failureSummary: string;
  rect: Rect | null;
  text: string;
  attrs: Record<string, string>;
  proposal: Proposal | null;
  status: string;
  origin: string;
  clusterTitle: string;
  fix: Fix | null;
};
type Cluster = {
  ruleId: string;
  title: string;
  impact: string;
  count: number;
  verifiedCount: number;
  needsHuman: boolean;
  fixKind: string | null;
  pageUrls: string[];
};
type Page = {
  id: string;
  url: string;
  title: string;
  height: number;
  issueCount: number;
  hasPatched: boolean;
  updatedAt: string;
};
type ManualCheck = {
  key: string;
  label: string;
  status: string;
  note: string;
  completedAt: string | null;
};

const IMPACT_LABEL: Record<string, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

function impactTone(impact: string): "critical" | "amber" | "neutral" {
  if (impact === "critical" || impact === "serious") return "critical";
  if (impact === "moderate") return "amber";
  return "neutral";
}

function statusTone(
  status: string,
): "verified" | "amber" | "critical" | "neutral" {
  if (status === "verified") return "verified";
  if (status === "approved" || status === "remaining") return "amber";
  if (status === "failed") return "critical";
  return "neutral";
}

function timeAgo(value: string | null): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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

export default function WorkbenchRoute() {
  const { auditId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const clusterId = params.get("cluster") ?? "";
  const issueId = params.get("issue") ?? "";

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
  const syncAudit = useActionMutation("sync-audit");
  const syncRescan = useActionMutation("sync-rescan");
  const startRescan = useActionMutation("start-rescan");
  const saveFix = useActionMutation("save-fix");
  const approveFix = useActionMutation("approve-fix");
  const rejectFix = useActionMutation("reject-fix");
  const approveCluster = useActionMutation("approve-cluster");
  const manualCheck = useActionMutation("complete-manual-check");

  const [pageOverride, setPageOverride] = useState<string | null>(null);
  const [view, setView] = useState<"before" | "after" | "compare">("before");
  const [showAllPins, setShowAllPins] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = detailQuery.data;
  const allIssues = (issuesQuery.data?.issues ?? []) as Issue[];
  const clusters = (detail?.clusters ?? []) as Cluster[];
  const pages = (detail?.pages ?? []) as Page[];
  const status = detail?.audit.status ?? "";

  const selectedCluster =
    clusters.find((cluster) => cluster.ruleId === clusterId) ?? clusters[0];
  const clusterIssues = useMemo(
    () =>
      selectedCluster
        ? allIssues.filter((issue) => issue.ruleId === selectedCluster.ruleId)
        : allIssues,
    [allIssues, selectedCluster],
  );
  const selectedIssue =
    allIssues.find((issue) => issue.id === issueId) ??
    clusterIssues[0] ??
    allIssues[0];

  const activePage =
    pages.find((page) => page.id === pageOverride) ??
    pages.find((page) => page.id === selectedIssue?.pageId) ??
    pages[0];

  useEffect(() => {
    if (selectedIssue?.pageId) setPageOverride(selectedIssue.pageId);
  }, [selectedIssue?.id, selectedIssue?.pageId]);

  useEffect(() => {
    if (status === "verified") setView("after");
  }, [status]);

  // Poll the engine through a writing action; get-audit stays a pure read.
  useEffect(() => {
    if (!auditId) return;
    const active =
      status === "queued" ||
      status === "running" ||
      status === "verifying" ||
      status === "importing";
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        if (status === "verifying" || status === "importing") {
          await syncRescan.mutateAsync({ auditId });
        } else {
          await syncAudit.mutateAsync({ auditId });
        }
      } catch {
        // Leave the visible status alone; the next tick retries.
      }
      if (stopped) return;
      await detailQuery.refetch();
      if (!stopped) timer = setTimeout(tick, 1600);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, status]);

  const selectCluster = (ruleId: string) => {
    const first = allIssues.find((issue) => issue.ruleId === ruleId);
    if (first) setPageOverride(first.pageId);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("cluster", ruleId);
      next.delete("issue");
      if (first) next.set("page", first.pageId);
      return next;
    });
  };

  const selectIssue = (issue: Issue) => {
    setPageOverride(issue.pageId);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("cluster", issue.ruleId);
      next.set("issue", issue.id);
      next.set("page", issue.pageId);
      return next;
    });
  };

  const run = (
    mutation: { mutate: (payload: any, options?: any) => void },
    payload: any,
  ) => {
    setActionError(null);
    mutation.mutate(payload, {
      onError: (error: unknown) =>
        setActionError(
          actionErrorMessage(error) ?? "That action could not be completed.",
        ),
    });
  };

  if (!auditId) {
    return (
      <div className="u-wrap" style={{ padding: 48 }}>
        <p>No audit selected. Choose one from Inspections.</p>
        <Link className="u-btn" to="/home">
          Back to inspections
        </Link>
      </div>
    );
  }

  if (detailQuery.isLoading && !detail) {
    return (
      <div className="u-wrap" style={{ padding: 48 }}>
        <p className="u-kicker">Loading inspection</p>
        <p className="u-serif" style={{ fontSize: 40 }}>
          Reading the record…
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="u-wrap" style={{ padding: 48 }}>
        <p className="u-serif" style={{ fontSize: 36, margin: 0 }}>
          That inspection is not here.
        </p>
        <p className="u-muted">
          It may belong to another account, or it was never saved.
        </p>
        <Link className="u-btn" to="/home">
          Back to inspections
        </Link>
      </div>
    );
  }

  const audit = detail.audit;
  const approvedCount = detail.approvedCount;
  const rescanBusy = status === "verifying" || status === "importing";
  const canRescan =
    (status === "complete" || status === "verified") && approvedCount > 0;
  const totalVerified = audit.verifiedCount;
  const pageIssues = allIssues.filter(
    (issue) => issue.pageId === activePage?.id,
  );
  const pinIssues = showAllPins
    ? pageIssues
    : pageIssues.filter(
        (issue) => !selectedCluster || issue.ruleId === selectedCluster.ruleId,
      );
  const activeIssueId = selectedIssue?.id;

  return (
    <div className="u-workbench">
      <header className="u-wb-head">
        <div className="u-wb-title">
          <Link
            to="/home"
            className="u-btn u-btn-ghost u-btn-sm"
            aria-label="Back to inspections"
          >
            <IconArrowLeft size={13} />
          </Link>
          <div style={{ minWidth: 0 }}>
            <div className="u-kicker" style={{ marginBottom: 3 }}>
              {audit.projectName}
            </div>
            <h1>Baseline inspection</h1>
            <div className="u-wb-url">{audit.url}</div>
          </div>
          <span
            className="u-stamp"
            data-tone={
              status === "verified"
                ? "verified"
                : status === "failed"
                  ? "critical"
                  : status === "complete"
                    ? "amber"
                    : "neutral"
            }
          >
            {status === "verified"
              ? "Verified"
              : status === "verifying" || status === "importing"
                ? "Re-scanning"
                : status === "complete"
                  ? "Needs review"
                  : status === "failed"
                    ? "Failed"
                    : "Scanning"}
          </span>
        </div>

        <div className="u-wb-metrics" aria-label="Audit totals">
          <div className="u-metric">
            <b>{audit.issueCount}</b>
            <span>found</span>
          </div>
          <div className="u-metric">
            <b style={{ color: totalVerified ? "hsl(var(--u-verified))" : undefined }}>
              {totalVerified}
            </b>
            <span>verified</span>
          </div>
          <div className="u-metric">
            <b
              style={{
                color:
                  status === "verified" && audit.remainingCount > 0
                    ? "hsl(var(--u-amber))"
                    : undefined,
              }}
            >
              {status === "verified" ? audit.remainingCount : "—"}
            </b>
            <span>remaining</span>
          </div>
          <div className="u-metric">
            <b>{approvedCount}</b>
            <span>approved</span>
          </div>
        </div>

        <div className="u-wb-actions">
          <button
            type="button"
            className="u-btn u-btn-primary"
            disabled={!canRescan || startRescan.isPending || rescanBusy}
            onClick={() => run(startRescan, { auditId })}
          >
            <IconRefresh size={13} />
            {rescanBusy
              ? "Re-scanning…"
              : approvedCount > 0
                ? `Verify fixes (${approvedCount})`
                : "Verify fixes"}
          </button>
          <button
            type="button"
            className="u-btn"
            onClick={() => setLedgerOpen(true)}
          >
            Evidence
          </button>
          <button
            type="button"
            className="u-btn"
            onClick={() => setCodeOpen(true)}
            disabled={audit.verifiedCount === 0}
            title={
              audit.verifiedCount === 0
                ? "Verify fixes first to build the implementation pack"
                : "Implementation-ready changes for the verified fixes"
            }
          >
            <IconCode size={13} />
            Code
          </button>
          <Link className="u-btn u-btn-ghost" to={`/report/${auditId}`}>
            <IconExternalLink size={13} />
            Report
          </Link>
        </div>
      </header>

      {actionError ? (
        <div
          className="u-alert"
          role="alert"
          style={{ margin: "10px 24px 0", maxWidth: "none" }}
        >
          {actionError}
        </div>
      ) : null}

      {status === "failed" ? (
        <div className="u-alert" style={{ margin: "10px 24px 0", maxWidth: "none" }}>
          {audit.error ?? "The audit did not finish."} Start a new audit from{" "}
          <Link to="/home" style={{ textDecoration: "underline" }}>
            Inspections
          </Link>
          .
        </div>
      ) : null}

      <div className="u-wb-grid">
        <aside className="u-pane u-pane-left">
          <div className="u-pane-head">
            <span>Patterns</span>
            <span>{clusters.length} found</span>
          </div>

          {clusters.map((cluster) => {
            const fresh = allIssues.filter(
              (issue) =>
                issue.origin === "rescan" && issue.ruleId === cluster.ruleId,
            ).length;
            const done = Math.round(
              (cluster.verifiedCount / Math.max(1, cluster.count)) * 10,
            );
            return (
              <button
                key={cluster.ruleId}
                type="button"
                className="u-cluster"
                data-active={selectedCluster?.ruleId === cluster.ruleId}
                onClick={() => selectCluster(cluster.ruleId)}
              >
                <span className="u-cluster-top">
                  <span className="u-dot" data-impact={cluster.impact} />
                  <span className="u-cluster-title">{cluster.title}</span>
                  <span className="u-cluster-count">{cluster.count}</span>
                </span>
                <span className="u-cluster-meta">
                  <span>
                    {IMPACT_LABEL[cluster.impact] ?? cluster.impact}
                    {cluster.needsHuman ? " · judgment" : " · computed"}
                    {fresh ? ` · +${fresh} new` : ""}
                  </span>
                  <span>
                    {cluster.verifiedCount}/{cluster.count} verified
                  </span>
                </span>
                <span className="u-progress" aria-hidden="true">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <i key={index} data-done={index < done} />
                  ))}
                </span>
              </button>
            );
          })}

          <div className="u-pane-head" style={{ marginTop: 8 }}>
            <span>Manual checks</span>
            <span>
              {detail.manualChecks.filter((check) => check.status === "pass")
                .length}
              /{detail.manualChecks.length} passed
            </span>
          </div>
          {detail.manualChecks.map((check: ManualCheck) => (
            <div key={check.key} className="u-check" data-status={check.status}>
              <span className="u-check-mark">
                {check.status === "pass" ? "✓" : check.status === "fail" ? "!" : "·"}
              </span>
              <div className="u-check-body">
                <div className="u-check-label">{check.label}</div>
                {check.note ? (
                  <div className="u-note" style={{ marginTop: 2 }}>
                    {check.note}
                  </div>
                ) : null}
                <div className="u-check-actions">
                  <button
                    type="button"
                    className="u-btn u-btn-sm u-btn-ghost"
                    onClick={() =>
                      run(manualCheck, {
                        auditId,
                        key: check.key,
                        status: "pass",
                        note: "",
                      })
                    }
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    className="u-btn u-btn-sm u-btn-ghost"
                    onClick={() => {
                      const note = window.prompt(
                        "What did you find? (recorded in the evidence pack)",
                      );
                      run(manualCheck, {
                        auditId,
                        key: check.key,
                        status: "fail",
                        note: note ?? "",
                      });
                    }}
                  >
                    Flag
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="u-note" style={{ padding: "14px 16px 28px" }}>
            Automated checks cover a subset of WCAG. Manual checks stay in the
            evidence pack even when they pass.
          </div>
        </aside>

        <section className="u-canvas-wrap">
          <div className="u-canvas-bar">
            <div className="u-tabs" role="tablist" aria-label="Pages">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  role="tab"
                  aria-selected={activePage?.id === page.id}
                  className="u-tab"
                  data-active={activePage?.id === page.id}
                  onClick={() => setPageOverride(page.id)}
                >
                  {new URL(page.url).pathname === "/"
                    ? "/"
                    : new URL(page.url).pathname}
                  <span className="u-muted"> · {page.issueCount}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="u-seg" aria-label="Pin filter">
                <button
                  type="button"
                  data-active={!showAllPins}
                  onClick={() => setShowAllPins(false)}
                >
                  This pattern
                </button>
                <button
                  type="button"
                  data-active={showAllPins}
                  onClick={() => setShowAllPins(true)}
                >
                  All pins
                </button>
              </div>
              {activePage?.hasPatched ? (
                <div className="u-seg" aria-label="Preview version">
                  <button
                    type="button"
                    data-active={view === "before"}
                    onClick={() => setView("before")}
                  >
                    Before
                  </button>
                  <button
                    type="button"
                    data-active={view === "after"}
                    onClick={() => setView("after")}
                  >
                    After
                  </button>
                  <button
                    type="button"
                    data-active={view === "compare"}
                    onClick={() => setView("compare")}
                  >
                    Compare
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {activePage ? (
            <Canvas
              page={activePage}
              issues={pinIssues}
              activeIssueId={activeIssueId}
              view={view}
              onSelect={selectIssue}
              scanning={status === "queued" || status === "running" || rescanBusy}
            />
          ) : (
            <div className="u-canvas-empty">
              No pages were captured for this audit.
            </div>
          )}
        </section>

        <aside className="u-pane u-pane-right">
          {selectedIssue ? (
            <IssueInspector
              key={selectedIssue.id}
              issue={selectedIssue}
              cluster={selectedCluster}
              auditId={auditId}
              valueFallback={selectedIssue.proposal?.value ?? ""}
              onSave={(value, decorative) =>
                run(saveFix, {
                  issueId: selectedIssue.id,
                  value,
                  decorative,
                })
              }
              onApprove={(value, decorative) =>
                run(approveFix, {
                  issueId: selectedIssue.id,
                  value,
                  decorative,
                })
              }
              onReject={() =>
                run(rejectFix, { issueId: selectedIssue.id, reason: "" })
              }
              onApproveCluster={() => {
                if (selectedCluster) {
                  run(approveCluster, {
                    auditId,
                    ruleId: selectedCluster.ruleId,
                  });
                }
              }}
              pending={approveFix.isPending || saveFix.isPending}
            />
          ) : (
            <div className="u-canvas-empty">
              Select a pin to review a barrier.
            </div>
          )}
        </aside>
      </div>

      {ledgerOpen ? (
        <Ledger auditId={auditId} onClose={() => setLedgerOpen(false)} />
      ) : null}
      {codeOpen ? (
        <CodePack auditId={auditId} onClose={() => setCodeOpen(false)} />
      ) : null}
    </div>
  );
}

function Canvas({
  page,
  issues,
  activeIssueId,
  view,
  onSelect,
  scanning,
}: {
  page: Page;
  issues: Issue[];
  activeIssueId?: string | undefined;
  view: "before" | "after" | "compare";
  onSelect: (issue: Issue) => void;
  scanning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [split, setSplit] = useState(50);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth - 44);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scale = width > 0 ? Math.min(1.15, width / 1280) : 0.6;
  const frameWidth = 1280 * scale;
  const frameHeight = page.height * scale;
  const beforeSrc = `/api/snapshot/${page.id}`;
  const afterSrc = `/api/snapshot/${page.id}?v=after`;
  const compare = view === "compare";

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;
    const move = (moveEvent: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(96, Math.max(4, next)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="u-canvas-scroll" ref={scrollRef}>
      <div
        className="u-frame-outer"
        ref={frameRef}
        style={{ width: frameWidth, height: frameHeight }}
      >
        {compare ? (
          <>
            <iframe
              key={`${page.id}-before-compare-${page.updatedAt}`}
              src={beforeSrc}
              title={`${page.title || page.url} before fixes`}
              sandbox=""
              style={{
                width: 1280,
                height: page.height,
                transform: `scale(${scale})`,
              }}
            />
            <iframe
              key={`${page.id}-after-compare-${page.updatedAt}`}
              src={afterSrc}
              title={`${page.title || page.url} after fixes`}
              sandbox=""
              style={{
                width: 1280,
                height: page.height,
                transform: `scale(${scale})`,
                clipPath: `inset(0 0 0 ${split}%)`,
                zIndex: 2,
              }}
            />
            <div className="u-compare-labels" aria-hidden="true">
              <span>Before</span>
              <span>After</span>
            </div>
            <div
              className="u-compare-divider"
              style={{ left: `${split}%` }}
              role="slider"
              tabIndex={0}
              aria-label="Before and after split"
              aria-valuemin={4}
              aria-valuemax={96}
              aria-valuenow={Math.round(split)}
              onPointerDown={startDrag}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setSplit((value) => Math.max(4, value - 2));
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setSplit((value) => Math.min(96, value + 2));
                }
              }}
            >
              <span className="u-compare-handle">↔</span>
            </div>
          </>
        ) : (
          <>
            <iframe
              key={`${page.id}-${view}-${page.updatedAt}`}
              src={view === "after" ? afterSrc : beforeSrc}
              title={`${page.title || page.url} preview`}
              sandbox=""
              style={{
                width: 1280,
                height: page.height,
                transform: `scale(${scale})`,
              }}
            />
            <div className="u-pins">
              {scanning ? <div className="u-scan-line" /> : null}
              {issues.map((issue, index) => {
                if (!issue.rect) return null;
                const verified = issue.status === "verified";
                const manual = issue.proposal?.needsHuman;
                return (
                  <button
                    key={issue.id}
                    type="button"
                    className="u-pin"
                    data-active={activeIssueId === issue.id}
                    data-verified={verified}
                    data-manual={!verified && manual}
                    style={{
                      left: Math.max(8, issue.rect.x * scale),
                      top: Math.max(8, issue.rect.y * scale),
                    }}
                    title={`${index + 1}. ${issue.help}`}
                    aria-label={`Barrier ${index + 1}: ${issue.help}`}
                    onClick={() => onSelect(issue)}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <p
        className="u-mono u-muted"
        style={{
          textAlign: "center",
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "14px 0 4px",
        }}
      >
        {compare
          ? "Drag the divider to compare the rendered page"
          : `Rendered at 1280px · preview is inert · ${page.height}px tall`}
      </p>
    </div>
  );
}

function IssueInspector({
  issue,
  cluster,
  auditId,
  valueFallback,
  onSave,
  onApprove,
  onReject,
  onApproveCluster,
  pending,
}: {
  issue: Issue;
  cluster?: Cluster | undefined;
  auditId: string;
  valueFallback: string;
  onSave: (value: string, decorative: boolean) => void;
  onApprove: (value: string, decorative: boolean) => void;
  onReject: () => void;
  onApproveCluster: () => void;
  pending: boolean;
}) {
  const [value, setValue] = useState(issue.fix?.value ?? valueFallback);
  const [decorative, setDecorative] = useState(issue.fix?.decorative ?? false);

  useEffect(() => {
    setValue(issue.fix?.value ?? valueFallback);
    setDecorative(issue.fix?.decorative ?? false);
    // Only reset when the selected barrier changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.id]);

  const proposal = issue.proposal;
  const needsValue = proposal?.kind === "alt" ? !decorative : true;
  const canApprove = Boolean(proposal) && (!needsValue || value.trim().length > 0);
  const isVerified = issue.status === "verified";
  const isApproved = issue.fix?.status === "approved" || issue.status === "approved";
  const isRejected = issue.fix?.status === "rejected";
  const isRemaining = issue.status === "remaining";
  const isResolved = issue.status === "resolved";
  const implementation = isVerified ? buildFixCode(issue) : null;
  const askAgent = () => {
    sendToAgentChat({
      message: `Help me with this barrier: ${issue.help}`,
      context: `Unbarred audit ${auditId}; page ${issue.pageUrl}; pattern ${issue.ruleId}; barrier ${issue.id}; selector ${issue.selector}. ${
        issue.proposal?.rationale ?? ""
      } Draft a fix I can review and approve.`,
      contextLabel: "Unbarred barrier",
      openSidebar: true,
      submit: false,
      type: "content",
    });
  };
  const copyImplementation = async () => {
    if (!implementation) return;
    try {
      await navigator.clipboard.writeText(implementation.code);
      toast.success("Implementation copied");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };
  return (
    <div className="u-inspector">
      <div className="u-insp-head">
        <div style={{ minWidth: 0 }}>
          <div className="u-kicker">
            {issue.clusterTitle} · {issue.origin === "rescan" ? "new" : "baseline"}
          </div>
          <h2 className="u-insp-title">{cluster?.title ?? issue.help}</h2>
        </div>
        <div className="u-insp-head-actions">
          <button
            type="button"
            className="u-btn u-btn-sm"
            onClick={askAgent}
            title="Ask the agent about this barrier"
          >
            <IconMessage size={13} />
            Ask agent
          </button>
          <span
            className="u-stamp"
            data-tone={impactTone(issue.impact)}
            title="Impact as classified by axe"
          >
            {IMPACT_LABEL[issue.impact] ?? issue.impact}
          </span>
        </div>
      </div>

      {isVerified ? (
        <div className="u-insp-section">
          <div className="u-callout" data-tone="verified">
            <strong>Verified by re-scan.</strong>{" "}
            {issue.fix?.verifiedAt
              ? `The independent scan stopped reporting this element ${timeAgo(issue.fix.verifiedAt)}.`
              : "The independent scan stopped reporting this element."}
          </div>
          {implementation ? (
            <>
              <div className="u-label" style={{ marginTop: 12 }}>
                <span>Take this to the source</span>
                <button
                  type="button"
                  className="u-btn u-btn-sm u-btn-ghost"
                  onClick={copyImplementation}
                >
                  <IconCopy size={12} /> Copy
                </button>
              </div>
              <pre className="u-code" style={{ margin: 0 }}>
                {implementation.code}
              </pre>
              <p className="u-note">{implementation.instruction}</p>
            </>
          ) : null}
        </div>
      ) : isApproved ? (
        <div className="u-insp-section">
          <div className="u-callout">
            <strong>Approved, not yet proven.</strong> Run Verify fixes to
            re-render the page and re-scan it.
          </div>
        </div>
      ) : isRemaining ? (
        <div className="u-insp-section">
          <div className="u-callout" data-tone="critical">
            <strong>Still open after the re-scan.</strong>{" "}
            {issue.fix?.reason ||
              "The change did not clear the automated check. It may need a different value or a source-level fix."}
          </div>
        </div>
      ) : isResolved ? (
        <div className="u-insp-section">
          <div className="u-callout">
            <strong>No longer reported.</strong> The re-scan did not find this
            element, but it was not tied to an approved fix, so it is not
            counted as verified.
          </div>
        </div>
      ) : isRejected ? (
        <div className="u-insp-section">
          <div className="u-callout">
            <strong>Rejected.</strong> This barrier stays open and is not
            counted as verified.
          </div>
        </div>
      ) : null}

      <div className="u-insp-section">
        <div className="u-label">
          <span>On the page</span>
          <a
            href={issue.helpUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{ textTransform: "none", letterSpacing: 0 }}
          >
            {issue.ruleId} ↗
          </a>
        </div>
        <div className="u-code">{issue.selector}</div>
        <div className="u-code" style={{ marginTop: 6, maxHeight: 96 }}>
          {issue.snippet || "(element markup unavailable)"}
        </div>
        <p className="u-note">{issue.failureSummary}</p>
        <div className="u-tag-list" style={{ marginTop: 8 }}>
          {issue.tags
            .filter((tag) => tag.startsWith("wcag"))
            .slice(0, 4)
            .map((tag) => (
              <span className="u-tag" key={tag}>
                {tag}
              </span>
            ))}
          <a
            className="u-tag"
            href={issue.helpUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            axe rule ↗
          </a>
        </div>
      </div>

      {proposal ? (
        <div className="u-insp-section">
          <div className="u-label">
            <span>
              {proposal.needsHuman ? "Needs your judgment" : "Computed fix"}
            </span>
            <span className="u-mono" style={{ fontSize: 8.5 }}>
              {proposal.op} {proposal.name}
            </span>
          </div>

          {proposal.kind === "contrast" ? (
            <div className="u-swatches">
              <div className="u-swatch-fig">
                <span
                  className="u-swatch"
                  style={{ background: proposal.before }}
                />
                before
              </div>
              <div className="u-swatch-fig">
                <span
                  className="u-swatch"
                  style={{ background: value || proposal.after }}
                />
                after
              </div>
              <code className="u-mono" style={{ fontSize: 11 }}>
                {value || proposal.after}
              </code>
            </div>
          ) : null}

          <p className="u-copy" style={{ marginTop: 0 }}>
            {proposal.rationale}
          </p>

          {proposal.kind === "alt" ? (
            <>
              <textarea
                className="u-textarea"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Describe what the image communicates…"
                aria-label="Alternative text"
                disabled={decorative || isVerified}
              />
              <label className="u-choice">
                <input
                  type="checkbox"
                  checked={decorative}
                  disabled={isVerified}
                  onChange={(event) => setDecorative(event.target.checked)}
                />
                Decorative image — empty alt is correct
              </label>
            </>
          ) : proposal.kind === "contrast" ? (
            <input
              className="u-input u-mono"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-label="Contrast colour"
              disabled={isVerified}
            />
          ) : (
            <input
              className="u-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              aria-label="Fix value"
              disabled={isVerified}
            />
          )}

          {issue.fix?.note ? (
            <p className="u-note">Note: {issue.fix.note}</p>
          ) : null}

          {!isVerified ? (
            <div className="u-insp-actions">
              <button
                type="button"
                className="u-btn u-btn-primary"
                disabled={!canApprove || pending}
                onClick={() => onApprove(value, decorative)}
              >
                <IconCheck size={13} />
                {isApproved ? "Re-approve" : "Approve fix"}
              </button>
              <button
                type="button"
                className="u-btn"
                disabled={pending}
                onClick={() => onSave(value, decorative)}
              >
                Save draft
              </button>
              <button
                type="button"
                className="u-btn u-btn-ghost"
                disabled={pending}
                onClick={onReject}
                aria-label="Reject fix"
              >
                <IconX size={13} />
              </button>
            </div>
          ) : null}

          {cluster &&
          !cluster.needsHuman &&
          cluster.count > 1 &&
          cluster.verifiedCount < cluster.count ? (
            <button
              type="button"
              className="u-btn"
              style={{ width: "100%", marginTop: 8 }}
              disabled={pending}
              onClick={onApproveCluster}
            >
              Approve all {cluster.count} computed fixes
            </button>
          ) : null}
        </div>
      ) : (
        <div className="u-insp-section">
          <div className="u-label">Needs a source change</div>
          <div className="u-callout">
            This pattern has no safe automated patch. Fix it in the source,
            then run the re-scan — it will confirm the element is gone.
          </div>
          <a
            className="u-btn"
            style={{ marginTop: 10 }}
            href={issue.helpUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Read the rule <IconExternalLink size={12} />
          </a>
        </div>
      )}

      {cluster ? (
        <div className="u-insp-section">
          <div className="u-label">
            <span>Pattern</span>
            <span className="u-mono" style={{ fontSize: 8.5 }}>
              {cluster.verifiedCount}/{cluster.count} verified
            </span>
          </div>
          <p className="u-copy" style={{ margin: 0 }}>
            {cluster.needsHuman
              ? "This pattern needs a person. Automation cannot judge the wording."
              : "This pattern has a deterministic correction. Approve the values you agree with."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function pageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" ? "/" : parsed.pathname;
  } catch {
    return url;
  }
}

function CodePack({
  auditId,
  onClose,
}: {
  auditId: string;
  onClose: () => void;
}) {
  const packQuery = useActionQuery("export-code-pack", { auditId });
  const pack = packQuery.data;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };

  const byPage = new Map<string, NonNullable<typeof pack>["changes"]>();
  for (const change of pack?.changes ?? []) {
    const list = byPage.get(change.pageUrl) ?? [];
    list.push(change);
    byPage.set(change.pageUrl, list);
  }

  return (
    <>
      <div className="u-veil" onClick={onClose} aria-hidden="true" />
      <aside
        className="u-ledger"
        role="dialog"
        aria-label="Implementation pack"
      >
        <div className="u-ledger-head">
          <div>
            <div className="u-kicker">Implementation pack</div>
            <h2>{pack?.site ?? "Verified changes"}</h2>
            {pack ? (
              <p
                className="u-mono u-muted"
                style={{ fontSize: 9.5, marginTop: 4 }}
              >
                {pack.counts.verified} verified · {pack.counts.approved} approved
                · {pack.counts.remaining} still open
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="u-btn u-btn-ghost"
            onClick={onClose}
            aria-label="Close implementation pack"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="u-ledger-body">
          <div className="u-export-grid">
            <button
              type="button"
              className="u-btn"
              disabled={!pack}
              onClick={() =>
                pack &&
                copy(pack.markdown, "Implementation pack")
              }
            >
              <IconCopy size={13} /> Copy all
            </button>
            <button
              type="button"
              className="u-btn"
              disabled={!pack}
              onClick={() =>
                pack &&
                download(
                  `${pack.site.replace(/\s+/g, "-").toLowerCase()}-fix-pack.md`,
                  pack.markdown,
                  "text/markdown",
                )
              }
            >
              <IconDownload size={13} /> Markdown
            </button>
            <button
              type="button"
              className="u-btn"
              disabled={!pack}
              onClick={() =>
                pack &&
                download(
                  `${pack.site.replace(/\s+/g, "-").toLowerCase()}-fix-pack.json`,
                  pack.json,
                  "application/json",
                )
              }
            >
              <IconDownload size={13} /> JSON
            </button>
          </div>
          <p className="u-note">
            These are the changes the independent re-scan verified. Apply them
            in the client’s source, then run the project’s tests. Unbarred
            verified the rendered page, not the build.
          </p>

          {!pack ? (
            <p className="u-empty">Building the pack…</p>
          ) : pack.changes.length === 0 ? (
            <p className="u-empty">
              No verified fixes yet. Approve changes and run Verify fixes first.
            </p>
          ) : (
            [...byPage.entries()].map(([pageUrl, changes]) => (
              <div key={pageUrl}>
                <div className="u-label" style={{ marginTop: 18 }}>
                  <span>{pageLabel(pageUrl)}</span>
                  <span>{changes.length}</span>
                </div>
                {changes.map((change) => (
                  <div className="u-code-card" key={change.issueId}>
                    <div className="u-code-card-head">
                      <span>{change.help}</span>
                      <button
                        type="button"
                        className="u-btn u-btn-sm u-btn-ghost"
                        onClick={() => copy(change.code, "Change")}
                      >
                        <IconCopy size={12} /> Copy
                      </button>
                    </div>
                    <div className="u-mono u-muted" style={{ fontSize: 9 }}>
                      {change.selector}
                    </div>
                    <pre className="u-code">{change.code}</pre>
                    <div className="u-note">{change.instruction}</div>
                    <div className="u-code-before">
                      {change.before ? `${change.before} → ` : ""}
                      {change.after}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

function Ledger({ auditId, onClose }: { auditId: string; onClose: () => void }) {
  const detailQuery = useActionQuery("get-audit", { auditId });
  const exportQuery = useActionQuery("export-evidence", { auditId });
  const evidence = detailQuery.data?.evidence ?? [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const projectName = detailQuery.data?.audit.projectName ?? "audit";
  const summary = exportQuery.data?.summary;

  return (
    <>
      <div className="u-veil" onClick={onClose} aria-hidden="true" />
      <aside className="u-ledger" role="dialog" aria-label="Evidence ledger">
        <div className="u-ledger-head">
          <div>
            <div className="u-kicker">Evidence ledger</div>
            <h2>{projectName}</h2>
            {summary ? (
              <p className="u-mono u-muted" style={{ fontSize: 9.5, marginTop: 4 }}>
                {summary.barriers} found · {summary.verified} verified ·{" "}
                {summary.remaining} remaining · {summary.manualChecksOpen}{" "}
                manual open
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="u-btn u-btn-ghost"
            onClick={onClose}
            aria-label="Close ledger"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="u-ledger-body">
          <div className="u-export-grid">
            <button
              type="button"
              className="u-btn"
              disabled={!exportQuery.data}
              onClick={() =>
                exportQuery.data &&
                download(
                  `${projectName.replace(/\s+/g, "-").toLowerCase()}-evidence.json`,
                  exportQuery.data.json,
                  "application/json",
                )
              }
            >
              <IconDownload size={13} /> JSON pack
            </button>
            <button
              type="button"
              className="u-btn"
              disabled={!exportQuery.data}
              onClick={() =>
                exportQuery.data &&
                download(
                  `${projectName.replace(/\s+/g, "-").toLowerCase()}-barriers.csv`,
                  exportQuery.data.csv,
                  "text/csv",
                )
              }
            >
              <IconDownload size={13} /> CSV rows
            </button>
          </div>
          <p className="u-note" style={{ marginTop: 0 }}>
            Every approval and re-scan result is recorded with an actor and a
            timestamp. The JSON pack includes the axe version and the
            disclaimer.
          </p>
          {exportQuery.data?.ledgerHead ? (
            <p className="u-note" style={{ marginTop: 0 }}>
              Ledger head{" "}
              <code className="u-mono" style={{ fontSize: 9 }}>
                {exportQuery.data.ledgerHead.slice(0, 16)}…
              </code>{" "}
              — each entry is chained to the one before it.
            </p>
          ) : null}

          {evidence.length === 0 ? (
            <p className="u-empty">No ledger entries yet.</p>
          ) : (
            evidence.map((event) => (
              <div className="u-ledger-item" key={event.id}>
                <div className="u-ledger-time">
                  {new Date(event.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  <br />
                  {new Date(event.createdAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div>
                  <div className="u-ledger-type">{event.type}</div>
                  <div className="u-ledger-summary">{event.summary}</div>
                  <div className="u-ledger-actor">{event.actor}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
