import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { loadAuditDetail, loadIssues } from "../server/lib/queries.js";

export default defineAction({
  description:
    "Read what the user is looking at. On the workbench this includes the audit, the selected pattern, and the selected barrier. Basic navigation is already in <current-screen>; use this for a fresh read.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx) => {
    const navigation = (await readAppState("navigation")) as
      | { view?: string; path?: string }
      | null
      | undefined;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const path = navigation?.path ?? "";
    const match = path.match(/\/workbench\/([^/?#]+)/);
    const email = ctx?.userEmail;
    if (match && email) {
      const auditId = decodeURIComponent(match[1]!);
      const detail = await loadAuditDetail(auditId, email);
      if (detail) {
        const params = new URLSearchParams(path.split("?")[1] ?? "");
        const ruleId = params.get("cluster") ?? undefined;
        const issueId = params.get("issue") ?? undefined;
        const pageId = params.get("page") ?? undefined;
        const filters: { ruleId?: string; pageId?: string } = {};
        if (ruleId) filters.ruleId = ruleId;
        if (pageId) filters.pageId = pageId;
        const issues = await loadIssues(auditId, email, filters);
        const selected = issueId
          ? issues?.find((issue) => issue.id === issueId)
          : undefined;
        screen.workbench = {
          audit: detail.audit,
          patterns: detail.clusters,
          pages: detail.pages,
          selection: {
            ruleId: ruleId ?? null,
            pageId: pageId ?? null,
            issueId: issueId ?? null,
            cluster: ruleId
              ? (detail.clusters.find((cluster) => cluster.ruleId === ruleId) ??
                null)
              : null,
            issue: selected ?? null,
          },
          counts: {
            approved: detail.approvedCount,
            drafts: detail.draftCount,
            rejected: detail.rejectedCount,
          },
          manualChecks: detail.manualChecks,
        };
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
