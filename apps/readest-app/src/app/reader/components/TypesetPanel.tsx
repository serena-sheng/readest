'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MdClose } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { saveViewSettings } from '@/helpers/settings';
import { getMaxInlineSize } from '@/utils/config';
import { getStyles } from '@/utils/style';
import { getBookDirFromWritingMode } from '@/utils/book';
import { getOSPlatform } from '@/utils/misc';
import {
  CJK_SANS_SERIF_FONTS,
  CJK_SERIF_FONTS,
  IOS_FONTS,
  LINUX_FONTS,
  MACOS_FONTS,
  SANS_SERIF_FONTS,
  SERIF_FONTS,
  WINDOWS_FONTS,
} from '@/services/constants';
import { themes } from '@/styles/themes';
import type { ThemeMode } from '@/styles/themes';
import { eventDispatcher } from '@/utils/event';
import type { WritingMode } from '@/types/book';

interface TypesetPanelProps {
  /** The book whose view settings every control writes. */
  bookKey: string;
  /** Book title, shown as the drawer subtitle. */
  title: string;
  open: boolean;
  onClose: () => void;
}

type TabId = 'appearance' | 'font' | 'layout' | 'preset';

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'font', label: '字体' },
  { id: 'layout', label: '排版' },
  { id: 'preset', label: '主题包' },
];

const FONT_SIZE_LIMITS = { MIN: 8, MAX: 30 } as const;
const LINE_HEIGHT_LIMITS = { MIN: 1, MAX: 3 } as const;
// The footer bar derives its single margin control from the same ranges, so a
// value picked here lands on the same page geometry as a drag there.
const MAX_MARGIN_PX = 88;
const MAX_GAP_PERCENT = 10;

const marginValueToPx = (value: number) => Math.round((value / 100) * MAX_MARGIN_PX);
const marginPxToValue = (marginPx?: number) =>
  Math.max(0, Math.min(100, Math.round(((marginPx ?? 44) / MAX_MARGIN_PX) * 100)));

type ThemePackage = {
  id: string;
  label: string;
  description: string;
  themeColor: string;
  themeMode: 'light' | 'dark';
  fontSize: number;
  lineHeight: number;
  /** Slider position (0–100), converted to px through `marginValueToPx`. */
  margin: number;
};

const THEME_PACKAGES: ThemePackage[] = [
  {
    id: 'warm-paper',
    label: '暖纸',
    description: '米色暖调，行距舒展，适合日光与纸质书对照',
    themeColor: 'sunset',
    themeMode: 'light',
    fontSize: 18,
    lineHeight: 1.9,
    margin: 64,
  },
  {
    id: 'cool-gray',
    label: '冷灰',
    description: '中性灰白，默认字号与行距，长文不易累',
    themeColor: 'nord',
    themeMode: 'light',
    fontSize: 16,
    lineHeight: 1.6,
    margin: 50,
  },
  {
    id: 'night',
    label: '夜读',
    description: '深色低亮，暖字降低夜间对比度',
    themeColor: 'nord',
    themeMode: 'dark',
    fontSize: 16,
    lineHeight: 1.8,
    margin: 44,
  },
];

interface RangeRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

const RangeRow: React.FC<RangeRowProps> = ({ label, value, min, max, step, display, onChange }) => (
  <label className='block'>
    <span className='flex items-baseline justify-between gap-2'>
      <span className='text-sm font-medium'>{label}</span>
      <span className='text-base-content/60 text-xs tabular-nums'>{display}</span>
    </span>
    <input
      type='range'
      className='range range-sm mt-1 w-full'
      style={{ accentColor: 'var(--color-primary)' }}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

const Segmented: React.FC<{
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}> = ({ label, options, selected, onSelect }) => (
  <div role='radiogroup' aria-label={label} className='bg-base-200 flex rounded-field p-0.5'>
    {options.map((option) => {
      const active = option.value === selected;
      return (
        <button
          key={option.value}
          type='button'
          role='radio'
          aria-checked={active}
          aria-label={option.label}
          className={clsx(
            'flex-1 rounded-[calc(var(--radius-field)-2px)] px-2 py-1.5 text-xs font-medium transition-colors',
            active ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/60',
          )}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

/**
 * The typesetting drawer: appearance, font, page layout and ready-made theme
 * packages in one 360px panel. Every control writes straight through the same
 * APIs the settings dialog uses — `useThemeStore` for the app palette and
 * `saveViewSettings` for the per-book view settings — so there is no "apply"
 * step and the next page re-renders before the drawer is closed.
 */
const TypesetPanel: React.FC<TypesetPanelProps> = ({ bookKey, title, open, onClose }) => {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getView, getViewSettings, recreateViewer } = useReaderStore();
  const themeColor = useThemeStore((state) => state.themeColor);
  const themeMode = useThemeStore((state) => state.themeMode);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const setThemeColor = useThemeStore((state) => state.setThemeColor);
  const setThemeMode = useThemeStore((state) => state.setThemeMode);

  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [activeTab, setActiveTab] = useState<TabId>('appearance');
  const [fontSize, setFontSize] = useState(viewSettings.defaultFontSize);
  const [lineHeight, setLineHeight] = useState(viewSettings.lineHeight);
  const [margin, setMargin] = useState(() => marginPxToValue(viewSettings.marginTopPx));
  const [fontCategory, setFontCategory] = useState<'Serif' | 'Sans-serif'>(
    viewSettings.defaultFont === 'Sans-serif' ? 'Sans-serif' : 'Serif',
  );
  const [fontFamily, setFontFamily] = useState(
    viewSettings.defaultFont === 'Sans-serif' ? viewSettings.sansSerifFont : viewSettings.serifFont,
  );
  const [columns, setColumns] = useState<1 | 2>(viewSettings.maxColumnCount > 1 ? 2 : 1);
  const [writingMode, setWritingMode] = useState<'horizontal-tb' | 'vertical-rl'>(
    viewSettings.writingMode === 'vertical-rl' ? 'vertical-rl' : 'horizontal-tb',
  );

  const systemFonts = useMemo(() => {
    switch (getOSPlatform()) {
      case 'macos':
        return MACOS_FONTS;
      case 'windows':
        return WINDOWS_FONTS;
      case 'linux':
        return LINUX_FONTS;
      case 'ios':
        return IOS_FONTS;
      default:
        return [];
    }
  }, []);

  const fontOptions = useMemo(() => {
    const base =
      fontCategory === 'Serif'
        ? [viewSettings.serifFont, ...SERIF_FONTS, ...CJK_SERIF_FONTS]
        : [viewSettings.sansSerifFont, ...SANS_SERIF_FONTS, ...CJK_SANS_SERIF_FONTS];
    return Array.from(new Set([...base, ...systemFonts]));
  }, [fontCategory, systemFonts, viewSettings.sansSerifFont, viewSettings.serifFont]);

  // Re-read the writer whenever the drawer is reopened: settings may have been
  // changed from the footer bar or the settings dialog while it was closed.
  useEffect(() => {
    if (!open) return;
    const latest = getViewSettings(bookKey) || settings.globalViewSettings;
    setFontSize(latest.defaultFontSize);
    setLineHeight(latest.lineHeight);
    setMargin(marginPxToValue(latest.marginTopPx));
    setFontCategory(latest.defaultFont === 'Sans-serif' ? 'Sans-serif' : 'Serif');
    setFontFamily(latest.defaultFont === 'Sans-serif' ? latest.sansSerifFont : latest.serifFont);
    setColumns(latest.maxColumnCount > 1 ? 2 : 1);
    setWritingMode(latest.writingMode === 'vertical-rl' ? 'vertical-rl' : 'horizontal-tb');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookKey]);

  // All four right-hand drawers share one fixed slot. These are the two
  // channels the ask, ideas and translation-expert panels already announce on,
  // so this panel never has to know which specific sibling opened.
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

  const applyFontSize = (value: number) => {
    setFontSize(value);
    void saveViewSettings(envConfig, bookKey, 'defaultFontSize', value);
  };

  const applyLineHeight = (value: number) => {
    const next = Math.round(value * 10) / 10;
    setLineHeight(next);
    void saveViewSettings(envConfig, bookKey, 'lineHeight', next);
  };

  const applyMargin = useCallback(
    (value: number) => {
      setMargin(value);
      const marginTopPx = marginValueToPx(value);
      const gutterPx = Math.round(marginTopPx / 2);
      const gapPercent = Math.round((value / 100) * MAX_GAP_PERCENT);
      void saveViewSettings(envConfig, bookKey, 'marginTopPx', marginTopPx, false, false);
      void saveViewSettings(envConfig, bookKey, 'marginBottomPx', gutterPx, false, false);
      void saveViewSettings(envConfig, bookKey, 'marginLeftPx', gutterPx, false, false);
      void saveViewSettings(envConfig, bookKey, 'marginRightPx', gutterPx, false, false);
      void saveViewSettings(envConfig, bookKey, 'gapPercent', gapPercent, false, false);
      const view = getView(bookKey);
      view?.renderer.setAttribute('margin', `${marginTopPx}px`);
      view?.renderer.setAttribute('gap', `${gapPercent}%`);
    },
    [envConfig, bookKey, getView],
  );

  const applyFontCategory = (category: 'Serif' | 'Sans-serif') => {
    setFontCategory(category);
    setFontFamily(category === 'Serif' ? viewSettings.serifFont : viewSettings.sansSerifFont);
    void saveViewSettings(envConfig, bookKey, 'defaultFont', category);
  };

  const applyFontFamily = (font: string) => {
    setFontFamily(font);
    void saveViewSettings(
      envConfig,
      bookKey,
      fontCategory === 'Serif' ? 'serifFont' : 'sansSerifFont',
      font,
    );
  };

  const applyColumns = (count: 1 | 2) => {
    setColumns(count);
    void saveViewSettings(envConfig, bookKey, 'maxColumnCount', count, false, false).then(() => {
      const latest = getViewSettings(bookKey);
      const view = getView(bookKey);
      if (!latest || !view) return;
      view.renderer.setAttribute('max-column-count', count);
      view.renderer.setAttribute('max-inline-size', `${getMaxInlineSize(latest)}px`);
    });
  };

  const applyWritingMode = (mode: WritingMode) => {
    const next = mode === 'vertical-rl' ? 'vertical-rl' : 'horizontal-tb';
    if (next === writingMode) return;
    const previous = writingMode;
    setWritingMode(next);
    const latest = getViewSettings(bookKey);
    if (latest) latest.vertical = next === 'vertical-rl';
    // Writing direction is book-local by design (LayoutPanel passes
    // `skipGlobal = true`); switching axis needs a fresh renderer.
    void saveViewSettings(envConfig, bookKey, 'writingMode', next, true).then(() => {
      const view = getView(bookKey);
      const updated = getViewSettings(bookKey);
      if (view && updated) {
        view.renderer.setStyles?.(getStyles(updated));
        view.book.dir = getBookDirFromWritingMode(next);
      }
      if (previous !== next) recreateViewer(envConfig, bookKey);
    });
  };

  const applyThemePackage = (preset: ThemePackage) => {
    setThemeColor(preset.themeColor);
    setThemeMode(preset.themeMode);
    applyFontSize(preset.fontSize);
    applyLineHeight(preset.lineHeight);
    applyMargin(preset.margin);
  };

  const modeOptions: { mode: Exclude<ThemeMode, 'ambient'>; label: string }[] = [
    { mode: 'auto', label: '跟随系统' },
    { mode: 'light', label: '浅' },
    { mode: 'dark', label: '深' },
  ];

  return (
    <div
      role='dialog'
      aria-label='排版'
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
          <h2 className='font-serif text-base font-semibold'>排版</h2>
          <p className='mt-1 truncate text-xs opacity-60'>{title}</p>
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

      <div
        role='tablist'
        aria-label='排版设置'
        className='bg-base-200 mx-4 mt-3 flex rounded-field p-0.5'
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type='button'
              role='tab'
              aria-selected={active}
              className={clsx(
                'flex-1 rounded-[calc(var(--radius-field)-2px)] px-2 py-1.5 text-xs font-medium transition-colors',
                active ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/60',
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role='tabpanel'
        aria-label={TABS.find((tab) => tab.id === activeTab)?.label}
        className='min-h-0 flex-1 overflow-y-auto px-4 py-4'
      >
        <div className='space-y-6'>
          {activeTab === 'appearance' && (
            <>
              <section>
                <h3 className='text-sm font-medium'>主题色</h3>
                <div role='radiogroup' aria-label='主题色' className='mt-2 grid grid-cols-4 gap-2'>
                  {themes.map((theme) => {
                    const palette = theme.colors[isDarkMode ? 'dark' : 'light'];
                    const active = theme.name === themeColor;
                    return (
                      <button
                        key={theme.name}
                        type='button'
                        role='radio'
                        aria-checked={active}
                        aria-label={theme.label}
                        title={theme.label}
                        onClick={() => setThemeColor(theme.name)}
                        className={clsx(
                          'flex min-w-0 flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors',
                          active
                            ? 'border-primary'
                            : 'border-base-content/10 hover:border-base-content/30',
                        )}
                        style={{
                          backgroundColor: palette['base-100'],
                          color: palette['base-content'],
                        }}
                      >
                        <span
                          aria-hidden='true'
                          className='h-5 w-5 rounded-full border border-black/10'
                          style={{ backgroundColor: palette.primary }}
                        />
                        <span className='w-full truncate text-[10px] font-medium'>
                          {theme.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className='mb-2 text-sm font-medium'>深浅</h3>
                <Segmented
                  label='深浅'
                  selected={themeMode}
                  options={modeOptions.map(({ mode, label }) => ({ value: mode, label }))}
                  onSelect={(value) => setThemeMode(value as Exclude<ThemeMode, 'ambient'>)}
                />
              </section>
            </>
          )}

          {activeTab === 'font' && (
            <>
              <section className='space-y-2'>
                <h3 className='text-sm font-medium'>字体族</h3>
                <Segmented
                  label='字族'
                  selected={fontCategory}
                  options={[
                    { value: 'Serif', label: '衬线' },
                    { value: 'Sans-serif', label: '无衬线' },
                  ]}
                  onSelect={(value) => applyFontCategory(value as 'Serif' | 'Sans-serif')}
                />
                <label className='mt-2 block'>
                  <span className='mb-1 block text-xs opacity-60'>字体</span>
                  <select
                    className='select select-sm bg-base-100 text-base-content w-full'
                    aria-label='字体名称'
                    value={fontFamily}
                    onChange={(event) => applyFontFamily(event.target.value)}
                  >
                    {fontOptions.map((font) => (
                      <option key={font} value={font}>
                        {font}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <RangeRow
                label='字号'
                value={fontSize}
                min={FONT_SIZE_LIMITS.MIN}
                max={FONT_SIZE_LIMITS.MAX}
                step={1}
                display={`${fontSize}px`}
                onChange={applyFontSize}
              />

              <RangeRow
                label='行距'
                value={lineHeight}
                min={LINE_HEIGHT_LIMITS.MIN}
                max={LINE_HEIGHT_LIMITS.MAX}
                step={0.1}
                display={lineHeight.toFixed(1)}
                onChange={applyLineHeight}
              />
            </>
          )}

          {activeTab === 'layout' && (
            <>
              <RangeRow
                label='页边距'
                value={margin}
                min={0}
                max={100}
                step={1}
                display={`${margin}%`}
                onChange={applyMargin}
              />

              <section>
                <h3 className='mb-2 text-sm font-medium'>分栏</h3>
                <Segmented
                  label='分栏'
                  selected={String(columns)}
                  options={[
                    { value: '1', label: '单栏' },
                    { value: '2', label: '双栏' },
                  ]}
                  onSelect={(value) => applyColumns(value === '2' ? 2 : 1)}
                />
              </section>

              <section>
                <h3 className='mb-2 text-sm font-medium'>书写方向</h3>
                <Segmented
                  label='书写方向'
                  selected={writingMode}
                  options={[
                    { value: 'horizontal-tb', label: '横排' },
                    { value: 'vertical-rl', label: '竖排' },
                  ]}
                  onSelect={(value) => applyWritingMode(value as WritingMode)}
                />
                <p className='mt-2 text-xs leading-relaxed opacity-60'>
                  切换横排 / 竖排会重新载入当前书籍。
                </p>
              </section>
            </>
          )}

          {activeTab === 'preset' && (
            <section className='space-y-3'>
              <h3 className='text-sm font-medium'>主题包</h3>
              {THEME_PACKAGES.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='bg-base-200/60 hover:bg-base-200 w-full rounded-box border border-base-content/10 p-3 text-start transition-colors'
                  onClick={() => applyThemePackage(preset)}
                >
                  <span className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-semibold'>{preset.label}</span>
                    <span className='text-base-content/50 text-[11px]'>
                      {preset.fontSize}px · {preset.lineHeight.toFixed(1)} 行距
                    </span>
                  </span>
                  <span className='mt-1 block text-xs leading-relaxed opacity-60'>
                    {preset.description}
                  </span>
                </button>
              ))}
              <p className='text-xs leading-relaxed opacity-60'>
                一键同时设置主题色、深浅、字号、行距与页边距，立即生效。
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default TypesetPanel;
