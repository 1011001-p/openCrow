// chat/helpers.ts — Utility functions for the chat UI.

/** Format an ISO datetime as a short time string (e.g. "2:30 PM"). */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Check if a string is a valid UUID v1-5. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Human-readable label for automatic conversation types. */
export function automationLabel(kind?: string) {
  switch (kind) {
    case "scheduled_task":
      return "Scheduled task";
    case "heartbeat":
      return "Heartbeat";
    default:
      return "Automatic conversation";
  }
}

/**
 * Display a value as formatted text. Returns the text representation
 * and whether it looks like JSON (for styling purposes).
 */
export function displayValue(value: unknown): { text: string; isJson: boolean } {
  if (value == null) return { text: "", isJson: false };
  if (typeof value === "object") {
    try {
      return { text: JSON.stringify(value, null, 2), isJson: true };
    } catch {
      return { text: String(value), isJson: false };
    }
  }

  const text = String(value);
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") {
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    }
    return { text, isJson: false };
  } catch {
    return { text, isJson: false };
  }
}

/** Split content by markdown image patterns and render inline images. */
export function renderMessageContent(content: string) {
  const parts = content.split(/(!\[.*?\]\(data:[^)]+\))/g);
  return parts.map((part, i) => {
    const imgMatch = part.match(/!\[(.*?)\]\((data:[^)]+)\)/);
    if (imgMatch) {
      return { kind: "image" as const, src: imgMatch[2], alt: imgMatch[1], key: i };
    }
    return part ? { kind: "text" as const, text: part, key: i } : null;
  }).filter(Boolean);
}
