import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import type { SelectedFile } from '@/hooks/useFileSelector';
import type { Book } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { getFilename } from '@/utils/path';
import {
  candidateTag,
  defaultSelected,
  discoverImportable,
  formatBytes,
  type CandidateTag,
  type DiscoveryCandidate,
} from '@/services/library/discovery';

/** Fixed first-version roots: the places downloads and rips land on macOS. */
export const DEFAULT_DISCOVERY_ROOTS = [
  '~/Downloads',
  '~/Desktop',
  '~/Documents',
  '~/Movies',
  '/Volumes',
];

interface DiscoveryDialogProps {
  /** Library snapshot used for duplicate/“already there” detection. */
  library: Book[];
  onClose: () => void;
  /**
   * Reuses the library's existing import pipeline (manga conversion included).
   * Resolves with the paths that failed so the dialog can report the count.
   */
  onImport: (files: SelectedFile[]) => Promise<{ failedPaths?: string[] } | void> | void;
  roots?: string[];
}

const TAG_CLASS: Record<CandidateTag, string> = {
  建议: 'badge badge-success badge-sm',
  重复: 'badge badge-warning badge-sm',
  已在书库: 'badge badge-ghost badge-sm',
  体积过小: 'badge badge-ghost badge-sm',
};

const DiscoveryDialog: React.FC<DiscoveryDialogProps> = ({
  library,
  onClose,
  onImport,
  roots = DEFAULT_DISCOVERY_ROOTS,
}) => {
  const _ = useTranslation();

  // The dialog is mounted per opening; a fresh `library` array on every
  // library render must not restart a scan that may take a while.
  const [initialLibrary] = useState(library);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    void discoverImportable({
      roots,
      library: initialLibrary,
      signal: controller.signal,
    })
      .then((rows) => {
        if (cancelled) return;
        setCandidates(rows);
        setSelected(new Set(rows.filter(defaultSelected).map((row) => row.path)));
      })
      .catch((error) => {
        if (!cancelled) console.error('Discovery scan failed:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestedRows = useMemo(() => candidates.filter(defaultSelected), [candidates]);
  const selectedRows = useMemo(
    () => candidates.filter((row) => selected.has(row.path)),
    [candidates, selected],
  );

  const requestClose = () => {
    if (!importing) onClose();
  };
  const divRef = useKeyDownActions({ onCancel: requestClose });

  const handleToggle = (path: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const handleSelectSuggested = () => {
    setSelected(new Set(suggestedRows.map((row) => row.path)));
  };

  const handleImport = async () => {
    if (importing || selectedRows.length === 0) return;
    setImporting(true);
    const files: SelectedFile[] = selectedRows.map((row) => ({
      path: row.path,
      name: getFilename(row.path),
    }));
    try {
      const result = await onImport(files);
      const failed = result?.failedPaths?.length ?? 0;
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('已导入 {{count}} 个', { count: selectedRows.length - failed }),
      });
      onClose();
    } catch (error) {
      console.error('Discovery import failed:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('导入失败'),
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className='fixed inset-0 flex items-center justify-center'>
      <div
        ref={divRef}
        role='dialog'
        aria-modal='true'
        aria-label={_('扫描添加')}
        className={clsx(
          'modal-box bg-base-100 flex max-h-[85%] w-[95%] max-w-[720px] flex-col rounded-2xl p-6 shadow-xl',
        )}
      >
        <h2 className='text-center text-lg font-medium'>{_('扫描添加')}</h2>

        <p className='text-base-content/60 mt-1 text-center text-sm'>
          {loading
            ? _('正在扫描…')
            : candidates.length === 0
              ? _('没有找到可导入的书籍')
              : _('共发现 {{count}} 个可导入 · 建议 {{suggested}} 个', {
                  count: candidates.length,
                  suggested: suggestedRows.length,
                })}
        </p>

        <div className='mt-4 min-h-0 flex-1 overflow-y-auto'>
          {loading ? (
            <div className='flex items-center justify-center py-12' aria-live='polite'>
              <span className='loading loading-spinner loading-md' />
            </div>
          ) : candidates.length > 0 ? (
            <ul className='flex flex-col'>
              {candidates.map((row) => {
                const tag = candidateTag(row);
                return (
                  <li
                    key={row.path}
                    className='border-base-200 border-b last:border-b-0'
                    data-testid={`discovery-row-${row.path}`}
                  >
                    <label className='flex cursor-pointer items-start gap-2 py-2'>
                      <input
                        type='checkbox'
                        className='checkbox checkbox-sm mt-0.5'
                        checked={selected.has(row.path)}
                        disabled={importing}
                        aria-label={_('选择 {{title}}', { title: row.title })}
                        onChange={(e) => handleToggle(row.path, e.target.checked)}
                      />
                      <span className='min-w-0 flex-1'>
                        <span className='flex min-w-0 items-center gap-2'>
                          <span className='truncate text-sm'>{row.title}</span>
                          <span className={TAG_CLASS[tag]}>{_(tag)}</span>
                        </span>
                        <span
                          className='text-base-content/50 mt-0.5 block truncate text-xs'
                          title={row.path}
                        >
                          {row.path}
                        </span>
                      </span>
                      <span className='text-base-content/50 shrink-0 text-xs tabular-nums'>
                        {formatBytes(row.sizeBytes)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className='mt-4 flex flex-wrap items-center justify-between gap-2'>
          <span className='text-base-content/50 flex items-center gap-1.5 text-xs'>
            {importing && (
              <>
                <span className='loading loading-spinner loading-xs' />
                {_('正在导入 {{count}} 个…', { count: selectedRows.length })}
              </>
            )}
          </span>
          <div className='flex flex-wrap items-center justify-end gap-2'>
            <button
              type='button'
              className='btn btn-ghost btn-sm'
              onClick={handleSelectSuggested}
              disabled={loading || importing || suggestedRows.length === 0}
            >
              {_('全选建议')}
            </button>
            <button
              type='button'
              className='btn btn-ghost btn-sm eink-bordered'
              onClick={requestClose}
              disabled={importing}
            >
              {_('取消')}
            </button>
            <button
              type='button'
              className='btn btn-contrast btn-sm'
              onClick={() => void handleImport()}
              disabled={importing || selectedRows.length === 0}
            >
              {_('导入 {{count}} 个', { count: selectedRows.length })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiscoveryDialog;
