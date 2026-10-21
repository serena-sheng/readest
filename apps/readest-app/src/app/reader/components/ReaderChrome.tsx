'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdEditNote, MdList, MdOutlineMoreHoriz, MdSearch, MdTextFields } from 'react-icons/md';

import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { saveViewSettings } from '@/helpers/settings';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import ModalPortal from '@/components/ModalPortal';
import WindowButtons from '@/components/WindowButtons';
import ReaderToolsMenuItems from './ReaderToolsMenuItems';
import ViewMenu from './ViewMenu';
import SyncInfoDialog from './SyncInfoDialog';
import BookmarkToggler from './BookmarkToggler';
import TranslationToggler from './TranslationToggler';
import MangaTranslateToggler from './manga/MangaTranslateToggler';
import { annotationToolQuickActions } from './annotator/AnnotationTools';
import { ReaderToolsProvider, useNotebookToggle, useReaderToolsPanels } from '../hooks/useReaderTools';

/** Pointer distance from the top edge that reveals the toolbar. */
export const CHROME_TRIGGER_HEIGHT = 64;
/** How long the toolbar stays after it appears. */
export const CHROME_HIDE_DELAY_MS = 1200;

export interface ReaderChromeProps {
  bookKey: string;
  bookTitle: string;
  /** Where the reader currently is, for the bottom overlay's label. */
  sectionLabel?: string;
  page?: number;
  /** [0, 1] — drives the 2px hairline at the window's bottom edge. */
  fraction: number;
  gridInsets: Insets;
  onCloseBook: (bookKey: string) => void;
  onGoToLibrary: () => void;
  /** Keeps the reader's chrome pinned while a menu is open. */
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

const CHROME_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded-control text-study-ink/70 ' +
  'hover:bg-study-chip hover:text-study-ink transition-colors duration-150 ease-study';

/**
 * The reader's quiet chrome. Nothing is laid out: the top toolbar is an
 * absolute overlay that only appears while the pointer is near the top edge
 * (or ⌘K), and the bottom is a 2px progress hairline at the window edge whose
 * hover strip reveals the existing footer bar. Because every surface is
 * absolutely positioned, showing and hiding it never moves the page text.
 */
const ReaderChrome: React.FC<ReaderChromeProps> = (props) => (
  <ReaderToolsProvider bookKey={props.bookKey} title={props.bookTitle}>
    <ReaderChromeInner {...props} />
  </ReaderToolsProvider>
);

const ReaderChromeInner: React.FC<ReaderChromeProps> = ({
  bookKey,
  sectionLabel,
  page,
  fraction,
  gridInsets,
  onCloseBook,
  onGoToLibrary,
  onDropdownOpenChange,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { bookKeys, setHoveredBookKey, getView } = useReaderStore();
  const { setSideBarBookKey, setSideBarVisible, setSearchBarVisible } = useSidebarStore();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const tools = useReaderToolsPanels();
  const notebook = useNotebookToggle(bookKey);

  const headerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSyncInfoOpen, setIsSyncInfoOpen] = useState(false);

  const view = getView(bookKey);
  const config = getConfig(bookKey);
  const bookData = getBookData(bookKey);
  const viewSettings = config?.viewSettings;
  const quickActionEnabled = viewSettings?.enableAnnotationQuickActions;
  const nativeLastSyncedAt =
    Math.max(
      config?.lastSyncedAtConfig || 0,
      config?.lastSyncedAtNotes || 0,
      config?.lastPushedAtConfig || 0,
      config?.lastPushedAtNotes || 0,
    ) || undefined;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    setIsVisible(true);
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setIsVisible(false), CHROME_HIDE_DELAY_MS);
  }, [clearHideTimer]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  // ⌘K / Ctrl+K reveals the toolbar the same way the top-edge strip does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [show]);

  const openToc = () => {
    setSideBarBookKey(bookKey);
    setSideBarVisible(true);
    const config = getConfig(bookKey);
    if (config?.viewSettings) {
      setConfig(bookKey, {
        viewSettings: { ...config.viewSettings, sideBarTab: 'toc' },
      });
    }
  };

  const openSearch = () => {
    setSideBarBookKey(bookKey);
    setSideBarVisible(true);
    setSearchBarVisible(true);
  };

  const handleMenuToggle = (open: boolean) => {
    setIsMenuOpen(open);
    onDropdownOpenChange?.(open);
    if (open) clearHideTimer();
  };

  const chromeVisible = isVisible || isMenuOpen;
  const fractionPercent = Math.min(100, Math.max(0, fraction * 100));
  const statusLabel = [page !== undefined ? `第 ${page} 页` : null, sectionLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className='reader-chrome pointer-events-none absolute inset-0 z-20'>
      {/* Top edge trigger: 64px tall, above the page text, never a click target
          for reading. Repeating the hover on the bar itself keeps it alive
          while the pointer moves between icons. */}
      <div
        role='presentation'
        aria-hidden='true'
        className='reader-chrome-trigger pointer-events-auto absolute inset-x-0 top-0 h-16'
        onMouseEnter={show}
        onTouchStart={show}
      />
      <div
        ref={headerRef}
        role='toolbar'
        aria-label={_('Reader Chrome')}
        aria-hidden={!chromeVisible}
        className={clsx(
          'reader-chrome-top hairline-b bg-study-canvas absolute inset-x-0 top-0 h-11',
          'transition-opacity duration-[160ms] ease-study',
          chromeVisible ? 'visible opacity-100' : 'pointer-events-none invisible opacity-0',
        )}
        style={{
          paddingTop: gridInsets.top ? `${gridInsets.top}px` : undefined,
        }}
        onMouseEnter={() => {
          clearHideTimer();
          setIsVisible(true);
        }}
      >
        <div className='reader-chrome-row mx-auto flex h-11 w-[var(--reader-measure)] items-center justify-between'>
          <div className='flex items-center gap-1'>
            <button
              type='button'
              className={CHROME_BUTTON}
              onClick={openToc}
              aria-label='目录'
              title='目录'
            >
              <MdList className='h-4 w-4' />
            </button>
            <button
              type='button'
              className={CHROME_BUTTON}
              onClick={openSearch}
              aria-label='搜索'
              title='搜索'
            >
              <MdSearch className='h-4 w-4' />
            </button>
            <button
              type='button'
              className={CHROME_BUTTON}
              onClick={notebook.toggle}
              aria-label='笔记'
              title='笔记'
            >
              <MdEditNote className='h-4 w-4' />
            </button>
            <button
              type='button'
              className={CHROME_BUTTON}
              onClick={tools.typeset.toggle}
              aria-label='字体'
              title='字体'
            >
              <MdTextFields className='h-4 w-4' />
            </button>
            <Dropdown
              label='更多'
              containerClassName='h-8'
              className='dropdown-bottom'
              buttonClassName={CHROME_BUTTON}
              toggleButton={<MdOutlineMoreHoriz className='h-4 w-4' />}
              onToggle={handleMenuToggle}
            >
              <Menu
                className={clsx(
                  'bgcolor-base-200 dropdown-content no-triangle z-20 mt-1.5 border shadow-2xl',
                )}
                onCancel={() => handleMenuToggle(false)}
              >
                <ReaderToolsMenuItems
                  bookKey={bookKey}
                  setIsDropdownOpen={(open) => !open && handleMenuToggle(false)}
                />
                <hr aria-hidden='true' className='border-base-300 my-1' />
                <div className='flex items-center gap-1 px-2 py-1'>
                  <BookmarkToggler bookKey={bookKey} />
                  <TranslationToggler bookKey={bookKey} />
                  <MangaTranslateToggler bookKey={bookKey} view={view ?? null} />
                </div>
                {quickActionEnabled && (
                  <>
                    <hr aria-hidden='true' className='border-base-300 my-1' />
                    {annotationToolQuickActions.map((action) => (
                      <MenuItem
                        key={action.type}
                        label={action.label}
                        Icon={action.Icon}
                        toggled={viewSettings?.annotationQuickAction === action.type}
                        onClick={() => {
                          saveViewSettings(
                            envConfig,
                            bookKey,
                            'annotationQuickAction',
                            viewSettings?.annotationQuickAction === action.type
                              ? null
                              : action.type,
                            false,
                            true,
                          );
                          handleMenuToggle(false);
                        }}
                      />
                    ))}
                  </>
                )}
                <hr aria-hidden='true' className='border-base-300 my-1' />
                <ViewMenu
                  bookKey={bookKey}
                  bare
                  setIsDropdownOpen={(open) => !open && handleMenuToggle(false)}
                  onShowMetaHashDialog={() => setIsSyncInfoOpen(true)}
                />
                <hr aria-hidden='true' className='border-base-300 my-1' />
                <MenuItem
                  label='书房'
                  onClick={() => {
                    handleMenuToggle(false);
                    onGoToLibrary();
                  }}
                />
                <div className='flex justify-end px-2 py-1'>
                  <WindowButtons
                    className='window-buttons flex items-center'
                    headerRef={headerRef}
                    showMinimize={bookKeys.length === 1}
                    showMaximize={bookKeys.length === 1}
                    closeButtonLabel={_('Close Book')}
                    onClose={() => {
                      setHoveredBookKey(null);
                      onCloseBook(bookKey);
                    }}
                  />
                </div>
              </Menu>
            </Dropdown>
          </div>
        </div>
      </div>

      {/* Bottom edge: a 2px progress hairline pinned to the window, and a hover
          strip that reveals the footer bar. Neither participates in layout, so
          the text column keeps its position in every state. */}
      <div
        className='reader-chrome-foot absolute inset-x-0 bottom-0'
        data-testid='reader-chrome-foot'
      >
        <div aria-hidden='true' className='bg-study-ink/10 h-[2px] w-full'>
          <div
            className='bg-primary h-full transition-[width] duration-200 ease-study'
            style={{ width: `${fractionPercent}%` }}
            data-testid='reader-progress-line'
          />
        </div>
        <div
          role='presentation'
          data-testid='reader-chrome-foot-strip'
          className='pointer-events-auto absolute inset-x-0 bottom-0 h-6'
          onMouseEnter={() => setHoveredBookKey(bookKey)}
          onMouseLeave={() => setHoveredBookKey('')}
        />
        {statusLabel && (
          <span
            className='text-meta text-study-ink/55 pointer-events-none absolute bottom-2 start-4 tabular-nums'
            data-testid='reader-chrome-status'
          >
            {statusLabel}
          </span>
        )}
      </div>
      {isSyncInfoOpen && (
        <ModalPortal showOverlay={false}>
          <SyncInfoDialog
            isOpen={isSyncInfoOpen}
            bookKey={bookKey}
            metadata={bookData?.bookDoc?.metadata ?? bookData?.book?.metadata}
            storedMetaHash={bookData?.book?.metaHash}
            nativeLastSyncedAt={nativeLastSyncedAt}
            onClose={() => setIsSyncInfoOpen(false)}
          />
        </ModalPortal>
      )}
    </div>
  );
};

export default ReaderChrome;
