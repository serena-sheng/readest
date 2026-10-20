import '../setupMemoryStorage';

import React from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FoliateView } from '@/types/view';
import type { MangaPageResult } from '@/services/manga/types';
import MangaOverlay from '@/app/reader/components/manga/MangaOverlay';
import { useMangaTranslation } from '@/app/reader/hooks/useMangaTranslation';
import { eventDispatcher } from '@/utils/event';

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
const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

// This file keeps the `.ts` name the acceptance command expects, so the
// harness is built with createElement instead of JSX.
const Harness = ({ bookKey, pageView }: { bookKey: string; pageView: FoliateView }) => {
  const { imageEl, result, mode, toggle } = useMangaTranslation(bookKey, pageView);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('button', { onClick: () => void toggle() }, 'toggle'),
    imageEl && result && mode !== 'off'
      ? React.createElement(MangaOverlay, { imageEl, result })
      : null,
  );
};

beforeEach(() => {
  getMangaEndpointMock.mockReset().mockReturnValue(endpoint);
  translateMock.mockReset().mockResolvedValue(page);
  getGlossaryMock.mockReset().mockReturnValue({});
  dispatchSpy.mockClear();
  fetchMock.mockClear();

  container = document.createElement('div');
  document.body.appendChild(container);
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

describe('useMangaTranslation', () => {
  it('opens the setup guide instead of a toast when the endpoint is missing', async () => {
    getMangaEndpointMock.mockReturnValue(null);
    const { result } = renderHook(() => useMangaTranslation('book-1', view));

    await waitFor(() => expect(result.current.available).toBe(true));
    await result.current.toggle();

    expect(pageFetches()).toHaveLength(0);
    expect(translateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.needsModelSetup).toBe(true));
    expect(dispatchSpy).not.toHaveBeenCalledWith('toast', expect.anything());
  });

  it('translates once and mounts the overlay', async () => {
    render(React.createElement(Harness, { bookKey: 'book-1', pageView: view }));

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    await waitFor(() =>
      expect(document.querySelector('.manga-translation-layer')).not.toBeNull(),
    );
    expect(pageFetches()).toHaveLength(1);
    expect(translateMock).toHaveBeenCalledTimes(1);
    expect(translateMock).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/jpeg', width: 800, height: 1200 }),
    );
    // A successful page changes the artwork itself; there is no toast.
    expect(dispatchSpy).not.toHaveBeenCalledWith('toast', expect.anything());
  });

  it('removes the overlay on the second toggle', async () => {
    render(React.createElement(Harness, { bookKey: 'book-1', pageView: view }));
    const button = screen.getByRole('button', { name: 'toggle' });

    fireEvent.click(button);
    await waitFor(() =>
      expect(document.querySelector('.manga-translation-layer')).not.toBeNull(),
    );

    fireEvent.click(button);
    await waitFor(() =>
      expect(document.querySelector('.manga-translation-layer')).toBeNull(),
    );
    expect(translateMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the page result instead of requesting the endpoint again', async () => {
    render(React.createElement(Harness, { bookKey: 'book-1', pageView: view }));
    const button = screen.getByRole('button', { name: 'toggle' });

    fireEvent.click(button);
    await waitFor(() =>
      expect(document.querySelector('.manga-translation-layer')).not.toBeNull(),
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(document.querySelector('.manga-translation-layer')).toBeNull(),
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(document.querySelector('.manga-translation-layer')).not.toBeNull(),
    );

    expect(pageFetches()).toHaveLength(1);
    expect(translateMock).toHaveBeenCalledTimes(1);
  });
});
