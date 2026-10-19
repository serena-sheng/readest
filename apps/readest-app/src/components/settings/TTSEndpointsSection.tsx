import React, { useEffect, useState } from 'react';
import { PiSpinner } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import {
  deleteEndpoint,
  getActiveEndpointId,
  listEndpoints,
  saveEndpoint,
  setActiveEndpointId,
  type TTSEndpoint,
} from '@/services/tts/customEndpoints';
import {
  customVoiceId,
  OpenAICompatibleSpeechProvider,
} from '@/services/tts/providers/openaiCompatible';
import type { CustomTTSService } from '@/types/customTTS';
import { BoxedList } from './primitives';

type Draft = {
  name: string;
  baseUrl: string;
  model: string;
  voice: string;
  apiKey: string;
};

const EMPTY_DRAFT: Draft = { name: '', baseUrl: '', model: '', voice: '', apiKey: '' };

const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

const newEndpointId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `endpoint-${Date.now()}`;

/**
 * Local OpenAI-compatible endpoints (`emm.tts.endpoints`). One entry is the
 * active one; the custom TTS provider uses it in place of the configured
 * services. Rendering is gated by `LOCAL_UNLOCK` in TTSPanel.
 */
const TTSEndpointsSection: React.FC = () => {
  const _ = useTranslation();
  const [endpoints, setEndpoints] = useState<TTSEndpoint[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // undefined: the list; null: a new endpoint; a string: that endpoint.
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    setEndpoints(listEndpoints());
    setActiveId(getActiveEndpointId());
  }, []);

  const refresh = () => {
    setEndpoints(listEndpoints());
    setActiveId(getActiveEndpointId());
  };

  const closeEditor = () => {
    setEditingId(undefined);
    setTestResult('');
  };

  const openNew = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setTestResult('');
  };

  const openEdit = (endpoint: TTSEndpoint) => {
    setDraft({
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      model: endpoint.model,
      voice: endpoint.voice,
      apiKey: endpoint.apiKey ?? '',
    });
    setEditingId(endpoint.id);
    setTestResult('');
  };

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setTestResult('');
  };

  const useEndpoint = (endpoint: TTSEndpoint) => {
    saveEndpoint({ ...endpoint, enabled: true });
    setActiveEndpointId(endpoint.id);
    refresh();
  };

  const handleDelete = (id: string) => {
    deleteEndpoint(id);
    if (editingId === id) closeEditor();
    refresh();
  };

  const canSubmit = [draft.name, draft.baseUrl, draft.model, draft.voice].every(
    (value) => value.trim().length > 0,
  );

  const handleSave = () => {
    if (!canSubmit) return;
    const endpoint: TTSEndpoint = {
      id: editingId ?? newEndpointId(),
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      voice: draft.voice.trim(),
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      enabled: true,
    };
    saveEndpoint(endpoint);
    setActiveEndpointId(endpoint.id);
    refresh();
    closeEditor();
  };

  // One tiny `POST {baseUrl}/audio/speech` through the real provider, so the
  // request shape matches playback. The null override tests this draft rather
  // than whichever endpoint is currently active.
  const handleTest = async () => {
    if (!canSubmit) return;
    setTesting(true);
    setTestResult('');
    const started = Date.now();
    try {
      const service: CustomTTSService = {
        id: 'endpoint-test',
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        addedAt: 0,
        updatedAt: 0,
      };
      const provider = new OpenAICompatibleSpeechProvider(
        () => [service],
        async () => true,
        () => null,
      );
      await provider.synthesize(
        {
          lang: 'en',
          text: 'Hello.',
          voice: customVoiceId(service.id, draft.voice.trim()),
          pitch: 1,
        },
        new AbortController().signal,
      );
      setTestResult(`${_('Available')} · ${Date.now() - started}ms`);
    } catch (error) {
      setTestResult(
        `${_('Unavailable')}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTesting(false);
    }
  };

  // The stored active id can lag behind a deleted/disabled entry; the provider
  // falls back the same way, so the badge must agree with it.
  const resolvedActiveId = endpoints.some((e) => e.id === activeId && e.enabled)
    ? activeId
    : (endpoints.find((e) => e.enabled)?.id ?? null);

  const inputClass = 'input input-sm eink-bordered w-full';

  return (
    <BoxedList
      title={_('Custom Endpoints')}
      description={_(
        'Manage OpenAI-compatible endpoints on this device and choose which one Read Aloud uses.',
      )}
      data-setting-id='settings.tts.endpoints'
    >
      {endpoints.length === 0 && editingId === undefined && (
        <p className='text-base-content/65 py-3 pe-4 text-sm'>{_('No custom endpoints yet')}</p>
      )}

      {endpoints.map((endpoint) => (
        <div
          key={endpoint.id}
          className='flex items-center gap-2 py-3 pe-4'
          data-testid={`tts-endpoint-${endpoint.id}`}
        >
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm'>
              {endpoint.name} · {hostOf(endpoint.baseUrl)}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            {endpoint.id === resolvedActiveId ? (
              <span className='badge badge-sm badge-outline'>{_('In Use')}</span>
            ) : (
              <button
                type='button'
                className='btn btn-ghost btn-xs eink-bordered'
                onClick={() => useEndpoint(endpoint)}
              >
                {_('Enable')}
              </button>
            )}
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered'
              aria-label={`${_('Edit')} ${endpoint.name}`}
              onClick={() => openEdit(endpoint)}
            >
              {_('Edit')}
            </button>
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered text-error'
              aria-label={`${_('Delete')} ${endpoint.name}`}
              onClick={() => handleDelete(endpoint.id)}
            >
              {_('Delete')}
            </button>
          </div>
        </div>
      ))}

      <div className='py-3 pe-4'>
        {editingId === undefined ? (
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered w-full'
            onClick={openNew}
          >
            {_('Add Endpoint')}
          </button>
        ) : (
          <div className='space-y-3' data-testid='tts-endpoint-form'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <label className='flex flex-col gap-1 text-sm'>
                <span>{_('Name')}</span>
                <input
                  className={inputClass}
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder='Kokoro'
                />
              </label>
              <label className='flex flex-col gap-1 text-sm'>
                <span>{_('Base URL')}</span>
                <input
                  className={inputClass}
                  value={draft.baseUrl}
                  onChange={(event) => update({ baseUrl: event.target.value })}
                  placeholder='http://127.0.0.1:8880/v1'
                />
              </label>
              <label className='flex flex-col gap-1 text-sm'>
                <span>{_('Model')}</span>
                <input
                  className={inputClass}
                  value={draft.model}
                  onChange={(event) => update({ model: event.target.value })}
                  placeholder='kokoro'
                />
              </label>
              <label className='flex flex-col gap-1 text-sm'>
                <span>{_('Voice')}</span>
                <input
                  className={inputClass}
                  value={draft.voice}
                  onChange={(event) => update({ voice: event.target.value })}
                  placeholder='af_heart'
                />
              </label>
            </div>
            <label className='flex flex-col gap-1 text-sm'>
              <span>{_('API Key')}</span>
              <input
                type='password'
                className={inputClass}
                value={draft.apiKey}
                onChange={(event) => update({ apiKey: event.target.value })}
                placeholder={_('Optional for local servers')}
                autoComplete='off'
              />
            </label>

            {testResult && (
              <p className='text-base-content/70 break-words text-sm' role='status'>
                {testResult}
              </p>
            )}

            <div className='flex flex-wrap items-center justify-end gap-2'>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={handleTest}
                disabled={!canSubmit || testing}
              >
                {testing ? <PiSpinner className='size-4 animate-spin' /> : _('Test')}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={closeEditor}
              >
                {_('Cancel')}
              </button>
              <button
                type='button'
                className='btn btn-contrast btn-sm'
                onClick={handleSave}
                disabled={!canSubmit}
              >
                {_('Save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </BoxedList>
  );
};

export default TTSEndpointsSection;
