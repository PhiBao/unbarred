import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { requireEmail } from "../server/lib/access.js";
import { loadAuditDetail } from "../server/lib/queries.js";
import { zAuditDetail } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Read one audit in full: counts, pages, issue patterns, manual checks, and recent ledger entries.",
  schema: z.object({
    auditId: z.string().describe("Audit id"),
  }),
  http: { method: "GET" },
  link: (ctx) => ({
    url: `/workbench/${ctx.result.audit.id}`,
    label: "Open the workbench",
  }),
  outputSchema: zAuditDetail,
  run: async ({ auditId }, ctx) => {
    const email = requireEmail(ctx);
    const detail = await loadAuditDetail(auditId, email);
    if (!detail) {
      fail("That audit was not found.", {
        errorCode: "audit_not_found",
        statusCode: 404,
      });
    }
    return detail;
  },
});
