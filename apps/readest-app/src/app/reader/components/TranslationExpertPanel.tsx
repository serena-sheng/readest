'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';
import { MdClose } from 'react-icons/md';

import {
  bindExpert,
  getActiveStyle,
  getExperts,
  getStyles,
  saveExpert,
  setActiveStyle,
  splitStyleId,
} from '@/services/ai/translationExperts';
import type { TranslationExpert, TranslationStyles } from '@/services/ai/translationExperts';
import {
  deleteEndpoint,
  getActiveEndpointId,
  listEndpoints,
  saveEndpoint,
  setActiveEndpointId,
  type TranslationEndpoint,
  type TranslationEndpointKind,
} from '@/services/translators/endpoints';
import {
  getGlossaryText,
  parseGlossary,
  setGlossaryText,
} from '@/services/translators/glossary';
import { eventDispatcher } from '@/utils/event';
import { LOCAL_UNLOCK } from '@/utils/localUnlock';

interface TranslationExpertPanelProps {
  /** Book title: the subtitle, and the key `/bind` stores the expert under. */
  title: string;
  /** When several books are open, only this book's close events matter. */
  bookKey?: string;
  open: boolean;
  onClose: () => void;
}

type Status = 'loading' | 'ready' | 'error';

type EndpointDraft = {
  name: string;
  kind: TranslationEndpointKind;
  baseUrl: string;
  model: string;
  apiKey: string;
};

const EMPTY_ENDPOINT_DRAFT: EndpointDraft = {
  name: '',
  kind: 'emm',
  baseUrl: '',
  model: '',
  apiKey: '',
};

const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

/**
 * The translation-expert drawer: the style pair the `emm` provider reads, a
 * scratch glossary, and the experts kept by the local service.
 *
 * Three stores with three lifetimes:
 * - the active style is written to `localStorage` through `setActiveStyle` on
 *   every choice, which is what makes the change take effect on the next page
 *   without a reload;
 * - the glossary text only lives in this component until it is saved as part
 *   of an expert (or bound to the book);
 * - the expert list and per-book binding belong to the loopback service.
 */
const TranslationExpertPanel: React.FC<TranslationExpertPanelProps> = ({
  title,
  bookKey,
  open,
  onClose,
}) => {
  const [styles, setStyles] = useState<TranslationStyles | null>(null);
  const [stylesStatus, setStylesStatus] = useState<Status>('loading');
  const [stylesError, setStylesError] = useState('');
  const [experts, setExperts] = useState<TranslationExpert[]>([]);
  const [expertsStatus, setExpertsStatus] = useState<Status>('loading');
  const [expertsError, setExpertsError] = useState('');

  const [styleId, setStyleId] = useState(getActiveStyle);
  const [glossary, setGlossary] = useState('');
  const [savedGlossary, setSavedGlossary] = useState('');
  // The local glossary is independent of the expert scratch glossary above:
  // this one is persisted here and folded into cloud-endpoint prompts.
  const [localGlossary, setLocalGlossary] = useState(getGlossaryText);
  const [savedLocalGlossary, setSavedLocalGlossary] = useState(getGlossaryText);
  const [localGlossarySaved, setLocalGlossarySaved] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [binding, setBinding] = useState(false);
  const [note, setNote] = useState('');
  const [noteFailed, setNoteFailed] = useState(false);

  const [endpoints, setEndpoints] = useState<TranslationEndpoint[]>([]);
  const [activeEndpointId, setActiveEndpointIdState] = useState<string | null>(null);
  // undefined: the list; null: a new endpoint; a string: that endpoint.
  const [editingEndpointId, setEditingEndpointId] = useState<string | null | undefined>(
    undefined,
  );
  const [endpointDraft, setEndpointDraft] = useState<EndpointDraft>(EMPTY_ENDPOINT_DRAFT);
  const [endpointTesting, setEndpointTesting] = useState(false);
  const [endpointTestResult, setEndpointTestResult] = useState('');

  const loadStyles = useCallback(async () => {
    setStylesStatus('loading');
    try {
      setStyles(await getStyles());
      setStylesError('');
      setStylesStatus('ready');
    } catch (failure) {
      setStylesError(messageOf(failure));
      setStylesStatus('error');
    }
  }, []);

  const loadExperts = useCallback(async () => {
    setExpertsStatus('loading');
    try {
      setExperts(await getExperts());
      setExpertsError('');
      setExpertsStatus('ready');
    } catch (failure) {
      setExpertsError(messageOf(failure));
      setExpertsStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStyleId(getActiveStyle());
    setLocalGlossary(getGlossaryText());
    setSavedLocalGlossary(getGlossaryText());
    setLocalGlossarySaved(false);
    setEndpoints(listEndpoints());
    setActiveEndpointIdState(getActiveEndpointId());
    void loadStyles();
    void loadExperts();
  }, [open, loadStyles, loadExperts]);

  // The right-hand drawer slot is shared with the ask and ideas panels; both
  // announce their arrival with these events, and this panel yields the slot.
  useEffect(() => {
    if (!open) return;
    const close = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string } | undefined;
      if (bookKey && detail?.bookKey && detail.bookKey !== bookKey) return;
      onClose();
    };
    eventDispatcher.on('ask-local-close', close);
    eventDispatcher.on('ideas-close', close);
    return () => {
      eventDispatcher.off('ask-local-close', close);
      eventDispatcher.off('ideas-close', close);
    };
  }, [bookKey, onClose, open]);

  const active = splitStyleId(styleId);
  const genreItem = styles?.genres.find((item) => item.id === active.genre);
  const modeItem = styles?.modes.find((item) => item.id === active.mode);
  const styleLabel = `${genreItem?.label ?? active.genre} · ${modeItem?.label ?? active.mode}`;
  const savedGlossaryCount = savedGlossary.split('\n').filter((line) => {
    const at = line.indexOf('=');
    return at > 0 && line.slice(0, at).trim().length > 0 && line.slice(at + 1).trim().length > 0;
  }).length;
  const localGlossaryCount = Object.keys(parseGlossary(localGlossary)).length;

  /** Every pick rewrites the provider's key immediately. */
  const applyStyle = (nextStyleId: string) => {
    setStyleId(nextStyleId);
    setSelectedId(null);
    setNote('');
    setNoteFailed(false);
    try {
      setActiveStyle(nextStyleId);
    } catch (failure) {
      setNote(messageOf(failure));
      setNoteFailed(true);
    }
  };

  const applyExpert = (expert: TranslationExpert) => {
    applyStyle(`${expert.genre}.${expert.mode}`);
    setSelectedId(expert.id);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setNote('');
    setNoteFailed(false);
    try {
      const saved = await saveExpert({
        name: trimmed,
        genre: active.genre,
        mode: active.mode,
        glossary: glossary.trim(),
        override_prompt: '',
      });
      setSavedGlossary(glossary.trim());
      setName('');
      setSelectedId(saved.id);
      setNote(`已保存「${saved.name}」`);
      await loadExperts();
    } catch (failure) {
      setNote(messageOf(failure));
      setNoteFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const handleBind = async () => {
    if (selectedId === null || binding) return;
    setBinding(true);
    setNote('');
    setNoteFailed(false);
    try {
      await bindExpert(title, selectedId);
      setNote(`《${title}》已使用这个专家`);
    } catch (failure) {
      setNote(messageOf(failure));
      setNoteFailed(true);
    } finally {
      setBinding(false);
    }
  };

  /**
   * Persist the local glossary. The revision bump inside `setGlossaryText`
   * changes every translation cache key, so saving the same text twice is
   * avoided: only a real edit is written.
   */
  const saveLocalGlossary = () => {
    if (localGlossary !== savedLocalGlossary) {
      setGlossaryText(localGlossary);
      setSavedLocalGlossary(localGlossary);
    }
    setLocalGlossarySaved(true);
  };

  const refreshEndpoints = () => {
    setEndpoints(listEndpoints());
    setActiveEndpointIdState(getActiveEndpointId());
  };

  const openNewEndpoint = () => {
    setEndpointDraft(EMPTY_ENDPOINT_DRAFT);
    setEditingEndpointId(null);
    setEndpointTestResult('');
  };

  const openEditEndpoint = (endpoint: TranslationEndpoint) => {
    setEndpointDraft({
      name: endpoint.name,
      kind: endpoint.kind,
      baseUrl: endpoint.baseUrl,
      model: endpoint.model ?? '',
      apiKey: endpoint.apiKey ?? '',
    });
    setEditingEndpointId(endpoint.id);
    setEndpointTestResult('');
  };

  const updateEndpointDraft = (patch: Partial<EndpointDraft>) => {
    setEndpointDraft((current) => ({ ...current, ...patch }));
    setEndpointTestResult('');
  };

  const canSubmitEndpoint =
    endpointDraft.name.trim().length > 0 &&
    endpointDraft.baseUrl.trim().length > 0 &&
    (endpointDraft.kind === 'emm' || endpointDraft.model.trim().length > 0);

  const useEndpoint = (endpoint: TranslationEndpoint) => {
    saveEndpoint({ ...endpoint, enabled: true });
    setActiveEndpointId(endpoint.id);
    refreshEndpoints();
  };

  const handleDeleteEndpoint = (id: string) => {
    deleteEndpoint(id);
    if (editingEndpointId === id) {
      setEditingEndpointId(undefined);
      setEndpointTestResult('');
    }
    refreshEndpoints();
  };

  const handleSaveEndpoint = () => {
    if (!canSubmitEndpoint) return;
    const id =
      typeof editingEndpointId === 'string'
        ? editingEndpointId
        : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `translation-endpoint-${Date.now()}`;
    const endpoint: TranslationEndpoint = {
      id,
      name: endpointDraft.name.trim(),
      kind: endpointDraft.kind,
      baseUrl: endpointDraft.baseUrl.trim(),
      ...(endpointDraft.model.trim() ? { model: endpointDraft.model.trim() } : {}),
      ...(endpointDraft.apiKey.trim() ? { apiKey: endpointDraft.apiKey.trim() } : {}),
      enabled: true,
    };
    saveEndpoint(endpoint);
    setActiveEndpointId(endpoint.id);
    refreshEndpoints();
    setEditingEndpointId(undefined);
    setEndpointTestResult('');
  };

  const resolvedActiveEndpointId = endpoints.some(
    (endpoint) => endpoint.id === activeEndpointId && endpoint.enabled,
  )
    ? activeEndpointId
    : (endpoints.find((endpoint) => endpoint.enabled)?.id ?? null);

  // One tiny request through the draft's kind: `/styles` for the local
  // service, a `ping` chat completion for an OpenAI-compatible endpoint.
  const handleTestEndpoint = async () => {
    if (!canSubmitEndpoint) return;
    setEndpointTesting(true);
    setEndpointTestResult('');
    const started = Date.now();
    const baseUrl = endpointDraft.baseUrl.trim().replace(/\/+$/, '');
    const fetch = window.fetch.bind(window);
    try {
      let response: Response;
      if (endpointDraft.kind === 'emm') {
        response = await fetch(`${baseUrl}/styles`);
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (endpointDraft.apiKey.trim()) {
          headers['Authorization'] = `Bearer ${endpointDraft.apiKey.trim()}`;
        }
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: endpointDraft.model.trim(),
            temperature: 0,
            stream: false,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setEndpointTestResult(`可用 · ${Date.now() - started}ms`);
    } catch (failure) {
      setEndpointTestResult(`失败：${messageOf(failure)}`);
    } finally {
      setEndpointTesting(false);
    }
  };

  return (
    <div
      role='dialog'
      aria-label='翻译专家'
      aria-hidden={!open}
      inert={!open}
      className={clsx(
        'pointer-events-auto fixed bottom-0 right-0 top-0 z-50 flex w-[360px] max-w-full flex-col',
        'bg-base-100 rounded-box border border-base-content/10 shadow-lg',
        'transition-transform duration-300',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className='flex items-start gap-2 border-b border-base-content/10 px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='font-serif text-base font-semibold'>翻译专家</h2>
          <p className='mt-1 truncate text-xs opacity-60'>{styleLabel}</p>
        </div>
        <button
          className='btn btn-ghost btn-sm btn-circle'
          title='关闭'
          aria-label='关闭'
          onClick={onClose}
        >
          <MdClose size={18} />
        </button>
      </div>

      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4'>
        <section>
          <h3 className='text-sm font-medium'>风格</h3>
          {stylesStatus === 'loading' && !styles && (
            <p className='mt-2 text-sm opacity-60'>正在读取风格…</p>
          )}
          {stylesStatus === 'error' && (
            <div className='mt-2 space-y-2'>
              <p className='text-sm text-error'>读取失败：{stylesError}</p>
              <button className='btn btn-ghost btn-xs' onClick={() => void loadStyles()}>
                重试
              </button>
            </div>
          )}
          {styles && (
            <>
              <div className='mt-2 flex gap-1.5 overflow-x-auto pb-1'>
                {styles.genres.map((item) => {
                  const isActive = item.id === active.genre;
                  return (
                    <button
                      key={item.id}
                      aria-pressed={isActive}
                      title={item.desc}
                      className={clsx(
                        'btn btn-xs shrink-0 rounded-full',
                        isActive ? 'btn-primary' : 'btn-ghost bg-base-200/60',
                      )}
                      onClick={() => applyStyle(`${item.id}.${active.mode}`)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div
                role='group'
                aria-label='翻译模式'
                className='mt-3 flex rounded-field bg-base-200 p-0.5'
              >
                {styles.modes.map((item) => {
                  const isActive = item.id === active.mode;
                  return (
                    <button
                      key={item.id}
                      aria-pressed={isActive}
                      title={item.desc}
                      className={clsx(
                        'btn btn-xs flex-1 border-0 shadow-none',
                        isActive
                          ? 'bg-base-100 text-base-content'
                          : 'bg-transparent text-base-content/60',
                      )}
                      onClick={() => applyStyle(`${active.genre}.${item.id}`)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {(genreItem || modeItem) && (
                <p className='mt-2 text-xs leading-relaxed opacity-60'>
                  {[genreItem?.desc, modeItem?.desc].filter(Boolean).join('；')}
                </p>
              )}
            </>
          )}
        </section>

        <section>
          <div className='flex items-baseline justify-between gap-2'>
            <h3 className='text-sm font-medium'>术语表</h3>
            <span className='text-[11px] opacity-60'>{savedGlossaryCount} 条已暂存</span>
          </div>
          <textarea
            aria-label='术语表'
            className='textarea textarea-bordered mt-2 min-h-24 w-full resize-y text-sm'
            rows={4}
            placeholder='原词=译名，每行一条'
            value={glossary}
            onChange={(event) => setGlossary(event.target.value)}
            onBlur={() => setSavedGlossary(glossary.trim())}
          />
          <p className='mt-1.5 text-[11px] opacity-60'>失焦后暂存在面板里；保存专家时一并提交。</p>
        </section>

        <section>
          <h3 className='text-sm font-medium'>我的专家</h3>
          {expertsStatus === 'error' && (
            <div className='mt-2 space-y-2'>
              <p className='text-sm text-error'>读取失败：{expertsError}</p>
              <button className='btn btn-ghost btn-xs' onClick={() => void loadExperts()}>
                重试
              </button>
            </div>
          )}
          {expertsStatus === 'loading' && experts.length === 0 && (
            <p className='mt-2 text-sm opacity-60'>正在读取…</p>
          )}
          {expertsStatus === 'ready' && experts.length === 0 && (
            <p className='mt-2 text-sm opacity-60'>还没有专家，把上面的组合存下来。</p>
          )}
          <div className='mt-2 space-y-1.5'>
            {experts.map((expert) => {
              const isActive = expert.id === selectedId;
              const genreLabel =
                styles?.genres.find((item) => item.id === expert.genre)?.label ?? expert.genre;
              const modeLabel =
                styles?.modes.find((item) => item.id === expert.mode)?.label ?? expert.mode;
              return (
                <button
                  key={expert.id}
                  aria-pressed={isActive}
                  className={clsx(
                    'w-full rounded-field border px-3 py-2 text-left transition-colors',
                    isActive
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-base-content/10 bg-base-200/50 hover:bg-base-200',
                  )}
                  onClick={() => applyExpert(expert)}
                >
                  <span className='block truncate text-sm'>{expert.name}</span>
                  <span className='mt-0.5 block text-[11px] opacity-60'>
                    {genreLabel} · {modeLabel} · {expert.glossary_count} 条术语
                  </span>
                </button>
              );
            })}
          </div>
          <div className='mt-2 flex items-center gap-2'>
            <input
              aria-label='专家名称'
              className='input input-bordered input-sm min-w-0 flex-1 text-sm'
              placeholder='新专家名称'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className='btn btn-sm shrink-0'
              disabled={!name.trim() || saving}
              onClick={() => void handleSave()}
            >
              {saving ? '保存中…' : '保存为专家'}
            </button>
          </div>
        </section>

        {LOCAL_UNLOCK && (
          <>
            <section>
              <h3 className='text-sm font-medium'>本地术语表（对云端端点生效）</h3>
              <textarea
                aria-label='本地术语表'
                className='textarea textarea-bordered mt-2 min-h-24 w-full resize-y text-sm'
                rows={4}
                placeholder={'原词=译名，每行一条\nElizabeth=伊丽莎白\nDarcy=达西'}
                value={localGlossary}
                onChange={(event) => {
                  setLocalGlossary(event.target.value);
                  setLocalGlossarySaved(false);
                }}
                onBlur={saveLocalGlossary}
              />
              <div className='mt-1.5 flex flex-wrap items-center gap-2 text-[11px]'>
                <span className='opacity-60'>
                  {localGlossaryCount} 条 · 仅对 OpenAI 兼容端点生效
                </span>
                {localGlossarySaved && (
                  <span className='opacity-60' role='status'>
                    已保存
                  </span>
                )}
                <button
                  className='btn btn-ghost btn-xs ml-auto'
                  aria-label='保存本地术语表'
                  onClick={saveLocalGlossary}
                >
                  保存
                </button>
              </div>
            </section>

            <section>
              <h3 className='text-sm font-medium'>翻译端点</h3>
            {endpoints.length === 0 && editingEndpointId === undefined && (
              <p className='mt-2 text-sm opacity-60'>默认使用本机专家服务</p>
            )}
            <div className='mt-2 space-y-1.5'>
              {endpoints.map((endpoint) => {
                const isActive = endpoint.id === resolvedActiveEndpointId;
                return (
                  <div
                    key={endpoint.id}
                    data-testid={`translation-endpoint-${endpoint.id}`}
                    className='flex items-center gap-2 rounded-field border border-base-content/10 bg-base-200/50 px-3 py-2'
                  >
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm'>
                        {endpoint.name} ·{' '}
                        {endpoint.kind === 'openai-compatible'
                          ? 'OpenAI 兼容'
                          : '本机专家服务'}{' '}
                        · {hostOf(endpoint.baseUrl)}
                      </p>
                    </div>
                    <div className='flex shrink-0 items-center gap-1'>
                      {isActive ? (
                        <span className='badge badge-sm badge-outline'>使用中</span>
                      ) : (
                        <button
                          className='btn btn-ghost btn-xs eink-bordered'
                          aria-label={`启用 ${endpoint.name}`}
                          onClick={() => useEndpoint(endpoint)}
                        >
                          启用
                        </button>
                      )}
                      <button
                        className='btn btn-ghost btn-xs eink-bordered'
                        aria-label={`编辑 ${endpoint.name}`}
                        onClick={() => openEditEndpoint(endpoint)}
                      >
                        编辑
                      </button>
                      <button
                        className='btn btn-ghost btn-xs eink-bordered text-error'
                        aria-label={`删除 ${endpoint.name}`}
                        onClick={() => handleDeleteEndpoint(endpoint.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className='mt-2'>
              {editingEndpointId === undefined ? (
                <button
                  className='btn btn-ghost btn-sm eink-bordered w-full'
                  onClick={openNewEndpoint}
                >
                  添加端点
                </button>
              ) : (
                <div className='space-y-2' data-testid='translation-endpoint-form'>
                  <label className='flex flex-col gap-1 text-sm'>
                    <span>名称</span>
                    <input
                      className='input input-bordered input-sm eink-bordered w-full text-sm'
                      value={endpointDraft.name}
                      onChange={(event) => updateEndpointDraft({ name: event.target.value })}
                      placeholder='本机专家服务'
                    />
                  </label>
                  <label className='flex flex-col gap-1 text-sm'>
                    <span>类型</span>
                    <select
                      className='select select-bordered select-sm eink-bordered w-full text-sm'
                      value={endpointDraft.kind}
                      onChange={(event) =>
                        updateEndpointDraft({
                          kind: event.target.value as TranslationEndpointKind,
                        })
                      }
                    >
                      <option value='emm'>本机专家服务</option>
                      <option value='openai-compatible'>OpenAI 兼容</option>
                    </select>
                  </label>
                  <label className='flex flex-col gap-1 text-sm'>
                    <span>Base URL</span>
                    <input
                      className='input input-bordered input-sm eink-bordered w-full text-sm'
                      value={endpointDraft.baseUrl}
                      onChange={(event) => updateEndpointDraft({ baseUrl: event.target.value })}
                      placeholder='http://127.0.0.1:8790'
                    />
                  </label>
                  <label className='flex flex-col gap-1 text-sm'>
                    <span>模型</span>
                    <input
                      className='input input-bordered input-sm eink-bordered w-full text-sm'
                      value={endpointDraft.model}
                      onChange={(event) => updateEndpointDraft({ model: event.target.value })}
                      placeholder='deepseek-chat（OpenAI 兼容时必填）'
                    />
                  </label>
                  <label className='flex flex-col gap-1 text-sm'>
                    <span>API Key</span>
                    <input
                      type='password'
                      className='input input-bordered input-sm eink-bordered w-full text-sm'
                      value={endpointDraft.apiKey}
                      onChange={(event) => updateEndpointDraft({ apiKey: event.target.value })}
                      placeholder='可选'
                      autoComplete='off'
                    />
                  </label>

                  {endpointTestResult && (
                    <p className='break-words text-sm opacity-70' role='status'>
                      {endpointTestResult}
                    </p>
                  )}

                  <div className='flex flex-wrap items-center justify-end gap-2'>
                    <button
                      className='btn btn-ghost btn-sm eink-bordered'
                      onClick={() => void handleTestEndpoint()}
                      disabled={!canSubmitEndpoint || endpointTesting}
                    >
                      {endpointTesting ? '测试中…' : '测试'}
                    </button>
                    <button
                      className='btn btn-ghost btn-sm eink-bordered'
                      onClick={() => {
                        setEditingEndpointId(undefined);
                        setEndpointTestResult('');
                      }}
                    >
                      取消
                    </button>
                    <button
                      className='btn btn-contrast btn-sm'
                      onClick={handleSaveEndpoint}
                      disabled={!canSubmitEndpoint}
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}
            </div>
            </section>
          </>
        )}
      </div>

      <div className='border-t border-base-content/10 px-4 py-3'>
        <button
          className='btn btn-primary btn-sm w-full'
          disabled={selectedId === null || binding}
          onClick={() => void handleBind()}
        >
          {binding ? '设置中…' : '设为本书默认'}
        </button>
        {note && (
          <p className={clsx('mt-2 text-[11px]', noteFailed ? 'text-error' : 'opacity-60')}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
};

export default TranslationExpertPanel;
