import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { requireEmail } from "../server/lib/access.js";
import { loadAuditDetail, loadIssues } from "../server/lib/queries.js";

function csvCell(value: string): string {
  const text = value.replace(/\r?\n/g, " ").trim();
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default defineAction({
  deferLoading: false,
  description:
    "Export the audit as a client-ready evidence pack: a JSON record with the ledger, plus CSV rows for every barrier and fix.",
  schema: z.object({
    auditId: z.string().describe("Audit id"),
  }),
  http: { method: "GET" },
  outputSchema: z.object({
    json: z.string(),
    csv: z.string(),
    summary: z.object({
      auditId: z.string(),
      site: z.string(),
      url: z.string(),
      generatedAt: z.string(),
      barriers: z.number(),
      verified: z.number(),
      remaining: z.number(),
      manualChecksOpen: z.number(),
    }),
  }),
  run: async ({ auditId }, ctx) => {
    const email = requireEmail(ctx);
    const detail = await loadAuditDetail(auditId, email);
    const issueRows = await loadIssues(auditId, email);
    if (!detail || !issueRows) {
      fail("That audit was not found.", {
        errorCode: "audit_not_found",
        statusCode: 404,
      });
    }

    const generatedAt = new Date().toISOString();
    const report = {
      product: "Unbarred",
      generatedAt,
      disclaimer:
        "Automated checks cover a subset of WCAG. This record documents what was tested, what was changed, and what an independent re-scan observed. It is not a certification of compliance.",
      audit: detail.audit,
      pages: detail.pages,
      patterns: detail.clusters,
      manualChecks: detail.manualChecks,
      issues: issueRows.map((issue) => ({
        ruleId: issue.ruleId,
        impact: issue.impact,
        help: issue.help,
        page: issue.pageUrl,
        selector: issue.selector,
        status: issue.status,
        proposal: issue.proposal,
        fix: issue.fix
          ? {
              kind: issue.fix.kind,
              value: issue.fix.decorative ? "(decorative)" : issue.fix.value,
              status: issue.fix.status,
              approvedBy: issue.fix.approvedBy,
              approvedAt: issue.fix.approvedAt,
              verifiedAt: issue.fix.verifiedAt,
              reason: issue.fix.reason,
            }
          : null,
      })),
      ledger: detail.evidence,
    };

    const header = [
      "rule",
      "impact",
      "page",
      "selector",
      "status",
      "fix_kind",
      "fix_value",
      "approved_by",
      "approved_at",
      "verified_at",
      "rescan_reason",
    ];
    const rows = issueRows.map((issue) =>
      [
        issue.ruleId,
        issue.impact,
        issue.pageUrl,
        issue.selector,
        issue.status,
        issue.fix?.kind ?? "",
        issue.fix?.decorative
          ? "(decorative)"
          : (issue.fix?.value ?? ""),
        issue.fix?.approvedBy ?? "",
        issue.fix?.approvedAt ?? "",
        issue.fix?.verifiedAt ?? "",
        issue.fix?.reason ?? "",
      ]
        .map((cell) => csvCell(String(cell)))
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");

    return {
      json: JSON.stringify(report, null, 2),
      csv,
      summary: {
        auditId,
        site: detail.audit.projectName,
        url: detail.audit.url,
        generatedAt,
        barriers: detail.audit.issueCount,
        verified: detail.audit.verifiedCount,
        remaining: detail.audit.remainingCount,
        manualChecksOpen: detail.manualChecks.filter(
          (check) => check.status === "open",
        ).length,
      },
    };
  },
});
