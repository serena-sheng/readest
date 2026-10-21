import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { eventDispatcher } from '@/utils/event';
import { saveBookMetadataEdit } from '@/services/bookMetadataEdit';
import { suggestBookTitles, type RenameCandidate } from '@/services/library/renameSuggestions';

interface RenameSuggestionsDialogProps {
  books: Book[];
  isLoggedIn: boolean;
  onClose: () => void;
}

interface RenameRow extends RenameCandidate {
  title: string;
  selected: boolean;
}

const RenameSuggestionsDialog: React.FC<RenameSuggestionsDialogProps> = ({
  books,
  isLoggedIn,
  onClose,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();

  // The dialog is mounted per opening, so the batch runs once against the
  // books it was opened with. A fresh array prop on every library render must
  // not restart the request.
  const [initialBooks] = useState(books);
  const [rows, setRows] = useState<RenameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: books.length });
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    void suggestBookTitles(
      initialBooks.map((book) => ({
        hash: book.hash,
        title: book.title,
        author: book.author,
        language: book.primaryLanguage,
        series: book.metadata?.series,
        seriesIndex: book.metadata?.seriesIndex,
      })),
      {
        signal: controller.signal,
        onProgress: (done, total) => {
          if (!cancelled) setProgress({ done, total });
        },
      },
    )
      .then((candidates) => {
        if (cancelled) return;
        setRows(
          candidates.map((candidate) => ({
            ...candidate,
            title: candidate.suggestedTitle,
            selected: candidate.suggestedTitle.trim() !== candidate.currentTitle.trim(),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setRows([]);
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

  const selectedRows = rows.filter((row) => row.selected && row.title.trim());
  const hasEdits = rows.some((row) => row.title.trim() !== row.suggestedTitle.trim());

  const requestClose = () => {
    if (hasEdits && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const divRef = useKeyDownActions({ onCancel: requestClose });

  const handleToggle = (hash: string, selected: boolean) => {
    setRows((prev) => prev.map((row) => (row.hash === hash ? { ...row, selected } : row)));
  };

  const handleTitleChange = (hash: string, title: string) => {
    setRows((prev) => prev.map((row) => (row.hash === hash ? { ...row, title } : row)));
  };

  const handleSeriesIndexChange = (hash: string, raw: string) => {
    const parsed = parseFloat(raw);
    const seriesIndex = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    setRows((prev) =>
      prev.map((row) => {
        if (row.hash !== hash) return row;
        return seriesIndex === undefined
          ? { ...row, seriesIndex: undefined }
          : { ...row, seriesIndex };
      }),
    );
  };

  const handleSelectChanged = () => {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        selected: row.suggestedTitle.trim() !== row.currentTitle.trim(),
      })),
    );
  };

  const handleApply = async () => {
    if (!selectedRows.length || applying) return;
    setApplying(true);
    const byHash = new Map(initialBooks.map((book) => [book.hash, book]));
    for (const row of selectedRows) {
      const book = byHash.get(row.hash);
      if (!book) continue;
      const base: BookMetadata = book.metadata ?? {
        title: book.title,
        author: book.author,
        language: book.primaryLanguage ?? '',
      };
      await saveBookMetadataEdit(
        envConfig,
        book,
        {
          ...base,
          title: row.title.trim(),
          ...(row.seriesIndex !== undefined
            ? { series: row.series ?? row.title.trim(), seriesIndex: row.seriesIndex }
            : {}),
        },
        book.tags ?? [],
        isLoggedIn,
      );
    }
    setApplying(false);
    eventDispatcher.dispatch('toast', {
      type: 'success',
      message: _('已更新 {{count}} 本书名', { count: selectedRows.length }),
    });
    onClose();
  };

  return (
    <div className='fixed inset-0 flex items-center justify-center'>
      <div
        ref={divRef}
        role='dialog'
        aria-modal='true'
        aria-label={_('建议书名')}
        className={clsx(
          'modal-box bg-base-100 flex max-h-[85%] w-[95%] max-w-[760px] flex-col rounded-2xl p-6 shadow-xl',
        )}
      >
        <h2 className='text-center text-lg font-medium'>{_('建议书名')}</h2>

        {loading ? (
          <div className='text-base-content/60 flex flex-1 items-center justify-center py-10 text-sm'>
            {_('正在生成建议 {{done}}/{{total}}', progress)}
          </div>
        ) : rows.length === 0 ? (
          <p className='text-base-content/60 py-10 text-center text-sm'>
            {_('未能获取建议，请检查 AI 端点设置')}
          </p>
        ) : (
          <div className='mt-4 min-h-0 flex-1 overflow-y-auto'>
            <table className='table w-full table-fixed'>
              <thead>
                <tr className='text-base-content/60 text-caption'>
                  <th className='w-10' />
                  <th className='w-[32%] text-start font-normal'>{_('原书名')}</th>
                  <th className='w-[40%] text-start font-normal'>{_('建议书名')}</th>
                  <th className='text-start font-normal'>{_('理由')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.hash} data-testid={`rename-row-${row.hash}`}>
                    <td className='align-top'>
                      <input
                        type='checkbox'
                        className='checkbox checkbox-sm'
                        checked={row.selected}
                        aria-label={_('选择 {{title}}', { title: row.currentTitle })}
                        onChange={(e) => handleToggle(row.hash, e.target.checked)}
                      />
                    </td>
                    <td className='text-base-content/50 truncate align-top text-sm'>
                      {row.currentTitle}
                    </td>
                    <td className='align-top'>
                      <input
                        type='text'
                        className='input input-sm eink-bordered w-full'
                        aria-label={_('建议书名：{{title}}', { title: row.currentTitle })}
                        value={row.title}
                        onChange={(e) => handleTitleChange(row.hash, e.target.value)}
                      />
                      {row.seriesIndex !== undefined && (
                        <div className='text-base-content/60 mt-1 flex items-center gap-1 text-caption'>
                          <span aria-hidden>·</span>
                          <span>第</span>
                          <input
                            type='number'
                            min={0}
                            step={1}
                            className='input input-xs eink-bordered w-14 px-1 text-center'
                            aria-label={_('卷号：{{title}}', { title: row.currentTitle })}
                            value={row.seriesIndex}
                            onChange={(e) => handleSeriesIndexChange(row.hash, e.target.value)}
                          />
                          <span>卷</span>
                        </div>
                      )}
                    </td>
                    <td className='text-base-content/50 align-top text-xs break-words'>
                      {row.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {confirmDiscard && (
          <div
            role='alert'
            className='border-base-300 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm'
          >
            <span>{_('有未应用的修改，确定关闭？')}</span>
            <div className='flex gap-2'>
              <button className='btn btn-ghost btn-sm' onClick={() => setConfirmDiscard(false)}>
                {_('继续编辑')}
              </button>
              <button className='btn btn-error btn-sm' onClick={onClose}>
                {_('放弃修改')}
              </button>
            </div>
          </div>
        )}

        <div className='mt-4 flex flex-wrap items-center justify-end gap-2'>
          <button
            className='btn btn-ghost btn-sm'
            onClick={handleSelectChanged}
            disabled={loading || rows.length === 0}
          >
            {_('全选有变化的')}
          </button>
          <button className='btn btn-ghost btn-sm eink-bordered' onClick={requestClose}>
            {_('取消')}
          </button>
          <button
            className='btn btn-contrast btn-sm'
            onClick={() => void handleApply()}
            disabled={selectedRows.length === 0 || applying}
          >
            {_('应用 {{count}} 本', { count: selectedRows.length })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RenameSuggestionsDialog;
