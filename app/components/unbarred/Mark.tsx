export function UnbarredMark({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="13" fill="#14120f" />
      <path
        d="M17 53V31a15 15 0 0 1 30 0v22"
        fill="none"
        stroke="#f6f1e7"
        strokeWidth="5.5"
        strokeLinecap="square"
      />
      <path
        d="M24 41.5l6 6 12-14"
        fill="none"
        stroke="#2fa36b"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="u-wordmark">
      <UnbarredMark size={compact ? 22 : 26} />
      <span className="u-wordmark-text">unbarred</span>
    </span>
  );
}
