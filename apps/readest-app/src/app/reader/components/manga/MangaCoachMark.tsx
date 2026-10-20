'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const MANGA_COACH_SEEN_KEY = 'emm.manga.coachSeen';
export const MANGA_COACH_MESSAGE = '这一页是漫画，要把气泡里的文字翻成中文吗？';
/** Bubbles are anchored under the toolbar trigger; this is their fixed width. */
export const MANGA_COACH_WIDTH = 264;
/** Air between the trigger's bottom edge and the panel. */
const MANGA_COACH_GAP = 8;
/** Minimum distance the panel keeps from any viewport edge. */
const MANGA_COACH_MARGIN = 16;
/** Enough room for the message and both buttons when clamping vertically. */
const MANGA_COACH_MIN_HEIGHT = 116;
export const MANGA_COACH_AUTO_DISMISS_MS = 6000;

/** Whether this user has already seen the one-time manga hint. */
export const isMangaCoachSeen = (): boolean => {
  try {
    return window.localStorage.getItem(MANGA_COACH_SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

export const markMangaCoachSeen = () => {
  try {
    window.localStorage.setItem(MANGA_COACH_SEEN_KEY, '1');
  } catch {
    // Storage can be unavailable (private mode); the hint simply reappears.
  }
};

/**
 * Fixed position for the coach mark, in viewport coordinates. It hugs the
 * trigger's bottom edge, right-aligns when there is no room to the right, and
 * is clamped inside the viewport on both axes.
 */
export const computeMangaCoachMarkPosition = (
  trigger: { left: number; right: number; bottom: number },
  viewport: { width: number; height: number },
  width: number = MANGA_COACH_WIDTH,
): { top: number; left: number } => {
  let left = trigger.left;
  if (left + width > viewport.width - MANGA_COACH_MARGIN) {
    left = trigger.right - width;
  }
  left = Math.max(
    MANGA_COACH_MARGIN,
    Math.min(left, viewport.width - width - MANGA_COACH_MARGIN),
  );

  const wantedTop = trigger.bottom + MANGA_COACH_GAP;
  const top = Math.max(
    MANGA_COACH_MARGIN,
    Math.min(wantedTop, viewport.height - MANGA_COACH_MARGIN - MANGA_COACH_MIN_HEIGHT),
  );
  return { top, left };
};

interface MangaCoachMarkProps {
  /** The toolbar control the hint is anchored to. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Start translating the current page. */
  onTranslate: () => void;
  /** Called whenever the hint closes, for any reason. */
  onDismiss?: () => void;
}

/**
 * One-time hint shown the first time a manga page offers translation. It does
 * not block reading: only its own panel catches pointer events, and it closes
 * on any outside click or after six seconds.
 */
const MangaCoachMark: React.FC<MangaCoachMarkProps> = ({
  triggerRef,
  onTranslate,
  onDismiss,
}) => {
  const [open, setOpen] = useState(() => !isMangaCoachSeen());
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    markMangaCoachSeen();
    setOpen(false);
    onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const positionPanel = () => {
      setPosition(
        computeMangaCoachMarkPosition(trigger.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };
    positionPanel();
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    return () => {
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
    };
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(dismiss, MANGA_COACH_AUTO_DISMISS_MS);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panelRef.current?.contains(target)) return;
      dismiss();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [dismiss, open]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      role='dialog'
      aria-label={MANGA_COACH_MESSAGE}
      className='pointer-events-auto fixed z-50'
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: `${MANGA_COACH_WIDTH}px`,
        maxWidth: `calc(100vw - ${MANGA_COACH_MARGIN * 2}px)`,
        padding: '12px',
        borderRadius: '10px',
        background: 'rgba(255, 255, 255, 0.98)',
        color: '#3A2230',
        border: '1px solid color-mix(in srgb, var(--color-primary) 22%, transparent)',
        boxShadow: '0 12px 32px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)',
      }}
    >
      <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55 }}>{MANGA_COACH_MESSAGE}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
        <button
          type='button'
          onClick={() => dismiss()}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#6B5360',
            fontSize: '12px',
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          先不用
        </button>
        <button
          type='button'
          onClick={() => {
            dismiss();
            onTranslate();
          }}
          style={{
            border: 'none',
            borderRadius: '6px',
            background: 'var(--color-primary)',
            color: '#fff',
            fontSize: '12px',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          翻译这一页
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default MangaCoachMark;
