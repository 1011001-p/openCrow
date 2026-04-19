// config/ProviderCard.tsx — Expandable provider configuration card with test and model probe.
"use client";

import { useState } from "react";
import type { ProviderConfig, ProviderModelsProbeResult } from "@/lib/api";
import { endpoints } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { AnimatedDot } from "@/components/ui/AnimatedDot";
import { PROVIDER_KINDS, isOpenAICompatibleProviderKind, type UpdateConfigFn, type ProviderProbeStatus } from "./types";

export function ProviderCard({
  prov,
  index: i,
  updateConfig,
  probeStatus,
}: {
  prov: ProviderConfig;
  index: number;
  updateConfig: UpdateConfigFn;
  probeStatus?: ProviderProbeStatus;
}) {
  const configured = !!(prov.name && prov.model && (prov.apiKeyRef || prov.baseUrl));
  const [expanded, setExpanded] = useState(!configured);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string } | null>(null);
  const [probingModels, setProbingModels] = useState(false);
  const [modelsProbeResult, setModelsProbeResult] = useState<ProviderModelsProbeResult | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const handleTest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTesting(true);
    setTestResult(null);
    try {
      const res = await endpoints.testProvider({
        kind: prov.kind,
        name: prov.name,
        baseUrl: prov.baseUrl,
        apiKeyRef: prov.apiKeyRef,
        model: prov.model,
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: 0, error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleProbeModels = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setProbingModels(true);
    setModelsProbeResult(null);
    try {
      const res = await endpoints.probeProviderModels({
        kind: prov.kind,
        baseUrl: prov.baseUrl,
        apiKeyRef: prov.apiKeyRef,
      });
      setModelsProbeResult(res);
      const models = Array.isArray(res.models) ? res.models.filter((m) => !!m?.trim()) : [];
      setAvailableModels(models);
      if (models.length > 0 && !models.includes(prov.model)) {
        updateConfig((c) => {
          c.llm.providers[i].model = models[0];
          return c;
        });
      }
    } catch (err) {
      setModelsProbeResult({ ok: false, error: err instanceof Error ? err.message : "Probe failed" });
      setAvailableModels([]);
    } finally {
      setProbingModels(false);
    }
  };

  const displayStatus = testResult ?? probeStatus;
  const statusDotStatus = !prov.enabled
    ? "idle" as const
    : (displayStatus === null || displayStatus === undefined)
      ? "pending" as const
      : displayStatus.ok
        ? "ok" as const
        : "error" as const;

  return (
    <div className="rounded-xl border border-outline-ghost bg-surface-low overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-mid/40 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <AnimatedDot status={statusDotStatus} />
        <span className="font-body font-medium text-on-surface flex-1">
          {prov.name || `Provider ${i + 1}`}
        </span>
        {configured && (
          <span className="text-xs text-on-surface-variant font-mono shrink-0">
            {prov.kind} . {prov.model}
          </span>
        )}
        {displayStatus && (
          <span className={`text-xs font-mono shrink-0 ${displayStatus.ok ? "text-green-400" : "text-red-400"}`}>
            {displayStatus.ok ? `${displayStatus.latencyMs}ms` : "offline"}
          </span>
        )}
        <svg
          className={`h-4 w-4 shrink-0 text-on-surface-variant transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 16 16" fill="none"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-outline-ghost pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Kind" options={PROVIDER_KINDS} value={prov.kind} onChange={(e) => updateConfig((c) => { c.llm.providers[i].kind = e.target.value; return c; })} />
            <Input label="Name" value={prov.name} onChange={(e) => updateConfig((c) => { c.llm.providers[i].name = e.target.value; return c; })} />
            {isOpenAICompatibleProviderKind(prov.kind) ? (
              <div className="space-y-2">
                {availableModels.length > 0 ? (
                  <Select
                    label="Model"
                    options={availableModels.map((m) => ({ value: m, label: m }))}
                    value={prov.model || availableModels[0]}
                    onChange={(e) => updateConfig((c) => { c.llm.providers[i].model = e.target.value; return c; })}
                  />
                ) : (
                  <Input label="Model" value={prov.model} onChange={(e) => updateConfig((c) => { c.llm.providers[i].model = e.target.value; return c; })} />
                )}
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" loading={probingModels} onClick={handleProbeModels} disabled={!prov.kind}>
                    Probe models
                  </Button>
                  {modelsProbeResult && (
                    <span className={`text-xs font-mono ${modelsProbeResult.ok ? "text-cyan" : "text-error"}`}>
                      {modelsProbeResult.ok
                        ? `${availableModels.length} model${availableModels.length === 1 ? "" : "s"} found`
                        : (modelsProbeResult.error || "Probe failed")}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <Input label="Model" value={prov.model} onChange={(e) => updateConfig((c) => { c.llm.providers[i].model = e.target.value; return c; })} />
            )}
            <Input label="Base URL" value={prov.baseUrl} onChange={(e) => updateConfig((c) => { c.llm.providers[i].baseUrl = e.target.value; return c; })} />
            <Input label="API Key" type="password" value={prov.apiKeyRef} onChange={(e) => updateConfig((c) => { c.llm.providers[i].apiKeyRef = e.target.value; return c; })} />
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${testResult.ok ? "bg-green-400/10 text-green-400 border-green-400/20" : "bg-red-400/10 text-red-400 border-red-400/20"}`}>
              <span>{testResult.ok ? "Connected" : "Failed"}</span>
              {testResult.ok && <span className="text-xs opacity-70">{testResult.latencyMs}ms</span>}
              {testResult.error && <span className="text-xs opacity-80 ml-1 truncate">{testResult.error}</span>}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Toggle label="Enabled" checked={prov.enabled} onChange={(v) => updateConfig((c) => { c.llm.providers[i].enabled = v; return c; })} />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-on-surface-variant">Priority</label>
              <input
                type="number"
                min={0}
                className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-on-surface focus:outline-none focus:border-violet/40"
                value={prov.priority ?? 0}
                onChange={(e) => updateConfig((c) => { c.llm.providers[i].priority = parseInt(e.target.value, 10) || 0; return c; })}
              />
              <span className="text-xs text-on-surface-variant">(lower = higher priority)</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={testing}
              onClick={handleTest}
              disabled={!prov.kind}
            >
              Test connection
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto hover:text-error" onClick={() => updateConfig((c) => { c.llm.providers.splice(i, 1); return c; })}>
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
