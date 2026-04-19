// chat/FlagIcon.tsx — Simple flag icon component for automation banners.

export function FlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14V2m0 1h7l-1.6 2.4L10 8H3" />
    </svg>
  );
}
