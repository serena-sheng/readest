'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoChevronDown } from 'react-icons/io5';
import { MdCheck } from 'react-icons/md';
import { PiChatTeardropText, PiImageSquare, PiSidebarSimple } from 'react-icons/pi';

import type { FoliateView } from '@/types/view';
import type { MangaTranslationMode } from '@/types/book';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import MenuItem from '@/components/MenuItem';
import Dialog from '@/components/Dialog';
import { useMangaTranslation } from '../../hooks/useMangaTranslation';
import MangaOverlay from './MangaOverlay';
import MangaStatusBar from './MangaStatusBar';

interface MangaTranslateTogglerProps {
  bookKey: string;
  view: FoliateView | null;
}

const MENU_ITEMS: Array<{ mode: MangaTranslationMode; label: string; description: string }> = [
  { mode: 'off', label: '关闭', description: '显示原始页面' },
  { mode: 'bubble', label: '嵌字', description: '译文直接盖在气泡上' },
  { mode: 'danmaku', label: '侧栏译文', description: '译文排在页面两侧' },
];

const MODE_TOOLTIPS: Record<Exclude<MangaTranslationMode, 'off'>, string> = {
  bubble: '漫画翻译：嵌字（点击关闭）',
  danmaku: '漫画翻译：侧栏译文（点击关闭）',
};

/**
 * Reader toolbar entry for manga translation. It owns the overlay's lifetime:
 * the layer is portalled into the page image's own document, so the header
 * component hosting this button is the natural mount point.
 *
 * The control is a switch plus a small menu arrow: clicking the icon opens or
 * closes the last-used mode, while the menu reaches any mode in one click.
 */
const MangaTranslateToggler: React.FC<MangaTranslateTogglerProps> = ({ bookKey, view }) => {
  const _ = useTranslation();
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const setSettingsDialogOpen = useSettingsStore((state) => state.setSettingsDialogOpen);
  const setSettingsDialogBookKey = useSettingsStore((state) => state.setSettingsDialogBookKey);

  const [menuOpen, setMenuOpen] = useState(false);
  const [seenImage, setSeenImage] = useState(false);
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);

  const handleNarrowFallback = useCallback(
    (message: string) => {
      void eventDispatcher.dispatch('hint', { bookKey, message, timeout: 4000 });
    },
    [bookKey],
  );

  const {
    available,
    loading,
    mode,
    imageEl,
    result,
    status,
    danmakuDisabledReason,
    needsModelSetup,
    toggle,
    setMode,
    stop,
    retry,
    dismissStatus,
    dismissModelSetup,
  } = useMangaTranslation(bookKey, view, { onNarrowFallback: handleNarrowFallback });

  // A book that has shown a manga page keeps the slot on image-less pages
  // (covers, colophons): a vanishing button reads as a broken feature and
  // shifts its neighbours. Books that never showed one don't get the button.
  useEffect(() => {
    if (available) setSeenImage(true);
  }, [available]);

  // The inline status bar belongs to the reading area, not the header band.
  useEffect(() => {
    setStatusHost(document.getElementById(`gridcell-${bookKey}`));
  }, [bookKey]);

  const closeMenu = useCallback((returnFocus = false) => {
    setMenuOpen(false);
    if (returnFocus) arrowRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      );
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = index < 0 ? 0 : (index + step + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [closeMenu, menuOpen]);

  if (!seenImage && !available) return null;

  const disabled = !available;
  const accent = isDarkMode ? '#FF7BA6' : '#C81E57';
  const iconSize = 18;
  const active = mode !== 'off';
  const ModeIcon =
    mode === 'bubble' ? PiChatTeardropText : mode === 'danmaku' ? PiSidebarSimple : PiImageSquare;
  const mainLabel = disabled
    ? _('本页没有可翻译的图片')
    : mode !== 'off'
      ? _(MODE_TOOLTIPS[mode])
      : _('翻译这一页的漫画文字');
  const danmakuDescription =
    danmakuDisabledReason === 'tall'
      ? '长条漫只用嵌字'
      : danmakuDisabledReason === 'narrow'
        ? '需要更宽的窗口'
        : '译文排在页面两侧';

  const handleSelectMode = (next: MangaTranslationMode) => {
    setMenuOpen(false);
    void setMode(next);
  };

  return (
    <>
      <div className='relative flex items-center gap-0.5'>
        <button
          type='button'
          aria-label={mainLabel}
          aria-pressed={active}
          title={mainLabel}
          disabled={disabled}
          onClick={() => void toggle()}
          className={`touch-target btn btn-ghost relative h-8 min-h-8 w-8 p-0 ${
            disabled ? 'cursor-default bg-transparent! opacity-35' : ''
          }`}
        >
          <ModeIcon
            size={iconSize}
            style={active ? { color: accent } : undefined}
            className={active ? undefined : 'text-base-content/60'}
          />
          {loading ? (
            <span
              aria-hidden='true'
              className='absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 ring-2 ring-base-100'
              style={{ borderColor: accent }}
            />
          ) : (
            active && (
              <span
                aria-hidden='true'
                className='absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full ring-2 ring-base-100'
                style={{ backgroundColor: '#F0457E' }}
              />
            )
          )}
        </button>
        {!disabled && (
          <button
            ref={arrowRef}
            type='button'
            aria-label={_('显示方式')}
            aria-haspopup='menu'
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className='touch-target btn btn-ghost h-8 min-h-8 w-3 p-0'
          >
            <IoChevronDown size={12} className='text-base-content/45' />
          </button>
        )}

        {menuOpen && (
          <>
            <div className='fixed inset-0 z-40' onClick={() => closeMenu()} />
            <div
              ref={menuRef}
              role='menu'
              aria-label={_('显示方式')}
              className='absolute left-0 top-full z-50 mt-1 w-[248px] rounded-lg border border-base-300 bg-base-200 p-1.5'
              style={{
                boxShadow: '0 12px 32px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)',
              }}
            >
              {MENU_ITEMS.map((item) => {
                const isCurrent = item.mode === mode;
                const itemDisabled = item.mode === 'danmaku' && danmakuDisabledReason !== null;
                return (
                  <MenuItem
                    key={item.mode}
                    label={_(item.label)}
                    description={item.mode === 'danmaku' ? _(danmakuDescription) : _(item.description)}
                    disabled={itemDisabled}
                    toggled={isCurrent}
                    Icon={
                      isCurrent ? (
                        <MdCheck size={16} style={{ color: accent }} />
                      ) : undefined
                    }
                    transient
                    setIsDropdownOpen={() => setMenuOpen(false)}
                    onClick={() => handleSelectMode(item.mode)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {imageEl && result && mode !== 'off' && (
        <MangaOverlay imageEl={imageEl} result={result} mode={mode} />
      )}

      {statusHost &&
        createPortal(
          <MangaStatusBar
            status={status}
            onStop={stop}
            onRetry={() => void retry()}
            onDismiss={dismissStatus}
          />,
          statusHost,
        )}

      <Dialog
        isOpen={needsModelSetup}
        title={_('漫画翻译还没连上模型')}
        onClose={dismissModelSetup}
        boxClassName='sm:h-auto! sm:w-[420px]! sm:max-w-[90vw]!'
      >
        {needsModelSetup && (
          <div className='flex flex-col gap-4 pb-4'>
            <p className='text-base-content/70 text-sm'>
              {_('在设置里添加一个能看图的模型，再回来翻译这一页。')}
            </p>
            <div className='flex justify-end gap-2'>
              <button type='button' className='btn btn-ghost btn-sm' onClick={dismissModelSetup}>
                {_('以后再说')}
              </button>
              <button
                type='button'
                className='btn btn-primary btn-sm'
                onClick={() => {
                  dismissModelSetup();
                  setSettingsDialogBookKey(bookKey);
                  setSettingsDialogOpen(true);
                }}
              >
                {_('去设置')}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
};

export default MangaTranslateToggler;
