'use client';

/**
 * Design preview surface — not shipped UI, only reachable at /dev/preview.
 *
 * The real library and reader mount platform services that a browser tab does
 * not have, so reviewing their look in a browser meant either the whole app or
 * nothing. This route mounts the components with fixtures instead, which is
 * what a screenshot round needs: same tokens, same components, no services.
 */

import { useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';

import LibraryHome from '@/app/library/components/LibraryHome';
import MangaControlCluster from '@/app/reader/components/manga/MangaControlCluster';
import ReaderChrome from '@/app/reader/components/ReaderChrome';
import MarginRail from '@/app/reader/components/marginalia/MarginRail';
import type { Book } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { DEFAULT_SYSTEM_SETTINGS, DEFAULT_VIEW_CONFIG } from '@/services/constants';
import { add as addMarginNote } from '@/services/marginalia/store';

// Seed the stores the chrome reads during render; a browser tab has no
// settings service, and an unseeded store crashes the mounted panels before
// any effect could run.
if (typeof window !== 'undefined') {
  useSettingsStore.setState({ settings: DEFAULT_SYSTEM_SETTINGS } as never);
  useReaderStore.setState({
    viewStates: {},
    getView: () => null,
    getViewSettings: () => ({ ...DEFAULT_VIEW_CONFIG }),
  } as never);

  // Margin rail fixtures: the rail renders nothing for anchors it cannot
  // measure, so the preview needs both the notes and their offsets.
  const previewNotes = [
    ['n1', 'epubcfi(/6/4!/4/2/2)', 'translation', '这注定是一个漫长的夜晚。', 150],
    ['n2', 'epubcfi(/6/4!/4/2/6)', 'dictionary', '约定：约定；盟约；契约。此处指两人之间的承诺。', 330],
    ['n3', 'epubcfi(/6/4!/4/2/12)', 'note', '这里和第三章的伏笔对上了。', 620],
  ] as const;
  for (const [id, anchorCfi, kind, text] of previewNotes) {
    addMarginNote('preview', { id, anchorCfi, kind, text, at: Date.now() } as never);
  }
}

const mkBook = (i: number, title: string, author: string, page: number): Book =>
  ({
    hash: `fixture-${i}`,
    format: 'EPUB',
    title,
    author,
    coverHash: null,
    progress: [page, 320],
    pageCount: 320,
    primaryLanguage: 'zh',
    createdAt: Date.now() - i * 86400000,
    updatedAt: Date.now() - i * 3600000,
    metadata: { title, language: 'zh' },
  }) as unknown as Book;

const BOOKS: Book[] = [
  mkBook(0, '傲慢与偏见', '简·奥斯汀', 214),
  mkBook(1, '共堕2 被夺走未婚妻后我也被雌堕的故事', '绵谷', 96),
  mkBook(2, '男性失格 堕落为女装雌性职员的幸福末路', '绵谷', 439),
  mkBook(3, '我的容身处', '绵谷', 17),
  mkBook(4, '雌堕新娘 他堕为她的缘由', '绵谷', 442),
  mkBook(5, '爱丽丝梦游仙境', '刘易斯·卡罗尔', 12),
  mkBook(6, '白鲸', '赫尔曼·梅尔维尔', 88),
  mkBook(7, '女装雌堕的风纪委员', '绵谷', 441),
];

const NOTES = [
  {
    id: 'n1',
    anchorCfi: 'epubcfi(/6/4!/4/2/2)',
    kind: 'translation' as const,
    text: '这注定是一个漫长的夜晚。',
    at: Date.now(),
  },
  {
    id: 'n2',
    anchorCfi: 'epubcfi(/6/4!/4/2/6)',
    kind: 'dictionary' as const,
    text: '约定：约定；盟约；契约。此处指两人之间的承诺。',
    at: Date.now(),
  },
  {
    id: 'n3',
    anchorCfi: 'epubcfi(/6/4!/4/2/12)',
    kind: 'note' as const,
    text: '这里和第三章的伏笔对上了。',
    at: Date.now(),
  },
];



function Preview() {
  const params = useSearchParams();
  const view = params?.get('v') ?? 'home';
  const state = params?.get('state') ?? 'idle';
  const wake = params?.get('wake') === '1';

  React.useEffect(() => {
    if (!wake) return;
    const idle = window.setTimeout(() => {
      // Headless screenshots cannot hover, so the preview nudges the two
      // hover-only surfaces the way a pointer would.
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: innerWidth - 40, clientY: innerHeight - 40 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: innerWidth - 30, clientY: innerHeight - 30 }));
      window.dispatchEvent(new PointerEvent('pointerdown', { clientX: innerWidth - 30, clientY: innerHeight - 30 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 6 }));
    }, 600);
    return () => clearTimeout(idle);
  }, [wake]);
  const [pageImg, setPageImg] = React.useState<HTMLImageElement | null>(null);


  if (view === 'chrome') {
    return (
      <div className='relative h-screen bg-[var(--color-study-canvas)]'>
        <div className='mx-auto max-w-[720px] px-[72px] pt-[96px] text-[17px] leading-[29px] text-[var(--color-study-ink)]'>
          {Array.from({ length: 6 }).map((_, i) => (
            <p key={i} className='mb-6'>
              她合上书，窗外的雨还没有停。这样的夜晚总让人想起很多年前的那个约定，
              想起那些没有说完的话，以及始终没能寄出的信。
            </p>
          ))}
        </div>
        <ReaderChrome
          bookKey='preview'
          bookTitle='傲慢与偏见'
          page={214}
          fraction={0.42}
          gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
          onCloseBook={() => {}}
          onGoToLibrary={() => {}}
        />
      </div>
    );
  }

  if (view === 'manga') {
    return (
      <div className='relative h-screen bg-[var(--color-study-canvas)] p-6'>
        <div className='mx-auto flex h-full max-w-[980px] items-center justify-center'>
          <div className='relative h-full w-full bg-[#f2eee6]'>
            <img
              ref={setPageImg}
              alt=''
              src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900"><rect width="640" height="900" fill="%23f2eee6"/><rect x="24" y="24" width="592" height="852" fill="none" stroke="%23333" stroke-width="2"/></svg>'
              className='absolute inset-0 h-full w-full object-contain'
            />
            <MangaControlCluster
              available
              loading={state === 'loading'}
              mode={state === 'danmaku' ? 'danmaku' : state === 'off' ? 'off' : 'bubble'}
              danmakuDisabledReason={null}
              bubbles={[
                { box: [0.2, 0.2, 0.4, 0.3], src: 'Did you see that?', dst: '你看见了吗？', vertical: false },
                { box: [0.55, 0.5, 0.8, 0.62], src: 'It was huge!', dst: '那东西好大！', vertical: false },
              ]}
              onTranslate={() => {}}
              onSelectMode={() => {}}
              onFitPage={() => {}}
              onRetranslate={() => {}}
              onClose={() => {}}
              pageImage={pageImg}
            />
          </div>
        </div>
      </div>
    );
  }

  if (view === 'margin') {
    const anchorOffsets: Record<string, number> = {
      'epubcfi(/6/4!/4/2/2)': 150,
      'epubcfi(/6/4!/4/2/6)': 330,
      'epubcfi(/6/4!/4/2/12)': 620,
    };
    return (
      <div className='relative h-screen bg-[var(--color-study-canvas)]'>
        <div
          data-margin-rail-host
          className='relative mx-auto flex max-w-[1100px] gap-0'
        >
          <div className='w-[720px] px-[72px] pt-[96px] text-[17px] leading-[29px] text-[var(--color-study-ink)]'>
            {Array.from({ length: 8 }).map((_, i) => (
              <p key={i} className='mb-6'>
                第 {i + 1} 段。她合上书，窗外的雨还没有停。这样的夜晚总让人想起很多年前的
                那个约定，想起那些没有说完的话，以及始终没能寄出的信。
              </p>
            ))}
          </div>
          <MarginRail
            bookKey='preview'
            measureAnchor={(cfi) => anchorOffsets[cfi] ?? null}
            measurePage={() => ({ left: 0, top: 0, width: 720, height: 900, right: 720, bottom: 900 })}
          />
        </div>
      </div>
    );
  }

  if (view === 'sidebar') {
    const chapters = [
      ['第一章 初遇', 1],
      ['第二章 雨夜', 24],
      ['第三章 那封没有寄出的信', 42],
      ['第四章 归途', 78],
      ['第五章 重逢', 116],
    ] as const;
    return (
      <div className='flex h-screen bg-[var(--color-study-canvas)]'>
        <aside className='flex w-[320px] flex-col border-e border-study-ink/10'>
          <div className='flex h-11 items-center px-6 text-section font-medium text-study-ink'>目录</div>
          <ul className='mt-4'>
            {chapters.map(([label, page], i) => (
              <li key={label} className='relative flex h-11 items-baseline gap-2 px-6'>
                {i === 2 && (
                  <span
                    aria-hidden
                    className='absolute inset-y-0 start-0 w-[2px]'
                    style={{ background: '#305F4B' }}
                  />
                )}
                <span className={`min-w-0 truncate text-body ${i === 2 ? 'text-study-ink' : 'text-study-ink/75'}`}>
                  {label}
                </span>
                <span
                  aria-hidden
                  className='mb-1 min-w-4 flex-1 self-center text-study-ink'
                  style={{
                    height: '1px',
                    backgroundImage:
                      'radial-gradient(circle, color-mix(in srgb, currentColor 40%, transparent) 1px, transparent 1px)',
                    backgroundSize: '6px 1px',
                    backgroundRepeat: 'repeat-x',
                  }}
                />
                <span className='shrink-0 text-meta tabular-nums text-study-ink/55'>{page}</span>
              </li>
            ))}
          </ul>
        </aside>
        <div className='flex-1 px-[72px] pt-[96px] text-[17px] leading-[29px] text-study-ink'>
          她合上书，窗外的雨还没有停。这样的夜晚总让人想起很多年前的那个约定。
        </div>
      </div>
    );
  }

  if (view === 'empty') {
    return (
      <div className='min-h-screen bg-[var(--color-study-canvas)]'>
        <LibraryHome
          books={[]}
          onOpenBook={() => {}}
          onShowAll={() => {}}
          onSearch={() => {}}
          onImport={() => {}}
        />
      </div>
    );
  }

  return (
    <div
      className='min-h-screen bg-[var(--color-study-canvas)]'
      style={
        view === 'dark'
          ? ({
              '--color-study-canvas': '#141210',
              '--color-study-page': '#1B1815',
              '--color-study-ink': '#E9E2D5',
              '--color-study-chip': '#2A2620',
            } as React.CSSProperties)
          : undefined
      }
    >
      <LibraryHome
        books={BOOKS}
        onOpenBook={() => {}}
        onShowAll={() => {}}
        onSearch={() => {}}
        onImport={() => {}}
      />
      <ul className='sr-only'>
        {NOTES.map((n) => (
          <li key={n.id}>{n.text}</li>
        ))}
      </ul>
    </div>
  );
}

const ErrorProbe = () => {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const onErr = (e: ErrorEvent) => setMsg(`${e.message} @ ${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) => setMsg(String(e.reason?.stack ?? e.reason));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);
  return msg ? (
    <pre data-preview-error style={{ position: 'fixed', inset: 'auto 0 0 0', margin: 0, padding: 16, font: '12px ui-monospace', background: '#b3261e', color: '#fff', whiteSpace: 'pre-wrap', zIndex: 9999 }}>
      {msg}
    </pre>
  ) : null;
};

export default function PreviewPage() {
  return (
    <>
      <Suspense fallback={<div style={{ padding: 24 }}>loading preview…</div>}>
        <Preview />
      </Suspense>
      <ErrorProbe />
    </>
  );
}
