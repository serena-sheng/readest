import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import RenameSuggestionsDialog from '@/app/library/components/RenameSuggestionsDialog';
import { saveBookMetadataEdit } from '@/services/bookMetadataEdit';
import { suggestBookTitles } from '@/services/library/renameSuggestions';
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
    title: '作品 第2巻',
    author: 'Author',
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    metadata: { title: '作品 第2巻', author: 'Author', language: 'ja' },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  suggestMock.mockResolvedValue([
    {
      hash: 'h1',
      currentTitle: '作品 第2巻',
      suggestedTitle: '作品',
      reason: '译名',
      series: '作品',
      seriesIndex: 2,
    },
  ]);
  saveMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('RenameSuggestionsDialog series order', () => {
  it('shows the volume number next to the suggested title', async () => {
    render(<RenameSuggestionsDialog books={books} isLoggedIn={false} onClose={vi.fn()} />);

    expect(await screen.findByDisplayValue('作品')).toBeTruthy();
    const indexInput = screen.getByLabelText('卷号：作品 第2巻') as HTMLInputElement;
    expect(indexInput.value).toBe('2');
    expect(screen.getByText('卷')).toBeTruthy();
  });

  it('lets the user edit the volume and saves it with the title', async () => {
    const onClose = vi.fn();
    render(<RenameSuggestionsDialog books={books} isLoggedIn={false} onClose={onClose} />);

    const indexInput = (await screen.findByLabelText('卷号：作品 第2巻')) as HTMLInputElement;
    fireEvent.change(indexInput, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '应用 1 本' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveMock).toHaveBeenCalledWith(
      expect.anything(),
      books[0],
      expect.objectContaining({ title: '作品', series: '作品', seriesIndex: 3 }),
      [],
      false,
    );
  });
});
