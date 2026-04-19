import { formatTime, isUuid } from "./helpers";
import { MarkdownMessage } from "./MarkdownMessage";
import { formatAttachmentSize } from "./attachments";
import { FileIcon, CopyIcon, RegenIcon } from "@/components/ui/icons";
import type { MessageDTO } from "@/lib/api";

type MessageItemProps = {
  msg: MessageDTO;
  streamingMsgId: string | null;
  regeneratingId: string | null;
  copiedId: string | null;
  onCopy: (id: string, content: string) => void;
  onRegenerate: (id: string) => void;
};

export function MessageItem({
  msg,
  streamingMsgId,
  regeneratingId,
  copiedId,
  onCopy,
  onRegenerate,
}: MessageItemProps) {
  if (msg.role === "system") {
    const isError =
      msg.content.startsWith("Failed") ||
      msg.content.toLowerCase().includes("error") ||
      msg.id.startsWith("err-");
    return (
      <div className="text-center animate-in fade-in slide-in-from-bottom-1 duration-300">
        <p className={`text-xs font-mono ${isError ? "text-error" : "text-on-surface-variant"}`}>
          {msg.content}
        </p>
      </div>
    );
  }

  const isUser = msg.role === "user";
  const canRegenerate = msg.role === "assistant" && isUuid(msg.id) && !msg.id.startsWith("stream-");

  return (
    <div
      className={`flex group ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
    >
      {!isUser && (
        <div className="shrink-0 mt-3 mr-2">
          <span className="block h-2 w-2 rounded-full bg-cyan" />
        </div>
      )}
      <div
        className={`max-w-[70%] rounded-lg p-4 border ${isUser ? "bg-violet/5 border-violet/20" : "bg-surface-high border-outline-ghost"}`}
      >
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-on-surface-variant font-mono mb-1">
          {msg.role}
          <span className="inline-block h-1 w-1 rounded-full bg-on-surface-variant/50" />
          {formatTime(msg.createdAt)}
        </p>
        <div className="text-sm text-on-surface font-body break-words">
          {msg.role === "assistant" && msg.id === streamingMsgId && msg.content === "" ? (
            <div className="flex items-center gap-2 py-0.5">
              {[3, 1.5, 2].map((w, i) => (
                <div
                  key={i}
                  className="h-[1em] rounded bg-on-surface-variant/20 animate-pulse"
                  style={{
                    width: `${w}rem`,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          ) : msg.role === "assistant" ? (
            <MarkdownMessage content={msg.content} />
          ) : (
            <MarkdownMessage content={msg.content} compact />
          )}

          {!!msg.attachments?.length && (
            <div className="mt-3 grid gap-2">
              {msg.attachments.map((att, index) => {
                const isImage = att.mimeType?.startsWith("image/");
                const attachmentKey = att.id || `${att.fileName}-${index}`;
                return (
                  <a
                    key={attachmentKey}
                    href={att.dataUrl}
                    download={att.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-white/10 bg-surface-mid px-3 py-2 text-xs hover:bg-surface-high transition-colors overflow-hidden"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isImage ? (
                        <span className="font-mono text-on-surface-variant">IMG</span>
                      ) : (
                        <FileIcon className="h-4 w-4 text-on-surface-variant" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{att.fileName}</span>
                      <span className="ml-auto shrink-0 max-w-[45%] truncate text-right text-on-surface-variant font-mono">
                        {[att.mimeType, formatAttachmentSize(att.sizeBytes)]
                          .filter(Boolean)
                          .join(" . ")}
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
        {!isUser && (
          <div className="flex items-center justify-end gap-0.5 mt-2">
            <button
              onClick={() => msg.content && onCopy(msg.id, msg.content)}
              disabled={!msg.content}
              className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface px-1.5 py-0.5 rounded hover:cursor-pointer transition-colors font-mono disabled:opacity-30 disabled:cursor-default"
              title="Copy"
            >
              {copiedId === msg.id ? <span className="text-[10px]">copied</span> : <CopyIcon />}
            </button>
            {canRegenerate && (
              <button
                onClick={() => onRegenerate(msg.id)}
                disabled={!!regeneratingId || !msg.content}
                className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-cyan px-1.5 py-0.5 rounded hover:cursor-pointer transition-colors font-mono disabled:opacity-30 disabled:cursor-default"
                title="Regenerate"
              >
                <RegenIcon className={regeneratingId === msg.id ? "animate-spin" : ""} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
