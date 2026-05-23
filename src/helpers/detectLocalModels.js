const LOCAL_PROBES = [
  {
    name: "ollama",
    label: "Ollama",
    url: "http://localhost:11434/api/tags",
    extractModels: (data) => (data.models || []).map((m) => m.name),
  },
  {
    name: "lmstudio",
    label: "LM Studio",
    url: "http://localhost:1234/v1/models",
    extractModels: (data) => (data.data || []).map((m) => m.id),
  },
];

async function probeEndpoint(probe) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(probe.url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json();
    return {
      name: probe.name,
      label: probe.label,
      models: probe.extractModels(data),
    };
  } catch {
    return null;
  }
}

async function detectLocalModels() {
  const results = await Promise.all(LOCAL_PROBES.map(probeEndpoint));
  return results.filter((r) => r !== null);
}

module.exports = { detectLocalModels };
