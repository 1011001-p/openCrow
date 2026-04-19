// config/SaveBar.tsx — Reusable save action bar with status feedback.
"use client";

import { Button } from "@/components/ui/Button";

export function SaveBar({
  onClick,
  loading,
  label,
  status,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
  status?: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button onClick={onClick} loading={loading}>
        {label}
      </Button>
      {status && <span className="text-cyan text-sm">{status}</span>}
    </div>
  );
}
