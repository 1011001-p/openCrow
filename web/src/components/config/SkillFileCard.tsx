"use client";

import { useState } from "react";
import type { SkillFile } from "@/lib/api";
import { endpoints } from "@/lib/api";
import { TextArea } from "@/components/ui/TextArea";
import { Button } from "@/components/ui/Button";

export function SkillFileCard({
  sf,
  onSave,
  onDelete,
}: {
  sf: SkillFile;
  onSave: (slug: string, content: string) => void;
  onDelete: (slug: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleToggle = async () => {
    if (!expanded && content === null) {
      setLoading(true);
      try {
        const file = await endpoints.getSkillFile(sf.slug);
        setContent(file.content ?? "");
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await endpoints.updateSkillFile(sf.slug, content ?? "");
      onSave(sf.slug, content ?? "");
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-surface-mid overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
        onClick={handleToggle}
      >
        <span className="font-medium text-sm flex-1 truncate">{sf.name || sf.slug}</span>
        {sf.description && (
          <span className="text-xs text-on-surface-variant truncate hidden sm:block max-w-[240px]">
            {sf.description}
          </span>
        )}
        {loading && <span className="text-xs text-on-surface-variant">loading…</span>}
        <svg
          className={`w-4 h-4 text-on-surface-variant transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-4 space-y-3 border-t border-white/10">
          <TextArea
            label="Content (SKILL.md)"
            value={content ?? ""}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
          />
          {sf.path && <p className="text-xs text-on-surface-variant/50 font-mono">{sf.path}</p>}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto hover:text-error"
              onClick={() => onDelete(sf.slug)}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
