// User-managed OpenAI-compatible speech endpoints, kept on this device only.
// Unlike the synced `custom_tts` services, these are a local list the reader
// can switch between (a self-hosted Kokoro server, a cloud endpoint, an
// intranet service). `emm.tts.endpoints` holds the list; the active id lives
// beside it so the provider can pick one without touching the settings store.
//
// Every access degrades silently: storage can be unavailable (private mode,
// tests, a locked Tauri store) and a hand-edited or older value can be invalid
// JSON. Callers see an empty list or a no-op write instead of an exception.

export type TTSEndpoint = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  voice: string;
  apiKey?: string;
  enabled: boolean;
};

const ENDPOINTS_KEY = 'emm.tts.endpoints';
const ACTIVE_KEY = 'emm.tts.activeEndpoint';

const readValue = (key: string): string | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeValue = (key: string, value: string | null): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full: the caller keeps its in-memory copy.
  }
};

const toEndpoint = (value: unknown): TTSEndpoint | null => {
  if (!value || typeof value !== 'object') return null;
  const endpoint = value as Partial<TTSEndpoint>;
  if (
    typeof endpoint.id !== 'string' ||
    typeof endpoint.name !== 'string' ||
    typeof endpoint.baseUrl !== 'string' ||
    typeof endpoint.model !== 'string' ||
    typeof endpoint.voice !== 'string'
  ) {
    return null;
  }
  return {
    id: endpoint.id,
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    model: endpoint.model,
    voice: endpoint.voice,
    ...(typeof endpoint.apiKey === 'string' ? { apiKey: endpoint.apiKey } : {}),
    enabled: typeof endpoint.enabled === 'boolean' ? endpoint.enabled : true,
  };
};

export const listEndpoints = (): TTSEndpoint[] => {
  const raw = readValue(ENDPOINTS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const endpoint = toEndpoint(item);
      return endpoint ? [endpoint] : [];
    });
  } catch {
    return [];
  }
};

export const saveEndpoint = (endpoint: TTSEndpoint): void => {
  const endpoints = listEndpoints();
  const normalized: TTSEndpoint = { ...endpoint, enabled: endpoint.enabled ?? true };
  const exists = endpoints.some((candidate) => candidate.id === endpoint.id);
  const next = exists
    ? endpoints.map((candidate) => (candidate.id === endpoint.id ? normalized : candidate))
    : [...endpoints, normalized];
  writeValue(ENDPOINTS_KEY, JSON.stringify(next));
};

export const deleteEndpoint = (id: string): void => {
  const next = listEndpoints().filter((endpoint) => endpoint.id !== id);
  writeValue(ENDPOINTS_KEY, JSON.stringify(next));
  if (getActiveEndpointId() === id) setActiveEndpointId(null);
};

export const getActiveEndpointId = (): string | null => {
  const id = readValue(ACTIVE_KEY);
  return id && id.trim() ? id : null;
};

export const setActiveEndpointId = (id: string | null): void => {
  writeValue(ACTIVE_KEY, id && id.trim() ? id : null);
};

// The endpoint the provider should use: the active one when it is enabled,
// else the first enabled endpoint. Null when nothing is enabled.
export const getActiveEndpoint = (): TTSEndpoint | null => {
  const enabled = listEndpoints().filter((endpoint) => endpoint.enabled);
  if (enabled.length === 0) return null;
  const activeId = getActiveEndpointId();
  return enabled.find((endpoint) => endpoint.id === activeId) ?? enabled[0]!;
};
