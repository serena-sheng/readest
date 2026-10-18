import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import IdeasPanel from '@/app/reader/components/IdeasPanel';
import { deleteNote, listNotes } from '@/services/ai/localNotes';
import type { LocalNote } from '@/services/ai/localNotes';

vi.mock('@/services/ai/localNotes', () => ({
  listNotes: vi.fn(),
  deleteNote: vi.fn(),
}));

const listMock = vi.mocked(listNotes);
const deleteMock = vi.mocked(deleteNote);

const buildNote = (overrides: Partial<LocalNote> = {}): LocalNote => ({
  id: 1,
  uuid: 'note-1',
  quote: '第二段里被选中的那句话。',
  note: '这句值得回看',
  locator: 'ch1.xhtml#1',
  created_at: Math.floor(Date.now() / 1000) - 120,
  ...overrides,
});

const renderPanel = () => render(<IdeasPanel title='往事与随想' open onClose={vi.fn()} />);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('IdeasPanel', () => {
  it('shows the empty state when the book has no notes', async () => {
    listMock.mockResolvedValue([]);

    renderPanel();

    await waitFor(() => expect(screen.getByText('还没有想法，划线试试')).toBeTruthy());
    expect(listMock).toHaveBeenCalledWith('往事与随想');
  });

  it('renders quote, note and a locator with relative time', async () => {
    listMock.mockResolvedValue([buildNote()]);

    renderPanel();

    await waitFor(() => expect(screen.getByText('第二段里被选中的那句话。')).toBeTruthy());
    expect(screen.getByText('这句值得回看')).toBeTruthy();
    expect(screen.getByText('ch1.xhtml#1 · 2 分钟前')).toBeTruthy();
  });

  it('deletes a note after the inline confirmation', async () => {
    listMock.mockResolvedValue([buildNote()]);
    deleteMock.mockResolvedValue(undefined);

    renderPanel();
    await waitFor(() => expect(screen.getByText('第二段里被选中的那句话。')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: '删除想法' }));
    expect(screen.getByText('确定删除？')).toBeTruthy();
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('note-1'));
    await waitFor(() => expect(screen.queryByText('第二段里被选中的那句话。')).toBeNull());
  });

  it('keeps the note and reports the error when deleting fails', async () => {
    listMock.mockResolvedValue([buildNote()]);
    deleteMock.mockRejectedValue(new Error('local-notes: request failed (500)'));

    renderPanel();
    await waitFor(() => expect(screen.getByText('第二段里被选中的那句话。')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: '删除想法' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() =>
      expect(screen.getByText('读取失败：local-notes: request failed (500)')).toBeTruthy(),
    );
    expect(screen.getByText('第二段里被选中的那句话。')).toBeTruthy();
  });

  it('refreshes when a note is saved elsewhere', async () => {
    listMock.mockResolvedValueOnce([]).mockResolvedValueOnce([buildNote()]);

    renderPanel();
    await waitFor(() => expect(screen.getByText('还没有想法，划线试试')).toBeTruthy());

    window.dispatchEvent(new CustomEvent('emm-note-saved'));

    await waitFor(() => expect(screen.getByText('第二段里被选中的那句话。')).toBeTruthy());
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
