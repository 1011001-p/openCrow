"use client";

import { useState, useEffect } from "react";
import type { SSHServerConfig, UserConfig } from "@/lib/api";
import { endpoints } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { AnimatedDot } from "@/components/ui/AnimatedDot";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SaveBar } from "./SaveBar";
import type { UpdateConfigFn } from "./types";

function SSHServerCard({
  server,
  index: i,
  updateConfig,
}: {
  server: SSHServerConfig;
  index: number;
  updateConfig: UpdateConfigFn;
}) {
  const configured = !!(server.host && server.username);
  const [expanded, setExpanded] = useState(!configured);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const handleTest = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTesting(true);
    setTestResult(null);
    try {
      const res = await endpoints.testSSHConnection({
        host: server.host,
        port: server.port || 22,
        username: server.username,
        authMode: server.authMode || "key",
        sshKey: server.sshKey,
        password: server.password,
        passphrase: server.passphrase,
      });
      setTestResult(res);
    } catch {
      setTestResult({ ok: false, error: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    if (server.host && server.username && (server.sshKey || server.password)) handleTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateConfig((c) => {
        c.integrations.sshServers[i].sshKey = reader.result as string;
        return c;
      });
    };
    reader.readAsText(file);
  };

  return (
    <div className="rounded-lg border border-white/10 bg-surface-mid overflow-hidden">
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
          {server.name || `Server ${i + 1}`}
        </span>
        {server.host && (
          <span className="text-xs text-on-surface-variant truncate hidden sm:block">
            {server.username}@{server.host}
          </span>
        )}
        {testResult && (
          <span
            className={`flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded ${testResult.ok ? "text-cyan bg-cyan/10" : "text-error bg-error/10"}`}
          >
            <AnimatedDot status={testResult.ok ? "ok" : "error"} />
            {testResult.ok ? "OK" : "FAIL"}
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

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Server Name"
              value={server.name}
              placeholder="my-server"
              onChange={(e) => {
                const v = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                updateConfig((c) => {
                  c.integrations.sshServers[i].name = v;
                  return c;
                });
              }}
            />
            <Input
              label="IP Address / Hostname"
              value={server.host}
              onChange={(e) =>
                updateConfig((c) => {
                  c.integrations.sshServers[i].host = e.target.value;
                  return c;
                })
              }
            />
            <Input
              label="Username"
              value={server.username}
              onChange={(e) =>
                updateConfig((c) => {
                  c.integrations.sshServers[i].username = e.target.value;
                  return c;
                })
              }
            />
            <Input
              label="Port"
              type="number"
              value={server.port ?? ""}
              onChange={(e) =>
                updateConfig((c) => {
                  const n = parseInt(e.target.value);
                  c.integrations.sshServers[i].port = isNaN(n) ? undefined : n;
                  return c;
                })
              }
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-on-surface-variant">SSH Key</span>
            <Toggle
              label=""
              checked={server.authMode === "password"}
              onChange={(v) =>
                updateConfig((c) => {
                  c.integrations.sshServers[i].authMode = v ? "password" : "key";
                  return c;
                })
              }
            />
            <span className="text-sm text-on-surface-variant">Password</span>
          </div>

          {server.authMode === "password" ? (
            <Input
              label="Password"
              type="password"
              value={server.password ?? ""}
              onChange={(e) =>
                updateConfig((c) => {
                  c.integrations.sshServers[i].password = e.target.value;
                  return c;
                })
              }
            />
          ) : (
            <div className="space-y-2">
              <TextArea
                label="Private Key"
                value={server.sshKey ?? ""}
                onChange={(e) =>
                  updateConfig((c) => {
                    c.integrations.sshServers[i].sshKey = e.target.value;
                    return c;
                  })
                }
                rows={6}
                className="font-mono text-xs"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-cyan hover:text-cyan/80">
                  <input
                    type="file"
                    className="hidden"
                    accept=".pem,.key,.pub,*"
                    onChange={handleFileUpload}
                  />
                  Upload key file
                </label>
              </div>
              <Input
                label="Passphrase (optional)"
                type="password"
                value={server.passphrase ?? ""}
                onChange={(e) =>
                  updateConfig((c) => {
                    c.integrations.sshServers[i].passphrase = e.target.value;
                    return c;
                  })
                }
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <Toggle
              label="Enabled"
              checked={server.enabled}
              onChange={(v) =>
                updateConfig((c) => {
                  c.integrations.sshServers[i].enabled = v;
                  return c;
                })
              }
            />
          </div>

          <div className="flex gap-2 pt-2 items-center">
            <Button variant="secondary" size="sm" loading={testing} onClick={handleTest}>
              Test connection
            </Button>
            {testResult && (
              <span
                className={`flex items-center gap-1.5 text-xs font-mono ${testResult.ok ? "text-cyan" : "text-error"}`}
              >
                <AnimatedDot status={testResult.ok ? "ok" : "error"} />
                {testResult.ok ? "Connected" : testResult.error}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto hover:text-error"
              onClick={() =>
                updateConfig((c) => {
                  c.integrations.sshServers.splice(i, 1);
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

export function ServersTab({
  config,
  updateConfig,
  saving,
  saveFullConfig,
  saveStatus,
}: {
  config: UserConfig;
  updateConfig: UpdateConfigFn;
  saving: boolean;
  saveFullConfig: () => void;
  saveStatus: string | null;
}) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="SSH Servers"
        description="Remote servers the agent can SSH into and run commands on"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              updateConfig((c) => {
                c.integrations.sshServers.push({
                  name: "",
                  host: "",
                  port: 22,
                  username: "",
                  authMode: "key",
                  sshKey: "",
                  password: "",
                  enabled: true,
                });
                return c;
              })
            }
          >
            Add Server
          </Button>
        }
      />
      {config.integrations.sshServers.map((srv, i) => (
        <SSHServerCard key={i} server={srv} index={i} updateConfig={updateConfig} />
      ))}
      {config.integrations.sshServers.length === 0 && (
        <p className="text-on-surface-variant text-sm">No SSH servers configured.</p>
      )}
      <SaveBar
        onClick={saveFullConfig}
        loading={saving}
        label="Save Servers Config"
        status={saveStatus}
      />
    </div>
  );
}
