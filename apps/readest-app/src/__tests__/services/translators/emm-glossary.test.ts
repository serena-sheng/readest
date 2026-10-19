import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emmProvider } from '@/services/translators/providers/emm';
import { systemPromptFor } from '@/services/translators/prompts';
import { makeTranslationKey } from '@/services/translators/translationCache';
import { setGlossaryText, withGlossaryRevision } from '@/services/translators/glossary';
import { installMemoryStorage } from '../../memoryStorage';

vi.mock('@/services/translators/endpoints', () => ({
  getActiveEndpoint: () => ({
    id: 'cloud',
    name: '云端',
    kind: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    model: 'deepseek-chat',
    enabled: true,
  }),
}));

const fetchMock = vi.fn();

const chatResponse = (text: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ paragraphs: [{ id: 1, text }] }) } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

/** The system message the provider sent in the first chat completion. */
const sentSystem = (): string => {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    messages?: Array<{ role: string; content: string }>;
  };
  return body.messages?.find((message) => message.role === 'system')?.content ?? '';
};

beforeEach(() => {
  installMemoryStorage();
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(chatResponse('你好'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('emm provider with the local glossary', () => {
  it('puts the glossary pairs into the system prompt for an OpenAI-compatible endpoint', async () => {
    setGlossaryText('Elizabeth=伊丽莎白\nDarcy=达西');

    await emmProvider.translate(['Hello'], 'EN', 'ZH');

    const system = sentSystem();
    expect(system).toContain('## 术语表');
    expect(system).toContain('- Elizabeth → 伊丽莎白');
    expect(system).toContain('- Darcy → 达西');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://example.test/v1/chat/completions');
  });

  it('sends exactly the glossary-free prompt when no glossary is stored', async () => {
    await emmProvider.translate(['Hello'], 'EN', 'ZH');

    const system = sentSystem();
    expect(system).toBe(systemPromptFor('humanities.faithful'));
    expect(system).not.toContain('术语表');
  });

  it('changes the translation cache key when the glossary revision changes', () => {
    const scope = 'openai-compatible|';
    const before = makeTranslationKey('book-1', 'ZH', withGlossaryRevision(scope), 'Hello');

    setGlossaryText('Elizabeth=伊丽莎白');
    const after = makeTranslationKey('book-1', 'ZH', withGlossaryRevision(scope), 'Hello');

    expect(before).not.toBe(after);
    expect(after).toContain('openai-compatible||g1');
  });
});
