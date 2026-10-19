import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import TranslationExpertPanel from '@/app/reader/components/TranslationExpertPanel';
import { installMemoryStorage } from '../memoryStorage';
import {
  bindExpert,
  getExperts,
  getStyles,
  saveExpert,
} from '@/services/ai/translationExperts';
import type { TranslationStyles } from '@/services/ai/translationExperts';
import type * as TranslationExpertsModule from '@/services/ai/translationExperts';
import {
  getActiveEndpointId,
  listEndpoints,
  saveEndpoint,
  setActiveEndpointId,
  type TranslationEndpoint,
} from '@/services/translators/endpoints';

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
  genres: [{ id: 'humanities', label: '人文社科', desc: '概念精确' }],
  modes: [{ id: 'faithful', label: '忠实原文', desc: '贴句子结构', temp: 0.3 }],
  default: 'humanities.faithful',
};

const endpoint = (overrides: Partial<TranslationEndpoint> = {}): TranslationEndpoint => ({
  id: 'local',
  name: '本机专家',
  kind: 'emm',
  baseUrl: 'http://127.0.0.1:8790',
  enabled: true,
  ...overrides,
});

const renderPanel = () =>
  render(<TranslationExpertPanel title='往事与随想' open onClose={vi.fn()} />);

beforeEach(() => {
  vi.clearAllMocks();
  installMemoryStorage();
  window.localStorage.clear();
  getStylesMock.mockResolvedValue(styles);
  getExpertsMock.mockResolvedValue([]);
  saveExpertMock.mockResolvedValue({ id: 1, name: '专家' });
  bindExpertMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('TranslationExpertPanel translation endpoints', () => {
  it('shows the default local service when no endpoint is configured', async () => {
    renderPanel();

    expect(screen.getByText('翻译端点')).toBeTruthy();
    expect(await screen.findByText('默认使用本机专家服务')).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加端点' })).toBeTruthy();
    expect(screen.queryByText('使用中')).toBeNull();
  });

  it('adds an endpoint inline and makes it active', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '添加端点' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '本机专家' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://127.0.0.1:9000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const stored = listEndpoints();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      name: '本机专家',
      kind: 'emm',
      baseUrl: 'http://127.0.0.1:9000',
      enabled: true,
    });
    expect(getActiveEndpointId()).toBe(stored[0]!.id);
    expect(
      await screen.findByText(/本机专家 · 本机专家服务 · 127\.0\.0\.1:9000/),
    ).toBeTruthy();
    expect(screen.getByText('使用中')).toBeTruthy();
    expect(screen.queryByTestId('translation-endpoint-form')).toBeNull();
  });

  it('switches the active endpoint from the list', async () => {
    saveEndpoint(endpoint({ id: 'first', name: '第一个' }));
    saveEndpoint(
      endpoint({
        id: 'second',
        name: '第二个',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'chat-model',
      }),
    );
    setActiveEndpointId('first');

    renderPanel();

    const secondRow = screen.getByTestId('translation-endpoint-second');
    expect(within(secondRow).getByText('OpenAI 兼容', { exact: false })).toBeTruthy();
    fireEvent.click(within(secondRow).getByRole('button', { name: '启用 第二个' }));

    expect(getActiveEndpointId()).toBe('second');
    expect(within(secondRow).getByText('使用中')).toBeTruthy();
    expect(
      within(screen.getByTestId('translation-endpoint-first')).queryByText('使用中'),
    ).toBeNull();
  });

  it('requires a model before saving an OpenAI-compatible endpoint', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '添加端点' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'DeepSeek' } });
    fireEvent.change(screen.getByLabelText('类型'), {
      target: { value: 'openai-compatible' },
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.deepseek.com/v1' },
    });

    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'deepseek-chat' } });
    expect(save.disabled).toBe(false);
  });
});
