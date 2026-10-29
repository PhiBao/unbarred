export const MANUAL_CHECKS = [
  {
    key: "keyboard",
    label: "Every control is reachable by keyboard, with visible focus.",
  },
  {
    key: "focus-order",
    label: "Focus order follows the visual order of the page.",
  },
  {
    key: "alt-quality",
    label: "Alt text describes purpose, not appearance, and decorative images are empty.",
  },
  {
    key: "forms",
    label: "Labels and error messages make sense out of context.",
  },
  {
    key: "media",
    label: "Video has captions and audio has a transcript.",
  },
  {
    key: "reading-order",
    label: "The reading order still makes sense with styles turned off.",
  },
] as const;
