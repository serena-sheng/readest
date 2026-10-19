import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import TranslationExpertPanel from '@/app/reader/components/TranslationExpertPanel';
import { getGlossaryRevision, getGlossaryText, setGlossaryText } from '@/services/translators/glossary';
import { getExperts, getStyles } from '@/services/ai/translationExperts';
import type * as TranslationExpertsModule from '@/services/ai/translationExperts';
import { installMemoryStorage } from '../memoryStorage';

vi.mock('@/services/ai/translationExperts', async (importOriginal) => {
  const actual = await importOriginal<typeof TranslationExpertsModule>();
  return {
    ...actual,
    getStyles: vi.fn(),
    getExperts: vi.fn(),
  };
});

const getStylesMock = vi.mocked(getStyles);
const getExpertsMock = vi.mocked(getExperts);

const renderPanel = () =>
  render(<TranslationExpertPanel title='傲慢与偏见' open onClose={vi.fn()} />);

beforeEach(() => {
  installMemoryStorage();
  window.localStorage.clear();
  getStylesMock.mockResolvedValue({
    genres: [{ id: 'humanities', label: '人文社科', desc: '论证连接' }],
    modes: [{ id: 'faithful', label: '忠实原文', desc: '贴句子结构', temp: 0.3 }],
    default: 'humanities.faithful',
  });
  getExpertsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('TranslationExpertPanel local glossary', () => {
  it('loads the stored glossary into the editor and counts its pairs', async () => {
    setGlossaryText('Elizabeth=伊丽莎白\nDarcy=达西');

    renderPanel();

    const editor = (await screen.findByLabelText('本地术语表')) as HTMLTextAreaElement;
    expect(editor.value).toBe('Elizabeth=伊丽莎白\nDarcy=达西');
    expect(screen.getByText('2 条 · 仅对 OpenAI 兼容端点生效')).toBeTruthy();
  });

  it('persists the text and bumps the revision on save', async () => {
    renderPanel();

    const editor = await screen.findByLabelText('本地术语表');
    fireEvent.change(editor, { target: { value: 'Elizabeth=伊丽莎白' } });
    expect(screen.getByText('1 条 · 仅对 OpenAI 兼容端点生效')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保存本地术语表' }));

    expect(getGlossaryText()).toBe('Elizabeth=伊丽莎白');
    expect(getGlossaryRevision()).toBe(1);
    expect(await screen.findByText('已保存')).toBeTruthy();
  });

  it('persists the text when the editor loses focus', async () => {
    renderPanel();

    const editor = await screen.findByLabelText('本地术语表');
    fireEvent.change(editor, { target: { value: 'Darcy=达西' } });
    fireEvent.blur(editor);

    expect(getGlossaryText()).toBe('Darcy=达西');
    expect(getGlossaryRevision()).toBe(1);
  });
});
