'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdClose } from 'react-icons/md';
import { TbCopy } from 'react-icons/tb';

import {
  getTags,
  listBooks,
  queryBooks,
  type LocalTag,
  type LocalTagBook,
} from '@/services/ai/localTags';

interface TagBrowserPanelProps {
  open: boolean;
  onClose: () => void;
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The result list shows at most this many books; the count above it does not. */
const RESULT_LIMIT = 20;

interface NamespaceSummary {
  name: string;
  total: number;
}

interface ExpressionTerm {
  namespace: string;
  name: string;
  exclude: boolean;
}

const summarizeNamespaces = (tags: LocalTag[]): NamespaceSummary[] => {
  const totals = new Map<string, number>();
  tags.forEach((tag) => totals.set(tag.namespace, (totals.get(tag.namespace) ?? 0) + tag.count));
  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
};

/**
 * Split an expression into `namespace:name` terms the way the service does:
 * whitespace separates terms, `$…$` keeps a name together, and a leading `-`
 * marks an excluded term. Bare words are kept with an empty namespace so they
 * still count toward how many catalogue tags a result matched.
 */
const parseExpression = (expr: string): ExpressionTerm[] => {
  const terms: ExpressionTerm[] = [];
  let index = 0;
  while (index < expr.length) {
    while (index < expr.length && /\s/.test(expr[index]!)) index++;
    if (index >= expr.length) break;

    let exclude = false;
    if (expr[index] === '-') {
      exclude = true;
      index++;
    }

    let token = '';
    while (index < expr.length) {
      const char = expr[index]!;
      if (char === '$') {
        const end = expr.indexOf('$', index + 1);
        if (end === -1) {
          token += expr.slice(index + 1);
          index = expr.length;
          break;
        }
        token += expr.slice(index + 1, end);
        index = end + 1;
        continue;
      }
      if (/\s/.test(char)) break;
      token += char;
      index++;
    }

    const separator = token.indexOf(':');
    if (separator > 0 && separator < token.length - 1) {
      terms.push({
        namespace: token.slice(0, separator),
        name: token.slice(separator + 1),
        exclude,
      });
    } else if (token) {
      terms.push({ namespace: '', name: token, exclude });
    }
  }
  return terms;
};

/** `$…$` is only needed for names containing whitespace. */
const formatTagToken = (tag: LocalTag, exclude: boolean): string => {
  const name = /\s/.test(tag.name) ? `$${tag.name}$` : tag.name;
  return `${exclude ? '-' : ''}${tag.namespace}:${name}`;
};

const appendExpressionToken = (expr: string, token: string): string =>
  expr.trim() ? `${expr.trimEnd()} ${token}` : token;

const countMatchedTags = (book: LocalTagBook, expr: string): number => {
  const included = parseExpression(expr).filter((term) => !term.exclude);
  if (included.length === 0) return book.tags.length;

  const canonical = new Set(
    included
      .filter((term) => term.namespace)
      .map((term) => `${term.namespace}:${term.name}`.toLowerCase()),
  );
  const bare = included
    .filter((term) => !term.namespace)
    .map((term) => term.name.toLowerCase());

  return book.tags.filter((tag) => {
    const lower = tag.toLowerCase();
    return canonical.has(lower) || bare.some((word) => lower.includes(word));
  }).length;
};

/**
 * Read-only tag browser for the library: namespaces on the left, their tags on
 * the right, and a filter expression that the loopback service evaluates.
 * Clicking a tag appends `namespace:name` and runs the query immediately;
 * Shift-click appends the `-` exclusion form instead.
 */
const TagBrowserPanel: React.FC<TagBrowserPanelProps> = ({ open, onClose }) => {
  const [tags, setTags] = useState<LocalTag[]>([]);
  const [books, setBooks] = useState<LocalTagBook[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [queryFailed, setQueryFailed] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [expression, setExpression] = useState('');
  const [results, setResults] = useState<LocalTagBook[]>([]);
  const [matched, setMatched] = useState(0);
  const [copied, setCopied] = useState(false);

  const queryIdRef = useRef(0);
  const copyTimerRef = useRef<number | undefined>(undefined);

  const namespaces = useMemo(() => summarizeNamespaces(tags), [tags]);
  const namespaceTags = useMemo(() => {
    return tags
      .filter((tag) => tag.namespace === selectedNamespace)
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }, [selectedNamespace, tags]);

  const load = useCallback(async () => {
    setLoadStatus('loading');
    setQueryFailed(false);
    try {
      const [nextTags, nextBooks] = await Promise.all([getTags(), listBooks()]);
      const nextNamespaces = summarizeNamespaces(nextTags);
      setTags(nextTags);
      setBooks(nextBooks);
      setSelectedNamespace((previous) =>
        nextNamespaces.some((item) => item.name === previous)
          ? previous
          : (nextNamespaces[0]?.name ?? ''),
      );
      setResults(nextBooks.slice(0, RESULT_LIMIT));
      setMatched(nextBooks.length);
      setLoadStatus('ready');
    } catch {
      setLoadStatus('error');
    }
  }, []);

  const runQuery = useCallback(
    async (expr: string) => {
      const requestId = ++queryIdRef.current;
      const trimmed = expr.trim();
      setQueryFailed(false);
      if (!trimmed) {
        setResults(books.slice(0, RESULT_LIMIT));
        setMatched(books.length);
        setQuerying(false);
        return;
      }

      setQuerying(true);
      try {
        const matchedBooks = await queryBooks(trimmed);
        if (requestId !== queryIdRef.current) return;
        setResults(matchedBooks.slice(0, RESULT_LIMIT));
        setMatched(matchedBooks.length);
      } catch {
        if (requestId === queryIdRef.current) setQueryFailed(true);
      } finally {
        if (requestId === queryIdRef.current) setQuerying(false);
      }
    },
    [books],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const handleTagClick = (tag: LocalTag, exclude: boolean) => {
    const next = appendExpressionToken(expression, formatTagToken(tag, exclude));
    setExpression(next);
    void runQuery(next);
  };

  const handleClear = () => {
    setExpression('');
    void runQuery('');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(expression);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const serviceDown = loadStatus === 'error' || queryFailed;

  return (
    <div
      role='dialog'
      aria-label='标签'
      aria-hidden={!open}
      inert={!open}
      className={clsx(
        'pointer-events-auto fixed bottom-0 right-0 top-0 z-50 flex w-[380px] max-w-full flex-col',
        'bg-base-100 rounded-box border border-base-content/10 shadow-lg',
        'transition-transform duration-300',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className='flex items-start gap-2 border-b border-base-content/10 px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='font-serif text-base font-semibold'>标签</h2>
          <p className='mt-1 truncate text-xs opacity-60'>
            {loadStatus === 'ready'
              ? `${namespaces.length} 个命名空间 · ${tags.length} 个标签`
              : '浏览本地书库的标签'}
          </p>
        </div>
        <button
          className='btn btn-ghost btn-sm btn-circle'
          title='关闭'
          aria-label='关闭'
          onClick={onClose}
        >
          <MdClose size={18} />
        </button>
      </div>

      <div className='space-y-1.5 border-b border-base-content/10 px-4 py-3'>
        <div className='flex items-center gap-1.5'>
          <input
            aria-label='标签表达式'
            type='text'
            spellCheck='false'
            value={expression}
            placeholder='female:glasses -male'
            className='input input-bordered input-sm min-w-0 flex-1 font-mono text-xs'
            onChange={(event) => setExpression(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runQuery(expression);
            }}
          />
          <button
            type='button'
            className='btn btn-ghost btn-sm shrink-0 px-2 text-xs'
            title='清空表达式'
            disabled={!expression}
            onClick={handleClear}
          >
            清空
          </button>
          <button
            type='button'
            className='btn btn-ghost btn-sm shrink-0 gap-1 px-2 text-xs'
            title='复制表达式'
            disabled={!expression}
            onClick={() => void handleCopy()}
          >
            <TbCopy size={14} />
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        {serviceDown ? (
          <p role='alert' className='text-error text-xs'>
            本地服务未连接
          </p>
        ) : (
          <p className='text-caption opacity-60'>
            {loadStatus === 'loading'
              ? '正在读取…'
              : querying
                ? '查询中…'
                : `匹配 ${matched} 本`}
          </p>
        )}
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3'>
        <div className='flex min-h-0 flex-[1.1] gap-3'>
          <div className='hidden w-24 shrink-0 flex-col gap-1 overflow-y-auto sm:flex'>
            {namespaces.map((item) => (
              <button
                key={item.name}
                type='button'
                aria-pressed={item.name === selectedNamespace}
                className={clsx(
                  'rounded-field truncate px-1.5 py-1 text-left text-xs transition-colors',
                  item.name === selectedNamespace
                    ? 'bg-primary/10 text-primary'
                    : 'text-base-content/70 hover:bg-base-200',
                )}
                onClick={() => setSelectedNamespace(item.name)}
              >
                {item.name} · {item.total}
              </button>
            ))}
          </div>

          <div className='flex min-w-0 flex-1 flex-col'>
            <select
              aria-label='命名空间'
              className='select select-bordered select-sm mb-2 w-full text-xs sm:hidden'
              value={selectedNamespace}
              onChange={(event) => setSelectedNamespace(event.target.value)}
            >
              {namespaces.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} · {item.total}
                </option>
              ))}
            </select>
            {namespaceTags.length === 0 ? (
              <p className='text-xs opacity-60'>这个命名空间还没有标签</p>
            ) : (
              <div className='flex min-h-0 flex-wrap content-start gap-1.5 overflow-y-auto'>
                {namespaceTags.map((tag) => (
                  <button
                    key={`${tag.namespace}:${tag.name}`}
                    type='button'
                    aria-label={`${tag.name} · ${tag.count}`}
                    title='点击加入表达式；Shift 点击排除'
                    className='btn btn-xs h-6 min-h-6 rounded-full border-base-content/10 bg-base-200/60 px-2 font-normal'
                    onClick={(event) => handleTagClick(tag, event.shiftKey || event.altKey)}
                  >
                    <span className='truncate'>{tag.name}</span>
                    <span className='text-caption tabular-nums opacity-50'>{tag.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className='flex min-h-0 flex-1 flex-col border-t border-base-content/10 pt-2'>
          <h3 className='text-xs font-medium opacity-70'>结果</h3>
          {querying && results.length === 0 ? (
            <p className='mt-2 text-sm opacity-60'>正在查询…</p>
          ) : results.length === 0 ? (
            <p className='mt-2 text-sm opacity-60'>没有匹配的书</p>
          ) : (
            <ul className='mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto'>
              {results.map((book, index) => {
                const matchedTags = countMatchedTags(book, expression);
                return (
                  <li
                    key={`${book.id}-${index}`}
                    className='flex items-baseline justify-between gap-2 rounded-field px-1.5 py-1 text-sm'
                  >
                    <span className='truncate'>{book.title}</span>
                    <span className='shrink-0 text-caption opacity-60'>
                      {matchedTags} {expression.trim() ? '个匹配标签' : '个标签'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {matched > results.length && (
            <p className='mt-1.5 shrink-0 text-caption opacity-60'>
              只显示前 {results.length} 本，共 {matched} 本
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TagBrowserPanel;
