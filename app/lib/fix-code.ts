type FixLike = {
  value: string;
  decorative: boolean;
  kind: string;
  name?: string;
  op?: string;
};

type IssueLike = {
  ruleId: string;
  selector: string;
  help: string;
  proposal: { before: string; rationale: string } | null;
  fix: FixLike | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The implementation a developer can carry into their own source. This is
 * deliberately a small, reviewable change — not a generated rewrite.
 */
export function buildFixCode(issue: IssueLike): {
  language: "css" | "html" | "text";
  code: string;
  instruction: string;
  before: string;
  after: string;
} | null {
  const fix = issue.fix;
  if (!fix) return null;
  const after = fix.decorative ? "" : fix.value;
  const before = issue.proposal?.before ?? "";
  const rationale = issue.proposal?.rationale ?? issue.help;

  if (fix.kind === "contrast") {
    return {
      language: "css",
      code: `${issue.selector} {\n  color: ${after};\n}`,
      instruction: `Set the text colour of ${issue.selector} to ${after}${before ? ` (was ${before})` : ""}.`,
      before,
      after,
    };
  }
  if (fix.kind === "alt") {
    const attr = `alt="${escapeHtml(after)}"`;
    return {
      language: "html",
      code: `<!-- ${issue.selector} -->\n${attr}`,
      instruction: fix.decorative
        ? `Mark ${issue.selector} as decorative with an empty alt attribute.`
        : `Set ${issue.selector} to ${attr}.`,
      before,
      after: fix.decorative ? "(decorative)" : after,
    };
  }
  if (fix.kind === "lang") {
    return {
      language: "html",
      code: `<html lang="${escapeHtml(after)}">`,
      instruction: `Declare the page language on the root element.`,
      before,
      after,
    };
  }
  if (fix.kind === "title") {
    return {
      language: "html",
      code: `<title>${escapeHtml(after)}</title>`,
      instruction: `Give the page a descriptive title.`,
      before,
      after,
    };
  }
  if (["label", "link-name", "button-name"].includes(fix.kind)) {
    return {
      language: "html",
      code: `<!-- ${issue.selector} -->\naria-label="${escapeHtml(after)}"`,
      instruction: `Give ${issue.selector} the accessible name “${after}”.`,
      before,
      after,
    };
  }
  return {
    language: "text",
    code: `${issue.selector}: ${fix.op ?? "set-attr"} ${fix.name ?? "value"}="${escapeHtml(after)}"`,
    instruction: rationale,
    before,
    after,
  };
}
