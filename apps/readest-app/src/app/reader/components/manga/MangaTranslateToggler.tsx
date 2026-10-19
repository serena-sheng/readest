'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  { mode: 'off', label: '原始页面', description: '不显示译文' },
  { mode: 'bubble', label: '盖在原文上', description: '译文直接盖住气泡' },
  { mode: 'danmaku', label: '排在两侧', description: '译文排在画面左右两栏' },
];

const MODE_TOOLTIPS: Record<Exclude<MangaTranslationMode, 'off'>, string> = {
  bubble: '漫画翻译：盖在原文上',
  danmaku: '漫画翻译：排在两侧',
};

export const MANGA_MENU_WIDTH = 248;
/** Air between the trigger's bottom edge and the menu. */
export const MANGA_MENU_GAP = 6;
/** Minimum distance the menu keeps from any viewport edge. */
export const MANGA_MENU_MARGIN = 16;
/** Room reserved below the trigger so the rows stay reachable. */
const MANGA_MENU_MIN_HEIGHT = 120;

/**
 * Fixed position for the menu, in viewport coordinates. It hangs below the
 * trigger, right-aligns when there is no room to the right, and is clamped
 * MARGIN pixels inside the viewport on both axes.
 */
export const computeMangaMenuPosition = (
  trigger: { left: number; right: number; bottom: number },
  viewport: { width: number; height: number },
): { top: number; left: number; maxHeight: number } => {
  let left = trigger.left;
  if (left + MANGA_MENU_WIDTH > viewport.width - MANGA_MENU_MARGIN) {
    left = trigger.right - MANGA_MENU_WIDTH;
  }
  left = Math.max(
    MANGA_MENU_MARGIN,
    Math.min(left, viewport.width - MANGA_MENU_WIDTH - MANGA_MENU_MARGIN),
  );

  const wantedTop = trigger.bottom + MANGA_MENU_GAP;
  const top = Math.max(
    MANGA_MENU_MARGIN,
    Math.min(wantedTop, viewport.height - MANGA_MENU_MARGIN - MANGA_MENU_MIN_HEIGHT),
  );

  return {
    top,
    left,
    maxHeight: Math.max(MANGA_MENU_MIN_HEIGHT, viewport.height - top - MANGA_MENU_MARGIN),
  };
};

/**
 * Reader toolbar entry for manga translation. It owns the overlay's lifetime:
 * the layer is portalled into the page image's own document, so the header
 * component hosting this button is the natural mount point.
 *
 * There is one 32×32 button and no second hot zone: it opens a menu (portalled
 * to `body` so the header's overflow scroller cannot clip it) whose first row
 * switches translation on or off and whose remaining rows pick a layout.
 */
const MangaTranslateToggler: React.FC<MangaTranslateTogglerProps> = ({ bookKey, view }) => {
  const _ = useTranslation();
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const setSettingsDialogOpen = useSettingsStore((state) => state.setSettingsDialogOpen);
  const setSettingsDialogBookKey = useSettingsStore((state) => state.setSettingsDialogBookKey);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const [seenImage, setSeenImage] = useState(false);
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setMenuPosition(
      computeMangaMenuPosition(trigger.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, []);

  const openMenu = useCallback(() => {
    positionMenu();
    setMenuOpen(true);
  }, [positionMenu]);

  const closeMenu = useCallback((returnFocus = false) => {
    setMenuOpen(false);
    if (returnFocus) triggerRef.current?.focus();
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

  // A fixed menu must follow the trigger when the window resizes or the
  // reader scrolls; a pointer landing anywhere else closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [closeMenu, menuOpen, positionMenu]);

  // Keyboard users land in the menu; the trigger stays the way back.
  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [menuOpen]);

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
      ? '长条漫只用「盖在原文上」'
      : danmakuDisabledReason === 'narrow'
        ? '需要更宽的窗口'
        : '译文排在画面左右两栏';

  const handleSelectMode = (next: MangaTranslationMode) => {
    setMenuOpen(false);
    void setMode(next);
  };

  return (
    <>
      <div className='relative flex items-center'>
        <button
          ref={triggerRef}
          type='button'
          aria-label={mainLabel}
          aria-pressed={active}
          aria-haspopup='menu'
          aria-expanded={menuOpen}
          title={mainLabel}
          disabled={disabled}
          onClick={() => (menuOpen ? closeMenu(true) : openMenu())}
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

        {menuOpen &&
          menuPosition &&
          createPortal(
            <div
              ref={menuRef}
              role='menu'
              aria-label={_('漫画翻译显示方式')}
              className='fixed z-50 w-[248px] overflow-y-auto rounded-lg border border-base-300 bg-base-200 p-1.5'
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                maxHeight: `${menuPosition.maxHeight}px`,
                boxShadow: '0 12px 32px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)',
              }}
            >
              <MenuItem
                label={_(active ? '关闭漫画翻译' : '开启漫画翻译')}
                toggled={active}
                transient
                setIsDropdownOpen={() => closeMenu()}
                onClick={() => {
                  setMenuOpen(false);
                  void toggle();
                }}
              />
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
            </div>,
            document.body,
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
