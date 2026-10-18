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
import { eventDispatcher } from '@/utils/event';

interface TranslationExpertPanelProps {
  /** Book title: the subtitle, and the key `/bind` stores the expert under. */
  title: string;
  /** When several books are open, only this book's close events matter. */
  bookKey?: string;
  open: boolean;
  onClose: () => void;
}

type Status = 'loading' | 'ready' | 'error';

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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [binding, setBinding] = useState(false);
  const [note, setNote] = useState('');
  const [noteFailed, setNoteFailed] = useState(false);

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
