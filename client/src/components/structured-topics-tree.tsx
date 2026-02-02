import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const DEPTH_COLOR_CLASSES = [
  'border-sky-200 bg-sky-50',
  'border-emerald-200 bg-emerald-50',
  'border-amber-200 bg-amber-50',
  'border-violet-200 bg-violet-50',
];

const DEPTH_TEXT_CLASSES = [
  'text-sky-900',
  'text-emerald-900',
  'text-amber-900',
  'text-violet-900',
];

type TopicSegment = {
  timelineIndex?: number;
  isCurrent?: boolean;
  note?: string;
};

type StructuredTopic = {
  id?: string;
  parentId?: string | null;
  depth?: number;
  title?: string;
  summary?: string;
  brief_summary?: string;
  claims?: string[];
  decisions?: string[];
  actions?: string[];
  segments?: TopicSegment[];
};

type StructuredTopicsTreeProps = {
  topics: StructuredTopic[];
};

const fallbackId = (index: number) => `__topic-${index}`;

export function StructuredTopicsTree({ topics }: StructuredTopicsTreeProps) {
  const topicList = topics ?? [];

  const topicsById = useMemo(() => {
    const map = new Map<string, StructuredTopic>();
    topicList.forEach((topic) => {
      if (topic.id) {
        map.set(topic.id, topic);
      }
    });
    return map;
  }, [topicList]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpanded((prev) => {
      const next: Record<string, boolean> = {};
      topicList.forEach((topic, index) => {
        const key = topic.id ?? fallbackId(index);
        const hasCurrentSegment = topic.segments?.some((segment) => segment?.isCurrent) ?? false;
        next[key] = prev[key] ?? hasCurrentSegment;
      });
      return next;
    });
  }, [topicList]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const buildBreadcrumb = useCallback(
    (topic: StructuredTopic) => {
      if (!topic.parentId) return null;
      const chain: string[] = [];
      const visited = new Set<string>();
      let cursor: string | null | undefined = topic.parentId;

      while (cursor) {
        if (visited.has(cursor)) {
          break;
        }
        visited.add(cursor);
        const parent = topicsById.get(cursor);
        if (!parent) {
          break;
        }
        chain.push(parent.title ?? '無題トピック');
        cursor = parent.parentId ?? null;
      }

      if (chain.length === 0) {
        return null;
      }
      return chain.reverse().join(' > ');
    },
    [topicsById],
  );

  const renderTopics = useCallback(
    (parentId: string | null, prefix: string): ReactNode => {
      const siblings = topicList.filter((topic) => (topic.parentId ?? null) === parentId);
      if (siblings.length === 0) return null;

      return siblings.map((topic, siblingIndex) => {
        const sourceIndex = topicList.indexOf(topic);
        const key = topic.id ?? fallbackId(sourceIndex);
        const numberLabel = prefix ? `${prefix}.${siblingIndex + 1}` : `${siblingIndex + 1}`;
        const isExpanded = expanded[key] ?? false;
        const isCurrent = topic.segments?.some((segment) => segment?.isCurrent) ?? false;
        const childParentId = topic.id ?? key;
        const hasChildren = topicList.some(
          (candidate) => (candidate.parentId ?? null) === childParentId,
        );
        const childNodes = hasChildren ? renderTopics(childParentId, numberLabel) : null;
        const depth = typeof topic.depth === 'number' ? topic.depth : 0;
        const depthIndex = Math.min(depth, DEPTH_COLOR_CLASSES.length - 1);
        const depthTone = DEPTH_COLOR_CLASSES[depthIndex];
        const titleTone = DEPTH_TEXT_CLASSES[depthIndex];

        let preview = '';
        if (!isExpanded) {
          if (topic.claims && topic.claims.length > 0) {
            preview = topic.claims[0];
          } else if (topic.summary) {
            preview = topic.summary;
          } else if (topic.brief_summary) {
            preview = topic.brief_summary;
          }
        }

        const breadcrumb = buildBreadcrumb(topic);

        return (
          <div key={key} className="space-y-3">
            <div className={cn('rounded-2xl border px-4 py-4 shadow-sm shadow-slate-100', depthTone)}>
              <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-start gap-3 text-left"
              >
              <span
                className={cn(
                  'mt-1 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full border text-xs font-semibold',
                  isExpanded ? 'border-slate-400 text-slate-600' : 'border-slate-300 text-slate-400',
                )}
                aria-hidden
              >
                {isExpanded ? '-' : '+'}
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {numberLabel}
                  </span>
                  <span className={cn('font-semibold', titleTone)}>
                    {topic.title ?? `トピック ${numberLabel}`}
                  </span>
                  {isCurrent && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      今ここ
                    </span>
                  )}
                </div>
                {breadcrumb && (
                  <div className="text-xs text-slate-500">親系統: {breadcrumb}</div>
                )}
              </div>
              {typeof topic.depth === 'number' && (
                <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  深さ {topic.depth}
                </span>
              )}
            </button>

            {!isExpanded && preview && (
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {preview}
              </div>
            )}

            {isExpanded && (
              <div className="mt-4 space-y-4 border-t border-slate-200/80 pt-4">
                {topic.summary && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      概要
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{topic.summary}</p>
                  </div>
                )}

                {topic.brief_summary && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      要約
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{topic.brief_summary}</p>
                  </div>
                )}

                {topic.segments && topic.segments.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      議論の流れ
                    </div>
                    <ul className="mt-1 space-y-1 text-sm text-slate-700">
                      {topic.segments.map((segment, segIdx) => (
                        <li key={segIdx} className="flex items-start gap-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            {typeof segment.timelineIndex === 'number'
                              ? `#${segment.timelineIndex}`
                              : '-'}
                          </span>
                          <span>
                            {segment.note ?? '議論'}
                            {segment.isCurrent && (
                              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                今ここ
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {topic.claims && topic.claims.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      主張
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {topic.claims.map((claim, idx) => (
                        <li key={idx}>{claim}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {topic.decisions && topic.decisions.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      決定事項
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {topic.decisions.map((decision, idx) => (
                        <li key={idx}>{decision}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {topic.actions && topic.actions.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      TODO
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {topic.actions.map((action, idx) => (
                        <li key={idx}>{action}</li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            )}
            </div>
            {childNodes && (
              <div className="space-y-3 border-l border-slate-200/70 pl-4">
                {childNodes}
              </div>
            )}
          </div>
        );
      });
    },
    [buildBreadcrumb, expanded, topicList, toggle],
  );

  if (topicList.length === 0) {
    return null;
  }

  return <div className="flex flex-col gap-3">{renderTopics(null, '')}</div>;
}
