import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import RenameSuggestionsDialog from '@/app/library/components/RenameSuggestionsDialog';
import { saveBookMetadataEdit } from '@/services/bookMetadataEdit';
import { suggestBookTitles } from '@/services/library/renameSuggestions';
import type { RenameCandidate } from '@/services/library/renameSuggestions';
import type { Book } from '@/types/book';

vi.mock('@/services/library/renameSuggestions', () => ({ suggestBookTitles: vi.fn() }));
vi.mock('@/services/bookMetadataEdit', () => ({ saveBookMetadataEdit: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: vi.fn() }, appService: null }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));

const suggestMock = vi.mocked(suggestBookTitles);
const saveMock = vi.mocked(saveBookMetadataEdit);

const books: Book[] = [
  {
    hash: 'h1',
    format: 'EPUB',
    title: 'Original Title',
    author: 'Author',
    tags: ['read'],
    createdAt: 1,
    updatedAt: 2,
    metadata: { title: 'Original Title', author: 'Author', language: 'ja' },
  },
  {
    hash: 'h2',
    format: 'CBZ',
    title: 'Same Title',
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
  },
];

const candidates: RenameCandidate[] = [
  {
    hash: 'h1',
    currentTitle: 'Original Title',
    suggestedTitle: '建议书名',
    reason: '译名',
  },
  {
    hash: 'h2',
    currentTitle: 'Same Title',
    suggestedTitle: 'Same Title',
    reason: '',
  },
];

const renderDialog = () => {
  const onClose = vi.fn();
  const view = render(
    <RenameSuggestionsDialog books={books} isLoggedIn={false} onClose={onClose} />,
  );
  return { ...view, onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
  suggestMock.mockResolvedValue(candidates);
  saveMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('RenameSuggestionsDialog', () => {
  it('renders the generated suggestions with the original title and reason', async () => {
    renderDialog();

    expect(await screen.findByDisplayValue('建议书名')).toBeTruthy();
    expect(screen.getByText('Original Title')).toBeTruthy();
    expect(screen.getByText('译名')).toBeTruthy();
    expect(screen.getByText('Same Title')).toBeTruthy();
    expect(suggestMock).toHaveBeenCalledWith(
      [
        { hash: 'h1', title: 'Original Title', author: 'Author', language: undefined },
        { hash: 'h2', title: 'Same Title', author: 'Author', language: undefined },
      ],
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
  });

  it('checks only the rows whose title changes', async () => {
    renderDialog();

    const changed = (await screen.findByLabelText('选择 Original Title')) as HTMLInputElement;
    const unchanged = screen.getByLabelText('选择 Same Title') as HTMLInputElement;

    expect(changed.checked).toBe(true);
    expect(unchanged.checked).toBe(false);
    expect(screen.getByRole('button', { name: '应用 1 本' })).toBeTruthy();
  });

  it('saves an edited title through saveBookMetadataEdit and toasts the count', async () => {
    const { onClose } = renderDialog();

    const input = (await screen.findByLabelText('建议书名：Original Title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  新书名  ' } });
    fireEvent.click(screen.getByRole('button', { name: '应用 1 本' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(
      expect.anything(),
      books[0],
      { title: '新书名', author: 'Author', language: 'ja' },
      ['read'],
      false,
    );
  });

  it('does not save rows whose suggestion is unchanged', async () => {
    const { onClose } = renderDialog();

    await screen.findByDisplayValue('建议书名');
    fireEvent.click(screen.getByRole('button', { name: '应用 1 本' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0]![1].hash).toBe('h1');
  });

  it('selects every changed row again from the select-changed button', async () => {
    renderDialog();

    const changed = (await screen.findByLabelText('选择 Original Title')) as HTMLInputElement;
    fireEvent.click(changed);
    expect(changed.checked).toBe(false);
    expect(screen.getByRole('button', { name: '应用 0 本' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '全选有变化的' }));
    expect(changed.checked).toBe(true);
    expect(screen.getByRole('button', { name: '应用 1 本' })).toBeTruthy();
  });

  it('cancels without saving anything', async () => {
    const { onClose } = renderDialog();

    await screen.findByDisplayValue('建议书名');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('asks once before discarding an edited, unapplied title', async () => {
    const { onClose } = renderDialog();

    const input = (await screen.findByLabelText('建议书名：Original Title')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '改过的书名' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
