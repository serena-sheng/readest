import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import DiscoveryDialog from '@/app/library/components/DiscoveryDialog';
import { discoverImportable, type DiscoveryCandidate } from '@/services/library/discovery';
import { eventDispatcher } from '@/utils/event';
import type { Book } from '@/types/book';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null, envConfig: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn(), onSync: vi.fn(), on: vi.fn() },
}));
vi.mock('@/services/library/discovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/library/discovery')>();
  return { ...actual, discoverImportable: vi.fn() };
});

const discoverMock = vi.mocked(discoverImportable);
const dispatchMock = vi.mocked(eventDispatcher.dispatch);

const candidate = (overrides: Partial<DiscoveryCandidate>): DiscoveryCandidate => ({
  path: '/downloads/A.epub',
  sizeBytes: 5 * 1024 * 1024,
  kind: 'epub',
  title: 'A',
  reason: '未在书库',
  score: 65,
  alreadyInLibrary: false,
  ...overrides,
});

const rows: DiscoveryCandidate[] = [
  candidate({ path: '/downloads/A.epub', title: 'A', score: 65 }),
  candidate({
    path: '/downloads/B.epub',
    title: 'B',
    score: -30,
    reason: '与书库书名重复',
    duplicateOf: 'h-b',
  }),
  candidate({
    path: '/downloads/C.epub',
    title: 'C',
    score: -100,
    reason: '已在书库',
    alreadyInLibrary: true,
  }),
  candidate({ path: '/downloads/D.epub', title: 'D', sizeBytes: 40 * 1024, score: -10 }),
];

const library = [{ hash: 'h-b', title: 'B', format: 'EPUB', author: '' }] as Book[];

const renderDialog = (props: Partial<React.ComponentProps<typeof DiscoveryDialog>> = {}) => {
  const onClose = vi.fn();
  const onImport = vi.fn().mockResolvedValue({ failedPaths: [] });
  render(
    <DiscoveryDialog
      library={library}
      onClose={onClose}
      onImport={onImport}
      {...props}
    />,
  );
  return { onClose, onImport };
};

beforeEach(() => {
  vi.clearAllMocks();
  discoverMock.mockResolvedValue(rows);
});

afterEach(cleanup);

describe('DiscoveryDialog', () => {
  it('shows the loading state while scanning', () => {
    discoverMock.mockImplementation(() => Promise.withResolvers<DiscoveryCandidate[]>().promise);
    renderDialog();

    expect(screen.getByText('正在扫描…')).toBeTruthy();
  });

  it('renders every candidate with its size and scan summary', async () => {
    renderDialog();

    expect(await screen.findByText('共发现 4 个可导入 · 建议 1 个')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('/downloads/D.epub')).toBeTruthy();
    expect(screen.getAllByText('5.0 MB')).toHaveLength(3);
    expect(screen.getByText('40 KB')).toBeTruthy();
  });

  it('ticks only the suggested rows by default', async () => {
    renderDialog();

    const checkboxA = (await screen.findByLabelText('选择 A')) as HTMLInputElement;
    const checkboxB = screen.getByLabelText('选择 B') as HTMLInputElement;
    const checkboxC = screen.getByLabelText('选择 C') as HTMLInputElement;
    const checkboxD = screen.getByLabelText('选择 D') as HTMLInputElement;

    expect(checkboxA.checked).toBe(true);
    expect(checkboxB.checked).toBe(false);
    expect(checkboxC.checked).toBe(false);
    expect(checkboxD.checked).toBe(false);
  });

  it('labels duplicate, already-present, and tiny rows', async () => {
    renderDialog();

    await screen.findByText('建议');
    expect(screen.getByText('重复')).toBeTruthy();
    expect(screen.getByText('已在书库')).toBeTruthy();
    expect(screen.getByText('体积过小')).toBeTruthy();
  });

  it('re-selects the suggestions after they were cleared', async () => {
    renderDialog();

    const checkboxA = (await screen.findByLabelText('选择 A')) as HTMLInputElement;
    fireEvent.click(checkboxA);
    expect(screen.getByText('导入 0 个')).toBeTruthy();

    fireEvent.click(screen.getByText('全选建议'));
    expect((screen.getByLabelText('选择 A') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('导入 1 个')).toBeTruthy();
  });

  it('closes without importing when cancelled', async () => {
    const { onClose, onImport } = renderDialog();

    await screen.findByText('A');
    fireEvent.click(screen.getByText('取消'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('imports the selected paths and reports the count', async () => {
    const { onClose, onImport } = renderDialog();

    await screen.findByText('A');
    fireEvent.click(screen.getByText('导入 1 个'));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith([
      { path: '/downloads/A.epub', name: 'A.epub' },
    ]);
    await waitFor(() =>
      expect(dispatchMock).toHaveBeenCalledWith('toast', {
        type: 'success',
        message: '已导入 1 个',
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not report files the importer said failed', async () => {
    const onImport = vi.fn().mockResolvedValue({ failedPaths: ['/downloads/A.epub'] });
    renderDialog({ onImport });

    await screen.findByText('A');
    fireEvent.click(screen.getByText('导入 1 个'));

    await waitFor(() =>
      expect(dispatchMock).toHaveBeenCalledWith('toast', {
        type: 'success',
        message: '已导入 0 个',
      }),
    );
  });
});
