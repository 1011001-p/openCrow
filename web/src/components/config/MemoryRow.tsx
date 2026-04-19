// config/MemoryRow.tsx — Expandable memory entry editor row.
"use client";

import { useState } from "react";
import type { MemoryEntry } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Button } from "@/components/ui/Button";

export function MemoryRow({
  mem,
  index: i,
  onUpdate,
  onDelete,
}: {
  mem: MemoryEntry;
  index: number;
  onUpdate: (updated: MemoryEntry) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-white/10 bg-surface-mid overflow-hidden">
      {/* Compact row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-xs font-mono text-cyan/70 bg-cyan/10 px-1.5 py-0.5 rounded shrink-0">{mem.category || "--"}</span>
        <span className="text-sm text-on-surface flex-1 truncate">{mem.content}</span>
        <span className="text-xs text-on-surface-variant shrink-0">{mem.confidence ?? 50}%</span>
        <svg className={`w-3.5 h-3.5 text-on-surface-variant transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Category"
              value={mem.category}
              onChange={(e) => onUpdate({ ...mem, category: e.target.value })}
            />
            <Input
              label="Confidence (%)"
              type="number"
              min={0}
              max={100}
              step={5}
              value={mem.confidence ?? 50}
              onChange={(e) => onUpdate({ ...mem, confidence: Math.min(100, Math.max(0, parseInt(e.target.value) || 50)) })}
            />
          </div>
          <TextArea
            label="Content"
            value={mem.content}
            onChange={(e) => onUpdate({ ...mem, content: e.target.value })}
            rows={3}
          />
          <Button variant="ghost" size="sm" className="hover:text-error" onClick={onDelete}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
