// [20260724_TS_Migration_DetectLocalModels] Migrated from .js to .ts (ADR-010 Phase 2).
// Uses fetch (Node 18+) with AbortController timeout.

/** A local model probe configuration. */
interface LocalProbe {
  name: string;
  label: string;
  url: string;
  extractModels: (data: Record<string, unknown>) => string[];
}

/** Result of a successful probe. */
interface DetectedModel {
  name: string;
  label: string;
  models: string[];
}

const LOCAL_PROBES: LocalProbe[] = [
  {
    name: "ollama",
    label: "Ollama",
    url: "http://localhost:11434/api/tags",
    extractModels: (data) =>
      ((data.models as Array<{ name: string }>) || []).map((m) => m.name),
  },
  {
    name: "lmstudio",
    label: "LM Studio",
    url: "http://localhost:1234/v1/models",
    extractModels: (data) =>
      ((data.data as Array<{ id: string }>) || []).map((m) => m.id),
  },
];

async function probeEndpoint(probe: LocalProbe): Promise<DetectedModel | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(probe.url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    return {
      name: probe.name,
      label: probe.label,
      models: probe.extractModels(data),
    };
  } catch {
    return null;
  }
}

async function detectLocalModels(): Promise<DetectedModel[]> {
  const results = await Promise.all(LOCAL_PROBES.map(probeEndpoint));
  return results.filter((r): r is DetectedModel => r !== null);
}

export { detectLocalModels };
export type { LocalProbe, DetectedModel };
