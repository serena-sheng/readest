import '../setupMemoryStorage';

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FoliateView } from '@/types/view';
import type { MangaPageResult } from '@/services/manga/types';
import MangaOverlay, {
  MANGA_GUTTER_CLASS,
  MANGA_LAYER_CLASS,
} from '@/app/reader/components/manga/MangaOverlay';
import { useMangaTranslation } from '@/app/reader/hooks/useMangaTranslation';

const { getMangaEndpointMock, translateMock, getGlossaryMock } = vi.hoisted(() => ({
  getMangaEndpointMock: vi.fn(),
  translateMock: vi.fn(),
  getGlossaryMock: vi.fn(() => ({})),
}));

vi.mock('@/services/translators/endpoints', () => ({
  getMangaEndpoint: getMangaEndpointMock,
}));
vi.mock('@/services/manga/translateMangaPage', () => ({
  translateMangaPage: translateMock,
}));
vi.mock('@/services/translators/glossary', () => ({
  getGlossary: getGlossaryMock,
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    key.replace('{{count}}', String(options?.['count'] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

const endpoint = { baseUrl: 'https://vision.example.com/v1', model: 'vision-1' };
const page: MangaPageResult = {
  width: 800,
  height: 1200,
  bubbles: [{ box: [100, 200, 400, 500], src: '原文', dst: '译文', vertical: false }],
};

const rect = (width: number, height: number): DOMRect => ({
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  width,
  height,
  right: width,
  bottom: height,
  toJSON: () => ({}),
});

let container: HTMLDivElement;
let view: FoliateView;

const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
  ok: true,
  status: 200,
  blob: async () => ({
    type: 'image/jpeg',
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }),
}));
// The stub catches every request, including the i18n bundle the app's stores
// load in the background; only the page image reads belong to this suite.
const pageFetches = () =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith('https://example.com/manga/'),
  );

// `.ts` file, so the tree is built with createElement instead of JSX.
const Harness = ({ bookKey, pageView }: { bookKey: string; pageView: FoliateView }) => {
  const { imageEl, result, mode, cycleMode } = useMangaTranslation(bookKey, pageView);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('button', { onClick: () => void cycleMode() }, 'cycle'),
    React.createElement('span', { id: 'mode' }, mode),
    React.createElement('span', { id: 'bubbles' }, result ? String(result.bubbles.length) : 'none'),
    imageEl && result && mode !== 'off'
      ? React.createElement(MangaOverlay, { imageEl, result, mode })
      : null,
  );
};

const modeText = () => document.querySelector('#mode')?.textContent ?? '';

beforeEach(() => {
  getMangaEndpointMock.mockReset().mockReturnValue(endpoint);
  translateMock.mockReset().mockResolvedValue(page);
  getGlossaryMock.mockReset().mockReturnValue({});
  fetchMock.mockClear();

  container = document.createElement('div');
  document.body.appendChild(container);
  container.getBoundingClientRect = () => rect(800, 1200);

  const image = document.createElement('img');
  image.src = 'https://example.com/manga/page-01.jpg';
  Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 1200, configurable: true });
  image.getBoundingClientRect = () => rect(800, 1200);
  container.appendChild(image);

  view = {
    renderer: { getContents: () => [{ doc: document, index: 0 }] },
  } as unknown as FoliateView;

  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  container.remove();
  vi.unstubAllGlobals();
});

describe('useMangaTranslation mode cycle', () => {
  it('translates once on the first cycle and shows bubble mode', async () => {
    render(React.createElement(Harness, { bookKey: 'book-1', pageView: view }));

    fireEvent.click(screen.getByRole('button', { name: 'cycle' }));

    await waitFor(() => expect(modeText()).toBe('bubble'));
    expect(document.querySelector(`.${MANGA_LAYER_CLASS}`)).not.toBeNull();
    expect(pageFetches()).toHaveLength(1);
    expect(translateMock).toHaveBeenCalledTimes(1);
  });

  it('switches to danmaku without requesting the page again', async () => {
    render(React.createElement(Harness, { bookKey: 'book-1', pageView: view }));
    const button = screen.getByRole('button', { name: 'cycle' });

    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('bubble'));

    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('danmaku'));
    await waitFor(() =>
      expect(document.querySelectorAll(`.${MANGA_GUTTER_CLASS}`)).toHaveLength(2),
    );

    expect(pageFetches()).toHaveLength(1);
    expect(translateMock).toHaveBeenCalledTimes(1);
  });

  it('turns off without dropping the result or the request count', async () => {
    render(React.createElement(Harness, { bookKey: 'book-1', pageView: view }));
    const button = screen.getByRole('button', { name: 'cycle' });

    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('bubble'));
    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('danmaku'));

    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('off'));
    expect(document.querySelector(`.${MANGA_LAYER_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${MANGA_GUTTER_CLASS}`)).toBeNull();
    // The page result stays in memory for the next cycle.
    expect(document.querySelector('#bubbles')?.textContent).toBe('1');
    expect(pageFetches()).toHaveLength(1);
    expect(translateMock).toHaveBeenCalledTimes(1);
  });

  it('re-shows bubble mode from off without a second request', async () => {
    render(React.createElement(Harness, { bookKey: 'book-1', pageView: view }));
    const button = screen.getByRole('button', { name: 'cycle' });

    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('bubble'));
    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('danmaku'));
    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('off'));

    fireEvent.click(button);
    await waitFor(() => expect(modeText()).toBe('bubble'));
    expect(document.querySelector(`.${MANGA_LAYER_CLASS}`)).not.toBeNull();
    expect(pageFetches()).toHaveLength(1);
    expect(translateMock).toHaveBeenCalledTimes(1);
  });
});
