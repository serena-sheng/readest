import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import TagBrowserPanel from '@/app/library/components/TagBrowserPanel';
import { getTags, listBooks, queryBooks } from '@/services/ai/localTags';
import type { LocalTag, LocalTagBook } from '@/services/ai/localTags';
import type * as LocalTagsModule from '@/services/ai/localTags';

vi.mock('@/services/ai/localTags', async (importOriginal) => {
  const actual = await importOriginal<typeof LocalTagsModule>();
  return {
    ...actual,
    getTags: vi.fn(),
    listBooks: vi.fn(),
    queryBooks: vi.fn(),
  };
});

const getTagsMock = vi.mocked(getTags);
const listBooksMock = vi.mocked(listBooks);
const queryBooksMock = vi.mocked(queryBooks);

const tags: LocalTag[] = [
  { namespace: 'female', name: 'glasses', count: 4 },
  { namespace: 'female', name: 'big breasts', count: 5 },
  { namespace: 'male', name: 'glasses', count: 3 },
];

const books: LocalTagBook[] = [
  { id: 1, title: '往事与随想', tags: ['female:glasses', 'female:big breasts'] },
  { id: 2, title: '另一本', tags: ['male:glasses'] },
];

const renderPanel = () => {
  const onClose = vi.fn();
  const view = render(<TagBrowserPanel open onClose={onClose} />);
  return { ...view, onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
  getTagsMock.mockResolvedValue(tags);
  listBooksMock.mockResolvedValue(books);
  queryBooksMock.mockResolvedValue([books[0]!]);
});

afterEach(() => {
  cleanup();
});

describe('TagBrowserPanel', () => {
  it('renders namespaces with their totals and the selected namespace chips', async () => {
    renderPanel();

    const female = await screen.findByRole('button', { name: 'female · 9' });
    const male = screen.getByRole('button', { name: 'male · 3' });
    expect(female.getAttribute('aria-pressed')).toBe('true');
    expect(male.getAttribute('aria-pressed')).toBe('false');

    expect(screen.getByRole('button', { name: 'glasses · 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'big breasts · 5' })).toBeTruthy();

    fireEvent.click(male);
    expect(male.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'glasses · 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'big breasts · 5' })).toBeNull();
  });

  it('appends tag tokens to the expression and queries immediately', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'glasses · 4' }));
    const input = screen.getByLabelText('标签表达式') as HTMLInputElement;
    expect(input.value).toBe('female:glasses');
    await waitFor(() => expect(queryBooksMock).toHaveBeenCalledWith('female:glasses'));

    fireEvent.click(screen.getByRole('button', { name: 'big breasts · 5' }));
    expect(input.value).toBe('female:glasses female:$big breasts$');
    await waitFor(() =>
      expect(queryBooksMock).toHaveBeenLastCalledWith('female:glasses female:$big breasts$'),
    );
    expect(screen.getByText('往事与随想')).toBeTruthy();
  });

  it('appends the exclusion form on Shift-click', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'glasses · 4' }), {
      shiftKey: true,
    });

    const input = screen.getByLabelText('标签表达式') as HTMLInputElement;
    expect(input.value).toBe('-female:glasses');
    await waitFor(() => expect(queryBooksMock).toHaveBeenCalledWith('-female:glasses'));
  });

  it('renders the matched result list with the matched tag count', async () => {
    renderPanel();

    expect(await screen.findByText('往事与随想')).toBeTruthy();
    expect(screen.getByText('另一本')).toBeTruthy();
    expect(screen.getByText('2 个标签')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'glasses · 4' }));

    await waitFor(() => expect(screen.queryByText('另一本')).toBeNull());
    expect(screen.getByText('往事与随想')).toBeTruthy();
    expect(screen.getByText('1 个匹配标签')).toBeTruthy();
  });

  it('shows an empty state when the expression matches nothing', async () => {
    queryBooksMock.mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'glasses · 4' }));

    expect(await screen.findByText('没有匹配的书')).toBeTruthy();
  });

  it('reports a disconnected service and keeps the typed expression', async () => {
    getTagsMock.mockRejectedValue(new Error('tags: Failed to fetch'));
    renderPanel();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('本地服务未连接');

    const input = screen.getByLabelText('标签表达式') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'female:$big breasts$' } });
    expect(input.value).toBe('female:$big breasts$');
  });
});
