// config/McpServerCard.tsx — Expandable MCP server configuration card with connection testing.
"use client";

import { useState, useEffect } from "react";
import type { MCPServerConfig, MCPToolSummary, MCPServerTestResult } from "@/lib/api";
import { endpoints } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { AnimatedDot } from "@/components/ui/AnimatedDot";
import { Chip } from "@/components/ui/Chip";
import type { UpdateConfigFn } from "./types";

export function McpServerCard({
  server,
  index: i,
  updateConfig,
}: {
  server: MCPServerConfig;
  index: number;
  updateConfig: UpdateConfigFn;
}) {
  const configured = !!server.url.trim();
  const [expanded, setExpanded] = useState(!configured);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MCPServerTestResult | null>(null);
  const [tools, setTools] = useState<MCPToolSummary[]>([]);

  const handleTest = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!server.url.trim()) {
      setTestResult({ ok: false, latencyMs: 0, error: "Server URL is required" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await endpoints.testMCPServer({
        name: server.name,
        url: server.url,
        headers: server.headers ?? {},
      });
      setTestResult(result);
      setTools(result.tools ?? []);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Test failed",
      });
      setTools([]);
    } finally {
      setTesting(false);
    }
  };

  // Auto-test when tab opens (component mounts with a configured URL)
  useEffect(() => {
    if (server.url.trim()) handleTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerRows = Object.entries(server.headers ?? {});

  return (
    <div className="rounded-lg border border-white/10 bg-surface-mid overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <AnimatedDot
          status={
            testing
              ? "pending"
              : testResult
                ? testResult.ok
                  ? "ok"
                  : "error"
                : server.enabled
                  ? "ok"
                  : "idle"
          }
        />
        <span className="font-medium text-sm flex-1 truncate">
          {server.name || `MCP Server ${i + 1}`}
        </span>
        {server.url && (
          <span className="text-xs text-on-surface-variant truncate hidden sm:block max-w-[200px]">
            {server.url}
          </span>
        )}
        {testResult && (
          <span
            className={`flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded ${testResult.ok ? "text-cyan bg-cyan/10" : "text-error bg-error/10"}`}
          >
            <AnimatedDot status={testResult.ok ? "ok" : "error"} />
            {testResult.ok ? `OK . ${testResult.latencyMs}ms` : "FAIL"}
          </span>
        )}
        <svg
          className={`w-4 h-4 text-on-surface-variant transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Name"
              value={server.name}
              onChange={(e) =>
                updateConfig((c) => {
                  c.mcp.servers[i].name = e.target.value;
                  return c;
                })
              }
              placeholder="My MCP"
            />
            <Input
              label="Server URL"
              value={server.url}
              onChange={(e) =>
                updateConfig((c) => {
                  c.mcp.servers[i].url = e.target.value;
                  return c;
                })
              }
              placeholder="https://example.com/mcp"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Headers</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateConfig((c) => {
                    const current = c.mcp.servers[i].headers ?? {};
                    c.mcp.servers[i].headers = { ...current, "": "" };
                    return c;
                  })
                }
              >
                Add Header
              </Button>
            </div>
            {headerRows.length === 0 && (
              <p className="text-xs text-on-surface-variant">No custom headers configured.</p>
            )}
            {headerRows.map(([key, value], hi) => (
              <div
                key={`header-${i}-${hi}`}
                className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2"
              >
                <Input
                  label="Key"
                  value={key}
                  onChange={(e) =>
                    updateConfig((c) => {
                      const rows = Object.entries(c.mcp.servers[i].headers ?? {});
                      const next: Record<string, string> = {};
                      rows.forEach(([k, v], idx) => {
                        next[idx === hi ? e.target.value : k] = v;
                      });
                      c.mcp.servers[i].headers = next;
                      return c;
                    })
                  }
                  placeholder="Authorization"
                />
                <Input
                  label="Value"
                  value={value}
                  onChange={(e) =>
                    updateConfig((c) => {
                      const rows = Object.entries(c.mcp.servers[i].headers ?? {});
                      const next: Record<string, string> = {};
                      rows.forEach(([k, v], idx) => {
                        next[k] = idx === hi ? e.target.value : v;
                      });
                      c.mcp.servers[i].headers = next;
                      return c;
                    })
                  }
                  placeholder="Bearer ..."
                />
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hover:text-error"
                    onClick={() =>
                      updateConfig((c) => {
                        const rows = Object.entries(c.mcp.servers[i].headers ?? {});
                        const next: Record<string, string> = {};
                        rows.forEach(([k, v], idx) => {
                          if (idx !== hi) next[k] = v;
                        });
                        c.mcp.servers[i].headers = next;
                        return c;
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {testResult && (
            <div
              className={`rounded-lg px-3 py-2 text-sm border ${testResult.ok ? "bg-cyan/10 text-cyan border-cyan/20" : "bg-error/10 text-error border-error/20"}`}
            >
              <div className="flex items-center gap-2">
                <span>{testResult.ok ? "Connected" : "Failed"}</span>
                <span className="text-xs opacity-80">{testResult.latencyMs}ms</span>
              </div>
              {testResult.error && (
                <p className="text-xs mt-1 opacity-90 break-all">{testResult.error}</p>
              )}
            </div>
          )}

          {tools.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">
                Exposed Tools
              </p>
              <div className="flex flex-wrap gap-2">
                {tools.map((tool) => (
                  <Chip key={tool.name} className="bg-violet/12 text-violet">
                    {tool.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Toggle
              label="Enabled"
              checked={server.enabled}
              onChange={(v) =>
                updateConfig((c) => {
                  c.mcp.servers[i].enabled = v;
                  return c;
                })
              }
            />
            <Button
              variant="secondary"
              size="sm"
              loading={testing}
              onClick={handleTest}
              disabled={!server.url.trim()}
              className="ml-4"
            >
              Test connection
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto hover:text-error"
              onClick={() =>
                updateConfig((c) => {
                  c.mcp.servers.splice(i, 1);
                  return c;
                })
              }
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
