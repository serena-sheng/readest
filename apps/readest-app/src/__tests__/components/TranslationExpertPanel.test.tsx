import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import TranslationExpertPanel from '@/app/reader/components/TranslationExpertPanel';
import { installMemoryStorage } from '../memoryStorage';
import {
  bindExpert,
  getExperts,
  getStyles,
  saveExpert,
  STYLE_STORAGE_KEY,
} from '@/services/ai/translationExperts';
import type { TranslationExpert, TranslationStyles } from '@/services/ai/translationExperts';
import type * as TranslationExpertsModule from '@/services/ai/translationExperts';
import { eventDispatcher } from '@/utils/event';

vi.mock('@/services/ai/translationExperts', async (importOriginal) => {
  const actual = await importOriginal<typeof TranslationExpertsModule>();
  return {
    ...actual,
    getStyles: vi.fn(),
    getExperts: vi.fn(),
    saveExpert: vi.fn(),
    bindExpert: vi.fn(),
  };
});

const getStylesMock = vi.mocked(getStyles);
const getExpertsMock = vi.mocked(getExperts);
const saveExpertMock = vi.mocked(saveExpert);
const bindExpertMock = vi.mocked(bindExpert);

const styles: TranslationStyles = {
  genres: [
    { id: 'humanities', label: '人文社科', desc: '论证连接、概念精确、引文照译' },
    { id: 'jp_light', label: '日本轻小说', desc: '口语、吐槽、角色口吻' },
  ],
  modes: [
    { id: 'faithful', label: '忠实原文', desc: '贴句子结构，术语与称呼不折损', temp: 0.3 },
    { id: 'plain', label: '通俗易懂', desc: '长句拆短，用现代口语讲明白', temp: 0.55 },
    { id: 'learn', label: '语言学习', desc: '译文可读，另附词汇与地道用语', temp: 0.45 },
  ],
  default: 'humanities.faithful',
};

const experts: TranslationExpert[] = [
  {
    id: 7,
    name: '轻小说口语',
    genre: 'jp_light',
    mode: 'plain',
    glossary_count: 3,
    override_prompt: '',
    temp_override: null,
  },
];

const renderPanel = () => {
  const onClose = vi.fn();
  const view = render(<TranslationExpertPanel title='往事与随想' open onClose={onClose} />);
  return { ...view, onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryStorage();
  window.localStorage.clear();
  getStylesMock.mockResolvedValue(styles);
  getExpertsMock.mockResolvedValue(experts);
  saveExpertMock.mockResolvedValue({ id: 9, name: '轻小说口语' });
  bindExpertMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('TranslationExpertPanel', () => {
  it('renders the genre chips, mode segments and the active combination', async () => {
    renderPanel();

    expect(await screen.findByRole('button', { name: '日本轻小说' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '人文社科' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '通俗易懂' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '语言学习' })).toBeTruthy();
    expect(screen.getByText('人文社科 · 忠实原文')).toBeTruthy();
    expect(
      screen.getByText('论证连接、概念精确、引文照译；贴句子结构，术语与称呼不折损'),
    ).toBeTruthy();
  });

  it('writes the active style to the key the emm provider reads', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '日本轻小说' }));
    expect(window.localStorage.getItem(STYLE_STORAGE_KEY)).toBe('jp_light.faithful');
    expect(screen.getByText('日本轻小说 · 忠实原文')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '语言学习' }));
    expect(window.localStorage.getItem(STYLE_STORAGE_KEY)).toBe('jp_light.learn');
    expect(screen.getByText('日本轻小说 · 语言学习')).toBeTruthy();
  });

  it('saves the current combination and glossary as an expert', async () => {
    renderPanel();
    await screen.findByRole('button', { name: '日本轻小说' });

    fireEvent.change(screen.getByLabelText('专家名称'), { target: { value: '轻小说口语' } });
    fireEvent.change(screen.getByLabelText('术语表'), {
      target: { value: 'ツンデレ=傲娇\n幼馴染=青梅竹马' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为专家' }));

    await waitFor(() =>
      expect(saveExpertMock).toHaveBeenCalledWith({
        name: '轻小说口语',
        genre: 'humanities',
        mode: 'faithful',
        glossary: 'ツンデレ=傲娇\n幼馴染=青梅竹马',
        override_prompt: '',
      }),
    );
    expect(await screen.findByText('已保存「轻小说口语」')).toBeTruthy();
  });

  it('applies a saved expert and binds it to the book', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /轻小说口语/ }));
    expect(window.localStorage.getItem(STYLE_STORAGE_KEY)).toBe('jp_light.plain');
    expect(screen.getByText('日本轻小说 · 通俗易懂')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '设为本书默认' }));

    await waitFor(() => expect(bindExpertMock).toHaveBeenCalledWith('往事与随想', 7));
    expect(await screen.findByText('《往事与随想》已使用这个专家')).toBeTruthy();
  });

  it('keeps binding disabled without a selected expert and yields to other drawers', async () => {
    const { onClose } = renderPanel();
    await screen.findByRole('button', { name: '日本轻小说' });

    const bindButton = screen.getByRole('button', { name: '设为本书默认' }) as HTMLButtonElement;
    expect(bindButton.disabled).toBe(true);

    await eventDispatcher.dispatch('ideas-close', { bookKey: 'book-1' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
