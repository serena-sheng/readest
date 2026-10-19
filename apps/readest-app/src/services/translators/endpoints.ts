// Translation backends the reader can switch between: the local expert
// service (`/translate`, with its genre × mode styles and glossaries) or any
// OpenAI-compatible chat endpoint (DeepSeek, OpenAI, a local Ollama…).
//
// The list lives on this device only: `emm.translation.endpoints` holds it and
// `emm.translation.activeEndpoint` names the current one, so the `emm`
// provider can resolve a backend per call without touching the settings store.
//
// Every access degrades silently. Storage can be unavailable (private mode,
// tests, a locked Tauri store) and a hand-edited value can be invalid JSON;
// callers see an empty list, a no-op write, or the built-in default endpoint
// instead of an exception. Without `LOCAL_UNLOCK` storage is never read at
// all, which keeps upstream behaviour identical to the local service.

import { LOCAL_UNLOCK } from '@/utils/localUnlock';

export type TranslationEndpointKind = 'emm' | 'openai-compatible';

export type TranslationEndpoint = {
  id: string;
  name: string;
  kind: TranslationEndpointKind;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  enabled: boolean;
};

const ENDPOINTS_KEY = 'emm.translation.endpoints';
const ACTIVE_KEY = 'emm.translation.activeEndpoint';

/** The service the local build always has; used when nothing else is set. */
export const DEFAULT_TRANSLATION_ENDPOINT: TranslationEndpoint = {
  id: 'local-expert',
  name: '本机专家服务',
  kind: 'emm',
  baseUrl: 'http://127.0.0.1:8790',
  enabled: true,
};

const readValue = (key: string): string | null => {
  if (!LOCAL_UNLOCK) return null;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeValue = (key: string, value: string | null): void => {
  if (!LOCAL_UNLOCK) return;
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full: the caller keeps its in-memory copy.
  }
};

const toEndpoint = (value: unknown): TranslationEndpoint | null => {
  if (!value || typeof value !== 'object') return null;
  const endpoint = value as Partial<TranslationEndpoint>;
  if (
    typeof endpoint.id !== 'string' ||
    typeof endpoint.name !== 'string' ||
    typeof endpoint.baseUrl !== 'string' ||
    (endpoint.kind !== 'emm' && endpoint.kind !== 'openai-compatible')
  ) {
    return null;
  }
  return {
    id: endpoint.id,
    name: endpoint.name,
    kind: endpoint.kind,
    baseUrl: endpoint.baseUrl,
    ...(typeof endpoint.model === 'string' ? { model: endpoint.model } : {}),
    ...(typeof endpoint.apiKey === 'string' ? { apiKey: endpoint.apiKey } : {}),
    enabled: typeof endpoint.enabled === 'boolean' ? endpoint.enabled : true,
  };
};

export const listEndpoints = (): TranslationEndpoint[] => {
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

export const saveEndpoint = (endpoint: TranslationEndpoint): void => {
  const endpoints = listEndpoints();
  const normalized: TranslationEndpoint = { ...endpoint, enabled: endpoint.enabled ?? true };
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

/**
 * The endpoint the provider should use: the active one when it is enabled,
 * else the first enabled endpoint, else the built-in local expert service.
 * The default is always returned when nothing is configured, so translation
 * never breaks because the list is empty.
 */
export const getActiveEndpoint = (): TranslationEndpoint => {
  const enabled = listEndpoints().filter((endpoint) => endpoint.enabled);
  if (enabled.length === 0) return { ...DEFAULT_TRANSLATION_ENDPOINT };
  const activeId = getActiveEndpointId();
  return enabled.find((endpoint) => endpoint.id === activeId) ?? enabled[0]!;
};
