import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireEmail } from "../server/lib/access.js";
import { loadIssues } from "../server/lib/queries.js";
import { zIssue } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "List the barriers in an audit with their proposed fixes. Filter by pattern (ruleId), page, or status.",
  schema: z.object({
    auditId: z.string().describe("Audit id"),
    ruleId: z
      .string()
      .optional()
      .describe("Pattern id such as color-contrast or image-alt"),
    pageId: z.string().optional().describe("Restrict to one page id"),
    status: z
      .enum(["open", "approved", "rejected", "verified", "remaining", "resolved"])
      .optional()
      .describe("Restrict to one issue status"),
  }),
  http: { method: "GET" },
  outputSchema: z.object({ issues: z.array(zIssue) }),
  run: async ({ auditId, ruleId, pageId, status }, ctx) => {
    const email = requireEmail(ctx);
    const filters: { ruleId?: string; pageId?: string; status?: string } = {};
    if (ruleId) filters.ruleId = ruleId;
    if (pageId) filters.pageId = pageId;
    if (status) filters.status = status;
    const issues = await loadIssues(auditId, email, filters);
    return { issues: issues ?? [] };
  },
});
