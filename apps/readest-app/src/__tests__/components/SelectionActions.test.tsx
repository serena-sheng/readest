import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import SelectionActions from '@/app/reader/components/annotator/SelectionActions';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import type { TextSelection } from '@/utils/sel';

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(true),
}));

const writeTextMock = vi.mocked(writeTextToClipboard);
const fetchMock = vi.fn();

const buildSelection = (text: string): TextSelection => {
  const first = document.createElement('p');
  first.textContent = 'A first paragraph.';
  const second = document.createElement('p');
  second.textContent = 'The second paragraph holds the selected words.';
  document.body.append(first, second);

  const node = second.firstChild!;
  const range = document.createRange();
  range.setStart(node, 4);
  range.setEnd(node, Math.min(4 + text.length, second.textContent!.length));
  return {
    key: 'book-1',
    text,
    page: 1,
    range,
    index: 0,
  };
};

const renderActions = (overrides: Partial<React.ComponentProps<typeof SelectionActions>> = {}) => {
  const props = {
    selection: buildSelection('second paragraph'),
    bookTitle: '往事与随想',
    href: 'ch1.xhtml',
    onAsk: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  const view = render(<SelectionActions {...props} />);
  return { ...props, ...view };
};

beforeEach(() => {
  vi.clearAllMocks();
  writeTextMock.mockResolvedValue(true);
  fetchMock.mockReset();
  Object.defineProperty(window, 'fetch', {
    value: fetchMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('SelectionActions', () => {
  it('renders the three actions for a real selection and stays hidden below 2 characters', () => {
    const { unmount } = renderActions();

    expect(screen.getByRole('toolbar', { name: '选区操作' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '问 AI' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '记想法' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy();

    unmount();
    renderActions({ selection: buildSelection('a') });

    expect(screen.queryByRole('toolbar', { name: '选区操作' })).toBeNull();
  });

  it('copies the selected text and dismisses', () => {
    const { onDismiss } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(writeTextMock).toHaveBeenCalledWith('second paragraph');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('opens the ask panel with the selected text', () => {
    const { onAsk, onDismiss } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: '问 AI' }));

    expect(onAsk).toHaveBeenCalledWith('second paragraph');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('posts a note with book, quote, note and locator', async () => {
    const toasts: CustomEvent[] = [];
    const onToast = (event: CustomEvent) => {
      toasts.push(event);
    };
    eventDispatcher.on('toast', onToast);
    fetchMock.mockResolvedValue({ ok: true, status: 201 });

    const { onDismiss } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: '记想法' }));
    fireEvent.change(screen.getByLabelText('想法'), {
      target: { value: '这句值得回看' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8790/notes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      book: '往事与随想',
      quote: 'second paragraph',
      note: '这句值得回看',
      locator: 'ch1.xhtml#1',
    });
    await waitFor(() => expect(toasts.some((t) => t.detail.message === '已记下')).toBe(true));
    expect(onDismiss).toHaveBeenCalled();

    eventDispatcher.off('toast', onToast);
  });

  it('keeps the note panel open and reports a failure when the service is down', async () => {
    const toasts: CustomEvent[] = [];
    const onToast = (event: CustomEvent) => {
      toasts.push(event);
    };
    eventDispatcher.on('toast', onToast);
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const { onDismiss } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: '记想法' }));
    fireEvent.change(screen.getByLabelText('想法'), { target: { value: '留个想法' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(toasts.some((t) => t.detail.type === 'error')).toBe(true));
    expect(screen.getByLabelText('想法')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();

    eventDispatcher.off('toast', onToast);
  });

  it('dismisses on Escape', () => {
    const { onDismiss } = renderActions();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
