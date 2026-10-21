import clsx from 'clsx';
import React, { useRef } from 'react';
import { FaChevronDown, FaSearch, FaTags } from 'react-icons/fa';
import { MdManageSearch, MdTune } from 'react-icons/md';
import { PiPlus } from 'react-icons/pi';
import { PiSelectionAll, PiSelectionAllFill } from 'react-icons/pi';
import { PiDotsThreeCircle } from 'react-icons/pi';
import { MdOutlineMenu } from 'react-icons/md';
import { IoMdCloseCircle } from 'react-icons/io';
import { TbRadar2, TbWand } from 'react-icons/tb';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { LibrarySearchConfig, LibrarySearchTarget } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import useShortcuts from '@/hooks/useShortcuts';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import SettingsMenu from './SettingsMenu';
import ImportMenu from './ImportMenu';
import LibrarySearchOptionsMenu from './LibrarySearchOptionsMenu';
import ViewMenu from './ViewMenu';

interface LibraryHeaderProps {
  isSelectMode: boolean;
  isSelectAll: boolean;
  onPullLibrary: () => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportFromLocalLibrary?: () => void;
  onImportFromWebBrowser?: () => void;
  onImportBookFromNovelUrl?: () => void;
  onOpenCatalogManager: () => void;
  onOpenFeeds: () => void;
  onToggleTagBrowser?: () => void;
  isTagBrowserOpen?: boolean;
  onSuggestTitles?: () => void;
  onScanImportable?: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  searchQuery: string;
  searchTarget: LibrarySearchTarget;
  searchConfig: LibrarySearchConfig;
  onSearchConfigChange: (config: LibrarySearchConfig) => void;
  onSearchQueryChange: (query: string) => void;
  onSearchTargetChange: (target: LibrarySearchTarget) => void;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSelectMode,
  isSelectAll,
  onPullLibrary,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportFromLocalLibrary,
  onImportFromWebBrowser,
  onImportBookFromNovelUrl,
  onOpenCatalogManager,
  onOpenFeeds,
  onToggleTagBrowser,
  isTagBrowserOpen = false,
  onSuggestTitles,
  onScanImportable,
  onToggleSelectMode,
  onSelectAll,
  onDeselectAll,
  searchQuery,
  searchTarget,
  searchConfig,
  onSearchConfigChange,
  onSearchQueryChange,
  onSearchTargetChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { currentBookshelf } = useLibraryStore();

  const headerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize18 = useResponsiveSize(18);
  const { safeAreaInsets: insets, isIPhoneDuo } = useThemeStore();

  useShortcuts({
    onToggleSelectMode,
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchQueryChange(e.target.value);
  };

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const currentBooksCount = currentBookshelf.length;

  if (!insets) return null;

  const isMobile = appService?.isMobile || window.innerWidth <= 640;

  return (
    <div
      ref={headerRef}
      className={clsx(
        'titlebar z-10 flex w-full flex-col py-2 pr-4',
        windowButtonVisible ? 'sm:pr-4' : 'sm:pr-6',
        isTrafficLightVisible ? 'pl-16' : 'pl-0',
      )}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : '0px',
        // Keep the trailing buttons clear of iPhone Duo's side status strip /
        // camera cutout (#6307); bases match pl-0 / pr-4. Only with a side
        // inset, so responsive sm:pl-2 / sm:pr-6 keep applying otherwise.
        ...(isIPhoneDuo && (insets.left || insets.right)
          ? { paddingLeft: `${insets.left}px`, paddingRight: `${insets.right + 16}px` }
          : {}),
      }}
    >
      <div className='flex w-full items-baseline gap-2 ps-6 pe-4'>
        <h1 className='library-title text-[19px] font-semibold leading-[26px]'>{_('Library')}</h1>
        <span className='text-base-content/55 text-caption leading-4 font-normal tabular-nums'>
          {_('{{count}} books', { count: currentBooksCount })}
        </span>
      </div>
      <div className='mt-1 flex w-full min-w-0 items-center justify-between gap-3 sm:gap-6'>
        <div className='exclude-title-bar-mousedown relative flex min-w-0 flex-1 items-center gap-3 ps-6'>
          <div className='relative flex h-9 w-full max-w-[420px] min-w-0 items-center'>
            {/* The magnifier only focuses the input; the search scope is the
                text control on the right (书名 / 全文). */}
            <div className='absolute inset-y-0 start-0 z-10 flex items-center'>
              <button
                type='button'
                aria-label={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
                title={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
                className={clsx(
                  'text-base-content/55 hover:text-base-content',
                  'not-eink:transition-colors ms-1.5 flex h-7 min-h-7 items-center justify-center',
                  'touch-target w-8 rounded-full bg-transparent duration-150',
                  'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
                )}
                onClick={() => searchInputRef.current?.focus()}
              >
                {searchTarget === 'text' ? (
                  <MdManageSearch className='h-5 w-5 -translate-y-[1px]' />
                ) : (
                  <FaSearch className='h-3.5 w-3.5' />
                )}
              </button>
            </div>
            <input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              placeholder={
                searchTarget === 'text'
                  ? _('Search contents in {{count}} Book(s)...', { count: currentBooksCount })
                  : currentBooksCount > 1
                    ? _('Search in {{count}} Book(s)...', {
                        count: currentBooksCount,
                      })
                    : _('Search Books...')
              }
              onChange={handleSearchChange}
              spellCheck='false'
              className={clsx(
                'search-input input h-9 w-full rounded-full border ps-10',
                searchTarget === 'text' ? 'pe-28' : 'pe-24',
                'border-base-content/8 bg-base-100',
                'font-sans text-sm font-light',
                'placeholder:text-base-content/50 truncate',
                'focus:outline-hidden focus:ring-0',
              )}
            />
            <div className='absolute inset-y-0 end-0 flex items-center gap-0.5 pe-2'>
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => onSearchQueryChange('')}
                  className='text-base-content/40 hover:text-base-content/60 flex h-6 w-6 items-center justify-center'
                  aria-label={_('Clear Search')}
                >
                  <IoMdCloseCircle className='h-4 w-4' />
                </button>
              )}
              {searchTarget === 'text' && (
                <Dropdown
                  label={_('Search Options')}
                  className='dropdown-bottom dropdown-end'
                  menuClassName='no-triangle mt-1'
                  buttonClassName={clsx(
                    'btn btn-ghost h-6 min-h-6 w-6 p-0',
                    'bg-transparent! hover:bg-transparent!',
                  )}
                  toggleButton={<MdTune role='none' className='text-base-content/50 h-4 w-4' />}
                >
                  <LibrarySearchOptionsMenu
                    config={searchConfig}
                    onConfigChange={onSearchConfigChange}
                  />
                </Dropdown>
              )}
              <button
                type='button'
                aria-pressed={searchTarget === 'text'}
                aria-label={_('Search Scope')}
                title={searchTarget === 'text' ? _('Full Text Search') : _('Title')}
                className={clsx(
                  'text-base-content/55 hover:text-base-content',
                  'not-eink:transition-colors flex h-6 items-center gap-0.5 rounded-full px-1',
                  'text-caption leading-4 font-normal whitespace-nowrap',
                )}
                onClick={() => onSearchTargetChange(searchTarget === 'text' ? 'books' : 'text')}
              >
                {searchTarget === 'text' ? _('Full Text Search') : _('Title')}
                <FaChevronDown role='none' className='h-2.5 w-2.5' />
              </button>
            </div>
          </div>
          {searchTarget !== 'text' && (
            <div className='flex shrink-0 items-center gap-1'>
              <Dropdown
                label={_('Import Books')}
                className={clsx(
                  'exclude-title-bar-mousedown dropdown-bottom dropdown-center cursor-pointer',
                )}
                buttonClassName='p-0 h-6 min-h-6 w-6 flex touch-target items-center justify-center bg-transparent!'
                toggleButton={<PiPlus role='none' className='m-0.5 h-5 w-5' />}
              >
                <ImportMenu
                  onImportBooksFromFiles={onImportBooksFromFiles}
                  onImportBooksFromDirectory={onImportBooksFromDirectory}
                  onImportFromLocalLibrary={onImportFromLocalLibrary}
                  onImportFromWebBrowser={onImportFromWebBrowser}
                  onImportBookFromNovelUrl={onImportBookFromNovelUrl}
                  onOpenCatalogManager={onOpenCatalogManager}
                  onOpenFeeds={onOpenFeeds}
                />
              </Dropdown>
              {isMobile ? null : (
                <button
                  onClick={onToggleSelectMode}
                  aria-label={_('Select Books')}
                  title={_('Select Books')}
                  className='h-6'
                >
                  {isSelectMode ? (
                    <PiSelectionAllFill role='button' className='text-base-content/60 h-6 w-6' />
                  ) : (
                    <PiSelectionAll role='button' className='text-base-content/60 h-6 w-6' />
                  )}
                </button>
              )}
            </div>
          )}
        </div>
        {isSelectMode ? (
          <div
            className={clsx(
              'flex h-full items-center',
              'w-max-[72px] w-min-[72px] sm:w-max-[80px] sm:w-min-[80px]',
            )}
          >
            <button
              onClick={isSelectAll ? onDeselectAll : onSelectAll}
              className='btn btn-ghost text-base-content/85 h-8 min-h-8 w-[72px] p-0 sm:w-[80px]'
              aria-label={isSelectAll ? _('Deselect') : _('Select All')}
            >
              <span className='font-sans text-base font-normal sm:text-sm whitespace-nowrap truncate'>
                {isSelectAll ? _('Deselect') : _('Select All')}
              </span>
            </button>
          </div>
        ) : (
          <div className='flex h-full items-center gap-x-2 sm:gap-x-4'>
            {onSuggestTitles && (
              <button
                type='button'
                title={_('建议书名')}
                aria-label={_('建议书名')}
                className='btn btn-ghost h-8 min-h-8 w-8 p-0'
                disabled={currentBooksCount === 0}
                onClick={onSuggestTitles}
              >
                <TbWand role='none' size={iconSize18} />
              </button>
            )}
            {onScanImportable && (
              <button
                type='button'
                title={_('扫描添加')}
                aria-label={_('扫描添加')}
                className='btn btn-ghost h-8 min-h-8 w-8 p-0'
                onClick={onScanImportable}
              >
                <TbRadar2 role='none' size={iconSize18} />
              </button>
            )}
            {onToggleTagBrowser && (
              <button
                type='button'
                title='标签'
                aria-label='标签'
                aria-pressed={isTagBrowserOpen}
                className='btn btn-ghost h-8 min-h-8 w-8 p-0'
                onClick={onToggleTagBrowser}
              >
                <FaTags role='none' size={iconSize18} />
              </button>
            )}
            <Dropdown
              label={_('View Menu')}
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<PiDotsThreeCircle role='none' size={iconSize18} />}
            >
              <ViewMenu />
            </Dropdown>
            <Dropdown
              label={_('Settings Menu')}
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<MdOutlineMenu role='none' size={iconSize18} />}
            >
              <SettingsMenu onPullLibrary={onPullLibrary} />
            </Dropdown>
            {appService?.hasWindowBar && (
              <WindowButtons
                headerRef={headerRef}
                showMinimize={windowButtonVisible}
                showMaximize={windowButtonVisible}
                showClose={windowButtonVisible}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LibraryHeader;
