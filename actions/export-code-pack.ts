import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { buildFixCode } from "../app/lib/fix-code.js";
import { requireEmail } from "../server/lib/access.js";
import { loadAuditDetail, loadIssues } from "../server/lib/queries.js";

function mdFence(value: string): string {
  return value.replace(/```/g, "` ` `");
}

export default defineAction({
  deferLoading: false,
  description:
    "Build the implementation pack for an audit: one reviewable code change per verified fix, grouped by page, plus Markdown and JSON downloads.",
  schema: z.object({ auditId: z.string().describe("Audit id") }),
  http: { method: "GET" },
  outputSchema: z.object({
    auditId: z.string(),
    site: z.string(),
    url: z.string(),
    generatedAt: z.string(),
    counts: z.object({
      verified: z.number(),
      approved: z.number(),
      remaining: z.number(),
    }),
    changes: z.array(
      z.object({
        issueId: z.string(),
        ruleId: z.string(),
        help: z.string(),
        pageUrl: z.string(),
        selector: z.string(),
        kind: z.string(),
        language: z.enum(["css", "html", "text"]),
        code: z.string(),
        instruction: z.string(),
        before: z.string(),
        after: z.string(),
        verifiedAt: z.string().nullable(),
      }),
    ),
    markdown: z.string(),
    json: z.string(),
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

    const changes = issueRows
      .filter((issue) => issue.fix?.status === "verified")
      .map((issue) => {
        const code = buildFixCode(issue);
        if (!code) return null;
        return {
          issueId: issue.id,
          ruleId: issue.ruleId,
          help: issue.clusterTitle,
          pageUrl: issue.pageUrl,
          selector: issue.selector,
          kind: issue.fix?.kind ?? "custom",
          language: code.language,
          code: code.code,
          instruction: code.instruction,
          before: code.before,
          after: code.after,
          verifiedAt: issue.fix?.verifiedAt ?? null,
        };
      })
      .filter((change): change is NonNullable<typeof change> => Boolean(change));

    const generatedAt = new Date().toISOString();
    const byPage = new Map<string, typeof changes>();
    for (const change of changes) {
      const list = byPage.get(change.pageUrl) ?? [];
      list.push(change);
      byPage.set(change.pageUrl, list);
    }

    const lines: string[] = [
      `# Unbarred implementation pack — ${detail.audit.projectName}`,
      "",
      `Site: ${detail.audit.url}`,
      `Generated: ${generatedAt}`,
      "",
      "These changes were approved by a person and verified by an independent re-scan.",
      "Apply them in the client's source, then run the project's own tests. Unbarred",
      "verified the rendered page, not the client's build.",
      "",
      `Verified ${changes.length} · still open ${detail.audit.remainingCount}.`,
      "",
    ];
    for (const [pageUrl, pageChanges] of byPage) {
      lines.push(`## ${pageUrl}`, "");
      for (const change of pageChanges) {
        lines.push(`### ${change.help}`, "");
        lines.push(`Selector: \`${change.selector}\``);
        if (change.before) lines.push(`Before: \`${change.before}\``);
        lines.push(`After: \`${change.after}\``);
        lines.push("", `\`\`\`${change.language}`, mdFence(change.code), "```", "");
        lines.push(change.instruction, "");
      }
    }

    return {
      auditId,
      site: detail.audit.projectName,
      url: detail.audit.url,
      generatedAt,
      counts: {
        verified: detail.audit.verifiedCount,
        approved: detail.approvedCount,
        remaining: detail.audit.remainingCount,
      },
      changes,
      markdown: lines.join("\n"),
      json: JSON.stringify(
        {
          product: "Unbarred",
          generatedAt,
          site: detail.audit.projectName,
          url: detail.audit.url,
          disclaimer:
            "These are verified changes to the rendered page. Apply them in source and run the project's tests; this is not a compliance certificate.",
          changes,
        },
        null,
        2,
      ),
    };
  },
});
