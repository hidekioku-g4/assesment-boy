import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SupportRecordSection = {
  id: string;
  title: string;
  placeholder?: string;
  helperText?: string;
  value: string;
  aiAppend?: string;
  updatedAt?: number | null;
};

export type SupportRecordPanelProps = {
  sections: SupportRecordSection[];
  onSectionChange: (id: string, value: string) => void;
  onSave?: () => void;
  onComplete?: () => void;
  onFinalize?: () => void;
  saveStatus?: 'idle' | 'running' | 'success' | 'error';
  finalizeStatus?: 'idle' | 'running' | 'success' | 'error';
  completeStatus?: 'idle' | 'running' | 'success' | 'error';
  isSaveDisabled?: boolean;
  isFinalizeDisabled?: boolean;
  isCompleteDisabled?: boolean;
  busy?: boolean;
  lastUpdatedAt?: number | null;
  className?: string;
};

const formatTimestamp = (timestamp?: number | null) => {
  if (!timestamp) return null;
  try {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return null;
  }
};

export function SupportRecordPanel({
  sections,
  onSectionChange,
  onSave,
  onComplete,
  onFinalize,
  saveStatus = 'idle',
  finalizeStatus = 'idle',
  completeStatus = 'idle',
  isSaveDisabled = false,
  isFinalizeDisabled = false,
  isCompleteDisabled = false,
  busy = false,
  lastUpdatedAt,
  className,
}: SupportRecordPanelProps) {
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const resizeTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    sections.forEach((section) => {
      resizeTextarea(textareaRefs.current[section.id] ?? null);
    });
  }, [sections, resizeTextarea]);

  return (
    <section
      className={cn(
        'flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm shadow-slate-100',
        className,
      )}
    >
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">支援記録ドラフト</p>
            <h2 className="text-lg font-semibold text-slate-900">手書きメモと AI メモを統合</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {lastUpdatedAt && (
              <span className="text-xs text-slate-500">
                最終更新: <span className="font-medium text-slate-600">{formatTimestamp(lastUpdatedAt)}</span>
              </span>
            )}
            {(onSave || onComplete || onFinalize) && (
              <div className="flex flex-wrap items-center gap-2">
                {onSave && (
                  <Button
                    size="sm"
                    onClick={onSave}
                    disabled={isSaveDisabled || saveStatus === 'running'}
                    variant={saveStatus === 'success' ? 'secondary' : 'default'}
                  >
                    {saveStatus === 'running'
                      ? '保存中…'
                      : saveStatus === 'success'
                        ? '保存済み'
                        : saveStatus === 'error'
                          ? '再試行'
                          : 'ドラフトを保存'}
                  </Button>
                )}
                {onComplete && (
                  <Button
                    size="sm"
                    onClick={onComplete}
                    disabled={isCompleteDisabled || completeStatus === 'running'}
                    variant={completeStatus === 'success' ? 'secondary' : 'default'}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {finalizeStatus === 'running'
                    ? '最終クリーニング中…'
                    : completeStatus === 'running'
                      ? '送信中…'
                      : completeStatus === 'success'
                        ? '送信済み'
                        : completeStatus === 'error'
                          ? '再送信'
                          : '完了して送信'}
                </Button>
              )}
                {onFinalize && (
                  <Button
                    size="sm"
                    onClick={onFinalize}
                    disabled={isFinalizeDisabled || finalizeStatus === 'running'}
                    variant={finalizeStatus === 'success' ? 'secondary' : 'outline'}
                  >
                    {finalizeStatus === 'running'
                      ? '最終クリーニング中…'
                      : finalizeStatus === 'success'
                        ? '最終クリーニング済み'
                        : finalizeStatus === 'error'
                          ? '再クリーニング'
                          : '最終クリーニング'}
                  </Button>
                )}
                {saveStatus === 'error' && (
                  <span className="text-[11px] font-medium text-red-600">保存に失敗しました</span>
                )}
                {saveStatus === 'success' && (
                  <span className="text-[11px] font-medium text-emerald-600">最新のドラフトを保存しました</span>
                )}
                {completeStatus === 'success' && (
                  <span className="text-[11px] font-medium text-emerald-600">BigQueryへ送信しました</span>
                )}
                {finalizeStatus === 'success' && (
                  <span className="text-[11px] font-medium text-emerald-600">最終クリーニングを反映しました</span>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-600">
          手書きメモは残しつつ、AI メモは自動で追加されます。保存時に手書き + AI メモを合体します。
        </p>
        {busy && (
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
            AI メモを更新中…
          </div>
        )}
      </header>

      <div className="space-y-6">
        {sections.map((section) => {
          const sectionUpdatedAt = formatTimestamp(section.updatedAt);
          const aiAppend = (section.aiAppend ?? '').trim();
          return (
            <article
              key={section.id}
              className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                  {section.helperText && <p className="text-xs text-slate-500">{section.helperText}</p>}
                </div>
                {sectionUpdatedAt && (
                  <span className="text-[11px] text-slate-400">更新: {sectionUpdatedAt}</span>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">AIメモ</p>
                {aiAppend ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">{aiAppend}</p>
                ) : (
                  <p className="mt-2 text-xs text-emerald-700/70">AIメモはまだありません。</p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">手書きメモ</p>
                <textarea
                  ref={(el) => {
                    textareaRefs.current[section.id] = el;
                    resizeTextarea(el);
                  }}
                  rows={1}
                  value={section.value}
                  onChange={(event) => onSectionChange(section.id, event.target.value)}
                  onInput={(event) => resizeTextarea(event.currentTarget)}
                  placeholder={section.placeholder}
                  className="min-h-[2.5rem] w-full resize-none overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-inner focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/60"
                />
              </div>
            </article>
          );
        })}
      </div>

      {!sections.length && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          表示する項目がまだ設定されていません。
        </div>
      )}
    </section>
  );
}
