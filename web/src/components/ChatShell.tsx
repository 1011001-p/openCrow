"use client";

import { useState, useEffect, useRef, useCallback, type ChangeEvent, type KeyboardEvent } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import {
  endpoints,
  type ConversationDTO,
  type MessageDTO,
  type ProviderConfig,
  type ToolCallRecord,
  type TokenUsage,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
// Input import removed - using plain input in composer
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";

// ─── Helpers ───

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function FlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14V2m0 1h7l-1.6 2.4L10 8H3" />
    </svg>
  );
}

function automationLabel(kind?: string) {
  switch (kind) {
    case "scheduled_task":
      return "Scheduled task";
    case "heartbeat":
      return "Heartbeat";
    default:
      return "Automatic conversation";
  }
}

function safeMarkdownUrlTransform(url: string) {
  if (/^data:image\//i.test(url)) return url;
  return defaultUrlTransform(url);
}

function MarkdownImage({ src, alt }: { src?: string | Blob | null; alt?: string | null }) {
  if (typeof src !== "string" || !src) return null;
  return <img src={src} alt={alt ?? ""} className="mt-2 max-w-full rounded-lg max-h-64 object-contain" />;
}

function linkifyPlainUrls(content: string): string {
  return content.replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+)/gi, (_, prefix: string, raw: string) => {
    let url = raw;
    let trailing = "";
    while (/[),.;!?]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    return `${prefix}<${url}>${trailing}`;
  });
}

function displayValue(value: unknown): { text: string; isJson: boolean } {
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


function MarkdownMessage({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <ReactMarkdown
      urlTransform={safeMarkdownUrlTransform}
      components={{
        p: ({ children }) => <p className={compact ? "mb-1.5 last:mb-0" : "mb-2 last:mb-0"}>{children}</p>,
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          return isBlock ? (
            <pre className={`${compact ? "bg-black/20" : "bg-black/30"} rounded p-2 overflow-x-auto my-2 text-xs font-mono`}>
              <code>{children}</code>
            </pre>
          ) : (
            <code className={`${compact ? "bg-black/20" : "bg-black/30"} rounded px-1 py-0.5 text-xs font-mono`}>{children}</code>
          );
        },
        ul: ({ children }) => <ul className={compact ? "list-disc pl-4 mb-1.5 space-y-0.5" : "list-disc pl-4 mb-2 space-y-1"}>{children}</ul>,
        ol: ({ children }) => <ol className={compact ? "list-decimal pl-4 mb-1.5 space-y-0.5" : "list-decimal pl-4 mb-2 space-y-1"}>{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h1 className="text-base font-bold mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-semibold mb-1.5">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-medium mb-1">{children}</h3>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-white/20 pl-3 italic opacity-80">{children}</blockquote>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener" className="text-violet underline">{children}</a>,
        img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
      }}
    >
      {linkifyPlainUrls(content)}
    </ReactMarkdown>
  );
}


// ─── Message Content Renderer ───
function renderMessageContent(content: string) {
  // Split by markdown image pattern and render inline images
  const parts = content.split(/(!\[.*?\]\(data:[^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const imgMatch = part.match(/!\[(.*?)\]\((data:[^)]+)\)/);
        if (imgMatch) {
          return (
            <img
              key={i}
              src={imgMatch[2]}
              alt={imgMatch[1]}
              className="mt-2 max-w-full rounded-lg max-h-64 object-contain"
            />
          );
        }
        return part ? <span key={i} className="whitespace-pre-wrap">{part}</span> : null;
      })}
    </>
  );
}

// ─── Chat Shell ───

type ChatShellProps = {
  activeConversationId: string | null;
  onActiveConversationChange: (id: string | null) => void;
  onConversationsUpdate: (conversations: ConversationDTO[]) => void;
};

export default function ChatShell({
  activeConversationId,
  onActiveConversationChange,
  onConversationsUpdate,
}: ChatShellProps) {
  // State
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [toolCallHistory, setToolCallHistory] = useState<ToolCallRecord[]>([]);
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState("");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ file: File; dataUrl: string }[]>([]);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextMsgLoad = useRef(false);
  const conversationsRef = useRef<ConversationDTO[]>([]);

  // Keep ref in sync so handleSend can build the updated list without stale closure
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // ─── Load conversations on mount ───
  useEffect(() => {
    setLoadingConvs(true);
    endpoints
      .listConversations()
      .then((data) => {
        const list = data ?? [];
        setConversations(list);
        onConversationsUpdate(list);
      })
      .catch(() => {})
      .finally(() => setLoadingConvs(false));
  }, [onConversationsUpdate]);

  // ─── Load messages when active conversation changes ───
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setToolCallHistory([]);
      composeRef.current?.focus();
      return;
    }
    if (skipNextMsgLoad.current) {
      skipNextMsgLoad.current = false;
      return;
    }
    setLoadingMsgs(true);
    Promise.all([
      endpoints.getMessages(activeConversationId),
      endpoints.getToolCalls(activeConversationId),
    ])
      .then(([msgs, calls]) => {
        setMessages(msgs ?? []);
        setToolCallHistory(calls ?? []);
      })
      .catch(() => {})
      .finally(() => {
        setLoadingMsgs(false);
        composeRef.current?.focus();
      });
  }, [activeConversationId]);

  // ─── Load providers from config ───
  useEffect(() => {
    endpoints
      .getConfig()
      .then((cfg) => {
        const enabled = cfg.llm.providers.filter((p) => p.enabled);
        setProviders(enabled);
        if (enabled.length > 0) setSelectedProvider(enabled[0].name);
      })
      .catch(() => {});
  }, []);

  // ─── Auto-scroll ───
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Copy message content ───
  const handleCopy = useCallback((msgId: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 3000);
    });
  }, []);

  // ─── Regenerate assistant message ───
  const handleRegenerate = useCallback(async (msgId: string, convId: string) => {
    if (!convId || regeneratingId) return;
    const targetMessage = messages.find((m) => m.id === msgId);
    const regenerateAt = targetMessage ? new Date(targetMessage.createdAt).getTime() : null;
    setRegeneratingId(msgId);
    // Replace message content with empty streaming placeholder
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, content: "" } : m))
    );
    if (regenerateAt != null) {
      setToolCallHistory((prev) =>
        prev.filter((tc) => new Date(tc.createdAt).getTime() < regenerateAt)
      );
    }
    try {
      await endpoints.regenerateMessage(convId, msgId, (token) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, content: m.content + token } : m))
        );
      });
      const [msgs, calls] = await Promise.all([
        endpoints.getMessages(convId),
        endpoints.getToolCalls(convId),
      ]);
      setMessages(msgs ?? []);
      setToolCallHistory(calls ?? []);
    } catch (err) {
      console.error("Regenerate failed:", err);
      const msgs = await endpoints.getMessages(convId).catch(() => null);
      if (msgs) setMessages(msgs);
    } finally {
      setRegeneratingId(null);
    }
  }, [messages, regeneratingId]);


  // ─── Send message ───
  const handleSend = useCallback(async () => {
    if (!composing.trim() || sending) return;
    const userContent = composing.trim();
    // Snapshot and clear attachments
    const currentAttachments = attachedFiles;
    setComposing("");
    setAttachedFiles([]);
    if (composeRef.current) composeRef.current.style.height = "36px";
    setSending(true);

    // Build full content (text + images as markdown)
    const imageMarkdown = currentAttachments
      .filter((a) => a.file.type.startsWith("image/"))
      .map((a) => `\n![${a.file.name}](${a.dataUrl})`)
      .join("");
    const fullContent = userContent + imageMarkdown;

    let conversationId = activeConversationId;
    if (!conversationId) {
      const autoTitle = userContent.slice(0, 48) + (userContent.length > 48 ? "..." : "");
      try {
        const conv = await endpoints.createConversation(autoTitle || "New chat");
        conversationId = conv.id;
        const updatedList = [conv, ...conversationsRef.current];
        setConversations(updatedList);
        onConversationsUpdate(updatedList);
        onActiveConversationChange(conv.id);
        skipNextMsgLoad.current = true;
      } catch {
        setSending(false);
        return;
      }
    }

    if (!conversationId) {
      setSending(false);
      return;
    }

    // Optimistic user message
    const optimisticUser: MessageDTO = {
      id: `temp-${Date.now()}`,
      conversationId,
      role: "user",
      content: fullContent,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      // Persist user message
      const savedUser = await endpoints.createMessage(conversationId, "user", fullContent);
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticUser.id ? savedUser : m))
      );

      const providerOrder = selectedProvider ? [selectedProvider] : undefined;

      // Add a streaming assistant placeholder
      const streamId = `stream-${Date.now()}`;
      setStreamingMsgId(streamId);
      setMessages((prev) => [...prev, {
        id: streamId,
        conversationId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      }]);

      let fullOutput = "";
      const finalOutput = await endpoints.streamComplete(
        conversationId,
        fullContent,
        (token: string) => {
          fullOutput += token;
          setMessages((prev) =>
            prev.map((m) => m.id === streamId ? { ...m, content: fullOutput } : m)
          );
        },
        providerOrder,
        (name: string, args: string, kind?: "TOOL" | "MCP") => {
          // Add optimistic live entry
          setToolCallHistory((prev) => [
            ...prev,
            {
              id: `live-${Date.now()}-${Math.random()}`,
              toolName: name,
              kind: kind ?? "TOOL",
              arguments: (() => { try { return JSON.parse(args); } catch { return {}; } })(),
              createdAt: new Date().toISOString(),
            },
          ]);
        },
        (usage: TokenUsage) => {
          setLastUsage(usage);
        },
      );
      setStreamingMsgId(null);
      if (finalOutput && finalOutput !== fullOutput) {
        setMessages((prev) =>
          prev.map((m) => m.id === streamId ? { ...m, content: finalOutput } : m)
        );
      }
      // Refresh persisted messages + tool calls from server (replaces optimistic stream IDs)
      if (conversationId) {
        Promise.all([
          endpoints.getMessages(conversationId),
          endpoints.getToolCalls(conversationId),
        ]).then(([msgs, calls]) => {
          setMessages(msgs ?? []);
          setToolCallHistory(calls ?? []);
        }).catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          conversationId,
          role: "system",
          content: "Failed to get a response. Please try again.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
      setStreamingMsgId(null);
      composeRef.current?.focus();
    }
  }, [activeConversationId, composing, sending, onActiveConversationChange, onConversationsUpdate]);

  const handleFilesPicked = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachedFiles((prev) => [...prev, { file, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ─── Key handler ───
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleMic = useCallback(async () => {
    if (transcribing) return;

    if (recording) {
      // Stop recording
      mediaRecorderRef.current?.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const res = await endpoints.transcribeAudio(blob);
          if (res.transcript) {
            setComposing((prev) => (prev ? prev + " " + res.transcript : res.transcript));
            setTimeout(() => composeRef.current?.focus(), 50);
          }
        } catch {
          // silently ignore transcription errors
        } finally {
          setTranscribing(false);
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      // microphone permission denied or unavailable
    }
  }, [recording, transcribing]);

  // ─── Render ───
  const activeConversation = conversations.find((conv) => conv.id === activeConversationId) ?? null;
  const activeConversationAutomatic = !!activeConversation?.isAutomatic;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Center: Message Area ── */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">

        {activeConversationAutomatic && activeConversation && (
          <div className="shrink-0 px-6 pt-4">
            <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-sm bg-surface-mid px-4 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.10)] backdrop-blur-sm ring-1 ring-[var(--color-outline-ghost)]">
              <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-violet/12 text-violet">
                <FlagIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-on-surface">{automationLabel(activeConversation.automationKind)}</p>
                  <span className="inline-flex items-center rounded-sm bg-violet/12 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em] text-violet">
                    Auto
                  </span>
                </div>
                <p className="mt-1 text-sm text-on-surface">{activeConversation.title || "Automatic conversation"}</p>
                <p className="mt-1 text-xs font-mono text-on-surface-variant">
                  Generated by openCrow automation. Styled separately so automatic runs stand out from manual chats.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          className={`flex-1 overflow-y-auto px-6 pb-32 ${activeConversationAutomatic ? "pt-4" : ""}`}
        >
          {!activeConversationId ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <p className="text-on-surface font-display text-lg">Chat</p>
                <p className="text-on-surface-variant text-sm font-mono">
                  Start a new conversation from the prompt below.
                </p>
                {loadingConvs && <p className="text-on-surface-variant text-xs">Loading previous chats...</p>}
              </div>
            </div>
          ) : loadingMsgs ? (
            <div className="flex items-center justify-center h-full">
              <Spinner />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-on-surface-variant text-sm font-mono">
                No messages yet -- start the conversation
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-3xl mx-auto pt-4">
              {(() => {
                // Build a merged, sorted timeline of messages + tool calls
                type TimelineItem =
                  | { kind: "message"; item: MessageDTO; idx: number }
                  | { kind: "tool"; item: ToolCallRecord; idx: number };
                const timeline: TimelineItem[] = [
                  ...messages.map((m, idx) => ({ kind: "message" as const, item: m, idx })),
                  ...toolCallHistory.map((t, idx) => ({ kind: "tool" as const, item: t, idx })),
                ].sort((a, b) => new Date(a.item.createdAt).getTime() - new Date(b.item.createdAt).getTime());

                return timeline.map((entry, i) => {
                  if (entry.kind === "tool") {
                    const tc = entry.item;
                    const toolKind = tc.kind === "MCP" ? "MCP" : "TOOL";
                    const isLive = tc.id.startsWith("live-");
                    const isExpanded = expandedToolCalls.has(tc.id);
                    const toggleExpand = () => setExpandedToolCalls((prev) => {
                      const next = new Set(prev);
                      if (next.has(tc.id)) next.delete(tc.id); else next.add(tc.id);
                      return next;
                    });

                    // Extract the primary "command" arg (command, query, content, prompt, action -- first string arg)
                    const args = tc.arguments ?? {};
                    const primaryArgKeys = ["command", "query", "content", "prompt", "action", "url", "messageId", "memoryId", "taskId"];
                    const primaryKey = primaryArgKeys.find((k) => k in args) ?? Object.keys(args)[0];
                    const primaryVal = primaryKey ? String(args[primaryKey] ?? "") : "";

                    // Parse stdout from output (output may be JSON with stdout/output/result fields, or raw string)
                    let stdout = "";
                    let stdoutIsJson = false;
                    if (tc.output != null) {
                      const raw = String(tc.output);
                      try {
                        const parsed = JSON.parse(raw);
                        const extracted = parsed.stdout ?? parsed.output ?? parsed.result;
                        if (extracted !== undefined) {
                          // Extracted field may itself be an object (avoid [object Object])
                          const rendered = displayValue(extracted);
                          stdout = rendered.text;
                          stdoutIsJson = rendered.isJson;
                        } else {
                          stdout = JSON.stringify(parsed, null, 2);
                          stdoutIsJson = true;
                        }
                      } catch {
                        stdout = raw;
                      }
                    }

                    return (
                      <div
                        key={tc.id}
                        className="flex justify-center animate-in fade-in duration-300"
                        style={{ animationDelay: `${i * 20}ms`, animationFillMode: "both" }}
                      >
                        <button
                          onClick={toggleExpand}
                          className="w-full max-w-[90%] text-left rounded-lg border border-[#2a2a3e] bg-[#0d0d1a] hover:border-[#3a3a5e] transition-colors font-mono text-xs overflow-hidden"
                        >
                          {/* Compact header -- always visible */}
                          <div className="flex items-center gap-2 px-3 py-1.5">
                            <svg className="text-[#6272a4] shrink-0 w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${toolKind === "MCP" ? "text-violet border-violet/40 bg-violet/10" : "text-cyan border-cyan/40 bg-cyan/10"}`}>[{toolKind}]</span>
                            <span className="text-[#8be9fd] shrink-0">{tc.toolName}</span>
                            {primaryVal && (
                              <span className="text-[#f8f8f2]/60 truncate flex-1">{primaryVal.slice(0, 80)}</span>
                            )}
                            <span className="text-[#6272a4] shrink-0 ml-auto">{formatTime(tc.createdAt)}</span>
                            {isLive && <span className="text-[#6272a4] animate-pulse shrink-0">...</span>}
                            <span className="text-[#6272a4] shrink-0 ml-1">{isExpanded ? "▲" : "▼"}</span>
                          </div>

                          {/* Expanded body */}
                          {isExpanded && (
                            <div className="border-t border-[#2a2a3e] px-3 py-2 space-y-2">
                              {/* All args */}
                              {Object.keys(args).length > 0 && (
                                <div className="space-y-1">
                                  {Object.entries(args).map(([k, v]) => {
                                    const isObj = typeof v === "object" && v !== null;
                                    const prettyVal = isObj ? JSON.stringify(v, null, 2) : String(v);
                                    const looksLikeJson = !isObj && (() => { try { JSON.parse(String(v)); return true; } catch { return false; } })();
                                    const displayVal = looksLikeJson ? JSON.stringify(JSON.parse(String(v)), null, 2) : prettyVal;
                                    const multiline = displayVal.includes("\n");
                                    return (
                                      <div key={k}>
                                        <span className="text-[#f1fa8c]">{k}</span>
                                        <span className="text-[#6272a4]">=</span>
                                        {multiline ? (
                                          <pre className="text-[#50fa7b] whitespace-pre-wrap break-all mt-0.5 pl-2 border-l border-[#6272a4]/30">{displayVal}</pre>
                                        ) : (
                                          <span className="text-[#50fa7b] break-all ml-1">{displayVal}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* Stdout / output */}
                              {stdout && (
                                <pre className={`whitespace-pre-wrap break-all leading-relaxed ${stdoutIsJson ? "text-[#f8f8f2]/80 bg-black/20 rounded p-2" : "text-[#50fa7b] opacity-80"}`}>{stdout}</pre>
                              )}
                              {/* Error */}
                              {tc.error && (
                                <pre className="text-[#ff5555] whitespace-pre-wrap break-all">{tc.error}</pre>
                              )}
                            </div>
                          )}
                        </button>
                      </div>
                    );
                  }

                  const msg = entry.item;
                  if (msg.role === "system") {
                    return (
                      <div
                        key={msg.id}
                        className="text-center animate-in fade-in slide-in-from-bottom-1 duration-300"
                        style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
                      >
                        <p className="text-xs text-on-surface-variant font-mono">
                          {msg.content}
                        </p>
                    </div>
                  );
                }

                const isUser = msg.role === "user";
                const canRegenerate = msg.role === "assistant" && isUuid(msg.id) && !msg.id.startsWith("stream-");
                return (
                  <div
                    key={msg.id}
                    className={`flex group ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
                    style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
                  >
                    {!isUser && (
                      <div className="shrink-0 mt-3 mr-2">
                        <span className="block h-2 w-2 rounded-full bg-cyan" />
                      </div>
                    )}
                    <div
                        className={`max-w-[70%] rounded-lg p-4 ${isUser ? "bg-surface-high" : "bg-surface-mid"}`}
                     >
                      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-on-surface-variant font-mono mb-1">
                        {msg.role}
                        <span className="inline-block h-1 w-1 rounded-full bg-on-surface-variant/50" />
                        {formatTime(msg.createdAt)}
                      </p>
                      <div className="text-sm text-on-surface font-body break-words">
                        {msg.role === "assistant" && msg.id === streamingMsgId && msg.content === "" ? (
                          <div className="space-y-2 py-0.5">
                            <div className="h-3 rounded bg-on-surface-variant/15 animate-pulse w-3/4" />
                            <div className="h-3 rounded bg-on-surface-variant/10 animate-pulse w-1/2" />
                            <div className="h-3 rounded bg-on-surface-variant/8 animate-pulse w-2/3" />
                          </div>
                        ) : msg.role === "assistant" ? (
                          <MarkdownMessage content={msg.content} />
                        ) : (
                          <MarkdownMessage content={msg.content} compact />
                        )}
                      </div>
                      {!isUser && (
                        <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className="text-xs text-on-surface-variant hover:text-on-surface px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors font-mono"
                            title="Copy"
                          >
                            {copiedId === msg.id ? "copied" : "copy"}
                          </button>
                          {canRegenerate && (
                            <button
                              onClick={() => activeConversationId && handleRegenerate(msg.id, activeConversationId)}
                              disabled={!!regeneratingId}
                              className="text-xs text-on-surface-variant hover:text-cyan px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors font-mono disabled:opacity-40"
                              title="Regenerate"
                            >
                              {regeneratingId === msg.id ? "..." : "↺ regen"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }); })()}
              {sending && !streamingMsgId && (
                <div className="flex justify-start animate-in fade-in duration-200">
                  <div className="shrink-0 mt-3 mr-2">
                    <span className="block h-2 w-2 rounded-full bg-cyan" />
                  </div>
                  <div className="bg-surface-mid rounded-lg px-5 py-4 flex items-center gap-1.5">
                    <span className="block h-2 w-2 rounded-full bg-on-surface-variant/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="block h-2 w-2 rounded-full bg-on-surface-variant/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="block h-2 w-2 rounded-full bg-on-surface-variant/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Floating Composer */}
        <div
          className="absolute bottom-6 left-0 flex justify-center px-6 pointer-events-none"
          style={{ right: "0" }}
        >
          <div className="w-full max-w-3xl pointer-events-auto">
            <div className="rounded-xl border border-violet bg-surface-mid backdrop-blur-xl shadow-[var(--shadow-float)] ring-1 ring-violet/20 p-3">
              {/* Provider/model selector row */}
              {providers.length > 0 && (
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant shrink-0">Model:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {providers.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => setSelectedProvider(p.name)}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-mono transition-all duration-100 border ${
                          selectedProvider === p.name
                            ? "border-violet/60 bg-violet/20 text-violet-light"
                            : "border-white/10 bg-white/5 text-on-surface-variant hover:text-on-surface hover:border-white/20"
                        }`}
                      >
                        {p.model || p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {attachedFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachedFiles.map((att, fi) => (
                    <div key={`${att.file.name}-${fi}`} className="flex items-center gap-2 rounded-md bg-surface-mid px-2 py-1 text-xs text-on-surface">
                      {att.file.type.startsWith("image/") ? (
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        <img src={att.dataUrl} alt={att.file.name} className="h-8 w-8 rounded object-cover" />
                      ) : null}
                      <span className="truncate max-w-[120px]">{att.file.name}</span>
                      <button
                        onClick={() => removeAttachment(fi)}
                        className="text-on-surface-variant hover:text-error"
                        aria-label={`Remove ${att.file.name}`}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2 w-full">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mb-0.5 shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-mid/50 transition-colors"
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <path d="M6 8.5l3.8-3.8a2 2 0 112.8 2.8L7.8 12.3a3.5 3.5 0 11-5-5L7.2 2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFilesPicked}
                />

                {/* Mic button */}
                <button
                  onClick={handleMic}
                  disabled={transcribing}
                  className={`mb-0.5 shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                    recording
                      ? "text-error bg-error/10 hover:bg-error/20 animate-pulse"
                      : transcribing
                        ? "text-on-surface-variant opacity-50 cursor-wait"
                        : "text-on-surface-variant hover:text-on-surface hover:bg-surface-mid/50"
                  }`}
                  aria-label={recording ? "Stop recording" : "Record voice message"}
                  title={recording ? "Stop recording" : "Voice input"}
                >
                  {transcribing ? (
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="animate-spin">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 14" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M2.5 8a5.5 5.5 0 0011 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <line x1="8" y1="13.5" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                </button>

                <textarea
                  ref={composeRef}
                  rows={1}
                  placeholder={activeConversationId ? "Message openCrow..." : "Start a new conversation..."}
                  value={composing}
                  onChange={(e) => {
                    setComposing(e.target.value);
                    // Auto-grow: reset then set to scrollHeight, capped at 3 lines (~72px)
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 72) + "px";
                  }}
                  onKeyDown={handleKeyDown}
                  className="flex-1 min-w-0 bg-transparent text-on-surface placeholder:text-on-surface-variant px-3 py-2 rounded text-sm font-body focus:outline-none resize-none overflow-y-auto leading-5"
                  style={{ height: "36px", maxHeight: "72px" }}
                />

                <Button onClick={handleSend} loading={sending} disabled={!composing.trim()}>
                  Send
                </Button>
              </div>
              {lastUsage && (
                <div className="flex justify-end px-1 pt-0.5">
                  <span className="text-xs text-on-surface-variant font-mono opacity-60">
                    ^{lastUsage.promptTokens} v{lastUsage.completionTokens} Σ{lastUsage.totalTokens}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
