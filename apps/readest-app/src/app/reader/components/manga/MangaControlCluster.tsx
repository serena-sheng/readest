'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdMoreHoriz, MdTranslate } from 'react-icons/md';

import type { MangaTranslationMode } from '@/types/book';
import type { MangaBubble } from '@/services/manga/types';
import type { MangaDanmakuBlockedReason } from '../../hooks/useMangaTranslation';

/** Distance the cluster keeps from the reading area's edges. */
export const MANGA_CONTROL_EDGE = 24;
/** Pointer stillness after which the cluster steps back. */
export const MANGA_CONTROL_IDLE_MS = 2500;
export const MANGA_CONTROL_IDLE_OPACITY = 0.6;
/** Below this reading-area height the cluster moves to the top edge. */
export const MANGA_SHORT_VIEWPORT_HEIGHT = 480;

export const MANGA_SEGMENT_WIDTH = 132;
export const MANGA_SEGMENT_HEIGHT = 28;

/** The three display states, in the order the 1/2/3 shortcuts follow. */
export const MANGA_DISPLAY_OPTIONS: Array<{ mode: MangaTranslationMode; label: string }> = [
  { mode: 'bubble', label: '嵌字' },
  { mode: 'danmaku', label: '侧栏' },
  { mode: 'off', label: '原' },
];

const KEY_TO_MODE: Record<string, MangaTranslationMode> = {
  '1': 'bubble',
  '2': 'danmaku',
  '3': 'off',
};

const EDITABLE_TAGS: Record<string, true> = { INPUT: true, TEXTAREA: true, SELECT: true };

export interface MangaControlClusterProps {
  available: boolean;
  loading: boolean;
  mode: MangaTranslationMode;
  danmakuDisabledReason: MangaDanmakuBlockedReason | null;
  /** Bubbles of the page on screen; drives the list panel. */
  bubbles: MangaBubble[];
  /** Translate the current page in the last-used display mode. */
  onTranslate: () => void;
  /** Pick a display state directly. */
  onSelectMode: (mode: MangaTranslationMode) => void;
  onFitPage: () => void;
  onRetranslate: () => void;
  onClose: () => void;
  /** The first-run note, rendered beside the cluster. */
  hint?: React.ReactNode;
}

/**
 * The page's own translation controls. It floats in the reading area's
 * bottom-right corner rather than the toolbar, so the reader never has to
 * remember a button's cycle: the display state is three visible choices.
 */
const MangaControlCluster: React.FC<MangaControlClusterProps> = ({
  available,
  loading,
  mode,
  danmakuDisabledReason,
  bubbles,
  onTranslate,
  onSelectMode,
  onFitPage,
  onRetranslate,
  onClose,
  hint,
}) => {
  const [idle, setIdle] = useState(false);
  const [shortViewport, setShortViewport] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const translated = mode !== 'off';
  const translateDisabled = !available || translated || loading;

  // The cluster fades back while the pointer rests, so artwork stays legible;
  // any movement brings it forward again. Hovering it also counts as intent.
  useEffect(() => {
    let timer: number | undefined;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), MANGA_CONTROL_IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  // Short reading areas put the cluster at the top, where it cannot cover the
  // page's lower speech bubbles.
  useEffect(() => {
    const measure = () => setShortViewport(window.innerHeight < MANGA_SHORT_VIEWPORT_HEIGHT);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 1/2/3 pick the same three states as the segmented control while the reader
  // is in the reading area — never while typing in a field or an open dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const next = KEY_TO_MODE[event.key];
      if (!next) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || EDITABLE_TAGS[target.tagName])) return;
      if (target?.closest?.('[role="dialog"]')) return;
      // The page, not a sidebar or dialog, must own the keyboard focus.
      const focus = document.activeElement as HTMLElement | null;
      if (focus && focus !== document.body && !rootRef.current?.contains(focus)) return;
      event.preventDefault();
      onSelectMode(next);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectMode]);

  useEffect(() => {
    if (!menuOpen && !listOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
      setListOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setListOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [listOpen, menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const pickMode = useCallback(
    (next: MangaTranslationMode) => {
      setMenuOpen(false);
      onSelectMode(next);
    },
    [onSelectMode],
  );

  return (
    <div
      ref={rootRef}
      data-testid='manga-control-cluster'
      className='pointer-events-none absolute z-30 flex flex-col items-end gap-2'
      style={
        shortViewport
          ? { top: `${MANGA_CONTROL_EDGE}px`, right: `${MANGA_CONTROL_EDGE}px` }
          : { bottom: `${MANGA_CONTROL_EDGE}px`, right: `${MANGA_CONTROL_EDGE}px` }
      }
    >
      <div className='relative flex flex-col items-end gap-2'>
        {hint}
        {listOpen && (
          <div
            role='region'
            aria-label='本页气泡'
            data-testid='manga-bubble-list'
            className='pointer-events-auto w-[280px] max-w-[calc(100vw-48px)] overflow-y-auto rounded-[6px] border border-study-ink/10 bg-study-page p-2'
            style={{ maxHeight: '280px' }}
          >
            {bubbles.length === 0 ? (
              <p className='text-study-ink/55 px-1 py-2 text-[12px]'>本页还没有译文</p>
            ) : (
              <ol className='flex flex-col gap-2'>
                {bubbles.map((bubble, index) => (
                  <li key={`${index}-${bubble.box[0]}-${bubble.box[1]}`} className='flex gap-2'>
                    <span className='text-study-ink/40 w-4 shrink-0 text-[11px] tabular-nums'>
                      {index + 1}
                    </span>
                    <span className='min-w-0'>
                      <span className='text-study-ink block text-[13px] leading-[1.5]'>
                        {bubble.dst}
                      </span>
                      <span className='text-study-ink/45 mt-0.5 block text-[11px] leading-[1.4]'>
                        {bubble.src}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <div
          data-testid='manga-control-surface'
          className='pointer-events-auto flex items-center gap-1 rounded-[6px] border border-study-ink/10 bg-study-page p-1'
          style={{ opacity: idle ? MANGA_CONTROL_IDLE_OPACITY : 1 }}
          onPointerEnter={() => setIdle(false)}
          onPointerDown={() => setIdle(false)}
        >
          <button
            type='button'
            aria-label='翻译本页'
            aria-busy={loading}
            title={available ? '翻译本页' : '本页没有可翻译的图片'}
            disabled={translateDisabled}
            onClick={onTranslate}
            className='group flex h-8 items-center rounded-[4px] bg-primary px-2 text-primary-content enabled:hover:brightness-105 disabled:opacity-35'
          >
            <MdTranslate size={18} aria-hidden='true' />
            <span className='ml-0 max-w-0 overflow-hidden whitespace-nowrap text-[12px] opacity-0 group-hover:ml-1 group-hover:max-w-[5em] group-hover:opacity-100'>
              翻译本页
            </span>
          </button>

          <div
            role='group'
            aria-label='显示方式'
            className='flex overflow-hidden rounded-[4px] border border-study-ink/10'
            style={{ width: `${MANGA_SEGMENT_WIDTH}px`, height: `${MANGA_SEGMENT_HEIGHT}px` }}
          >
            {MANGA_DISPLAY_OPTIONS.map((option) => {
              const selected = mode === option.mode;
              const optionDisabled =
                !available || (option.mode === 'danmaku' && danmakuDisabledReason !== null);
              const title =
                option.mode === 'danmaku'
                  ? danmakuDisabledReason === 'tall'
                    ? '长条漫只用「嵌字」'
                    : danmakuDisabledReason === 'narrow'
                      ? '窗口太窄，放不下两侧译文'
                      : '译文排在画面两侧'
                  : option.label;
              return (
                <button
                  key={option.mode}
                  type='button'
                  aria-pressed={selected}
                  disabled={optionDisabled}
                  title={title}
                  onClick={() => pickMode(option.mode)}
                  className='flex-1 text-[12px] disabled:opacity-35'
                  style={{
                    color: selected ? 'var(--color-primary)' : 'var(--color-study-ink)',
                    opacity: selected ? 1 : 0.6,
                    borderBottom: selected
                      ? '1px solid var(--color-primary)'
                      : '1px solid transparent',
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className='relative'>
            <button
              type='button'
              aria-label='更多'
              aria-haspopup='menu'
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className='flex h-8 w-8 items-center justify-center rounded-[4px] text-study-ink/60 hover:bg-study-chip hover:text-study-ink'
            >
              <MdMoreHoriz size={18} aria-hidden='true' />
            </button>
            {menuOpen && (
              <div
                role='menu'
                aria-label='更多'
                className={`absolute end-0 w-[168px] rounded-[6px] border border-study-ink/10 bg-study-page p-1 ${
                  shortViewport ? 'top-full mt-1' : 'bottom-full mb-1'
                }`}
              >
                <button
                  type='button'
                  role='menuitem'
                  disabled={bubbles.length === 0}
                  onClick={() => {
                    closeMenu();
                    setListOpen((open) => !open);
                  }}
                  className='flex w-full items-center rounded-[4px] px-2 py-1 text-start text-[12px] text-study-ink/80 hover:bg-study-chip disabled:opacity-35'
                >
                  气泡列表
                </button>
                <button
                  type='button'
                  role='menuitem'
                  onClick={() => {
                    closeMenu();
                    onFitPage();
                  }}
                  className='flex w-full items-center rounded-[4px] px-2 py-1 text-start text-[12px] text-study-ink/80 hover:bg-study-chip'
                >
                  适应页面
                </button>
                <button
                  type='button'
                  role='menuitem'
                  disabled={!available}
                  onClick={() => {
                    closeMenu();
                    onRetranslate();
                  }}
                  className='flex w-full items-center rounded-[4px] px-2 py-1 text-start text-[12px] text-study-ink/80 hover:bg-study-chip disabled:opacity-35'
                >
                  重新翻译
                </button>
                <button
                  type='button'
                  role='menuitem'
                  disabled={!translated}
                  onClick={() => {
                    closeMenu();
                    onClose();
                  }}
                  className='flex w-full items-center rounded-[4px] px-2 py-1 text-start text-[12px] text-study-ink/80 hover:bg-study-chip disabled:opacity-35'
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MangaControlCluster;
