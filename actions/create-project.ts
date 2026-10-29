import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { projects } from "../server/db/schema.js";
import {
  newId,
  normalizeUrl,
  requireEmail,
  siteName,
} from "../server/lib/access.js";

export default defineAction({
  deferLoading: false,
  description:
    "Create or reuse a site record for a URL. Audits attach to a site so a client's pages stay together.",
  schema: z.object({
    url: z.string().describe("Public http(s) URL for the site"),
    name: z
      .string()
      .optional()
      .describe("Display name, for example the client or business name"),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    created: z.boolean(),
  }),
  run: async ({ url, name }, ctx) => {
    const email = requireEmail(ctx);
    const normalized = normalizeUrl(url);
    const db = getDb();

    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerEmail, email), eq(projects.url, normalized)))
      .limit(1);

    if (existing) {
      const nextName = name?.trim();
      if (nextName && nextName !== existing.name) {
        await db
          .update(projects)
          .set({ name: nextName })
          .where(eq(projects.id, existing.id));
        return { ...existing, name: nextName, created: false };
      }
      return { ...existing, created: false };
    }

    const row = {
      id: newId(),
      name: name?.trim() || siteName(normalized),
      url: normalized,
      ownerEmail: email,
    };
    await db.insert(projects).values(row);
    return { ...row, created: true };
  },
});
