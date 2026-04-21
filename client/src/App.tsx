import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AccountInfo } from '@azure/msal-browser';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import { Button } from '@/components/ui/button';

import { ScrollArea } from '@/components/ui/scroll-area';

import { cn } from '@/lib/utils';
import {
  MSAL_ENABLED,
  MSAL_LOGIN_SCOPES,
  MSAL_REDIRECT_URI,
  ensureMsalInitialized,
  getMsalAccount,
  msalInstance,
} from '@/lib/msal';
import { fetchWithAuth, getWsTokenParam } from '@/lib/fetchWithAuth';
import { preloadAizuchi, pickInstantAizuchi, playAizuchiBuffer, findAizuchiBuffer, isAizuchiReady } from '@/lib/aizuchi';
import { SupportRecordPanel, type SupportRecordSection } from '@/features/support-record/support-record-panel';
import { InterviewPracticePanel } from '@/features/interview-practice/interview-practice-panel';
import {
  FaceAnalysisRecorder,
  TalkingAvatar,
  Live2DAvatar,
  SimpleAvatar,
  SessionFeedback,
  type AnalysisSummary,
  type RealtimeAnalysis,
  type ExpressionType,
} from '@/features/face-analysis';


type TranscriptMessage = {
  id: string;
  text: string;
  isFinal: boolean;
  speaker?: number;
  ts?: number;
  lowConfidence?: LowConfidenceWord[];
  confidenceAvg?: number | null;
};

type LowConfidenceWord = {
  word: string;
  confidence: number;
  start?: number;
  end?: number;
};


type MemoState = {
  fact: string;
  interpretation: string;
  action: string;
};

type Participant = {
  id: string;
  name: string;
  nameKana?: string;
  email?: string;
  department?: string;
  extras?: string[];
};

type SupportRecordDraftState = Record<
  string,
  {
    value: string;
    suggestion: string | null;

    updatedAt: number | null;

  }

>;



type SupportRecordSectionDefinition = {
  id: string;
  title: string;
  placeholder: string;
  helperText: string;
};

type DesktopSource = {
  id: string;
  name: string;
  thumbnail?: string;
  appIcon?: string;
};


const BASE_SUPPORT_RECORD_TEMPLATE: SupportRecordSectionDefinition[] = [

  {

    id: 'session_overview',

    title: '面談サマリー',

    helperText: '面談で共有された主な話題や背景、利用者の気持ちをまとめます。',

    placeholder:

      '例: 利用者は通所ペースを週3日に増やす方針を希望し、面談では直近の課題と成功体験を共有。',

  },

  {

    id: 'current_status',

    title: '現状・課題',

    helperText: '就労準備に向けた強み・困りごと・生活状況など、支援員が把握した最新情報を記載します。',

    placeholder:

      '例: 朝の起床は9時前後で安定。生活リズムは改善傾向だが、週後半は疲れが出やすい。',

  },

  {

    id: 'support_plan',

    title: '支援方針・支援内容',

    helperText: '面談で合意した支援方針や伴走内容、調整事項を整理します。',

    placeholder:

      '例: 朝礼前ストレッチと日報のチェックを継続。次回までに企業見学の日程案を支援員が提示する。',

  },

  {

    id: 'next_actions',

    title: '次回までのアクション',

    helperText: '利用者・支援員それぞれの宿題や確認事項を列挙します。',

    placeholder:

      '例: 利用者は1週間の行動記録をメモ。支援員は面接練習の候補日を共有。',

  },

  {

    id: 'shared_notes',

    title: '共有・特記事項',

    helperText: '医療や家族連携、注意が必要な事項、リスクなどを整理して共有します。',

    placeholder:

      '例: 通院日が来月より水曜午前に変更。家族との三者面談を検討中。',

  },

];



type MeetingTypeDefinition = {
  id: string;
  name: string;
  timing: string;
  frequency: string;
  purpose: string;
  participants: string;
  sections: SupportRecordSectionDefinition[];
};

type SupportRecordConfig = {
  meetingTypes: MeetingTypeDefinition[];
};

type MeetingTypeStringField = 'id' | 'name' | 'timing' | 'frequency' | 'purpose' | 'participants';

const applySectionOverrides = (
  base: SupportRecordSectionDefinition[],
  overrides?: Record<string, Partial<SupportRecordSectionDefinition>>,
): SupportRecordSectionDefinition[] =>
  base.map((section) => ({
    ...section,
    ...(typeof overrides?.[section.id] === 'object'
      ? (Object.entries(overrides?.[section.id] ?? {}).reduce((acc, [key, value]) => {
          if (typeof value === 'string' && value.trim()) {
            acc[key as keyof SupportRecordSectionDefinition] = value.trim();
          }
          return acc;
        }, {} as Partial<SupportRecordSectionDefinition>))
      : {}),
  }));

const MEETING_TYPES: MeetingTypeDefinition[] = [
  {

    id: 'assessment',

    name: 'アセスメント面談',

    timing: '利用開始時・計画更新時',

    frequency: '必要なタイミングで実施',
    purpose: '本人の心身状況や希望、生活環境を把握・分析する。',
    participants: 'サービス管理責任者、利用者',
    sections: applySectionOverrides(BASE_SUPPORT_RECORD_TEMPLATE, {
      session_overview: {

        helperText: 'アセスメントで確認した背景・希望・気づきの要点を整理します。',

        placeholder:

          '例: 利用開始前の体調や生活リズム、就労に向けて重視している価値観についてヒアリング。家族の意向や支援歴も共有。',

      },

      current_status: {

        helperText: '心身の状態・生活リズム・強みと課題など、アセスメント結果をまとめます。',

        placeholder:

          '例: 睡眠は6時間前後、週2〜3回の通所で体力が安定。集中時間は40分程度で、得意な作業は接客。課題は朝の起床と情報整理。',

      },

      support_plan: {

        helperText: '今後の支援で優先したいテーマや必要な環境整備を記載します。',

        placeholder:

          '例: 生活リズムの安定化支援、適性評価、コミュニケーション練習を3ヶ月目標で計画。必要に応じ医療機関と連携。',

      },

    }),
  },
  {

    id: 'individual_support',

    name: '個別支援会議',

    timing: '個別支援計画の作成・変更時',
    frequency: '計画見直しの度に実施',
    purpose: '個別支援計画の原案を検討し、内容を確定する。',
    participants: 'サービス管理責任者、担当職員、利用者、必要に応じて家族等',
    sections: applySectionOverrides(BASE_SUPPORT_RECORD_TEMPLATE, {
      session_overview: {

        helperText: '個別支援計画案に沿って、議論したポイントをまとめます。',

        placeholder:

          '例: 目標3本柱（生活リズム／職業スキル／健康管理）を確認。本人の希望を踏まえて実現ステップを調整。',

      },

      support_plan: {

        helperText: '計画案に盛り込む支援方針・役割分担を明確に記載します。',

        placeholder:

          '例: 生活面は支援員Aがモニタリング、職業スキルは職業指導員Bが週1レッスン、医療面は家族と共有して受診情報を提供。',

      },

      shared_notes: {

        helperText: '決定事項や関係者との共有事項、注意点を記載します。',

        placeholder:

          '例: 3ヶ月後の計画見直しを設定。家族へ計画内容を郵送予定。支援会議議事録を来週までに共有。',

      },

      next_actions: {

        helperText: '計画推進のためのタスク・締切を列挙します。',

        placeholder:

          '例: 利用者→日報フォーマットを試行、支援員→週次面談を実施、家族→送迎体制を確認して連絡。',

      },

    }),
  },
  {

    id: 'monitoring',

    name: 'モニタリング面談',

    timing: '最低3ヶ月に1回（必要に応じて毎月）',
    frequency: '定期',
    purpose: '計画の実施状況や達成度を確認し、継続・変更を判断する。',
    participants: 'サービス管理責任者、利用者',
    sections: applySectionOverrides(BASE_SUPPORT_RECORD_TEMPLATE, {
      session_overview: {

        helperText: '前回から今回までの取り組み状況と変化をまとめます。',

        placeholder:

          '例: 起床時刻は平均7:30で定着。通所日数は月12回→14回に増加。面接練習を1回実施し、自信がついたと発言。',

      },

      next_actions: {

        helperText: '次回モニタリングまでに確認したい行動や目標を列挙します。',

        placeholder:

          '例: 朝のルーティン記録を継続。次回までに職業講座へ1回参加。支援員は実習先候補を2件提示する。',

      },

      support_plan: {

        helperText: '継続・変更する支援内容やサポート強化ポイントを記載します。',

        placeholder:

          '例: 面接練習の頻度を隔週→毎週へ変更。通所リズム安定に合わせて通勤訓練を提案。',

      },

    }),
  },
  {

    id: 'service_meeting',

    name: 'サービス担当者会議',

    timing: '計画作成・更新時（計画相談支援を利用する場合）',
    frequency: '計画の更新時',
    purpose: '相談支援専門員主催の会議で連携と役割分担を確認する。',
    participants: '相談支援専門員、サービス管理責任者、利用者、その他関係者',
    sections: applySectionOverrides(BASE_SUPPORT_RECORD_TEMPLATE, {
      session_overview: {

        helperText: '会議で共有された背景・目的・相談内容を記します。',

        placeholder:

          '例: 計画相談支援の更新に向け、就労移行から一般就労へのステップを整理。就労継続B型も選択肢として検討。',

      },

      shared_notes: {

        helperText: '関係機関との連携内容や役割分担、合意事項を詳しく記します。',

        placeholder:

          '例: 相談支援専門員→ハローワーク連携、事業所→職場実習調整、家族→生活支援体制の確認。',

      },

      support_plan: {

        helperText: '各機関・担当者が担う支援内容とスケジュールを明確にします。',

        placeholder:

          '例: 4月中に合同訪問を実施し、5月から就労アセスメントへ移行。週次で進捗をチャット共有。',

      },

    }),
  },
  {

    id: 'case_meeting',

    name: 'ケース会議',

    timing: '必要時（随時）',
    frequency: '必要に応じて開催',
    purpose: '就職活動・トラブル・医療連携など課題が生じた際に情報共有と方針決定を行う。',
    participants: '関係機関（ハローワーク、病院等）、職員、利用者',
    sections: applySectionOverrides(BASE_SUPPORT_RECORD_TEMPLATE, {
      session_overview: {

        helperText: '発生した課題や背景、共有された情報を整理します。',

        placeholder:

          '例: 職場でのトラブルにより就労継続が困難との連絡。本人の状況と企業側の要望を整理し、医療情報も共有。',

      },

      support_plan: {

        helperText: '合意した対応策・役割・期限を箇条書きでまとめます。',

        placeholder:

          '例: ①企業訪問で状況確認（支援員A、来週火曜）、②医師と情報連携（家族経由、水曜）、③必要なら部署変更を提案（企業側）。',

      },

      shared_notes: {

        helperText: '関係機関への連絡事項やリスク管理ポイントを記録します。',

        placeholder:

          '例: 情緒不安定時の対応マニュアルを共有。連絡窓口を一本化。緊急時は家族→医療→事業所の順で連絡。',

      },

      next_actions: {

        helperText: '緊急度・優先度の高いアクションを明確にします。',

        placeholder:

          '例: 3日以内にケースカンファレンス結果を関係者へ送付。次回会議日を2週間後に設定。',

      },

    }),
  },
];

const DEFAULT_SUPPORT_RECORD_CONFIG: SupportRecordConfig = {
  meetingTypes: MEETING_TYPES,
};

const getSupportRecordTemplate = (
  meetingTypeId: string | null,
  meetingTypes: MeetingTypeDefinition[],
): SupportRecordSectionDefinition[] => {
  const meetingType = meetingTypes.find((type) => type.id === meetingTypeId) ?? meetingTypes[0] ?? null;
  return meetingType?.sections ?? [];
};

const createInitialSupportRecordDraft = (
  template: SupportRecordSectionDefinition[] = DEFAULT_SUPPORT_RECORD_CONFIG.meetingTypes[0]?.sections ?? [],
): SupportRecordDraftState => {
  const initialEntries = template.map((section) => [

    section.id,

    { value: '', suggestion: null, updatedAt: null },

  ]);

  return Object.fromEntries(initialEntries);

};



const STORAGE_VERSION = 1;

const NO_RETENTION_MODE = (import.meta.env.VITE_NO_RETENTION_MODE ?? 'true') !== 'false';

const KEYWORDS_STORAGE_KEY = 'meeting-tool:keywords';

const MEMOS_STORAGE_KEY = 'meeting-tool:memos';

const SUPPORT_RECORD_ID_STORAGE_KEY = 'meeting-tool:session-support-record-id';
const MEETING_TYPE_STORAGE_KEY = 'meeting-tool:meeting-type';
const INITIAL_SETTINGS_STORAGE_KEY = 'meeting-tool:initial-settings';
const TRANSIENT_STORAGE_KEYS = [
  KEYWORDS_STORAGE_KEY,
  MEMOS_STORAGE_KEY,
  SUPPORT_RECORD_ID_STORAGE_KEY,
  MEETING_TYPE_STORAGE_KEY,
  INITIAL_SETTINGS_STORAGE_KEY,
];
const DEFAULT_STREAM_CODEC = 'linear16';

const STREAM_CODEC = import.meta.env.VITE_STREAM_CODEC || DEFAULT_STREAM_CODEC;

const DEFAULT_AUTO_CLEAN_INTERVAL_MS = 15000;
const AUTO_CLEAN_INTERVAL_MS = Number(import.meta.env.VITE_AUTO_CLEAN_INTERVAL_MS ?? DEFAULT_AUTO_CLEAN_INTERVAL_MS);
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.75;
const LOW_CONFIDENCE_THRESHOLD = Number(
  import.meta.env.VITE_LOW_CONFIDENCE_THRESHOLD ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD,
);
const DEFAULT_UNCERTAIN_HINT_LIMIT = 200;
const UNCERTAIN_HINT_LIMIT = Number(
  import.meta.env.VITE_UNCERTAIN_HINT_LIMIT ?? DEFAULT_UNCERTAIN_HINT_LIMIT,
);
const DEFAULT_UNCERTAIN_HINT_LINE_LIMIT = 60;
const UNCERTAIN_HINT_LINE_LIMIT = Number(
  import.meta.env.VITE_UNCERTAIN_HINT_LINE_LIMIT ?? DEFAULT_UNCERTAIN_HINT_LINE_LIMIT,
);
const DEFAULT_UNCERTAIN_HINT_CHAR_LIMIT = 4000;
const UNCERTAIN_HINT_CHAR_LIMIT = Number(
  import.meta.env.VITE_UNCERTAIN_HINT_CHAR_LIMIT ?? DEFAULT_UNCERTAIN_HINT_CHAR_LIMIT,
);
const DEFAULT_AUDIO_PREBUFFER_MS = 1500; // 頭切れ対策: 600→1500ms
const AUDIO_PREBUFFER_MS = Number(import.meta.env.VITE_AUDIO_PREBUFFER_MS ?? DEFAULT_AUDIO_PREBUFFER_MS);
const DEFAULT_FINALIZE_TIMEOUT_MS = 2500;
const FINALIZE_TIMEOUT_MS = Number(
  import.meta.env.VITE_FINALIZE_TIMEOUT_MS ?? DEFAULT_FINALIZE_TIMEOUT_MS,
);
const DEFAULT_CLEAN_PREVIEW_INTERVAL_MS = 2000;
const CLEAN_PREVIEW_INTERVAL_MS = Number(
  import.meta.env.VITE_CLEAN_PREVIEW_INTERVAL_MS ?? DEFAULT_CLEAN_PREVIEW_INTERVAL_MS,
);
const SUPPORT_RECORD_POST_RETRIES = Number(import.meta.env.VITE_SUPPORT_RECORD_POST_RETRIES ?? 2);



const sentenceTerminators = new Set(['。', '．', '！', '!', '？', '?', '…', '.', '！？', '?!']);



const isStringArray = (value: unknown): value is string[] =>

  Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);



const splitTranscriptSegments = (input: string): string[] => {
  if (!input) return [];
  const normalized = input.replace(/\r/g, '');
  const segments: string[] = [];
  let buffer = '';

  for (const char of normalized) {

    if (char === '\n') {

      if (buffer.trim()) {

        segments.push(buffer.replace(/\s+/g, ' ').trim());

      }

      buffer = '';

      continue;

    }

    buffer += char;

    if (sentenceTerminators.has(char)) {

      if (buffer.trim()) {

        segments.push(buffer.replace(/\s+/g, ' ').trim());

      }

      buffer = '';

    }

  }

  if (buffer.trim()) {

    segments.push(buffer.replace(/\s+/g, ' ').trim());

  }

  return segments;
};

const normalizeLowConfidenceWords = (raw: unknown): LowConfidenceWord[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const word = typeof item?.word === 'string' ? item.word.trim() : '';
      const confidence = typeof item?.confidence === 'number' ? item.confidence : null;
      const start = typeof item?.start === 'number' ? item.start : undefined;
      const end = typeof item?.end === 'number' ? item.end : undefined;
      if (!word || confidence === null) return null;
      return { word, confidence, start, end };
    })
    .filter(Boolean) as LowConfidenceWord[];
};

const distributeLowConfidence = (segments: string[], words: LowConfidenceWord[]) => {
  if (!segments.length) return [];
  if (!words.length) return segments.map(() => []);
  const buckets: LowConfidenceWord[][] = segments.map(() => []);
  let cursor = 0;

  words.forEach((entry) => {
    const token = entry.word;
    let placed = false;
    for (let i = cursor; i < segments.length; i += 1) {
      if (segments[i].includes(token)) {
        buckets[i].push(entry);
        cursor = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      buckets[0].push(entry);
    }
  });

  return buckets;
};

const buildUncertainHints = (list: TranscriptMessage[]) => {
  let lines: string[] = [];
  let wordCount = 0;

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (!msg?.isFinal) continue;
    const words = (msg.lowConfidence ?? []).filter(
      (entry) => typeof entry.confidence === 'number' && entry.confidence < LOW_CONFIDENCE_THRESHOLD,
    );
    if (words.length === 0) continue;

    const unique: LowConfidenceWord[] = [];
    const seen = new Set<string>();
    words.forEach((entry) => {
      const key = entry.word;
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(entry);
    });

    if (unique.length === 0) continue;

    const preview = msg.text.length > 180 ? `${msg.text.slice(0, 180)}…` : msg.text;
    const detail = unique
      .slice(0, Math.max(1, UNCERTAIN_HINT_LIMIT - wordCount))
      .map((entry) => `${entry.word}(${entry.confidence.toFixed(2)})`)
      .join(', ');

    lines.push(`${lines.length + 1}. ${preview}\n   ? ${detail}`);
    wordCount += unique.length;

    if (wordCount >= UNCERTAIN_HINT_LIMIT || lines.length >= UNCERTAIN_HINT_LINE_LIMIT) {
      break;
    }
  }

  if (lines.length === 0) return '';
  let payload = lines.join('\n');
  if (payload.length > UNCERTAIN_HINT_CHAR_LIMIT) {
    payload = `${payload.slice(0, UNCERTAIN_HINT_CHAR_LIMIT)}…`;
  }
  return payload;
};

const mergeSupportRecordText = (manual: string, aiAppend: string | null): string => {
  const manualText = typeof manual === 'string' ? manual.trim() : '';
  const aiText = typeof aiAppend === 'string' ? aiAppend.trim() : '';
  if (!manualText) return aiText;
  if (!aiText) return manualText;
  if (manualText.includes(aiText)) return manualText;
  return `${manualText}\n\n${aiText}`;
};

type DraftReplaceDirective = {
  from: string;
  to: string;
};

const normalizeReplaceKey = (value: string) =>
  value.replace(/\s+/g, '').replace(/[.…]+$/g, '').trim();

const parseDraftReplaceText = (rawText: string) => {
  const lines = rawText.split(/\r?\n/);
  const replacements: DraftReplaceDirective[] = [];
  const cleanedLines: string[] = [];

  lines.forEach((line) => {
    const replaceMatch = line.match(/^(\s*)([-*・：:]*)\s*replace\s+(.+)$/i);
    if (!replaceMatch) {
      cleanedLines.push(line);
      return;
    }

    const indent = replaceMatch[1] ?? '';
    const prefix = replaceMatch[2] ?? '';
    const leading = prefix ? `${indent}${prefix.trimEnd()} ` : indent;
    const body = replaceMatch[3].trim();

    let replacement: DraftReplaceDirective | null = null;
    let nextLine = body;

    const arrowMatch = body.match(/^(.+?)\s*(?:=>|→)\s*(.+)$/);
    if (arrowMatch) {
      replacement = { from: arrowMatch[1].trim(), to: arrowMatch[2].trim() };
      nextLine = replacement.to;
    } else {
      const colonMatch = body.match(/^(.+?)(?:：|:)\s+(.+)$/);
      if (colonMatch) {
        replacement = { from: colonMatch[1].trim(), to: colonMatch[2].trim() };
        nextLine = replacement.to;
      } else {
        const ellipsisMatch = body.match(/^(.+?(?:…|\.{3}))\s+(.+)$/);
        if (ellipsisMatch) {
          replacement = { from: ellipsisMatch[1].trim(), to: ellipsisMatch[2].trim() };
          nextLine = replacement.to;
        }
      }
    }

    if (replacement) {
      replacements.push(replacement);
    }
    cleanedLines.push(`${leading}${nextLine}`);
  });

  return {
    cleanedText: cleanedLines.join('\n').trim(),
    replacements,
  };
};

const applyReplaceDirectives = (baseText: string, replacements: DraftReplaceDirective[]) => {
  if (!baseText || replacements.length === 0) {
    return { text: baseText, changed: false };
  }

  const lines = baseText.split(/\r?\n/);
  const entries = lines.map((line) => {
    const match = line.match(/^(\s*[-*・：:]*)\s*(.*)$/);
    const prefix = match?.[1] ?? '';
    const content = match?.[2] ?? '';
    return { prefix, content, original: line };
  });
  const existingKeys = new Set(entries.map((entry) => normalizeReplaceKey(entry.content)));

  let changed = false;

  replacements.forEach(({ from, to }) => {
    const fromKey = normalizeReplaceKey(from);
    if (!fromKey) return;

    let replaced = false;
    for (let i = 0; i < entries.length; i += 1) {
      const lineKey = normalizeReplaceKey(entries[i].content);
      if (!lineKey) continue;
      if (lineKey === fromKey || lineKey.startsWith(fromKey)) {
        const leading = entries[i].prefix ? `${entries[i].prefix.trimEnd()} ` : '';
        entries[i] = {
          prefix: entries[i].prefix,
          content: to,
          original: `${leading}${to}`,
        };
        existingKeys.add(normalizeReplaceKey(to));
        replaced = true;
        changed = true;
        break;
      }
    }

    if (!replaced) {
      const toKey = normalizeReplaceKey(to);
      if (toKey && !existingKeys.has(toKey)) {
        entries.push({ prefix: '', content: to, original: to });
        existingKeys.add(toKey);
        changed = true;
      }
    }
  });

  return {
    text: entries.map((entry) => entry.original).join('\n'),
    changed,
  };
};

const splitSupportRecordText = (combined: string, aiAppend: string | null): string => {
  const combinedText = typeof combined === 'string' ? combined.trimEnd() : '';
  const aiText = typeof aiAppend === 'string' ? aiAppend.trim() : '';
  if (!aiText) return combinedText;
  const suffixes = [`\n\n${aiText}`, `\n${aiText}`, aiText];
  for (const suffix of suffixes) {
    if (combinedText.endsWith(suffix)) {
      return combinedText.slice(0, combinedText.length - suffix.length).trimEnd();
    }
  }
  return combinedText;
};

const RETRYABLE_COMPLETE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const computeRetryDelay = (attempt: number, baseMs = 750, maxMs = 5000) => {
  const jitter = Math.random() * baseMs;
  return Math.min(maxMs, baseMs * Math.pow(2, attempt) + jitter);
};

const FATAL_ERROR_MESSAGE = '致命的なエラーが発生しました。管理者に連絡してください。';

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object');

const isFatalErrorPayload = (payload: unknown) => {
  if (!isRecordObject(payload)) return false;
  if (payload.retryable === false) return true;
  const error = typeof payload.error === 'string' ? payload.error.trim() : '';
  if (!error) return false;
  return error === 'missing_export_config' || error === 'Gemini API key not configured';
};

const readErrorPayload = async (response: Response) => {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const buildApiErrorMessage = (payload: unknown, fallback: string) => {
  if (isFatalErrorPayload(payload)) return FATAL_ERROR_MESSAGE;
  if (isRecordObject(payload)) {
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (message) return message;
    const error = typeof payload.error === 'string' ? payload.error.trim() : '';
    if (error && !['gemini_error', 'failed_to_generate_agenda', 'failed_to_complete_support_record'].includes(error)) {
      return error;
    }
  }
  return fallback;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type ChatStatus = 'idle' | 'running' | 'error';

const createChatId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const CHAT_STORAGE_KEY_PREFIX = 'meeting-tool:chat:';
const CHAT_STORAGE_MAX_MESSAGES = 80;
const CHAT_CONTEXT_MAX_MESSAGES = 30;
const CHAT_CONTEXT_MESSAGE_MAX_CHARS = 800;

const getChatDateKey = () => {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
};

const getChatStorageKey = () => `${CHAT_STORAGE_KEY_PREFIX}${getChatDateKey()}`;

const normalizeStoredChat = (raw: unknown): ChatMessage[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const role = entry?.role === 'assistant' ? 'assistant' : entry?.role === 'user' ? 'user' : null;
      const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
      if (!role || !text) return null;
      const id = typeof entry?.id === 'string' && entry.id.trim().length > 0 ? entry.id : createChatId();
      return { id, role, text };
    })
    .filter(Boolean) as ChatMessage[];
};

const loadChatMessages = (key: string): ChatMessage[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    return normalizeStoredChat(JSON.parse(raw));
  } catch {
    return [];
  }
};

const saveChatMessages = (key: string, messages: ChatMessage[]) => {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = messages.slice(-CHAT_STORAGE_MAX_MESSAGES);
    window.localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors
  }
};

const buildChatContext = (messages: ChatMessage[]) =>
  messages
    .filter((entry) => entry.text.trim().length > 0)
    .slice(-CHAT_CONTEXT_MAX_MESSAGES)
    .map((entry) => ({
      role: entry.role,
      text: entry.text.trim().slice(0, CHAT_CONTEXT_MESSAGE_MAX_CHARS),
    }));

const readChatError = async (response: Response) => {
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
    if (payload && typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
  } catch {
    // ignore parse errors
  }
  return `chat failed: ${response.status}`;
};

function ChatPanel({
  className,
  disableVoice = false,
  onReauthRequired,
  context = '',
  initialMessage = null,
  userInfo = {},
  msAccountId = '',
  prepareVoice = false,
}: {
  className?: string;
  disableVoice?: boolean;
  onReauthRequired?: () => void;
  context?: string;
  initialMessage?: string | null;
  userInfo?: { name?: string };
  msAccountId?: string;
  prepareVoice?: boolean;
}) {
  const initialStorageKey = getChatStorageKey();
  const storageKeyRef = useRef(initialStorageKey);
  // 起動時は過去のログを読み込まない（新鮮な状態で開始）
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  chatMessagesRef.current = messages;
  const [chatStarted, setChatStarted] = useState(false);
  const [chatEnding, setChatEnding] = useState(false);

  // 連続出席ストリーク
  const [streakDays, setStreakDays] = useState(0);
  const updateStreak = useCallback(() => {
    try {
      const key = 'assess-kun:streak';
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      const jstDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const today = jstDate(new Date());
      const yesterday = jstDate(new Date(Date.now() - 86400000));
      if (stored.lastDate === today) {
        setStreakDays(stored.count || 1);
        return stored.count || 1;
      }
      const newCount = stored.lastDate === yesterday ? (stored.count || 0) + 1 : 1;
      localStorage.setItem(key, JSON.stringify({ lastDate: today, count: newCount }));
      setStreakDays(newCount);
      return newCount;
    } catch { return 0; }
  }, []);
  // セッション保存用
  const sessionIdRef = useRef<string | null>(null);
  const lastSavedMessageCountRef = useRef(0);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSavedAtRef = useRef(0);
  const autoSavingRef = useRef(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'sending' | 'error'>('idle');
  const [voiceInitStatus, setVoiceInitStatus] = useState<'idle' | 'warming' | 'ready'>('idle');
  const [voicePreview, setVoicePreview] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsSpeed, setTtsSpeed] = useState(1.5);
  const [ttsVoice, setTtsVoice] = useState('ja-JP-Chirp3-HD-Leda'); // Chirp 3 HD 女性・優しい
  const [ttsProvider, setTtsProvider] = useState<'google' | 'gemini'>('google'); // A/B比較用
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<{ id: string; name: string }[]>([]);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  // AIモデル切替（ABテスト用）
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  // 顔分析関連（デフォルトON）
  const [faceAnalysisEnabled, setFaceAnalysisEnabled] = useState(true);
  const [faceAnalysisSummary, setFaceAnalysisSummary] = useState<AnalysisSummary | null>(null);
  const [showSessionFeedback, setShowSessionFeedback] = useState(false);
  const [sessionInsight, setSessionInsight] = useState<{ emoji: string; title: string; body: string; encouragement: string } | null>(null);
  const [faceAnalysisError, setFaceAnalysisError] = useState<string | null>(null);
  const [faceAnalysisDebugMode, setFaceAnalysisDebugMode] = useState(false);
  const [faceAnalysisRealtime, setFaceAnalysisRealtime] = useState<{
    eyeContact: boolean;
    gazeX: number;
    gazeY: number;
    expression: string;
  } | null>(null);
  const [debugPinInput, setDebugPinInput] = useState('');
  // Live2Dアバター設定
  const [avatarZoom, setAvatarZoom] = useState(3.0);
  const [avatarOffsetY, setAvatarOffsetY] = useState(-20);
  const [showAvatarSettings, setShowAvatarSettings] = useState(false);
  const [avatarExpression, setAvatarExpression] = useState<ExpressionType>('neutral');
  const [earOnlyMode, setEarOnlyMode] = useState(false); // 耳だけモード（文字非表示、キャラ中央）

  // テキストから返答モードタグを解析して除去（[mode:aizuchi|respond|silent]）
  const parseMode = useCallback((text: string): { mode: 'aizuchi' | 'respond' | 'silent'; cleanText: string } => {
    const match = text.match(/^\[mode:(aizuchi|respond|silent)\]\s*/);
    if (match) {
      return {
        mode: match[1] as 'aizuchi' | 'respond' | 'silent',
        cleanText: text.slice(match[0].length).trim(),
      };
    }
    return { mode: 'respond', cleanText: text };
  }, []);

  // テキストから表情タグを解析して除去
  const parseExpression = useCallback((text: string): { expression: ExpressionType; cleanText: string } => {
    const match = text.match(/^\[表情:(\w+)\]\s*/);
    if (match) {
      const exp = match[1] as typeof avatarExpression;
      const validExpressions = ['neutral', 'smile', 'happy', 'think', 'surprise', 'sad', 'shy'];
      return {
        expression: validExpressions.includes(exp) ? exp : 'neutral',
        cleanText: text.slice(match[0].length).trim()
      };
    }
    return { expression: 'neutral', cleanText: text };
  }, []);

  // 読み仮名を除去（UI表示用）: 漢字《ふりがな》 → 漢字
  const stripFurigana = useCallback((text: string): string => {
    // 完全な《ふりがな》を除去
    let result = text.replace(/《[^》]*》/g, '');
    // ストリーミング中の不完全な《... を末尾から除去
    result = result.replace(/《[^》]*$/, '');
    return result;
  }, []);

  // 入力モード: 'auto-smart'(1.5秒+文末), 'auto-slow'(2秒), 'manual'(手動), 'typing'(タイピングのみ)
  const [inputMode, setInputMode] = useState<'auto-smart' | 'auto-slow' | 'manual' | 'typing'>('auto-smart');
  const endRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const prebufferRef = useRef<ArrayBuffer[]>([]);
  const transcriptRef = useRef<string[]>([]);
  const finalizeTimerRef = useRef<number | null>(null);
  const finalizeOnceRef = useRef(false);
  const autoSendTimerRef = useRef<number | null>(null);
  const autoSendRetryRef = useRef(0); // auto-smartモードでの再試行回数
  const voicePreviewRef = useRef('');
  const pendingVoiceTranscriptRef = useRef<string | null>(null);
  const ttsSpeakingRef = useRef(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);
  const ttsVoiceRef = useRef(ttsVoice);
  const ttsSpeedRef = useRef(ttsSpeed);
  const ttsProviderRef = useRef(ttsProvider);
  const lastVoiceActivityRef = useRef(0);
  const voiceStatusRef = useRef<'idle' | 'listening' | 'sending' | 'error'>(voiceStatus);
  const inputModeRef = useRef(inputMode);
  const avatarContainerRef = useRef<HTMLDivElement | null>(null);
  // モードに応じた沈黙時間
  const getAutoSendSilenceMs = () => {
    if (inputMode === 'auto-smart') return 1500;
    if (inputMode === 'auto-slow') return 2000;
    return 99999999; // manual/typing: 自動送信しない
  };
  const AUTO_SEND_RMS_THRESHOLD = 0.015;
  // バージイン用の閾値は自動送信より高め（TTS残響を誤検知しないため）
  const BARGE_IN_RMS_THRESHOLD = 0.025;
  // 連続何フレームで「本物のユーザー発話」と判定するか (2048samples/48kHz≒43ms × 4 ≈ 170ms)
  const BARGE_IN_CONSECUTIVE_FRAMES = 4;
  const PREBUFFER_MS = 4000;

  const voiceSupported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    saveChatMessages(storageKeyRef.current, messages);
  }, [messages]);

  useEffect(() => {
    voiceStatusRef.current = voiceStatus;
  }, [voiceStatus]);

  // バージイン判定用: chat 状態を ref 経由で audioprocess コールバックから参照する
  const statusRef = useRef<ChatStatus>('idle');
  const bargeInFrameCountRef = useRef(0);
  // バージイン検出中に保留した音声フレーム。割り込み確定時に Deepgram へ flush する（頭切れ防止）
  const bargeInPendingFramesRef = useRef<ArrayBuffer[]>([]);
  // chat-stream の進行中リクエストを中断するためのコントローラ
  const chatStreamAbortRef = useRef<AbortController | null>(null);
  // 古いレスポンスが新しいセッションに上書きしないようにするシーケンス番号
  const chatRequestIdRef = useRef(0);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    inputModeRef.current = inputMode;
  }, [inputMode]);

  useEffect(() => {
    ttsVoiceRef.current = ttsVoice;
  }, [ttsVoice]);

  useEffect(() => {
    ttsSpeedRef.current = ttsSpeed;
  }, [ttsSpeed]);

  useEffect(() => {
    ttsProviderRef.current = ttsProvider;
  }, [ttsProvider]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  // ストリーミングTTS用 refs（stopAllTts より先に宣言）
  const ttsAudioCtxRef = useRef<AudioContext | null>(null);
  const ttsStreamAbortRef = useRef<AbortController | null>(null);
  const ttsRequestIdRef = useRef(0);
  const ttsQueueRef = useRef<string[]>([]); // 残りテキストのキュー
  // 連続再生用: 最後にスケジュールした AudioContext 再生時刻（もったり感対策）
  const ttsNextPlayTimeRef = useRef(0);
  const ttsActiveChainsRef = useRef(0);
  // リップシンク用の AnalyserNode（TTS AudioContext と同一に接続）
  const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
  // 感情適応TTS: 現在の表情をTTSリクエストに渡す
  const ttsEmotionRef = useRef<string>('neutral');
  // バージイン時のフェードアウト用: 現在再生中の {source, gain} を追跡
  const ttsActiveSourcesRef = useRef<Array<{ source: AudioBufferSourceNode; gain: GainNode; endTime: number }>>([]);
  // 相槌: ユーザー発話中のポーズ検出
  const aizuchiSilenceFramesRef = useRef(0);
  const aizuchiSpeechFramesRef = useRef(0);
  const aizuchiPreloadedRef = useRef(false);

  // 全ての音声を停止するヘルパー関数
  // options.fadeMs を指定すると自然にフェードアウト（バージイン時の唐突さ回避）
  const stopAllTts = useCallback((options?: { fadeMs?: number }) => {
    const fadeMs = options?.fadeMs ?? 0;
    // ブラウザTTSを停止
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    // クラウドTTS（Audio要素）を停止
    const prevAudio = ttsAudioRef.current;
    if (prevAudio) {
      try {
        prevAudio.pause();
        prevAudio.currentTime = 0;
        prevAudio.src = '';
      } catch {
        // ignore
      }
    }
    if (ttsAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(ttsAudioUrlRef.current);
      } catch {
        // ignore
      }
      ttsAudioUrlRef.current = null;
    }
    // スケジュール済み BufferSource をフェードアウトで停止
    const ctx = ttsAudioCtxRef.current;
    const now = ctx ? ctx.currentTime : 0;
    const fadeSec = Math.max(0, fadeMs / 1000);
    const active = ttsActiveSourcesRef.current;
    ttsActiveSourcesRef.current = [];
    for (const { source, gain } of active) {
      try {
        if (ctx && fadeSec > 0) {
          gain.gain.cancelScheduledValues(now);
          // 現在値から fadeSec で 0 にランプ
          const cur = gain.gain.value;
          gain.gain.setValueAtTime(cur, now);
          gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
          source.stop(now + fadeSec + 0.02);
        } else {
          source.stop();
        }
      } catch {
        // ignore: already stopped
      }
    }
    // ストリーミングTTSを中断（AudioContextは再利用するので close しない）
    ttsStreamAbortRef?.current?.abort();
    ttsStreamAbortRef.current = null;
    ttsQueueRef.current = [];
    ttsNextPlayTimeRef.current = 0;
    ttsActiveChainsRef.current = 0;
    ttsSpeakingRef.current = false;
    setTtsSpeaking(false);
  }, []);

  // バージイン: ユーザーが喋り始めたら AI の発話・思考を即座に止めてユーザーの番にする
  const triggerBargeIn = useCallback((reason: string) => {
    console.log(`[barge-in] interrupting AI (${reason})`);
    // 1. TTS フェードアウト停止（唐突に切れないように 150ms フェード）
    stopAllTts({ fadeMs: 150 });
    // 2. 進行中の chat-stream を中断
    if (chatStreamAbortRef.current) {
      try { chatStreamAbortRef.current.abort(); } catch { /* ignore */ }
      chatStreamAbortRef.current = null;
    }
    // 3. 新しいシーケンスに切り替え（古いレスポンスは破棄される）
    chatRequestIdRef.current += 1;
    // 4. 保留中のトランスクリプトをクリア（重複送信を防ぐ）
    pendingVoiceTranscriptRef.current = null;
    // 5. 未完の assistant メッセージを履歴から除去（空または途中のものが残ると Gemini が
    //    文脈を見失って一問一答化する）
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === 'assistant' && (!last.text || last.text.trim().length < 4)) {
        return prev.slice(0, -1);
      }
      return prev;
    });
    // 6. チャット状態を idle に戻す
    setStatus('idle');
    setError(null);
    bargeInFrameCountRef.current = 0;
  }, [stopAllTts]);

  const speakReply = useCallback(
    (text: string, options?: { append?: boolean; chained?: boolean }) => {
      if (!ttsEnabled) return;

      // append モード: 現在再生中のTTSが終わったら次を再生するキューに追加
      if (options?.append) {
        ttsQueueRef.current.push(text);
        console.log(`[tts:queue] enqueued ${text.length} chars, queue size: ${ttsQueueRef.current.length}`);
        // 何も再生中でない＆chainもアクティブでないならキュー消化を開始
        if (ttsActiveChainsRef.current === 0 && !ttsSpeakingRef.current) {
          const next = ttsQueueRef.current.shift();
          if (next) speakReply(next, { chained: false });
        }
        return;
      }

      setTtsError(null);

      const chained = options?.chained === true;
      if (!chained) {
        // 新規発話: すべての音声を停止して状態リセット
        stopAllTts();
        ttsStreamAbortRef.current?.abort();
        ttsStreamAbortRef.current = null;
      }

      if (typeof window === 'undefined') return;

      const requestId = chained ? ttsRequestIdRef.current : ++ttsRequestIdRef.current;
      const abort = new AbortController();
      ttsStreamAbortRef.current = abort;
      ttsActiveChainsRef.current += 1;

      // ブラウザTTSフォールバック
      const playBrowserTts = () => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
        try {
          const synth = window.speechSynthesis;
          synth.cancel();
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = 'ja-JP';
          utter.rate = 1.1;
          utter.onstart = () => { ttsSpeakingRef.current = true; setTtsSpeaking(true); };
          utter.onend = () => { ttsSpeakingRef.current = false; setTtsSpeaking(false); };
          utter.onerror = () => { ttsSpeakingRef.current = false; setTtsSpeaking(false); };
          const voices = synth.getVoices();
          const jaVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('ja'));
          if (jaVoice) utter.voice = jaVoice;
          synth.speak(utter);
        } catch { /* ignore */ }
      };

      // ストリーミング再生: SSE で PCM チャンクを受け取り、AudioContext で即再生
      const playStreaming = async () => {
        // AudioContext をソースと同じ 24000Hz で作成（リサンプルによるノイズ回避）
        let audioCtx = ttsAudioCtxRef.current;
        if (!audioCtx || audioCtx.state === 'closed') {
          audioCtx = new AudioContext({ sampleRate: 24000 });
          ttsAudioCtxRef.current = audioCtx;
        }
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        // 相槌音声プリロード（初回のみ）
        if (!aizuchiPreloadedRef.current) {
          aizuchiPreloadedRef.current = true;
          preloadAizuchi(audioCtx).catch(() => {});
        }
        // リップシンク用 AnalyserNode（シングルトン）
        if (!ttsAnalyserRef.current) {
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.3;
          analyser.connect(audioCtx.destination);
          ttsAnalyserRef.current = analyser;
        }
        const analyser = ttsAnalyserRef.current;

        const response = await fetchWithAuth('/api/tts-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speakingRate: ttsSpeedRef.current, voice: ttsVoiceRef.current, provider: ttsProviderRef.current, emotion: ttsEmotionRef.current }),
          signal: abort.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`tts-stream failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        // 連続再生: 前回のスケジュール終端から継続（もったり感対策）
        let nextPlayTime = Math.max(audioCtx.currentTime, ttsNextPlayTimeRef.current);
        let started = false;
        let sampleRate = 24000;
        let sseBuffer = '';
        let queueFired = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (ttsRequestIdRef.current !== requestId) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let evt: any;
            try {
              evt = JSON.parse(line.slice(6));
            } catch {
              continue; // JSON パースエラーはスキップ
            }

            if (evt.type === 'info' && evt.sampleRate) {
              sampleRate = evt.sampleRate;
            } else if (evt.type === 'audio' && evt.data) {
              // base64 → Uint8Array → Int16 → Float32
              const binaryStr = atob(evt.data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              const int16 = new Int16Array(bytes.buffer);
              const float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / 32768;
              }

              const audioBuf = audioCtx.createBuffer(1, float32.length, sampleRate);
              audioBuf.getChannelData(0).set(float32);

              const source = audioCtx.createBufferSource();
              source.buffer = audioBuf;
              // source → gain → analyser → destination（フェードアウト＋リップシンク用）
              const gain = audioCtx.createGain();
              source.connect(gain);
              gain.connect(analyser);

              const now = audioCtx.currentTime;
              if (nextPlayTime < now) nextPlayTime = now;
              source.start(nextPlayTime);
              const scheduledEnd = nextPlayTime + audioBuf.duration;
              const sourceEntry = { source, gain, endTime: scheduledEnd };
              ttsActiveSourcesRef.current.push(sourceEntry);
              source.onended = () => {
                const arr = ttsActiveSourcesRef.current;
                const idx = arr.indexOf(sourceEntry);
                if (idx >= 0) arr.splice(idx, 1);
              };
              nextPlayTime = scheduledEnd;
              ttsNextPlayTimeRef.current = nextPlayTime;

              if (!started) {
                started = true;
                console.log('[tts:stream] first audio chunk playing');
                ttsSpeakingRef.current = true;
                setTtsSpeaking(true);
                ttsAudioRef.current = new Audio();
                (ttsAudioRef.current as any)._requestId = requestId;
              }
            } else if (evt.type === 'done') {
              // 'done' が来た瞬間に次のキュー項目の取得を開始（間を詰める）
              if (!queueFired) {
                queueFired = true;
                const next = ttsQueueRef.current.shift();
                if (next && ttsRequestIdRef.current === requestId) {
                  console.log(`[tts:queue] chaining next (${next.length} chars), remaining queue: ${ttsQueueRef.current.length}`);
                  speakReply(next, { chained: true });
                }
              }
              // このチェーンを終了。speaking 解除は最後のチェーンだけが行う
              ttsActiveChainsRef.current = Math.max(0, ttsActiveChainsRef.current - 1);
              const remaining = Math.max(0, (nextPlayTime - audioCtx.currentTime) * 1000);
              setTimeout(() => {
                if (
                  ttsRequestIdRef.current === requestId &&
                  ttsActiveChainsRef.current === 0 &&
                  ttsQueueRef.current.length === 0
                ) {
                  ttsSpeakingRef.current = false;
                  setTtsSpeaking(false);
                  ttsNextPlayTimeRef.current = 0;
                }
              }, remaining);
            } else if (evt.type === 'error') {
              throw new Error(evt.message || 'tts_stream_error');
            }
          }
        }
      };

      playStreaming().catch((err) => {
        ttsActiveChainsRef.current = Math.max(0, ttsActiveChainsRef.current - 1);
        if (abort.signal.aborted) return;
        if (ttsRequestIdRef.current !== requestId) return;
        if (ttsActiveChainsRef.current === 0) {
          ttsSpeakingRef.current = false;
          setTtsSpeaking(false);
        }
        const detail = err instanceof Error ? err.message : String(err || '');
        console.warn('[tts:stream] failed, falling back to browser TTS:', detail);
        setTtsError(detail ? `音声ストリーミングに失敗: ${detail}` : '');
        playBrowserTts();
      });
    },
    [ttsEnabled, stopAllTts],
  );

  // 会話スタートボタンを押したときにAIメッセージを表示
  const handleChatStart = useCallback(() => {
    // LocalStorageの過去ログをクリア
    const key = getChatStorageKey();
    storageKeyRef.current = key;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore storage errors
      }
    }
    setMessages([]);
    setError(null);
    // セッションID生成
    sessionIdRef.current = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    lastSavedMessageCountRef.current = 0;
    autoSavedAtRef.current = 0;
    autoSavingRef.current = false;

    // 議題提案またはデフォルトメッセージを表示
    const messageText = initialMessage || 'はじめまして！今日からよろしくお願いします。もしよかったら、あなたのことを教えていただけますか？好きなことや趣味、どんなことに興味があるかなど、何でも大丈夫です！';
    const agendaMessage: ChatMessage = {
      id: createChatId(),
      role: 'assistant',
      text: stripFurigana(messageText), // UI表示用: 読み仮名除去
    };
    setMessages([agendaMessage]);

    setChatStarted(true);
    updateStreak();

    // AIメッセージを読み上げ（読み仮名付きのまま渡す）
    speakReply(messageText);
  }, [initialMessage, speakReply, stripFurigana, updateStreak]);

  // 顔分析サマリーを受け取る
  const handleFaceAnalysisSummary = useCallback((summary: AnalysisSummary) => {
    setFaceAnalysisSummary(summary);
  }, []);

  // 顔分析リアルタイム更新（常に更新、表示は設定パネルで制御）
  // 感情軌跡: 直近の表情を記録し、急激なネガティブシフトを検出
  const emotionTrajectoryRef = useRef<{ expression: string; ts: number }[]>([]);
  const emotionShiftRef = useRef<string | null>(null);

  const handleFaceRealtimeUpdate = useCallback((data: RealtimeAnalysis) => {
    setFaceAnalysisRealtime(data);

    const now = Date.now();
    const trajectory = emotionTrajectoryRef.current;
    trajectory.push({ expression: data.expression, ts: now });
    // 直近60秒分だけ保持
    while (trajectory.length > 0 && now - trajectory[0].ts > 60_000) trajectory.shift();

    // ネガティブシフト検出: 直近10秒以内にポジティブ/中立→ネガティブへ急変
    const negativeExpressions = new Set(['worried', 'tense']);
    const positiveExpressions = new Set(['smile', 'happy', 'neutral']);
    const recent = trajectory.filter(e => now - e.ts <= 10_000);
    if (recent.length >= 3) {
      const hasPositiveBefore = recent.slice(0, -2).some(e => positiveExpressions.has(e.expression));
      const lastTwo = recent.slice(-2);
      const isNegativeNow = lastTwo.every(e => negativeExpressions.has(e.expression));
      if (hasPositiveBefore && isNegativeNow) {
        emotionShiftRef.current = `表情が急に${data.expression === 'worried' ? '心配そう' : 'こわばった'}に変化した`;
      } else if (!negativeExpressions.has(data.expression)) {
        emotionShiftRef.current = null;
      }
    }
  }, []);

  // キャラの目の位置から視線オフセットを計算
  const calculateGazeOffset = useCallback((): { x: number; y: number } | undefined => {
    const container = avatarContainerRef.current;
    if (!container) return undefined;

    const rect = container.getBoundingClientRect();
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // キャラの目の位置を推定（コンテナの上部1/3、中央）
    const eyeX = rect.left + rect.width * 0.5;
    const eyeY = rect.top + rect.height * 0.3;

    // カメラ位置を推定（画面上部中央）
    const cameraX = screenWidth / 2;
    const cameraY = 0; // 画面最上部

    // 画面座標での差分を計算
    const deltaX = (eyeX - cameraX) / screenWidth;  // -0.5 to 0.5
    const deltaY = (eyeY - cameraY) / screenHeight; // 0 to 1

    // オフセットに変換（視線検出は-1～1の範囲）
    // キャラが左にいる場合、左を見てもOKにするため負のオフセット
    // キャラが下にいる場合、下を見てもOKにするため正のオフセット
    return {
      x: deltaX * 1.5,  // スケール調整
      y: deltaY * 0.8,  // 下方向は控えめに
    };
  }, []);

  // デバッグPIN入力チェック
  const handleDebugPinChange = useCallback((value: string) => {
    setDebugPinInput(value);
    if (value === '4109') {
      setFaceAnalysisDebugMode(true);
      setDebugPinInput('');
    }
  }, []);

  // 顔分析AIフィードバックを取得
  const requestFaceAIFeedback = useCallback(async (summary: AnalysisSummary): Promise<string> => {
    try {
      const response = await fetchWithAuth('/api/face-analysis-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisData: {
            eyeContactRate: summary.eyeContactRate,
            gazeStability: summary.gazeStability,
            gazeWanderCount: summary.gazeWanderCount,
            expressionTrends: summary.expressionTrends,
            dominantExpression: summary.dominantExpression,
            totalFrames: summary.totalFrames,
          },
        }),
      });
      if (!response.ok) throw new Error('feedback_failed');
      const data = await response.json();
      return data.feedback || '';
    } catch (err) {
      console.error('[face-analysis] feedback error:', err);
      return 'フィードバックを取得できませんでした。';
    }
  }, []);

  // セッションフィードバックを閉じる
  const handleCloseSessionFeedback = useCallback(() => {
    setShowSessionFeedback(false);
    setFaceAnalysisSummary(null);
    setChatStarted(false);
    setMessages([]);
    // セッションリセット
    sessionIdRef.current = null;
    lastSavedMessageCountRef.current = 0;
    autoSavedAtRef.current = 0;
  }, []);

  const handleCloseInsight = useCallback(() => {
    setSessionInsight(null);
    setChatStarted(false);
    setMessages([]);
  }, []);

  // 会話終了ボタンのハンドラー
  const handleEndChat = useCallback(async () => {
    if (chatEnding || !msAccountId) return;
    setChatEnding(true);

    const chatText = messages
      .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.text}`)
      .join('\n');

    // 自動保存済みで新しいメッセージがなければAPI呼び出しをスキップ
    const alreadySaved = autoSavedAtRef.current >= messages.length && messages.length > 0;

    const savePromise = alreadySaved
      ? Promise.resolve()
      : fetchWithAuth('/api/session-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msAccountId,
            cleanedText: chatText,
            supportRecordJson: '',
            meetingTypeId: null,
            meetingTypeName: '会話セッション',
            facilitatorId: null,
            facilitatorName: null,
            talentId: null,
            talentName: userInfo.name || null,
            sessionDate: new Date().toISOString().slice(0, 10),
          }),
        }).then(() => console.log('[chat] session summary saved'))
          .catch((err: unknown) => console.warn('[chat] failed to save session summary', err));

    // インサイトカード生成（セッション保存と並行）
    const insightPromise = messages.length >= 4
      ? fetchWithAuth('/api/session-insight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatText, userName: userInfo.name || '' }),
        }).then((r) => r.json())
          .then((data: { insight?: { emoji: string; title: string; body: string; encouragement: string } }) => data.insight || null)
          .catch(() => null)
      : Promise.resolve(null);

    const [, insight] = await Promise.all([savePromise, insightPromise]);

    // 顔分析が有効でサマリーがある場合はフィードバックモーダルを表示
    if (faceAnalysisEnabled && faceAnalysisSummary && faceAnalysisSummary.totalFrames > 0) {
      setShowSessionFeedback(true);
    } else if (insight) {
      setSessionInsight(insight);
    } else {
      setChatStarted(false);
      setMessages([]);
    }
    // セッションリセット
    sessionIdRef.current = null;
    lastSavedMessageCountRef.current = 0;
    autoSavedAtRef.current = 0;
    setChatEnding(false);
  }, [chatEnding, msAccountId, messages, userInfo.name, faceAnalysisEnabled, faceAnalysisSummary]);

  // ハートビート送信（軽量保存）
  const sendHeartbeat = useCallback((isFinal = false) => {
    if (!sessionIdRef.current || !msAccountId || messages.length === 0) return;

    const chatText = messages
      .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.text}`)
      .join('\n');

    const payload = {
      sessionId: sessionIdRef.current,
      msAccountId,
      cleanedText: chatText,
      talentName: userInfo.name || null,
      sessionDate: new Date().toISOString().slice(0, 10),
      messageCount: messages.length,
      isFinal,
    };

    // sendBeaconを使用（ページ閉じ時でも確実に送信）
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/api/session-heartbeat', blob);
      console.log(`[chat] heartbeat sent via beacon (messages:${messages.length}, final:${isFinal})`);
    } else {
      // フォールバック
      fetchWithAuth('/api/session-heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
      console.log(`[chat] heartbeat sent via fetch (messages:${messages.length}, final:${isFinal})`);
    }

    lastSavedMessageCountRef.current = messages.length;
  }, [msAccountId, messages, userInfo.name]);

  // タブ非表示時の自動保存（AI要約付き）
  const autoSaveSession = useCallback(async () => {
    const currentMessages = chatMessagesRef.current;
    if (!msAccountId || currentMessages.length < 3 || autoSavingRef.current) return;
    if (autoSavedAtRef.current >= currentMessages.length) return;

    autoSavingRef.current = true;

    const chatText = currentMessages
      .map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.text}`)
      .join('\n');

    try {
      await fetchWithAuth('/api/session-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msAccountId,
          cleanedText: chatText,
          supportRecordJson: '',
          meetingTypeId: null,
          meetingTypeName: '会話セッション',
          facilitatorId: null,
          facilitatorName: null,
          talentId: null,
          talentName: userInfo.name || null,
          sessionDate: new Date().toISOString().slice(0, 10),
        }),
        keepalive: true,
      });
      autoSavedAtRef.current = currentMessages.length;
      lastSavedMessageCountRef.current = currentMessages.length;
      console.log(`[chat] auto-save completed (messages:${currentMessages.length})`);
    } catch (err) {
      console.warn('[chat] auto-save failed', err);
    } finally {
      autoSavingRef.current = false;
    }
  }, [msAccountId, userInfo.name]);

  // 60秒ごとの定期保存（差分がある場合のみ）
  useEffect(() => {
    if (!chatStarted || !msAccountId) {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    heartbeatIntervalRef.current = setInterval(() => {
      if (messages.length > lastSavedMessageCountRef.current) {
        sendHeartbeat(false);
      }
    }, 60000); // 60秒

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [chatStarted, msAccountId, messages.length, sendHeartbeat]);

  // ページ閉じ/リロード時の保存
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (chatStarted && messages.length > 0) {
        sendHeartbeat(true);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' || !chatStarted) return;
      const currentMessages = chatMessagesRef.current;
      // 3メッセージ以上あればAI要約付き自動保存
      if (currentMessages.length >= 3 && autoSavedAtRef.current < currentMessages.length) {
        autoSaveSession();
      }
      // ハートビートも送る（sendBeaconで即時・確実）
      if (currentMessages.length > lastSavedMessageCountRef.current) {
        sendHeartbeat(false);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [chatStarted, messages.length, sendHeartbeat, autoSaveSession]);

  useEffect(() => {
    if (!ttsEnabled) {
      setTtsError(null);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      const audio = ttsAudioRef.current;
      if (audio) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // ignore audio errors
        }
      }
      if (ttsAudioUrlRef.current) {
        URL.revokeObjectURL(ttsAudioUrlRef.current);
        ttsAudioUrlRef.current = null;
      }
      ttsSpeakingRef.current = false;
    }
  }, [ttsEnabled]);

  // TTS音声リストを取得
  useEffect(() => {
    fetchWithAuth('/api/tts/voices')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.voices)) {
          setTtsVoiceOptions(data.voices);
        }
        if (typeof data?.default === 'string') {
          setTtsVoice(data.default);
        }
      })
      .catch((err) => {
        console.warn('[tts] failed to fetch voices', err);
      });
  }, []);

  const finalizeVoiceCapture = useCallback(() => {
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    if (autoSendTimerRef.current !== null) {
      window.clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.close(1000, 'voice_finalize');
      } catch {
        // ignore close errors
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx) {
      try {
        ctx.close();
      } catch {
        // ignore close errors
      }
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    wsRef.current = null;
    wsReadyRef.current = false;
    audioCtxRef.current = null;
    processorRef.current = null;
    mediaStreamRef.current = null;
    prebufferRef.current = [];
    setVoiceInitStatus('idle');
  }, []);

  useEffect(() => {
    if (voiceStatus === 'listening') return;
    if (autoSendTimerRef.current !== null) {
      window.clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
  }, [voiceStatus]);

  const handleClear = () => {
    stopVoiceCapture(false);
    const key = getChatStorageKey();
    storageKeyRef.current = key;
    setMessages([]);
    setError(null);
    setStatus('idle');
    setVoicePreview('');
    voicePreviewRef.current = '';
    setVoiceError(null);
    setVoiceStatus('idle');
    setVoiceInitStatus('idle');
    pendingVoiceTranscriptRef.current = null;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore storage errors
      }
    }
  };

  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!text || status === 'running') return;

      const nextStorageKey = getChatStorageKey();
      const shouldReset = storageKeyRef.current !== nextStorageKey;
      if (shouldReset) {
        storageKeyRef.current = nextStorageKey;
        setMessages([]);
      }

      const history = buildChatContext(shouldReset ? [] : chatMessagesRef.current);
      const userMessage: ChatMessage = { id: createChatId(), role: 'user', text };
      const assistantMessageId = createChatId();
      setMessages((prev) => (shouldReset ? [userMessage] : [...prev, userMessage]));
      setStatus('running');
      setAvatarExpression('think');
      setError(null);

      // バージイン対応: このリクエストのシーケンス番号を払い出し、AbortController を紐付ける
      const myRequestId = ++chatRequestIdRef.current;
      const abortCtrl = new AbortController();
      chatStreamAbortRef.current = abortCtrl;
      const isStale = () => chatRequestIdRef.current !== myRequestId || abortCtrl.signal.aborted;

      // ストリーミングAPIを試行し、失敗したら通常APIにフォールバック
      const tryStreaming = async (): Promise<boolean> => {
        try {
          const response = await fetchWithAuth('/api/chat-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text,
              history,
              context,
              userInfo,
              faceAnalysis: faceAnalysisRealtime,
              emotionShift: emotionShiftRef.current,
              streakDays,
              msAccountId,
              geminiModel,
            }),
            signal: abortCtrl.signal,
          });

          // 404の場合はフォールバック
          if (response.status === 404) {
            return false;
          }

          if (!response.ok) {
            const message = await readChatError(response);
            throw new Error(message);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            return false;
          }

          const decoder = new TextDecoder();
          let fullReply = '';        // 生テキスト（mode/表情タグ除去後、読み仮名あり）
          let rawTtsText = '';       // TTS用テキスト（読み仮名あり）
          let hasStartedTts = false;
          let pendingTtsText = '';   // まだ TTS に送っていないテキスト
          let tagsParsed = false;    // mode + 表情 タグ解析済みか
          let replyMode: 'aizuchi' | 'respond' | 'silent' = 'respond';
          let assistantMessageInserted = false;

          // TTS を早く開始するための判定。モードによって閾値を変える。
          // イントネーション崩れを避けるため、文末（。！？）での区切りを基本とし、
          // 長い場合のみ読点で区切る。初回だけは早く発話したいので短めに許容。
          const isSpeakable = (txt: string, mode: 'aizuchi' | 'respond' | 'silent', isFirst: boolean) => {
            const trimmed = txt.trim();
            if (!trimmed) return false;
            if (mode === 'aizuchi') {
              // 相槌は文末で区切る（「うん」「そうなんですね」）、または 6 文字以上
              if (/[。！？\n]$/.test(trimmed)) return true;
              return trimmed.length >= 6;
            }
            // respond: 文末で区切るのが最優先
            if (/[。！？\n]$/.test(trimmed)) return true;
            // 初回だけは 「、」 で早く始めて TTFA を詰める
            if (isFirst && /、$/.test(trimmed) && trimmed.length >= 10) return true;
            // 30 文字超えたら仕方なく区切る（読点がなくても）
            if (trimmed.length >= 40) return true;
            return false;
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // バージインされたら即座にストリーム終了
            if (isStale()) {
              try { reader.cancel(); } catch { /* ignore */ }
              return true;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (isStale()) return true;
                  if (data.type === 'chunk' && data.text) {
                    fullReply += data.text;

                    // mode + 表情 タグの解析（最初の1回のみ）
                    // プロンプトの指示: [mode:xxx][表情:yyy] の順で必ず先頭に付く
                    if (!tagsParsed) {
                      // [mode:xxx] が閉じているかチェック
                      const modeEnd = fullReply.indexOf(']');
                      if (modeEnd === -1) continue; // まだ mode タグ閉じてない
                      // mode 解析
                      const modeResult = parseMode(fullReply);
                      replyMode = modeResult.mode;
                      let afterMode = modeResult.cleanText;

                      // silent モードはここで打ち切り。UI にも追加しない、TTS も鳴らさない
                      if (replyMode === 'silent') {
                        tagsParsed = true;
                        rawTtsText = '';
                        pendingTtsText = '';
                        // ストリームの残りは読み飛ばす
                        try { reader.cancel(); } catch { /* ignore */ }
                        return true;
                      }

                      // respond / aizuchi は表情タグも消費してから本文を進める
                      const hasExpressionStart = afterMode.includes('[表情:');
                      if (hasExpressionStart && !afterMode.includes(']')) {
                        // 表情タグが途中（閉じ括弧未着）→ 次チャンク待ち
                        continue;
                      }
                      if (hasExpressionStart) {
                        const expResult = parseExpression(afterMode);
                        setAvatarExpression(expResult.expression);
                        ttsEmotionRef.current = expResult.expression;
                        afterMode = expResult.cleanText;
                      }
                      tagsParsed = true;
                      rawTtsText = afterMode;
                      pendingTtsText = afterMode;
                    } else {
                      rawTtsText += data.text;
                      pendingTtsText += data.text;
                    }

                    // UI表示用: メッセージ未挿入なら挿入（silent 以外）
                    if (!assistantMessageInserted) {
                      setMessages((prev) => [
                        ...prev,
                        { id: assistantMessageId, role: 'assistant', text: stripFurigana(rawTtsText) },
                      ]);
                      assistantMessageInserted = true;
                    } else {
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === assistantMessageId ? { ...m, text: stripFurigana(rawTtsText) } : m
                        )
                      );
                    }

                    // TTS 早期トリガー（aizuchiモードはキャッシュ音声を優先）
                    if (!hasStartedTts && isSpeakable(pendingTtsText, replyMode, true)) {
                      hasStartedTts = true;
                      if (replyMode === 'aizuchi') {
                        const cachedBuf = findAizuchiBuffer(pendingTtsText.trim());
                        if (cachedBuf && ttsAudioCtxRef.current) {
                          const ctx = ttsAudioCtxRef.current;
                          if (ctx.state === 'suspended') await ctx.resume();
                          const tracking = playAizuchiBuffer(ctx, cachedBuf, ttsAnalyserRef.current, 'gemini-aizuchi');
                          ttsActiveSourcesRef.current.push(tracking);
                          tracking.source.onended = () => {
                            ttsActiveSourcesRef.current = ttsActiveSourcesRef.current.filter((s) => s.source !== tracking.source);
                            ttsSpeakingRef.current = false;
                            setTtsSpeaking(false);
                          };
                          ttsSpeakingRef.current = true;
                          setTtsSpeaking(true);
                          pendingTtsText = '';
                          continue;
                        }
                      }
                      speakReply(pendingTtsText.trim());
                      pendingTtsText = '';
                    } else if (hasStartedTts && isSpeakable(pendingTtsText, replyMode, false)) {
                      // 後続チャンクは文末区切りで append
                      speakReply(pendingTtsText.trim(), { append: true });
                      pendingTtsText = '';
                    }
                  } else if (data.type === 'replace') {
                    // 安全フィルターによる応答差し替え
                    const safeText = data.text || '';
                    const modeResult = parseMode(safeText);
                    replyMode = modeResult.mode;
                    const expResult = parseExpression(modeResult.cleanText);
                    setAvatarExpression(expResult.expression);
                    rawTtsText = expResult.cleanText;
                    pendingTtsText = expResult.cleanText;
                    fullReply = safeText;
                    tagsParsed = true;
                    stopAllTts();
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMessageId ? { ...m, text: stripFurigana(rawTtsText) } : m
                      )
                    );
                    assistantMessageInserted = true;
                    hasStartedTts = false;
                  } else if (data.type === 'done') {
                    // silent でここまで来ることは通常ないが念のため
                    if (replyMode === 'silent') break;

                    // タグが最後まで見つからなかった場合のフォールバック
                    if (!tagsParsed) {
                      const modeResult = parseMode(fullReply);
                      replyMode = modeResult.mode;
                      if (replyMode === 'silent') break;
                      const expResult = parseExpression(modeResult.cleanText);
                      setAvatarExpression(expResult.expression);
                      rawTtsText = expResult.cleanText;
                      pendingTtsText = expResult.cleanText;
                      if (!assistantMessageInserted) {
                        setMessages((prev) => [
                          ...prev,
                          { id: assistantMessageId, role: 'assistant', text: stripFurigana(rawTtsText) },
                        ]);
                        assistantMessageInserted = true;
                      } else {
                        setMessages((prev) =>
                          prev.map((m) =>
                            m.id === assistantMessageId ? { ...m, text: stripFurigana(rawTtsText) } : m
                          )
                        );
                      }
                    }
                    if (!hasStartedTts && rawTtsText.trim()) {
                      speakReply(rawTtsText.trim());
                    } else if (hasStartedTts && pendingTtsText.trim()) {
                      speakReply(pendingTtsText.trim(), { append: true });
                    }
                  } else if (data.type === 'error') {
                    throw new Error(data.error || 'stream_error');
                  }
                } catch {
                  // JSON parse error - skip
                }
              }
            }
          }

          if (!fullReply.trim()) {
            throw new Error('reply was empty');
          }

          return true;
        } catch (err) {
          // バージイン (AbortError) は正常扱い
          if (err instanceof DOMException && err.name === 'AbortError') {
            return true;
          }
          if (isStale()) return true;
          // ストリーミング固有のエラーはフォールバック
          if (err instanceof Error && err.message.includes('404')) {
            return false;
          }
          throw err;
        }
      };

      // 通常のAPI（フォールバック）
      const useFallback = async () => {
        const response = await fetchWithAuth('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history, context, userInfo, faceAnalysis: faceAnalysisRealtime, msAccountId }),
        });
        if (!response.ok) {
          const message = await readChatError(response);
          throw new Error(message);
        }
        const payload = await response.json();
        let reply = typeof payload?.reply === 'string' ? payload.reply.trim() : '';
        if (!reply) {
          throw new Error('reply was empty');
        }

        // mode タグ解析（silent なら何も表示・再生せずに終了）
        const serverMode = payload?.mode as string | undefined;
        if (serverMode === 'silent') {
          return;
        }
        if (serverMode === 'aizuchi' || serverMode === 'respond') {
          // サーバーで strip 済み
        } else {
          const modeResult = parseMode(reply);
          if (modeResult.mode === 'silent') return;
          reply = modeResult.cleanText;
        }

        // サーバーで解析済みの表情があればそれを使う、なければテキストから解析
        const serverExpression = payload?.expression as string | undefined;
        const validExpressions: ExpressionType[] = ['neutral', 'smile', 'happy', 'think', 'surprise', 'sad', 'shy'];
        if (serverExpression && validExpressions.includes(serverExpression as ExpressionType)) {
          setAvatarExpression(serverExpression as ExpressionType);
        } else {
          const { expression, cleanText } = parseExpression(reply);
          setAvatarExpression(expression);
          reply = cleanText;
        }
        const assistantMessage: ChatMessage = { id: assistantMessageId, role: 'assistant', text: stripFurigana(reply) };
        setMessages((prev) => [...prev, assistantMessage]);
        speakReply(reply); // TTSには読み仮名付きで渡す
      };

      try {
        const streamingSucceeded = await tryStreaming();
        if (isStale()) {
          // バージインされた: status はすでに triggerBargeIn で idle に戻っている
          return;
        }
        if (!streamingSucceeded) {
          console.log('[chat] streaming not available, using fallback');
          await useFallback();
        }
        if (isStale()) return;
        setStatus('idle');
      } catch (err) {
        if (isStale()) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [speakReply, status, context, userInfo, faceAnalysisRealtime, msAccountId, geminiModel, parseMode, parseExpression, stripFurigana],
  );

  useEffect(() => {
    if (status !== 'idle') return;
    const pending = pendingVoiceTranscriptRef.current;
    if (!pending) return;
    pendingVoiceTranscriptRef.current = null;
    void sendChatMessage(pending);
  }, [sendChatMessage, status]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || status === 'running') return;
    setInput('');
    await sendChatMessage(text);
  }, [input, sendChatMessage, status]);

  const completeVoiceTranscript = useCallback(
    async (shouldSend: boolean) => {
      if (finalizeOnceRef.current) return;
      finalizeOnceRef.current = true;

      const transcript = (transcriptRef.current.join('') || voicePreviewRef.current).trim();
      transcriptRef.current = [];
      setVoicePreview('');
      voicePreviewRef.current = '';
      finalizeVoiceCapture();

      if (shouldSend && transcript) {
        setVoiceStatus('idle');
        setVoiceError(null);
        void sendChatMessage(transcript);
      } else if (shouldSend) {
        setVoiceStatus('error');
      } else {
        setVoiceStatus('idle');
      }

      finalizeOnceRef.current = false;
    },
    [finalizeVoiceCapture, sendChatMessage],
  );

  const floatTo16LE = (buffer: Float32Array) => {
    const out = new ArrayBuffer(buffer.length * 2);
    const view = new DataView(out);
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, buffer[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return out;
  };

  const stopVoiceCapture = useCallback(
    (shouldSend: boolean) => {
      if (voiceStatus === 'idle') return;
      setVoiceStatus('sending');
      if (autoSendTimerRef.current !== null) {
        window.clearTimeout(autoSendTimerRef.current);
        autoSendTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'finalize' }));
        } catch {
          // ignore send errors
        }
      }
      if (finalizeTimerRef.current !== null) {
        window.clearTimeout(finalizeTimerRef.current);
      }
      finalizeTimerRef.current = window.setTimeout(() => {
        completeVoiceTranscript(shouldSend);
      }, 1500);
    },
    [completeVoiceTranscript, voiceStatus],
  );

  const flushVoiceTranscript = useCallback(() => {
    const transcript = (transcriptRef.current.join('') || voicePreviewRef.current).trim();
    if (!transcript) return;
    transcriptRef.current = [];
    voicePreviewRef.current = '';
    setVoicePreview('');
    if (status === 'running') {
      pendingVoiceTranscriptRef.current = transcript;
      return;
    }
    setVoiceError(null);
    void sendChatMessage(transcript);
  }, [sendChatMessage, status]);

  const scheduleAutoSend = useCallback((isRetry = false) => {
    // manual/typingモードでは自動送信しない
    const mode = inputModeRef.current;
    if (mode === 'manual' || mode === 'typing') return;

    if (autoSendTimerRef.current !== null) {
      window.clearTimeout(autoSendTimerRef.current);
    }

    // リトライでない場合はカウンターをリセット
    if (!isRetry) {
      autoSendRetryRef.current = 0;
    }

    const silenceMs = mode === 'auto-smart' ? 1500 : 2000;

    autoSendTimerRef.current = window.setTimeout(() => {
      if (voiceStatusRef.current !== 'listening') return;
      const preview = voicePreviewRef.current.trim();
      const finalText = transcriptRef.current.join('').trim();
      const text = finalText || preview;
      if (!text) return;

      // auto-smartモードでは文末検出も行う（ただし最大1回リトライまで＝最大3秒）
      if (mode === 'auto-smart' && autoSendRetryRef.current < 1) {
        // 文末パターン:
        // - 句読点: 。！？…
        // - 終助詞: ね、よ、な、の、か、さ、わ、ぞ、ぜ
        // - 動詞終止形: る、た、だ、う
        // - 丁寧語: です、ます、ません
        // - 形容詞: い（ただし「〜ない」「〜たい」など）
        // - 疑問パターン: 〜る？、〜か？（？なしでも）
        const seemsComplete = /[。！？…]$/.test(text) ||
                             /[ねよなのかさわぞぜ]$/.test(text) ||
                             /[るたう]$/.test(text) ||
                             /(です|ます|ません|ました|でした)$/.test(text) ||
                             /(ない|たい|しい|かった)$/.test(text) ||
                             /(だよ|だね|だな|かな|よね|のね)$/.test(text) ||
                             text.length >= 25;
        if (!seemsComplete) {
          // まだ完了してなさそうなので、もう少し待つ（最大1回まで＝計3秒）
          autoSendRetryRef.current++;
          scheduleAutoSend(true);
          return;
        }
      }

      // 送信時にカウンターをリセット
      autoSendRetryRef.current = 0;
      aizuchiSpeechFramesRef.current = 0;
      aizuchiSilenceFramesRef.current = 0;
      flushVoiceTranscript();
    }, silenceMs);
  }, [flushVoiceTranscript]);

  // 手動送信（manualモード用）
  const handleManualVoiceSend = useCallback(() => {
    const transcript = (transcriptRef.current.join('') || voicePreviewRef.current).trim();
    if (!transcript) return;
    transcriptRef.current = [];
    voicePreviewRef.current = '';
    setVoicePreview('');
    if (status === 'running') {
      pendingVoiceTranscriptRef.current = transcript;
      return;
    }
    setVoiceError(null);
    void sendChatMessage(transcript);
  }, [sendChatMessage, status]);

  const startVoiceCapture = useCallback(async () => {
    // typingモードでは音声入力を無効化
    if (inputMode === 'typing') {
      setVoiceStatus('error');
      setVoiceError('タイピングモードです。音声入力を使うにはモードを変更してください。');
      return;
    }
    if (disableVoice) {
      setVoiceStatus('error');
      setVoiceError('文字起こし中は音声会話を停止してください。');
      return;
    }
    if (!voiceSupported) {
      setVoiceStatus('error');
      setVoiceError('この環境では音声入力が利用できません。');
      return;
    }
    if (voiceStatus === 'listening') return;

    finalizeOnceRef.current = false;
    transcriptRef.current = [];
    voicePreviewRef.current = '';
    setVoicePreview('');
    setVoiceError(null);
    setVoiceStatus('listening');
    setVoiceInitStatus('warming');
    lastVoiceActivityRef.current = Date.now();

    try {
      const rate = 48000;
      const chunkSize = 2048;
      const prebufferMax = Math.max(1, Math.ceil((PREBUFFER_MS / 1000) * (rate / chunkSize)));
      prebufferRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: rate,
        },
      });
      mediaStreamRef.current = stream;

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: rate,
      });
      audioCtxRef.current = ctx;

      const wsTokenParam = await getWsTokenParam();
      const wsUrl = `${window.location.origin.replace('http', 'ws')}/ws?lang=ja&model=nova-3&codec=linear16&rate=${rate}${wsTokenParam}`;
      console.log('[voice-ws] connecting to:', wsUrl);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      wsReadyRef.current = false;

      ws.addEventListener('open', () => {
        console.log('[voice-ws] connection opened');
      });

      const source = ctx.createMediaStreamSource(stream);

      // AudioWorklet（メインスレッド非ブロッキング）を優先、非対応時は ScriptProcessorNode にフォールバック
      let workletNode: AudioWorkletNode | null = null;
      let legacyProcessor: ScriptProcessorNode | null = null;

      const handleAudioChunk = (rms: number, audioPayload: ArrayBuffer) => {
        const aiBusy = ttsSpeakingRef.current || statusRef.current === 'running';
        if (aiBusy) {
          if (rms > BARGE_IN_RMS_THRESHOLD) {
            bargeInPendingFramesRef.current.push(audioPayload);
            bargeInFrameCountRef.current += 1;
            if (bargeInFrameCountRef.current >= BARGE_IN_CONSECUTIVE_FRAMES) {
              triggerBargeIn('user started speaking');
              const pending = bargeInPendingFramesRef.current;
              bargeInPendingFramesRef.current = [];
              const client = wsRef.current;
              if (client && client.readyState === WebSocket.OPEN && wsReadyRef.current) {
                for (const p of pending) {
                  try { client.send(p); } catch { /* ignore */ }
                }
              } else {
                prebufferRef.current.push(...pending);
              }
              if (rms > AUTO_SEND_RMS_THRESHOLD) {
                lastVoiceActivityRef.current = Date.now();
                scheduleAutoSend();
              }
            }
          } else {
            bargeInFrameCountRef.current = 0;
            bargeInPendingFramesRef.current = [];
          }
          // AI応答中でもプリバッファに蓄積（頭切れ防止）
          const q = prebufferRef.current;
          q.push(audioPayload);
          if (q.length > prebufferMax) q.splice(0, q.length - prebufferMax);
          return;
        }

        bargeInFrameCountRef.current = 0;
        bargeInPendingFramesRef.current = [];

        // 相槌: ユーザー発話中のポーズ検出
        if (rms > AUTO_SEND_RMS_THRESHOLD) {
          aizuchiSpeechFramesRef.current += 1;
          aizuchiSilenceFramesRef.current = 0;
        } else if (aizuchiSpeechFramesRef.current > 20) {
          aizuchiSilenceFramesRef.current += 1;
          const jitter = Math.random() < 0.5 ? 0 : 1;
          if (aizuchiSilenceFramesRef.current === 6 + jitter && isAizuchiReady()) {
            const aCtx = ttsAudioCtxRef.current;
            if (aCtx && aCtx.state === 'running') {
              const pick = pickInstantAizuchi();
              if (pick) {
                const tracking = playAizuchiBuffer(aCtx, pick.buffer, ttsAnalyserRef.current, pick.id);
                ttsActiveSourcesRef.current.push(tracking);
                tracking.source.onended = () => {
                  ttsActiveSourcesRef.current = ttsActiveSourcesRef.current.filter((s) => s.source !== tracking.source);
                };
              }
            }
          }
        }

        if (rms > AUTO_SEND_RMS_THRESHOLD) {
          lastVoiceActivityRef.current = Date.now();
          scheduleAutoSend();
        }

        const client = wsRef.current;
        if (client && client.readyState === WebSocket.OPEN && wsReadyRef.current) {
          client.send(audioPayload);
        } else {
          const queue = prebufferRef.current;
          queue.push(audioPayload);
          if (queue.length > prebufferMax) {
            queue.splice(0, queue.length - prebufferMax);
          }
        }
      };

      try {
        await ctx.audioWorklet.addModule('./voice-processor.js');
        workletNode = new AudioWorkletNode(ctx, 'voice-processor', {
          processorOptions: { chunkSize },
        });
        workletNode.port.onmessage = (e: MessageEvent) => {
          handleAudioChunk(e.data.rms, e.data.audio);
        };
        source.connect(workletNode);
        workletNode.connect(ctx.destination);
        console.log('[voice] using AudioWorklet');
      } catch (workletErr) {
        console.warn('[voice] AudioWorklet not available, falling back to ScriptProcessorNode', workletErr);
        legacyProcessor = ctx.createScriptProcessor(chunkSize, source.channelCount || 1, 1);
        processorRef.current = legacyProcessor;

        legacyProcessor.addEventListener('audioprocess', (event: AudioProcessingEvent) => {
          const input = event.inputBuffer;
          let channel: Float32Array;
          if (input.numberOfChannels === 2) {
            const left = input.getChannelData(0);
            const right = input.getChannelData(1);
            channel = new Float32Array(left.length);
            for (let i = 0; i < left.length; i++) channel[i] = (left[i] + right[i]) / 2;
          } else {
            channel = input.getChannelData(0);
          }
          let sum = 0;
          for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
          const rms = Math.sqrt(sum / channel.length);
          const payload = floatTo16LE(channel);
          handleAudioChunk(rms, payload);
        });

        source.connect(legacyProcessor);
        legacyProcessor.connect(ctx.destination);
      }

      ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[voice-ws] received:', data.type, data);
          if (data.type === 'dg_open') {
            console.log('[voice-ws] dg_open received, setting ready');
            wsReadyRef.current = true;
            setVoiceInitStatus('ready');
            // AI応答中はTTSエコーを含むプリバッファを送らない（非busy時に自然にdirect送信に切り替わる）
            const aiBusyNow = ttsSpeakingRef.current || statusRef.current === 'running';
            if (!aiBusyNow) {
              const queue = prebufferRef.current;
              if (queue.length > 0 && ws.readyState === WebSocket.OPEN) {
                queue.forEach((payload) => {
                  try {
                    ws.send(payload);
                  } catch {
                    // ignore send errors
                  }
                });
              }
            }
            prebufferRef.current = [];
            return;
          }
          if (data.type === 'finalize_ack') {
            completeVoiceTranscript(true);
            return;
          }
          if (data.type === 'dg_closed') {
            completeVoiceTranscript(true);
            return;
          }
          if (data.type === 'dg_error') {
            setVoiceError(data.error ?? '音声認識エラー');
            completeVoiceTranscript(false);
            return;
          }
          if (data.type === 'stt') {
            const text = typeof data.text === 'string' ? data.text.trim() : '';
            if (!text) return;
            if (data.isFinal) {
              transcriptRef.current.push(text);
              const snapshot = transcriptRef.current.join('');
              voicePreviewRef.current = snapshot;
              setVoicePreview(snapshot);
            } else {
              const snapshot = transcriptRef.current.join('') + text;
              voicePreviewRef.current = snapshot;
              setVoicePreview(snapshot);
            }
            scheduleAutoSend();
          }
        } catch {
          // ignore non-JSON frames
        }
      });

      ws.addEventListener('close', (ev) => {
        setVoiceInitStatus('idle');
        if (ev.code === 4401) {
          setVoiceStatus('error');
          setVoiceError('認証エラー: ページを再読み込みしてください');
          return;
        }
        if (voiceStatus === 'listening' || voiceStatus === 'sending') {
          completeVoiceTranscript(true);
        }
      });

      ws.addEventListener('error', () => {
        setVoiceStatus('error');
        setVoiceInitStatus('idle');
        setVoiceError('音声接続に失敗しました。');
        completeVoiceTranscript(false);
      });
    } catch (err) {
      setVoiceStatus('error');
      setVoiceError(err instanceof Error ? err.message : String(err));
      finalizeVoiceCapture();
    }
  }, [completeVoiceTranscript, disableVoice, finalizeVoiceCapture, status, voiceStatus, voiceSupported, triggerBargeIn]);

  // 事前準備フラグがtrueになったら音声キャプチャを開始（最初のスタートボタン押下時）
  useEffect(() => {
    if (prepareVoice && voiceSupported && !disableVoice && voiceStatus === 'idle') {
      startVoiceCapture();
    }
  }, [prepareVoice, voiceSupported, disableVoice, voiceStatus, startVoiceCapture]);

  const canSend = chatStarted && status !== 'running' && input.trim().length > 0;
  const voiceButtonLabel =
    voiceStatus === 'listening'
      ? '話すのを止める'
      : voiceStatus === 'sending'
        ? '送信中…'
        : '音声で話す';
  const voiceButtonDisabled =
    !chatStarted || !voiceSupported || disableVoice || status === 'running' || voiceStatus === 'sending';
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <section
      className={cn(
        'relative flex flex-col rounded-3xl border border-slate-200 bg-white/90 shadow-sm shadow-slate-100 flex-1 min-h-0',
        className,
      )}
    >
      {voiceStatus === 'listening' && voiceInitStatus !== 'ready' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-white/80 backdrop-blur">
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-700 shadow-lg">
            音声の準備中…
          </div>
        </div>
      )}
      {/* ヘッダー部分（コンパクト） */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">会話</h2>
          {chatStarted && <span className="text-xs text-slate-400">当日分のみ</span>}
          {chatStarted && streakDays >= 2 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 text-xs font-medium">
              <span className="text-xs">{'🔥'}</span>{streakDays}日連続
            </span>
          )}
        </div>
      </header>

      {/* 顔分析レコーダー（非表示） */}
      {chatStarted && faceAnalysisEnabled && (
        <FaceAnalysisRecorder
          enabled={faceAnalysisEnabled}
          onError={(err) => setFaceAnalysisError(err)}
          onSummaryReady={handleFaceAnalysisSummary}
          onRealtimeUpdate={handleFaceRealtimeUpdate}
          gazeOffset={calculateGazeOffset()}
        />
      )}

      {/* メインコンテンツエリア */}
      {!chatStarted ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="w-48 h-48 rounded-full bg-gradient-to-b from-sky-50 to-indigo-50 border border-slate-200 overflow-hidden">
            <Live2DAvatar
              modelPath="/live2d/ran.model3.json"
              autoSize
              isSpeaking={false}
              audioElement={null}
              zoom={avatarZoom}
              offsetY={avatarOffsetY}
              expression="smile"
            />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold text-slate-800">おはようございます！</h3>
            <p className="text-sm text-slate-500">
              {userInfo?.name ? `${userInfo.name}さん、` : ''}今日もよろしくお願いします
            </p>
          </div>
          <Button onClick={handleChatStart} className="px-8 py-3 text-base rounded-full shadow-sm">
            会話をスタート
          </Button>
        </div>
      ) : (
        <div className={cn(
          "flex-1 flex gap-4 p-4 overflow-hidden",
          earOnlyMode && "justify-center"
        )}>
          {/* キャラクター（耳だけモードでは中央、通常は左側） */}
          <div
            ref={avatarContainerRef}
            className={cn(
              "bg-gradient-to-b from-sky-50 to-indigo-50 rounded-2xl border border-slate-200 overflow-hidden",
              earOnlyMode
                ? "w-full max-w-[700px]"
                : "flex-shrink-0 w-[45%] min-w-[280px] max-w-[500px]"
            )}
          >
            <div className="relative w-full h-full">
              <Live2DAvatar
                modelPath="/live2d/ran.model3.json"
                autoSize
                isSpeaking={ttsSpeaking}
                audioElement={ttsAudioRef.current}
                externalAnalyser={ttsAnalyserRef.current}
                zoom={avatarZoom}
                offsetY={avatarOffsetY}
                expression={avatarExpression}
              />
              {/* 話中インジケーター */}
              {ttsSpeaking && (
                <div className="absolute right-4 top-4 w-4 h-4 rounded-full bg-green-400 animate-ping" />
              )}
              {/* 設定UI（トグル式） */}
              {showAvatarSettings ? (
                <div
                  className={cn(
                    "absolute left-2 right-2 bg-white/90 rounded-lg p-2 text-xs space-y-1 z-10",
                    earOnlyMode ? "top-2" : "bottom-2"
                  )}
                  style={{ pointerEvents: 'auto' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">設定</span>
                    <button
                      onClick={() => setShowAvatarSettings(false)}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 text-slate-500"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16">表情:</span>
                    <span className="flex-1 px-2 py-0.5 bg-slate-100 rounded text-slate-600">
                      {{
                        neutral: '😐 普通',
                        smile: '😊 笑顔',
                        happy: '😄 嬉しい',
                        think: '🤔 考え中',
                        surprise: '😮 驚き',
                        sad: '😢 悲しい',
                        shy: '😳 照れ',
                      }[avatarExpression]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16">ズーム:</span>
                    <input
                      type="range"
                      min="0.5"
                      max="4"
                      step="0.1"
                      value={avatarZoom}
                      onChange={(e) => setAvatarZoom(Number(e.target.value))}
                      className="flex-1 cursor-pointer"
                    />
                    <span className="w-10 text-right">{avatarZoom.toFixed(1)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16">位置Y:</span>
                    <input
                      type="range"
                      min="-100"
                      max="200"
                      step="10"
                      value={avatarOffsetY}
                      onChange={(e) => setAvatarOffsetY(Number(e.target.value))}
                      className="flex-1 cursor-pointer"
                    />
                    <span className="w-10 text-right">{avatarOffsetY}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16">TTS:</span>
                    <select
                      value={ttsProvider}
                      onChange={(e) => setTtsProvider(e.target.value as 'google' | 'gemini')}
                      className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="google">Chirp 3 HD (安定)</option>
                      <option value="gemini">Gemini 3.1 Flash TTS (実験)</option>
                    </select>
                  </div>
                  {ttsVoiceOptions.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="w-16">声:</span>
                      <select
                        value={ttsVoice}
                        onChange={(e) => setTtsVoice(e.target.value)}
                        className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {ttsVoiceOptions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="w-16">話速:</span>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.25"
                      value={ttsSpeed}
                      onChange={(e) => setTtsSpeed(Number(e.target.value))}
                      className="flex-1 cursor-pointer"
                    />
                    <span className="w-10 text-right">{ttsSpeed.toFixed(2)}</span>
                  </div>
                  {/* AIモデル切替 */}
                  <div className="flex items-center gap-2">
                    <span className="w-16">AI:</span>
                    <select
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      className="flex-1 text-xs border border-slate-200 rounded px-1 py-0.5 bg-white"
                    >
                      <option value="gemini-2.0-flash">2.0 Flash（現在）</option>
                      <option value="gemini-2.5-flash">2.5 Flash</option>
                      <option value="gemini-3-flash-preview">3 Flash（最新）</option>
                    </select>
                  </div>
                  {/* 顔分析リアルタイム結果 */}
                  {faceAnalysisEnabled && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="font-medium mb-1">顔分析</div>
                      {faceAnalysisRealtime ? (
                        <div className="space-y-1 text-slate-600">
                          <div className="flex items-center gap-2">
                            <span className="w-16">表情:</span>
                            <span className="flex-1">
                              {{
                                smile: '😊 笑顔',
                                tense: '😬 緊張',
                                surprise: '😮 驚き',
                                worried: '😟 心配',
                                neutral: '😐 普通',
                              }[faceAnalysisRealtime.expression] || faceAnalysisRealtime.expression}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-16">視線:</span>
                            <span className={cn(
                              'flex items-center gap-1',
                              faceAnalysisRealtime.eyeContact ? 'text-green-600' : 'text-amber-600'
                            )}>
                              <span className={cn(
                                'w-2 h-2 rounded-full',
                                faceAnalysisRealtime.eyeContact ? 'bg-green-500' : 'bg-amber-400'
                              )} />
                              {faceAnalysisRealtime.eyeContact ? 'こちらを見ている' : '視線が外れている'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-slate-400">検出中...</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowAvatarSettings(true)}
                  className={cn(
                    "absolute w-8 h-8 bg-white/90 hover:bg-white rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 shadow-sm z-10 transition-colors",
                    earOnlyMode ? "top-2 left-2" : "bottom-2 left-2"
                  )}
                  style={{ pointerEvents: 'auto' }}
                  title="アバター・音声の設定"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
              )}
            </div>
            {/* 顔分析デバッグ表示 */}
            {faceAnalysisEnabled && faceAnalysisDebugMode && faceAnalysisRealtime && (
              <div className="mt-2 p-2 rounded-lg bg-white/80 border border-slate-200 text-xs">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <span className={cn(
                      'w-2 h-2 rounded-full',
                      faceAnalysisRealtime.eyeContact ? 'bg-green-500' : 'bg-red-400'
                    )} />
                    <span>{faceAnalysisRealtime.eyeContact ? 'アイコンタクト中' : '視線ずれ'}</span>
                  </div>
                </div>
              </div>
            )}
            {faceAnalysisError && (
              <div className="mt-2 text-xs text-amber-600">{faceAnalysisError}</div>
            )}
          </div>

          {/* 右側：チャットエリア */}
          <div className={cn(
            "flex flex-col gap-2 overflow-hidden min-h-0",
            earOnlyMode ? "absolute bottom-4 left-4 right-4 max-h-[180px]" : "flex-1"
          )}>
          {/* コントロールバー（コンパクト） */}
          <div className="flex-shrink-0 flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={() => setEarOnlyMode(!earOnlyMode)}
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium border transition-colors",
                earOnlyMode
                  ? "bg-pink-100 border-pink-300 text-pink-700"
                  : "bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100"
              )}
            >
              {earOnlyMode ? '耳だけ ON' : '耳だけ'}
            </button>
            <select
              value={inputMode}
              onChange={(e) => setInputMode(e.target.value as typeof inputMode)}
              className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white"
            >
              <option value="auto-smart">自動(賢い)</option>
              <option value="auto-slow">自動(遅め)</option>
              <option value="manual">手動</option>
              <option value="typing">入力のみ</option>
            </select>
            {inputMode !== 'typing' && (
              <>
                <Button
                  size="sm"
                  variant={voiceStatus === 'listening' ? 'outline' : 'default'}
                  onClick={() => (voiceStatus === 'listening' ? stopVoiceCapture(true) : startVoiceCapture())}
                  disabled={voiceButtonDisabled}
                  className="text-xs px-2 py-1 h-auto"
                >
                  {voiceButtonLabel}
                </Button>
                {inputMode === 'manual' && voicePreview && (
                  <Button
                    size="sm"
                    onClick={handleManualVoiceSend}
                    disabled={status === 'running'}
                    className="bg-green-600 hover:bg-green-700 text-xs px-2 py-1 h-auto"
                  >
                    送信
                  </Button>
                )}
                <label className="flex items-center gap-1 text-slate-500">
                  <input
                    type="checkbox"
                    checked={ttsEnabled}
                    onChange={(event) => setTtsEnabled(event.target.checked)}
                    disabled={!ttsSupported}
                    className="w-3 h-3"
                  />
                  音声返答
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  <input
                    type="checkbox"
                    checked={faceAnalysisEnabled}
                    onChange={(event) => setFaceAnalysisEnabled(event.target.checked)}
                    className="w-3 h-3"
                  />
                  顔分析
                </label>
              </>
            )}
            {voicePreview && (
              <span className="text-slate-500 truncate max-w-[150px]">認識: {voicePreview}</span>
            )}
            {voiceStatus === 'listening' && !voicePreview && (
              <span className="text-slate-400">聞き取り中…</span>
            )}
          </div>
          {voiceError && (
            <div className="flex-shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
              {voiceError}
            </div>
          )}
          {ttsError && (
            <div className="flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              {ttsError}
            </div>
          )}

          <ScrollArea className={cn(
            "flex-1 min-h-0 rounded-2xl border border-slate-200 bg-white px-4 py-4",
            earOnlyMode && "hidden"
          )}>
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                AIからの返答を待っています…
              </div>
            ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl border px-4 py-2 text-sm leading-relaxed shadow-sm',
                    message.role === 'user'
                      ? 'border-pink-200 bg-pink-50 text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-700',
                  )}
                >
                  {message.text}
                </div>
              </div>
            ))}
            {status === 'running' && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-400">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
          </ScrollArea>
          {/* フッター入力エリア（コンパクト） */}
          <footer className={cn(
            "flex-shrink-0 bg-white/95 px-3 py-2",
            earOnlyMode
              ? "rounded-2xl border border-slate-200 shadow-lg"
              : "border-t border-slate-200"
          )}>
            <div className="flex gap-2 items-end">
              <textarea
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (status !== 'running') {
                      handleSend();
                    }
                  }
                }}
                placeholder={status === 'running' ? '返答待ち…' : 'メッセージを入力…'}
                disabled={status === 'running'}
                className={cn(
                  'flex-1 min-h-[2.5rem] max-h-20 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1',
                  status === 'running'
                    ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                    : 'border-slate-200 bg-white focus:border-accent focus:ring-accent/40'
                )}
              />
              <div className="flex gap-1">
                <Button size="sm" onClick={handleSend} disabled={!canSend}>
                  {status === 'running' ? '…' : '送信'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleClear} disabled={status === 'running' || (messages.length === 0 && !error)}>
                  消
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEndChat}
                  disabled={status === 'running' || chatEnding || messages.length === 0}
                  className="border-pink-300 text-pink-600 hover:bg-pink-50"
                >
                  {chatEnding ? '…' : '終了'}
                </Button>
              </div>
            </div>
            {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
          </footer>
          </div>
        </div>
      )}

      {/* セッションフィードバックモーダル */}
      <SessionFeedback
        summary={faceAnalysisSummary}
        isOpen={showSessionFeedback}
        onClose={handleCloseSessionFeedback}
        onRequestAIFeedback={requestFaceAIFeedback}
      />

      {/* セッション終了インサイトカード */}
      {sessionInsight && (
        <div className="insight-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="insight-card mx-4 w-full max-w-sm overflow-hidden rounded-3xl bg-white ring-1 ring-black/5">
            <div className="bg-gradient-to-br from-pink-100 via-purple-50 to-sky-100 px-6 py-8 text-center">
              <div className="mb-3 text-5xl">{sessionInsight.emoji}</div>
              <h3 className="mb-2 text-lg font-bold text-slate-800">{sessionInsight.title}</h3>
              <p className="mb-4 text-sm leading-relaxed text-slate-600">{sessionInsight.body}</p>
              <p className="text-xs font-medium text-pink-500">{sessionInsight.encouragement}</p>
            </div>
            <div className="flex items-center justify-center border-t border-slate-100 px-6 py-4">
              <button
                onClick={handleCloseInsight}
                className="rounded-full bg-gradient-to-r from-pink-400 to-purple-400 px-8 py-2.5 text-sm font-medium text-white transition-all hover:brightness-105 active:scale-95"
              >
                おわる
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const formatDateInputValue = (date: Date) => {
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 10);
};


const normalizeMemoState = (value: unknown): MemoState | null => {

  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;

  const fact = typeof candidate.fact === 'string' ? candidate.fact : '';

  const interpretation = typeof candidate.interpretation === 'string' ? candidate.interpretation : '';

  const action = typeof candidate.action === 'string' ? candidate.action : '';

  return { fact, interpretation, action };

};



const parseStoredKeywords = (raw: unknown): string[] | null => {

  if (!raw) return null;

  if (isStringArray(raw)) {

    return raw;

  }

  if (typeof raw === 'object' && raw !== null) {

    const candidate = raw as Record<string, unknown>;

    const version = typeof candidate.version === 'number' ? candidate.version : 0;

    const payload = candidate.keywords;

    if (version > STORAGE_VERSION) {

      return null;

    }

    if (isStringArray(payload)) {

      return payload;

    }

  }

  return null;

};



const parseStoredMemos = (raw: unknown): MemoState | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {

      const parsed = JSON.parse(raw);

      return parseStoredMemos(parsed);

    } catch {

      return null;

    }

  }

  if (typeof raw !== 'object' || raw === null) {

    return null;

  }

  const candidate = raw as Record<string, unknown>;

  const version = typeof candidate.version === 'number' ? candidate.version : 0;

  const payload = candidate.memos ?? candidate;

  if (version > STORAGE_VERSION) {

    return null;

  }

  return normalizeMemoState(payload);
};

const normalizeSupportRecordConfig = (raw: unknown): SupportRecordConfig | null => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const meetingTypesRaw = Array.isArray(candidate.meetingTypes) ? candidate.meetingTypes : null;
  if (!meetingTypesRaw) return null;

  const normalizeSectionList = (sectionsRaw: any): SupportRecordSectionDefinition[] | null => {
    if (!Array.isArray(sectionsRaw)) return null;
    const sectionIdSet = new Set<string>();
    const sections: SupportRecordSectionDefinition[] = sectionsRaw
      .map((section: any) => {
        const sectionId = typeof section?.id === 'string' ? section.id.trim() : '';
        const title = typeof section?.title === 'string' ? section.title.trim() : '';
        const helperText = typeof section?.helperText === 'string' ? section.helperText.trim() : '';
        const placeholder = typeof section?.placeholder === 'string' ? section.placeholder.trim() : '';
        if (!sectionId || !title || !helperText || !placeholder) return null;
        if (sectionIdSet.has(sectionId)) return null;
        sectionIdSet.add(sectionId);
        return { id: sectionId, title, helperText, placeholder };
      })
      .filter(Boolean) as SupportRecordSectionDefinition[];
    if (!sections.length) return null;
    return sections;
  };

  const meetingTypeIds = new Set<string>();
  const hasInlineSections = meetingTypesRaw.some((type: any) => Array.isArray(type?.sections));

  if (hasInlineSections) {
    const meetingTypes: MeetingTypeDefinition[] = meetingTypesRaw
      .map((type: any) => {
        const id = typeof type?.id === 'string' ? type.id.trim() : '';
        const name = typeof type?.name === 'string' ? type.name.trim() : '';
        const timing = typeof type?.timing === 'string' ? type.timing.trim() : '';
        const frequency = typeof type?.frequency === 'string' ? type.frequency.trim() : '';
        const purpose = typeof type?.purpose === 'string' ? type.purpose.trim() : '';
        const participants = typeof type?.participants === 'string' ? type.participants.trim() : '';
        if (!id || !name || !timing || !frequency || !purpose || !participants) return null;
        if (meetingTypeIds.has(id)) return null;
        meetingTypeIds.add(id);
        const sections = normalizeSectionList(type?.sections);
        if (!sections) return null;
        return {
          id,
          name,
          timing,
          frequency,
          purpose,
          participants,
          sections,
        };
      })
      .filter(Boolean) as MeetingTypeDefinition[];

    return meetingTypes.length ? { meetingTypes } : null;
  }

  const baseSections = normalizeSectionList(candidate.sections);
  if (!baseSections) return null;

  const meetingTypes: MeetingTypeDefinition[] = meetingTypesRaw
    .map((type: any) => {
      const id = typeof type?.id === 'string' ? type.id.trim() : '';
      const name = typeof type?.name === 'string' ? type.name.trim() : '';
      const timing = typeof type?.timing === 'string' ? type.timing.trim() : '';
      const frequency = typeof type?.frequency === 'string' ? type.frequency.trim() : '';
      const purpose = typeof type?.purpose === 'string' ? type.purpose.trim() : '';
      const participants = typeof type?.participants === 'string' ? type.participants.trim() : '';
      if (!id || !name || !timing || !frequency || !purpose || !participants) return null;
      if (meetingTypeIds.has(id)) return null;
      meetingTypeIds.add(id);
      const sections = applySectionOverrides(baseSections, type?.sectionOverrides);
      return {
        id,
        name,
        timing,
        frequency,
        purpose,
        participants,
        sections,
      };
    })
    .filter(Boolean) as MeetingTypeDefinition[];

  return meetingTypes.length ? { meetingTypes } : null;
};



type StepStatus = 'idle' | 'running' | 'success' | 'error';
type AuthStatus = 'unconfigured' | 'idle' | 'running' | 'signed-in' | 'error';
type ActiveView = 'record' | 'interview' | 'chat';
type NavTarget = ActiveView;
type GeminiUsage = {
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};
type GeminiTwoStageUsage = {
  stage1?: GeminiUsage | null;
  stage2?: GeminiUsage | null;
  total?: GeminiUsage | null;
};
type GeminiUsageState = {
  clean?: GeminiUsage | null;
  cleanTwoStage?: GeminiTwoStageUsage | null;
  supportRecordDraft?: GeminiUsage | null;
  supportRecordRefine?: GeminiUsage | null;
  agenda?: GeminiUsage | null;
};
type MsAccount =
  | AccountInfo
  | {
      homeAccountId?: string;
      username?: string;
      name?: string;
      localAccountId?: string;
      tenantId?: string;
    };

const PARTICIPANTS_MISSING_TOKEN_MESSAGE = 'Microsoftログイン後に参加者データを読み込めます。';
const PARTICIPANTS_EXPIRED_TOKEN_MESSAGE =
  'Microsoftログインの有効期限が切れています。再ログインしてください。';

const formatGeminiUsage = (usage?: GeminiUsage | null) => {
  if (!usage) return null;
  const prompt = usage.promptTokens ?? null;
  const output = usage.outputTokens ?? null;
  const total = usage.totalTokens ?? null;
  if (prompt === null && output === null && total === null) return null;
  const parts: string[] = [];
  if (prompt !== null) parts.push(`in ${prompt}`);
  if (output !== null) parts.push(`out ${output}`);
  if (total !== null) parts.push(`total ${total}`);
  return parts.join(' / ');
};

const formatGeminiTwoStageUsage = (usage?: GeminiTwoStageUsage | null) => {
  if (!usage) return null;
  const parts: string[] = [];
  const stage1 = formatGeminiUsage(usage.stage1 ?? null);
  const stage2 = formatGeminiUsage(usage.stage2 ?? null);
  const total = formatGeminiUsage(usage.total ?? null);
  if (stage1) parts.push(`stage1 ${stage1}`);
  if (stage2) parts.push(`stage2 ${stage2}`);
  if (total) parts.push(`total ${total}`);
  return parts.length > 0 ? parts.join(' | ') : null;
};

export default function App() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'streaming' | 'error'>('idle');
  const [audioSource, setAudioSource] = useState<'mic' | 'screen' | 'mixed'>('mic');

  const [messages, setMessages] = useState<TranscriptMessage[]>([]);

  const [partialText, setPartialText] = useState('');

  const [cleaned, setCleaned] = useState('');
  const [cleanPreviewText, setCleanPreviewText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [msAccount, setMsAccount] = useState<MsAccount | null>(null);
  const [msAuthStatus, setMsAuthStatus] = useState<AuthStatus>(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      return 'idle';
    }
    return MSAL_ENABLED ? 'idle' : 'unconfigured';
  });
  const [msAuthError, setMsAuthError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [msDomainError, setMsDomainError] = useState<string | null>(null);
  const [msBypassUnlocked, setMsBypassUnlocked] = useState(false);
  const [msBypassPin, setMsBypassPin] = useState('');
  const [msBypassError, setMsBypassError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [keywords, setKeywords] = useState<string[]>([]);

  const [keywordInput, setKeywordInput] = useState('');
  const [cleanStatus, setCleanStatus] = useState<StepStatus>('idle');
  const [geminiUsage, setGeminiUsage] = useState<GeminiUsageState>({
    clean: null,
    cleanTwoStage: null,
    supportRecordDraft: null,
    supportRecordRefine: null,
    agenda: null,
  });
  const [memos, setMemos] = useState<MemoState>({
    fact: '',
    interpretation: '',
    action: '',

  });

  const [meetingTypeId, setMeetingTypeId] = useState<string | null>(() => {
    if (typeof window === 'undefined' || NO_RETENTION_MODE) return null;
    const stored = window.sessionStorage.getItem(MEETING_TYPE_STORAGE_KEY);
    return stored && stored.trim().length > 0 ? stored : null;
  });
  const [sessionMode, setSessionMode] = useState<'online' | 'offline'>('online');
  const [sessionDate, setSessionDate] = useState<string>(() => formatDateInputValue(new Date()));
  const [facilitatorName, setFacilitatorName] = useState('');
  const [talentName, setTalentName] = useState('');
  const [facilitatorId, setFacilitatorId] = useState('');
  const [talentId, setTalentId] = useState('');
  const [isInitialSetupOpen, setIsInitialSetupOpen] = useState(false);
  const [isWelcomeLoading, setIsWelcomeLoading] = useState(false);
  const [voicePrepared, setVoicePrepared] = useState(false);
  const [initialSetupDraft, setInitialSetupDraft] = useState({
    mode: 'online' as 'online' | 'offline',
    meetingTypeId: meetingTypeId ?? '',
    sessionDate,
    facilitatorName: '',
    facilitatorId: '',
    talentName: '',
    talentId: '',
    suggestedTopics: '' as string, // カンマ区切りの議題
  });
  const [initialSetupError, setInitialSetupError] = useState<string | null>(null);
  const [agendaSuggestion, setAgendaSuggestion] = useState<string | null>(null);
  const [supportRecordConfig, setSupportRecordConfig] = useState<SupportRecordConfig>(DEFAULT_SUPPORT_RECORD_CONFIG);
  const [isConfigAdminOpen, setIsConfigAdminOpen] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [configDraftValue, setConfigDraftValue] = useState<SupportRecordConfig | null>(null);
  const [configSaveStatus, setConfigSaveStatus] = useState<StepStatus>('idle');
  const [configError, setConfigError] = useState<string | null>(null);
  const [configPreviewMeetingTypeId, setConfigPreviewMeetingTypeId] = useState<string | null>(null);
  const [supportRecordDraft, setSupportRecordDraft] = useState<SupportRecordDraftState>(() =>
    createInitialSupportRecordDraft(),
  );
  const [supportRecordLastUpdated, setSupportRecordLastUpdated] = useState<number | null>(null);
  const [supportRecordSaveStatus, setSupportRecordSaveStatus] = useState<StepStatus>('idle');
  const [supportRecordCompleteStatus, setSupportRecordCompleteStatus] = useState<StepStatus>('idle');
  const [supportRecordFinalizeStatus, setSupportRecordFinalizeStatus] = useState<StepStatus>('idle');
  const [isFinalReviewOpen, setIsFinalReviewOpen] = useState(false);
  const [finalReviewDraft, setFinalReviewDraft] = useState<Record<string, string>>({});
  const [supportRecordDraftStatus, setSupportRecordDraftStatus] = useState<StepStatus>('idle');
  const [agendaStatus, setAgendaStatus] = useState<StepStatus>('idle');

  const [agendaProposals, setAgendaProposals] = useState<

    Array<{ title: string; why?: string; relatedSections?: string[]; followUps?: string[] }>

  >([]);

  const [agendaReminders, setAgendaReminders] = useState<string[]>([]);
  const [isKeywordPanelOpen, setIsKeywordPanelOpen] = useState(false);
  const [cleanedMessageCount, setCleanedMessageCount] = useState(0);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<NavTarget | null>(null);
  const [facilitatorOptions, setFacilitatorOptions] = useState<Participant[]>([]);
  const [talentOptions, setTalentOptions] = useState<Participant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState({ facilitator: false, talent: false });
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [isFacilitatorListOpen, setIsFacilitatorListOpen] = useState(false);
  const [isTalentListOpen, setIsTalentListOpen] = useState(false);
  const [selectedScreenSource, setSelectedScreenSource] = useState<DesktopSource | null>(null);
  const selectedScreenSourceRef = useRef<DesktopSource | null>(null);
  const [useDisplayMediaFallback, setUseDisplayMediaFallback] = useState(false);


  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunkCounterRef = useRef(0);
  const prebufferRef = useRef<ArrayBuffer[]>([]);
  const prebufferMaxChunksRef = useRef(0);
  const wsReadyRef = useRef(false);
  const finalizePendingRef = useRef(false);
  const finalizeTimerRef = useRef<number | null>(null);
  const reauthAttemptedRef = useRef(false);
  const keywordsRef = useRef<string[]>([]);

  const messagesRef = useRef<TranscriptMessage[]>([]);

  const storageLoadedRef = useRef(false);

  const lastFinalTranscriptRef = useRef('');

  const lastSegmentsRef = useRef<string[]>([]);

  const keywordPanelRef = useRef<HTMLDivElement | null>(null);

  const keywordButtonRef = useRef<HTMLButtonElement | null>(null);

  const supportRecordSectionRef = useRef<HTMLDivElement | null>(null);
  const interviewSectionRef = useRef<HTMLDivElement | null>(null);
  const chatSectionRef = useRef<HTMLDivElement | null>(null);
  const lastCleanMetaRef = useRef<{ keywords: string[]; cleanedCount: number }>({
    keywords: [],
    cleanedCount: 0,
  });
  const cleanPreviewUpdatedAtRef = useRef(0);
  const cleanStatusRef = useRef<StepStatus>('idle');
  const supportRecordIdRef = useRef<string>(typeof window === 'undefined' ? `record-${Date.now()}` : '');
  const supportRecordDraftSnapshotRef = useRef('');
  const supportRecordDraftAbortRef = useRef<AbortController | null>(null);
  const blockedMsAccountRef = useRef<string | null>(null);
  const listCloseTimerRef = useRef<number | null>(null);
  const participantsRetryRef = useRef(false);

  const allowedEmailDomain = (import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();


  const currentMeetingType = useMemo(
    () => supportRecordConfig.meetingTypes.find((type) => type.id === meetingTypeId) ?? null,
    [meetingTypeId, supportRecordConfig],
  );
  const supportRecordTemplate = useMemo(
    () => getSupportRecordTemplate(meetingTypeId, supportRecordConfig.meetingTypes),
    [meetingTypeId, supportRecordConfig],
  );
  const liveMessages = useMemo(
    () => messages.slice(cleanedMessageCount),
    [messages, cleanedMessageCount],
  );
  const supportRecordSections = useMemo<SupportRecordSection[]>(
    () =>
      supportRecordTemplate.map((section) => {
        const draft = supportRecordDraft[section.id] ?? { value: '', suggestion: null, updatedAt: null };
        return {
          id: section.id,
          title: section.title,
          helperText: section.helperText,
          placeholder: section.placeholder,
          value: draft.value,
          suggestion: draft.suggestion,
          aiAppend: draft.suggestion ?? '',
          updatedAt: draft.updatedAt,
        };
      }),
    [supportRecordDraft, supportRecordTemplate],
  );
  const statusLabel = useMemo(() => {
    switch (status) {
      case 'connecting':
        return '接続中';
      case 'streaming':
        return '録音中';
      case 'error':
        return 'エラー';
      case 'idle':
      default:
        return '待機中';
    }
  }, [status]);
  const hasInitialSettings = useMemo(

    () => Boolean((meetingTypeId ?? '').trim().length > 0 && facilitatorName.trim() && talentName.trim()),

    [meetingTypeId, facilitatorName, talentName],

  );

  const supportRecordHasContent = useMemo(
    () =>
      supportRecordSections.some(
        (section) =>
          (section.value && section.value.trim().length > 0) ||
          (section.aiAppend && section.aiAppend.trim().length > 0),
      ),
    [supportRecordSections],
  );

  const completeGuardMessage = useMemo(() => {
    if (!sessionDate || !sessionDate.trim()) {
      return '面談日を入力してください';
    }
    if (!talentId || !talentId.trim()) {
      return 'タレントIDが未設定です。タレントを選び直してください。';
    }
    if (!cleaned || !cleaned.trim()) {
      return 'クリーン済みの文字起こしがありません。先にクリーンを実行してください。';
    }
    return null;
  }, [sessionDate, talentId, cleaned]);

  const finalReviewErrorMessage =
    supportRecordCompleteStatus === 'error' && errorMessage ? errorMessage : null;
  const finalReviewNotice = finalReviewErrorMessage ?? completeGuardMessage;
  const finalReviewNoticeClass = finalReviewErrorMessage
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
  const configPreviewMeetingType = useMemo(() => {
    if (!configDraftValue) return null;
    return (
      configDraftValue.meetingTypes.find((type) => type.id === configPreviewMeetingTypeId) ?? null
    );
  }, [configDraftValue, configPreviewMeetingTypeId]);
  const configPromptSections = useMemo(() => {
    if (!configDraftValue) return [];
    const meetingId = configPreviewMeetingType?.id ?? configPreviewMeetingTypeId ?? null;
    return getSupportRecordTemplate(meetingId, configDraftValue.meetingTypes);
  }, [configDraftValue, configPreviewMeetingType, configPreviewMeetingTypeId]);
  const configPromptPreview = useMemo(() => {
    if (!configDraftValue) return '';
    const meetingLine = configPreviewMeetingType?.name
      ? `面談タイプ: ${configPreviewMeetingType.name}`
      : '面談タイプ: 未設定';
    const sectionGuide = configPromptSections
      .map((section) => {
        const helper = section.helperText ? ` / 書き方のヒント: ${section.helperText}` : '';
        return `- ${section.title} (${section.id})${helper}`;
      })
      .join('\n');
    const currentContext = configPromptSections
      .map((section) => `- ${section.id}: （手書きメモ＋AIメモの合体済み内容が入ります）`)
      .join('\n');

    return `あなたは就労支援の面談記録を作成するアシスタントです。
${meetingLine}

# 項目定義
${sectionGuide || '（セクションが未設定です）'}

# 現在のドラフト（参考）
${currentContext || '（ドラフトがありません）'}

# クリーン済み文字起こし（直近の追加分）
（ここに差分のクリーン文字起こしが入ります）

# 指示
- 会話にない情報は書かない
- 事実・感情・課題・合意・タスクを中心に、簡潔な日本語で書く（敬体不要）
- 既存の内容と同じことは繰り返さない
- 訂正や否定があれば replace を使う
- 追記なら action は "append"、全体を書き直すなら "replace"
- 変更が必要な項目だけ出力する

# 出力形式（JSONのみ）
{
  "sections": [
    { "id": "session_overview", "action": "replace", "text": "..." },
    { "id": "next_actions", "action": "append", "text": "- 利用者: ...\\n- 支援員: ..." }
  ]
}
`;
  }, [configDraftValue, configPreviewMeetingType, configPromptSections]);
  const configDraftIssues = useMemo(() => {
    const issues: string[] = [];
    if (!configDraftValue) {
      issues.push('設定が読み込まれていません。');
      return issues;
    }
    if (configDraftValue.meetingTypes.length === 0) {
      issues.push('面談タイプが未設定です。');
    }
    const meetingTypeIdSet = new Set<string>();
    configDraftValue.meetingTypes.forEach((type, index) => {
      const id = type.id.trim();
      if (!id) {
        issues.push(`面談タイプ${index + 1}: id が空です。`);
      } else if (meetingTypeIdSet.has(id)) {
        issues.push(`面談タイプidが重複しています: ${id}`);
      } else {
        meetingTypeIdSet.add(id);
      }
      if (!type.name.trim()) issues.push(`面談タイプ${index + 1}: name が空です。`);
      if (!type.timing.trim()) issues.push(`面談タイプ${index + 1}: timing が空です。`);
      if (!type.frequency.trim()) issues.push(`面談タイプ${index + 1}: frequency が空です。`);
      if (!type.purpose.trim()) issues.push(`面談タイプ${index + 1}: purpose が空です。`);
      if (!type.participants.trim()) issues.push(`面談タイプ${index + 1}: participants が空です。`);
      if (!Array.isArray(type.sections) || type.sections.length === 0) {
        issues.push(`面談タイプ${index + 1}: セクションが未設定です。`);
        return;
      }

      const sectionIdSet = new Set<string>();
      type.sections.forEach((section, sectionIndex) => {
        const sectionId = section.id.trim();
        if (!sectionId) {
          issues.push(`面談タイプ${index + 1} セクション${sectionIndex + 1}: id が空です。`);
        } else if (sectionIdSet.has(sectionId)) {
          issues.push(`面談タイプ${index + 1}: セクションidが重複しています (${sectionId})`);
        } else {
          sectionIdSet.add(sectionId);
        }
        if (!section.title.trim()) {
          issues.push(`面談タイプ${index + 1} セクション${sectionIndex + 1}: title が空です。`);
        }
        if (!section.helperText.trim()) {
          issues.push(`面談タイプ${index + 1} セクション${sectionIndex + 1}: 書き方のヒントが空です。`);
        }
        if (!section.placeholder.trim()) {
          issues.push(`面談タイプ${index + 1} セクション${sectionIndex + 1}: 記入例が空です。`);
        }
      });
    });

    return issues;
  }, [configDraftValue]);
  const canSaveConfig = configDraftIssues.length === 0 && configSaveStatus !== 'running';
  const serializeMessages = useCallback(
    (list: TranscriptMessage[]) =>
      list
        .filter((m) => m.isFinal)
        .map((m) => m.text)
        .join('\n'),
    [],
  );

  const fetchSupportRecordConfig = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetchWithAuth('/api/support-record-config', { signal });
        if (!response.ok) {
          throw new Error(`config load failed: ${response.status}`);
        }
        const json = await response.json();
        if (signal?.aborted) return false;
        const normalized = normalizeSupportRecordConfig(json?.config ?? json);
        if (!normalized) {
          throw new Error('invalid config');
        }
        setSupportRecordConfig(normalized);
        if (isAdminUnlocked) {
          setConfigDraftValue(JSON.parse(JSON.stringify(normalized)) as SupportRecordConfig);
        }
        setConfigError(null);
        return true;
      } catch (error) {
        if (signal?.aborted) return false;
        console.warn('[config] failed to load support record config', error);
        setConfigError('テンプレート設定の読み込みに失敗しました。');
        return false;
      }
    },
    [isAdminUnlocked],
  );
  useEffect(() => {
    return () => {
      stopStreaming(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (listCloseTimerRef.current) {
        window.clearTimeout(listCloseTimerRef.current);
      }
    };
  }, []);

  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
  const persistSubjectToken = useCallback(async (idToken?: string | null) => {
    const token = typeof idToken === 'string' ? idToken.trim() : '';
    if (!token) return;
    try {
      const response = await fetch('/api/ms-subject-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        console.warn('[auth] subject token persist failed', response.status, message);
      }
    } catch (error) {
      console.warn('[auth] subject token persist failed', error);
    }
  }, []);

  // BigQuery操作の前にトークンをリフレッシュする関数
  const refreshSubjectToken = useCallback(async (): Promise<boolean> => {
    if (isElectron) {
      // Electron環境では別途認証フローがある
      return true;
    }
    if (!msalInstance) {
      return false;
    }
    try {
      await ensureMsalInitialized();
      const account = getMsalAccount();
      if (!account) {
        console.warn('[auth] no account for token refresh');
        return false;
      }
      const result = await msalInstance.acquireTokenSilent({
        account,
        scopes: MSAL_LOGIN_SCOPES,
        forceRefresh: true,
      });
      if (result?.idToken) {
        await persistSubjectToken(result.idToken);
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[auth] token refresh failed', error);
      return false;
    }
  }, [isElectron, persistSubjectToken]);

  useEffect(() => {
    if (isElectron) {
      let active = true;
      (window as any).electronAPI
        ?.getAccount()
        .then((result: any) => {
          if (!active) return;
          const account = result?.account ?? null;
          setMsAccount(account);
          setMsAuthStatus(account ? 'signed-in' : 'idle');
        })
        .catch((error: any) => {
          if (!active) return;
          console.warn('[auth] electron getAccount error', error);
          setMsAuthStatus('error');
          setMsAuthError('Microsoftログインに失敗しました。');
        });
      return () => {
        active = false;
      };
    }

    if (!msalInstance) {
      setMsAuthStatus('unconfigured');
      return;
    }
    let active = true;
    ensureMsalInitialized()
      .then(() => msalInstance.handleRedirectPromise())
      .then((result) => {
        if (!active) return;
        if (result?.account) {
          msalInstance.setActiveAccount(result.account);
        }
        if (result?.idToken) {
          void persistSubjectToken(result.idToken);
        }
        const account = getMsalAccount();
        if (account) {
          setMsAccount(account);
          setMsAuthStatus('signed-in');
          setMsAuthError(null);
        } else {
          setMsAuthStatus('idle');
        }
      })
      .catch((error) => {
        if (!active) return;
        console.warn('[auth] msal redirect error', error);
        setMsAuthStatus('error');
        setMsAuthError('Microsoftログインに失敗しました。');
      });
    return () => {
      active = false;
    };
  }, [isElectron, persistSubjectToken]);

  useEffect(() => {
    if (!msAccount) return;
    if (allowedEmailDomain) {
      const username = (msAccount.username ?? '').toLowerCase();
      if (!username.endsWith(`@${allowedEmailDomain}`)) {
        return;
      }
    }
    if (msBypassUnlocked) {
      setMsBypassUnlocked(false);
      setMsBypassPin('');
      setMsBypassError(null);
    }
    const displayName = msAccount.name ?? msAccount.username ?? '';
    if (!displayName) return;
    const accountId =
      typeof msAccount.homeAccountId === 'string'
        ? msAccount.homeAccountId
        : typeof msAccount.localAccountId === 'string'
          ? msAccount.localAccountId
          : '';
    setFacilitatorName((prev) => (prev.trim() ? prev : displayName));
    setFacilitatorId((prev) => (prev.trim() ? prev : accountId));
    setInitialSetupDraft((prev) =>
      prev.facilitatorName.trim()
        ? prev
        : { ...prev, facilitatorName: displayName, facilitatorId: accountId },
    );
  }, [msAccount, allowedEmailDomain, msBypassUnlocked]);

  useEffect(() => {
    participantsRetryRef.current = false;
    if (!needsReauth) {
      reauthAttemptedRef.current = false;
    }
  }, [msAccount, isInitialSetupOpen, needsReauth]);


  useEffect(() => {

    keywordsRef.current = keywords;

  }, [keywords]);



  useEffect(() => {

    messagesRef.current = messages;

    setCleanedMessageCount((prev) => (prev > messages.length ? messages.length : prev));

  }, [messages]);



  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (NO_RETENTION_MODE) {
      setIsInitialSetupOpen(true);
      return;
    }
    try {

      const raw = window.sessionStorage.getItem(INITIAL_SETTINGS_STORAGE_KEY);

      if (!raw) {

        setIsInitialSetupOpen(true);

        return;

      }

      const data = JSON.parse(raw);

      const mode = data?.mode === 'offline' ? 'offline' : 'online';

      setSessionMode(mode);

      setAudioSource('mic');

      const facilitator = typeof data?.facilitatorName === 'string' ? data.facilitatorName : '';
      const talent = typeof data?.talentName === 'string' ? data.talentName : '';
      const facilitatorIdValue = typeof data?.facilitatorId === 'string' ? data.facilitatorId : '';
      const talentIdValue = typeof data?.talentId === 'string' ? data.talentId : '';
      const storedSessionDate =
        typeof data?.sessionDate === 'string' && data.sessionDate.trim().length > 0
          ? data.sessionDate.trim()
          : formatDateInputValue(new Date());
      setFacilitatorName(facilitator);
      setTalentName(talent);
      setFacilitatorId(facilitatorIdValue);
      setTalentId(talentIdValue);
      setSessionDate(storedSessionDate);
      const storedMeetingType =

        typeof data?.meetingTypeId === 'string' && data.meetingTypeId.trim().length > 0

          ? data.meetingTypeId.trim()

          : null;

      if (storedMeetingType) {

        setMeetingTypeId((prev) => prev ?? storedMeetingType);

        try {

          window.sessionStorage.setItem(MEETING_TYPE_STORAGE_KEY, storedMeetingType);

        } catch {}

      }

      const hasSetup = Boolean(storedMeetingType && facilitator && talent);
      setIsInitialSetupOpen(!hasSetup);
    } catch (error) {

      console.warn('[settings] failed to load initial settings', error);

      setIsInitialSetupOpen(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSupportRecordConfig(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchSupportRecordConfig]);


  useEffect(() => {
    if (NO_RETENTION_MODE || !meetingTypeId || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(MEETING_TYPE_STORAGE_KEY, meetingTypeId);
    } catch {
      // ignore storage errors
    }
  }, [meetingTypeId]);

  useEffect(() => {
    if (supportRecordCompleteStatus === 'idle') return;
    setSupportRecordCompleteStatus('idle');
  }, [cleaned, sessionDate, meetingTypeId, facilitatorId, talentId, supportRecordCompleteStatus]);

  useEffect(() => {
    if (supportRecordFinalizeStatus === 'idle' || supportRecordFinalizeStatus === 'running') return;
    setSupportRecordFinalizeStatus('idle');
  }, [cleaned, supportRecordDraft, supportRecordFinalizeStatus]);

  useEffect(() => {
    if (supportRecordCompleteStatus !== 'success') return;
    setIsFinalReviewOpen(false);
  }, [supportRecordCompleteStatus]);

  useEffect(() => {
    if (!selectedScreenSource) return;
    selectedScreenSourceRef.current = selectedScreenSource;
    setErrorMessage((prev) => (prev === '画面を選択してください。' ? null : prev));
  }, [selectedScreenSource]);

  useEffect(() => {
    supportRecordDraftSnapshotRef.current = '';
  }, [meetingTypeId]);


  useEffect(() => {
    if (!isInitialSetupOpen) return;
    setInitialSetupDraft((prev) => ({
      mode: sessionMode,
      meetingTypeId: meetingTypeId ?? '',
      sessionDate,
      facilitatorName,
      facilitatorId,
      talentName,
      talentId,
      suggestedTopics: prev.suggestedTopics, // 議題は保持
    }));
    setInitialSetupError(null);
  }, [isInitialSetupOpen, sessionMode, meetingTypeId, sessionDate, facilitatorName, facilitatorId, talentName, talentId]);

  useEffect(() => {
    if (!allowedEmailDomain) {
      setMsDomainError(null);
      return;
    }
    if (!msAccount) return;
    const username = (msAccount.username ?? '').toLowerCase();
    const isAllowed = username.endsWith(`@${allowedEmailDomain}`);
    if (isAllowed) {
      blockedMsAccountRef.current = null;
      setMsDomainError(null);
      return;
    }

    setMsDomainError(`このアプリは ${allowedEmailDomain} のアカウントのみ利用できます。`);
    setMsAuthStatus('error');
    if (blockedMsAccountRef.current === msAccount.homeAccountId) {
      setMsAccount(null);
      return;
    }
    blockedMsAccountRef.current = msAccount.homeAccountId;
    if (!msalInstance) {
      setMsAccount(null);
      return;
    }
    ensureMsalInitialized()
      .then(() => msalInstance.logoutPopup({ account: msAccount }))
      .catch((error) => {
        console.warn('[auth] msal logout error', error);
      })
      .finally(() => {
        setMsAccount(null);
        setMsAuthStatus('idle');
      });
  }, [allowedEmailDomain, msAccount]);


  useEffect(() => {
    setSupportRecordDraft((prev) => {
      const allSections = supportRecordConfig.meetingTypes.flatMap((type) => type.sections);
      const templateIds = new Set(allSections.map((section) => section.id));
      let mutated = false;
      const next: SupportRecordDraftState = { ...prev };
      allSections.forEach((section) => {
        if (!next[section.id]) {
          next[section.id] = { value: '', suggestion: null, updatedAt: null };
          mutated = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!templateIds.has(id)) {
          delete next[id];
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });
  }, [supportRecordConfig]);


  useEffect(() => {

    if (!pendingScrollTarget) return;

    if (activeView !== pendingScrollTarget) {

      setActiveView(pendingScrollTarget);

      return;

    }



    const targetMap: Record<NavTarget, RefObject<HTMLElement | null>> = {
      record: supportRecordSectionRef,
      interview: interviewSectionRef,
      chat: chatSectionRef,
    };
    const element = targetMap[pendingScrollTarget]?.current;
    if (element) {
      requestAnimationFrame(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    setPendingScrollTarget(null);

  }, [pendingScrollTarget, activeView]);



useEffect(() => {
  if (!isKeywordPanelOpen) return;
    // ... 以下続く



  const handlePointer = (event: MouseEvent) => {

    const target = event.target as Node;

    if (keywordPanelRef.current?.contains(target)) return;

    if (keywordButtonRef.current?.contains(target)) return;

    setIsKeywordPanelOpen(false);

  };



  const handleKey = (event: globalThis.KeyboardEvent) => {

    if (event.key === 'Escape') {

      setIsKeywordPanelOpen(false);

    }

  };



  document.addEventListener('mousedown', handlePointer);

  document.addEventListener('keydown', handleKey);



  return () => {
    document.removeEventListener('mousedown', handlePointer);
    document.removeEventListener('keydown', handleKey);
  };
}, [isKeywordPanelOpen]);

useEffect(() => {
  if (typeof window === 'undefined') {
    return;
    }

    if (NO_RETENTION_MODE) {
      try {
        TRANSIENT_STORAGE_KEYS.forEach((key) => {
          window.sessionStorage.removeItem(key);
          window.localStorage.removeItem(key);
        });
      } catch {
        // ignore cleanup errors
      }
      storageLoadedRef.current = true;
      return;
    }

    const readStorageItem = (key: string) => {
      const sessionValue = window.sessionStorage.getItem(key);
      if (sessionValue) return sessionValue;
      const localValue = window.localStorage.getItem(key);
      if (localValue) {
        try {
          window.localStorage.removeItem(key);
          window.sessionStorage.setItem(key, localValue);
        } catch {
          // ignore migration errors
        }
        return localValue;
      }
      return null;
    };

    const applyKeywordsFromStorage = () => {
      const stored = readStorageItem(KEYWORDS_STORAGE_KEY);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored);
        const migrated = parseStoredKeywords(parsed);
        if (migrated) {
          setKeywords(migrated);
        } else {
          window.sessionStorage.removeItem(KEYWORDS_STORAGE_KEY);
          window.localStorage.removeItem(KEYWORDS_STORAGE_KEY);
        }
      } catch (err) {
        console.warn('[storage] failed to load keywords', err);
        window.sessionStorage.removeItem(KEYWORDS_STORAGE_KEY);
        window.localStorage.removeItem(KEYWORDS_STORAGE_KEY);
      }
    };

    const applyMemosFromStorage = () => {
      const stored = readStorageItem(MEMOS_STORAGE_KEY);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored);
        const migrated = parseStoredMemos(parsed);
        if (migrated) {
          setMemos(migrated);
        } else {
          window.sessionStorage.removeItem(MEMOS_STORAGE_KEY);
          window.localStorage.removeItem(MEMOS_STORAGE_KEY);
        }
      } catch (err) {
        console.warn('[storage] failed to load memos', err);
        window.sessionStorage.removeItem(MEMOS_STORAGE_KEY);
        window.localStorage.removeItem(MEMOS_STORAGE_KEY);
      }
    };

    applyKeywordsFromStorage();
    applyMemosFromStorage();

    storageLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const clearTransientStorage = () => {
      try {
        TRANSIENT_STORAGE_KEYS.forEach((key) => {
          window.sessionStorage.removeItem(key);
          window.localStorage.removeItem(key);
        });
      } catch {
        // ignore cleanup errors
      }
    };
    window.addEventListener('beforeunload', clearTransientStorage);
    return () => {
      window.removeEventListener('beforeunload', clearTransientStorage);
    };
  }, []);

  useEffect(() => {
    if (!configDraftValue) return;
    const meetingTypes = configDraftValue.meetingTypes;
    if (meetingTypes.length === 0) {
      setConfigPreviewMeetingTypeId(null);
      return;
    }
    const currentId = configPreviewMeetingTypeId;
    if (!currentId || !meetingTypes.some((type) => type.id === currentId)) {
      setConfigPreviewMeetingTypeId(meetingTypes[0].id);
    }
  }, [configDraftValue, configPreviewMeetingTypeId]);


  useEffect(() => {

    cleanStatusRef.current = cleanStatus;

  }, [cleanStatus]);



  useEffect(() => {
    if (NO_RETENTION_MODE || !storageLoadedRef.current || typeof window === 'undefined') {
      return;
    }
    try {
      const payload = JSON.stringify({ version: STORAGE_VERSION, keywords });
      window.sessionStorage.setItem(KEYWORDS_STORAGE_KEY, payload);
    } catch (err) {
      console.warn('[storage] failed to save keywords', err);
    }
  }, [keywords]);


  useEffect(() => {
    if (NO_RETENTION_MODE || !storageLoadedRef.current || typeof window === 'undefined') {
      return;
    }
    try {
      const payload = JSON.stringify({ version: STORAGE_VERSION, memos });
      window.sessionStorage.setItem(MEMOS_STORAGE_KEY, payload);
    } catch (err) {
      console.warn('[storage] failed to save memos', err);
    }
  }, [memos]);


  useEffect(() => {

    if (typeof window === 'undefined') {

      if (!supportRecordIdRef.current) {

        supportRecordIdRef.current = `record-${Date.now()}`;

      }

      return;

    }



    if (NO_RETENTION_MODE) {

      if (!supportRecordIdRef.current) {

        supportRecordIdRef.current = `record-${Date.now()}`;

      }

      return;

    }



    let shouldFetchExisting = false;
    if (!supportRecordIdRef.current) {
      const storedId = window.sessionStorage.getItem(SUPPORT_RECORD_ID_STORAGE_KEY);
      const trimmedStoredId = storedId && storedId.trim().length > 0 ? storedId.trim() : '';
      const nextId = trimmedStoredId ? trimmedStoredId : `record-${Date.now()}`;
      supportRecordIdRef.current = nextId;
      shouldFetchExisting = Boolean(trimmedStoredId);
      try {
        window.sessionStorage.setItem(SUPPORT_RECORD_ID_STORAGE_KEY, nextId);
      } catch {
        // ignore session storage failure
      }
    } else if (typeof window !== 'undefined') {
      const storedId = window.sessionStorage.getItem(SUPPORT_RECORD_ID_STORAGE_KEY);
      shouldFetchExisting = Boolean(storedId && storedId.trim().length > 0);
    }

    const recordId = supportRecordIdRef.current;
    if (!recordId) {
      return;
    }
    if (!shouldFetchExisting) {
      return;
    }


    const controller = new AbortController();



    const fetchExistingRecord = async () => {

      try {

        const response = await fetchWithAuth(`/api/support-record/${encodeURIComponent(recordId)}`, {

          signal: controller.signal,

        });

        if (controller.signal.aborted) return;

        if (response.status === 404) {

          setSupportRecordSaveStatus('idle');

          return;

        }

        if (!response.ok) {

          throw new Error(`load failed: ${response.status}`);

        }

        const json = await response.json();

        if (controller.signal.aborted) return;

        const record = json?.record;

        if (!record) return;



        const normalizeUpdatedAt = (value: unknown): number | null => {

          if (typeof value === 'number' && Number.isFinite(value)) {

            return value;

          }

          if (typeof value === 'string') {

            const ts = Date.parse(value);

            return Number.isNaN(ts) ? null : ts;

          }

          return null;

        };



        const sectionsArray: Array<{ id: string; value: string; suggestion: string | null; updatedAt: number | null }> =

          Array.isArray(record.sections)

            ? record.sections.map((item: any) => ({

                id: item?.id ?? '',

                value: typeof item?.value === 'string' ? item.value : String(item?.value ?? ''),

                suggestion:

                  typeof item?.suggestion === 'string' && item.suggestion.trim().length > 0

                    ? item.suggestion

                    : null,

                updatedAt: normalizeUpdatedAt(item?.updatedAt),

              }))

            : Object.entries(record.sections ?? {}).map(([id, payload]: [string, any]) => ({

                id,

                value:

                  typeof payload?.value === 'string'

                    ? payload.value

                    : String(payload?.value ?? ''),

                suggestion:

                  typeof payload?.suggestion === 'string' && payload.suggestion.trim().length > 0

                    ? payload.suggestion

                    : null,

                updatedAt: normalizeUpdatedAt(payload?.updatedAt),

              }));



        const metadataMeetingTypeId =

          typeof record?.metadata?.meetingTypeId === 'string' && record.metadata.meetingTypeId.trim().length > 0

            ? record.metadata.meetingTypeId.trim()

            : null;

        if (metadataMeetingTypeId) {
          setMeetingTypeId(metadataMeetingTypeId);
        }
        setSupportRecordDraft((prev) => {
          const next = { ...prev };
          sectionsArray.forEach((payload) => {
            if (!payload?.id) return;
            const aiAppend = payload.suggestion ?? null;
            next[payload.id] = {
              value: splitSupportRecordText(payload.value ?? '', aiAppend),
              suggestion: aiAppend,
              updatedAt: payload.updatedAt,
            };
          });
          return next;
        });


        const serverUpdatedAt = normalizeUpdatedAt(record.updatedAt);

        if (serverUpdatedAt) {

          setSupportRecordLastUpdated(serverUpdatedAt);

        }

        setSupportRecordSaveStatus('success');

      } catch (error) {

        if (controller.signal.aborted) return;

        console.error('[support-record] failed to load record', error);

        setSupportRecordSaveStatus('error');

      }

    };



    fetchExistingRecord();



    return () => {

      controller.abort();

    };

  }, []);



  useEffect(() => {
    const trimmed = cleaned.trim();
    if (!trimmed) {
      setCleanPreviewText('');
      cleanPreviewUpdatedAtRef.current = 0;
      return;
    }

    const now = Date.now();

    if (!cleanPreviewText || now - cleanPreviewUpdatedAtRef.current >= CLEAN_PREVIEW_INTERVAL_MS) {

      setCleanPreviewText(trimmed);

      cleanPreviewUpdatedAtRef.current = now;
    }
  }, [cleanPreviewText, cleaned]);

  const addKeyword = useCallback(() => {
    const value = keywordInput.trim();

    if (!value) return;

    if (keywords.includes(value)) {

      setKeywordInput('');

      return;

    }

    setKeywords((prev) => [...prev, value]);

    setKeywordInput('');

  }, [keywordInput, keywords]);



  const removeKeyword = useCallback((value: string) => {

    setKeywords((prev) => prev.filter((k) => k !== value));

  }, []);



  const clearKeywords = useCallback(() => {

    setKeywords([]);

  }, []);



  const handleKeywordInputKeyDown = useCallback(

    (event: KeyboardEvent<HTMLInputElement>) => {

      if (event.key === 'Enter') {

        event.preventDefault();

        addKeyword();

      }

    },

    [addKeyword],

  );



  const handleMemoChange = useCallback(
    (field: 'fact' | 'interpretation' | 'action', event: ChangeEvent<HTMLTextAreaElement>) => {
      const { value } = event.target;
      setMemos((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    [],
  );

  const normalizeParticipants = useCallback((payload: any): Participant[] => {
    if (!Array.isArray(payload)) return [];
    return payload
      .map((item) => ({
        id: typeof item?.id === 'string' ? item.id : item?.id != null ? String(item.id) : '',
        name: typeof item?.name === 'string' ? item.name : '',
        nameKana: typeof item?.nameKana === 'string' ? item.nameKana : '',
        email: typeof item?.email === 'string' ? item.email : '',
        department: typeof item?.department === 'string' ? item.department : '',
        extras: Array.isArray(item?.extras)
          ? item.extras.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
          : [],
      }))
      .filter((item) => item.name || item.id);
  }, []);

  const fetchParticipants = useCallback(
    async (role: 'facilitator' | 'talent') => {
      setParticipantsLoading((prev) => ({ ...prev, [role]: true }));
      setParticipantsError(null);
      let errorDetail = '';
      try {
        // BigQuery操作の前にトークンをリフレッシュ
        await refreshSubjectToken();
        const response = await fetchWithAuth(`/api/participants?role=${role}`);
        if (!response.ok) {
          try {
            const errorJson = await response.json();
            errorDetail = typeof errorJson?.detail === 'string' ? errorJson.detail : '';
          } catch {
            // ignore parse errors
          }
          throw new Error(`participants fetch failed: ${response.status}`);
        }
        const json = await response.json();
        const items = normalizeParticipants(json?.items ?? []);
        if (role === 'facilitator') {
          setFacilitatorOptions(items);
        } else {
          setTalentOptions(items);
        }
      } catch (error) {
        console.warn('[participants] fetch failed', error);
        if (errorDetail === 'missing_subject_token') {
          setParticipantsError(PARTICIPANTS_MISSING_TOKEN_MESSAGE);
        } else if (errorDetail === 'invalid_subject_token' || errorDetail.includes('invalid_grant')) {
          setParticipantsError(PARTICIPANTS_EXPIRED_TOKEN_MESSAGE);
          setNeedsReauth(true);
        } else {
          setParticipantsError('参加者データの読み込みに失敗しました。');
        }
      } finally {
        setParticipantsLoading((prev) => ({ ...prev, [role]: false }));
      }
    },
    [normalizeParticipants, refreshSubjectToken],
  );

  useEffect(() => {
    if (!isInitialSetupOpen) return;
    if (participantsError) return;
    if (facilitatorOptions.length === 0 && !participantsLoading.facilitator) {
      fetchParticipants('facilitator');
    }
    if (talentOptions.length === 0 && !participantsLoading.talent) {
      fetchParticipants('talent');
    }
  }, [
    isInitialSetupOpen,
    facilitatorOptions.length,
    talentOptions.length,
    participantsLoading.facilitator,
    participantsLoading.talent,
    fetchParticipants,
  ]);

  useEffect(() => {
    if (!isInitialSetupOpen) return;
    if (!msAccount) return;
    if (needsReauth) return;
    if (
      participantsError !== PARTICIPANTS_MISSING_TOKEN_MESSAGE &&
      participantsError !== PARTICIPANTS_EXPIRED_TOKEN_MESSAGE
    )
      return;
    if (participantsRetryRef.current) return;
    if (participantsLoading.facilitator || participantsLoading.talent) return;

    participantsRetryRef.current = true;

    if (facilitatorOptions.length === 0) {
      fetchParticipants('facilitator');
    }
    if (talentOptions.length === 0) {
      fetchParticipants('talent');
    }
  }, [
    isInitialSetupOpen,
    msAccount,
    participantsError,
    participantsLoading.facilitator,
    participantsLoading.talent,
    facilitatorOptions.length,
    talentOptions.length,
    fetchParticipants,
    needsReauth,
  ]);

  const filterParticipants = useCallback((items: Participant[], query: string) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice(0, 12);
    return items
      .filter((item) => {
        const hay = [
          item.name,
          item.nameKana,
          item.email,
          item.department,
          item.id,
          ...(item.extras ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 12);
  }, []);

  const formatParticipantMeta = useCallback(
    (participant: Participant, role: 'facilitator' | 'talent') => {
      const idLabel =
        participant.id && role === 'talent'
          ? `TLID: ${participant.id}`
          : participant.id
            ? `ID: ${participant.id}`
            : '';
      const parts = [
        ...(participant.extras ?? []),
        participant.department ?? '',
        participant.email ?? '',
        participant.nameKana ?? '',
        idLabel,
      ]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);
      const unique = parts.filter((value, index, self) => self.indexOf(value) === index);
      return unique.join(' / ');
    },
    [],
  );

  const filteredFacilitators = useMemo(
    () => filterParticipants(facilitatorOptions, initialSetupDraft.facilitatorName),
    [filterParticipants, facilitatorOptions, initialSetupDraft.facilitatorName],
  );

  const filteredTalents = useMemo(
    () => filterParticipants(talentOptions, initialSetupDraft.talentName),
    [filterParticipants, talentOptions, initialSetupDraft.talentName],
  );

  const handleSelectParticipant = useCallback(
    (role: 'facilitator' | 'talent', participant: Participant) => {
      if (role === 'facilitator') {
        setInitialSetupDraft((prev) => ({
          ...prev,
          facilitatorName: participant.name || participant.id,
          facilitatorId: participant.id,
        }));
        setIsFacilitatorListOpen(false);
      } else {
        setInitialSetupDraft((prev) => ({
          ...prev,
          talentName: participant.name || participant.id,
          talentId: participant.id,
        }));
        setIsTalentListOpen(false);
      }
    },
    [],
  );

  const openParticipantList = useCallback((role: 'facilitator' | 'talent') => {
    if (listCloseTimerRef.current) {
      window.clearTimeout(listCloseTimerRef.current);
      listCloseTimerRef.current = null;
    }
    if (role === 'facilitator') {
      setIsFacilitatorListOpen(true);
    } else {
      setIsTalentListOpen(true);
    }
  }, []);

  const closeParticipantList = useCallback((role: 'facilitator' | 'talent') => {
    if (listCloseTimerRef.current) {
      window.clearTimeout(listCloseTimerRef.current);
    }
    listCloseTimerRef.current = window.setTimeout(() => {
      if (role === 'facilitator') {
        setIsFacilitatorListOpen(false);
      } else {
        setIsTalentListOpen(false);
      }
    }, 150);
  }, []);

  const handleMsLogin = useCallback(async (forceLogin = false) => {
    if (isElectron) {
      setMsAuthStatus('running');
      setMsAuthError(null);
      try {
        const result = await (window as any).electronAPI?.login();
        const account = result?.account ?? null;
        setMsAccount(account);
        setMsAuthStatus(account ? 'signed-in' : 'idle');
        if (account) {
          setNeedsReauth(false);
        }
      } catch (error) {
        console.warn('[auth] electron login error', error);
        setMsAuthStatus('error');
        setMsAuthError('Microsoftログインに失敗しました。');
      }
      return;
    }
    if (!msalInstance) {
      setMsAuthStatus('unconfigured');
      setMsAuthError('Microsoftログインの設定がありません。');
      return;
    }
    setMsAuthStatus('running');
    setMsAuthError(null);
    try {
      await ensureMsalInitialized();
      const existingAccount = getMsalAccount();
      if (forceLogin && existingAccount) {
        try {
          const silentResult = await msalInstance.acquireTokenSilent({
            account: existingAccount,
            scopes: MSAL_LOGIN_SCOPES,
            forceRefresh: true,
          });
          if (silentResult?.idToken) {
            void persistSubjectToken(silentResult.idToken);
          }
          setMsAccount(existingAccount);
          setMsAuthStatus('signed-in');
          setNeedsReauth(false);
          return;
        } catch (silentError) {
          console.warn('[auth] msal silent refresh failed', silentError);
        }
      }
      // Electron 以外（ブラウザ）では COOP でポップアップが壊れやすいので redirect flow を使う
      if (!isElectron) {
        await msalInstance.loginRedirect({
          scopes: MSAL_LOGIN_SCOPES,
          prompt: forceLogin ? 'login' : undefined,
        });
        return; // ページがリダイレクトされるのでここから先は到達しない
      }
      const result = await msalInstance.loginPopup({
        scopes: MSAL_LOGIN_SCOPES,
        prompt: forceLogin ? 'login' : undefined,
      });
      if (result?.account) {
        msalInstance.setActiveAccount(result.account);
      }
      if (result?.idToken) {
        void persistSubjectToken(result.idToken);
      }
      const account = getMsalAccount();
      setMsAccount(account);
      setMsAuthStatus(account ? 'signed-in' : 'idle');
      if (account) {
        setNeedsReauth(false);
      }
    } catch (error: any) {
      console.warn('[auth] msal login error', error);
      const errorCode = typeof error?.errorCode === 'string' ? error.errorCode : '';
      if (errorCode === 'popup_window_error' || errorCode === 'popup_window_closed') {
        try {
          await ensureMsalInitialized();
          await msalInstance.loginRedirect({ scopes: MSAL_LOGIN_SCOPES });
          return;
        } catch (redirectError) {
          console.warn('[auth] msal login redirect error', redirectError);
        }
      }
      setMsAuthStatus('error');
      setMsAuthError(errorCode ? `Microsoftログインに失敗しました（${errorCode}）。` : 'Microsoftログインに失敗しました。');
    }
  }, [isElectron, persistSubjectToken]);

  useEffect(() => {
    if (!needsReauth) return;
    if (msAuthStatus === 'running') return;
    if (reauthAttemptedRef.current) return;
    reauthAttemptedRef.current = true;
    handleMsLogin(true);
  }, [needsReauth, msAuthStatus, handleMsLogin]);

  const handleMsLogout = useCallback(async () => {
    if (isElectron) {
      setMsAuthStatus('running');
      setMsAuthError(null);
      try {
        await (window as any).electronAPI?.logout();
      } catch (error) {
        console.warn('[auth] electron logout error', error);
      } finally {
        setMsAccount(null);
        setMsAuthStatus('idle');
        setNeedsReauth(false);
        reauthAttemptedRef.current = false;
      }
      return;
    }
    if (!msalInstance) {
      setMsAccount(null);
      setMsAuthStatus('idle');
      setNeedsReauth(false);
      reauthAttemptedRef.current = false;
      return;
    }
    setMsAuthStatus('running');
    setMsAuthError(null);
    try {
      await ensureMsalInitialized();
      await msalInstance.logoutPopup({ account: msAccount ?? undefined });
    } catch (error) {
      console.warn('[auth] msal logout error', error);
      try {
        await ensureMsalInitialized();
        await msalInstance.logoutRedirect({ account: msAccount ?? undefined });
        return;
      } catch (redirectError) {
        console.warn('[auth] msal logout redirect error', redirectError);
      }
    } finally {
      setMsAccount(null);
      setMsAuthStatus('idle');
      setNeedsReauth(false);
      reauthAttemptedRef.current = false;
    }
  }, [isElectron, msAccount]);

  const handleZoomIn = useCallback(() => {
    if (!isElectron) return;
    (window as any).electronAPI?.zoomIn();
  }, [isElectron]);

  const handleZoomOut = useCallback(() => {
    if (!isElectron) return;
    (window as any).electronAPI?.zoomOut();
  }, [isElectron]);

  const handleZoomReset = useCallback(() => {
    if (!isElectron) return;
    (window as any).electronAPI?.zoomReset();
  }, [isElectron]);

  const handleMsBypassUnlock = useCallback(() => {
    if (msBypassPin.trim() === '4109') {
      setMsBypassUnlocked(true);
      setMsBypassError(null);
      return;
    }
    setMsBypassError('PINが違います。');
  }, [msBypassPin]);
  const openInitialSetup = useCallback(() => {
    setInitialSetupDraft((prev) => ({
      mode: sessionMode,
      meetingTypeId: meetingTypeId ?? '',
      sessionDate,
      facilitatorName,
      facilitatorId,
      talentName,
      talentId,
      suggestedTopics: prev.suggestedTopics, // 議題は保持
    }));
    setInitialSetupError(null);
    setIsInitialSetupOpen(true);
  }, [sessionMode, meetingTypeId, sessionDate, facilitatorName, facilitatorId, talentName, talentId]);

  const openConfigAdmin = useCallback(() => {
    setIsConfigAdminOpen(true);
    setAdminPin('');
    setIsAdminUnlocked(false);
    setConfigDraftValue(null);
    setConfigError(null);
    setConfigSaveStatus('idle');
    fetchSupportRecordConfig();
  }, [fetchSupportRecordConfig]);

  const closeConfigAdmin = useCallback(() => {
    setIsConfigAdminOpen(false);
    setAdminPin('');
    setIsAdminUnlocked(false);
    setConfigDraftValue(null);
    setConfigError(null);
    setConfigSaveStatus('idle');
  }, []);

  const handleAdminUnlock = useCallback(() => {
    if (adminPin.trim() === '4109') {
      setIsAdminUnlocked(true);
      setConfigDraftValue(JSON.parse(JSON.stringify(supportRecordConfig)) as SupportRecordConfig);
      setConfigError(null);
      setConfigSaveStatus('idle');
      return;
    }
    setConfigError('PINが違います。');
  }, [adminPin, supportRecordConfig]);

  const markConfigDraftDirty = useCallback(() => {
    if (configSaveStatus !== 'idle') {
      setConfigSaveStatus('idle');
    }
    if (configError) {
      setConfigError(null);
    }
  }, [configSaveStatus, configError]);

  const updateConfigDraftValue = useCallback(
    (updater: (prev: SupportRecordConfig) => SupportRecordConfig) => {
      setConfigDraftValue((prev) => {
        if (!prev) return prev;
        return updater(prev);
      });
      markConfigDraftDirty();
    },
    [markConfigDraftDirty],
  );

  const handleConfigSectionChange = useCallback(
    (
      meetingIndex: number,
      sectionIndex: number,
      field: keyof SupportRecordSectionDefinition,
      value: string,
    ) => {
      updateConfigDraftValue((prev) => {
        const nextMeetingTypes = prev.meetingTypes.map((type, idx) => {
          if (idx !== meetingIndex) return type;
          const nextSections = type.sections.map((section, sIdx) =>
            sIdx === sectionIndex ? { ...section, [field]: value } : section,
          );
          return { ...type, sections: nextSections };
        });
        return { ...prev, meetingTypes: nextMeetingTypes };
      });
    },
    [updateConfigDraftValue],
  );

  const handleAddConfigSection = useCallback(
    (meetingIndex: number) => {
      updateConfigDraftValue((prev) => {
        const nextMeetingTypes = prev.meetingTypes.map((type, idx) => {
          if (idx !== meetingIndex) return type;
          return {
            ...type,
            sections: [...type.sections, { id: '', title: '', helperText: '', placeholder: '' }],
          };
        });
        return { ...prev, meetingTypes: nextMeetingTypes };
      });
    },
    [updateConfigDraftValue],
  );

  const handleRemoveConfigSection = useCallback(
    (meetingIndex: number, sectionIndex: number) => {
      updateConfigDraftValue((prev) => {
        const nextMeetingTypes = prev.meetingTypes.map((type, idx) => {
          if (idx !== meetingIndex) return type;
          return {
            ...type,
            sections: type.sections.filter((_, sIdx) => sIdx !== sectionIndex),
          };
        });
        return { ...prev, meetingTypes: nextMeetingTypes };
      });
    },
    [updateConfigDraftValue],
  );

  const handleConfigMeetingTypeChange = useCallback(
    (index: number, field: MeetingTypeStringField, value: string) => {
      updateConfigDraftValue((prev) => {
        const nextMeetingTypes = prev.meetingTypes.map((type, idx) =>
          idx === index ? { ...type, [field]: value } : type,
        );
        return { ...prev, meetingTypes: nextMeetingTypes };
      });
    },
    [updateConfigDraftValue],
  );

  const handleAddConfigMeetingType = useCallback(() => {
    updateConfigDraftValue((prev) => ({
      ...prev,
      meetingTypes: [
        ...prev.meetingTypes,
        {
          id: '',
          name: '',
          timing: '',
          frequency: '',
          purpose: '',
          participants: '',
          sections: [{ id: '', title: '', helperText: '', placeholder: '' }],
        },
      ],
    }));
  }, [updateConfigDraftValue]);

  const handleRemoveConfigMeetingType = useCallback(
    (index: number) => {
      updateConfigDraftValue((prev) => ({
        ...prev,
        meetingTypes: prev.meetingTypes.filter((_, idx) => idx !== index),
      }));
    },
    [updateConfigDraftValue],
  );


  const handleCopyConfigPrompt = useCallback(async () => {
    if (!configPromptPreview) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setConfigError('クリップボードへのコピーが利用できません。');
      return;
    }
    try {
      await navigator.clipboard.writeText(configPromptPreview);
      setConfigError(null);
    } catch (error) {
      console.warn('[config] clipboard copy failed', error);
      setConfigError('コピーに失敗しました。');
    }
  }, [configPromptPreview]);

  const handleSaveConfig = useCallback(async () => {
    if (adminPin.trim() !== '4109') {
      setConfigError('PINが違います。');
      setIsAdminUnlocked(false);
      return;
    }
    if (!configDraftValue) {
      setConfigError('設定内容が読み込めていません。');
      setConfigSaveStatus('error');
      return;
    }
    const normalized = normalizeSupportRecordConfig(configDraftValue);
    if (!normalized) {
      setConfigError('設定内容が不足しています。');
      setConfigSaveStatus('error');
      return;
    }
    setConfigSaveStatus('running');
    setConfigError(null);
    try {
      const response = await fetchWithAuth('/api/support-record-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: adminPin.trim(), config: normalized }),
      });
      if (!response.ok) {
        throw new Error(`config save failed: ${response.status}`);
      }
      const json = await response.json();
      const updated = normalizeSupportRecordConfig(json?.config ?? json);
      if (!updated) {
        throw new Error('invalid config response');
      }
      setSupportRecordConfig(updated);
      setConfigDraftValue(JSON.parse(JSON.stringify(updated)) as SupportRecordConfig);
      setConfigSaveStatus('success');
      setConfigError(null);
    } catch (error) {
      console.error('[config] failed to save', error);
      setConfigSaveStatus('error');
      setConfigError('保存に失敗しました。');
    }
  }, [adminPin, configDraftValue]);
  const handleInitialSetupSubmit = useCallback(() => {
    const draft = initialSetupDraft;
    const meetingTypeValue = draft.meetingTypeId?.trim();
    const sessionDateValue = draft.sessionDate?.trim();
    const facilitator = draft.facilitatorName.trim();
    const talent = draft.talentName.trim();
    const facilitatorIdValue = draft.facilitatorId?.trim() ?? '';
    const talentIdValue = draft.talentId?.trim() ?? '';
    if (!meetingTypeValue) {
      setInitialSetupError('面談タイプを選択してください');
      return;
    }
    if (!sessionDateValue) {
      setInitialSetupError('面談日を入力してください');
      return;
    }
    if (!facilitator || !talent) {
      setInitialSetupError('面談実施者とタレント名を入力してください');
      return;
    }
    setSessionMode(draft.mode);
    setAudioSource('mic');
    setMeetingTypeId(meetingTypeValue);
    setSessionDate(sessionDateValue);
    setFacilitatorName(facilitator);
    setTalentName(talent);
    setFacilitatorId(facilitatorIdValue);
    setTalentId(talentIdValue);
    setInitialSetupError(null);
    setIsInitialSetupOpen(false);
    setAgendaSuggestion(null);

    // 議題提案を取得（MSアカウントがある場合のみ）
    const msAccountId = msAccount?.homeAccountId || msAccount?.localAccountId || '';
    if (msAccountId) {
      fetchWithAuth('/api/agenda-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msAccountId,
          userName: msAccount?.name || msAccount?.username || '',
          meetingTypeName: selectedMeetingType?.name || '',
          sessionDate: sessionDateValue,
        }),
      })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.suggestion) {
            setAgendaSuggestion(data.suggestion);
          }
        })
        .catch((err) => {
          console.warn('[agenda-suggestion] fetch failed', err);
        });
    }

    if (!NO_RETENTION_MODE) {
      try {
        window.sessionStorage.setItem(
          INITIAL_SETTINGS_STORAGE_KEY,
          JSON.stringify({
          mode: draft.mode,
          meetingTypeId: meetingTypeValue,
          sessionDate: sessionDateValue,
          facilitatorName: facilitator,
          talentName: talent,
          facilitatorId: facilitatorIdValue,
          talentId: talentIdValue,
        }),
      );
      window.sessionStorage.setItem(MEETING_TYPE_STORAGE_KEY, meetingTypeValue);

      } catch (error) {

        console.warn('[settings] failed to persist initial settings', error);

      }

    }

  }, [initialSetupDraft, supportRecordConfig, msAccount]);

  const handleSupportRecordChange = useCallback((sectionId: string, value: string) => {
    setSupportRecordDraft((prev) => {
      const previous = prev[sectionId] ?? { value: '', suggestion: null, updatedAt: null };
      const nextValue = value;
      const now = Date.now();
      return {
        ...prev,
        [sectionId]: {
          ...previous,
          value: nextValue,
          updatedAt: now,
        },
      };
    });
    setSupportRecordLastUpdated(Date.now());
    setSupportRecordSaveStatus('idle');
    if (supportRecordCompleteStatus !== 'idle') {
      setSupportRecordCompleteStatus('idle');
    }
  }, [supportRecordCompleteStatus]);


  const ensureSupportRecordId = useCallback(() => {

    if (!supportRecordIdRef.current || !supportRecordIdRef.current.trim()) {

      const nextId = `record-${Date.now()}`;

      supportRecordIdRef.current = nextId;

      if (typeof window !== 'undefined' && !NO_RETENTION_MODE) {

        try {

          window.sessionStorage.setItem(SUPPORT_RECORD_ID_STORAGE_KEY, nextId);

        } catch {

          // ignore session storage failure

        }

      }

    }

    return supportRecordIdRef.current;

  }, []);



  const saveSupportRecordDraft = useCallback(async () => {
    if (NO_RETENTION_MODE) {
      return true;
    }
    const recordId = ensureSupportRecordId();
    if (!recordId) {
      setSupportRecordSaveStatus('error');
      setErrorMessage('支援記録IDの生成に失敗しました');
      return false;
    }
    if (!supportRecordHasContent) {
      setSupportRecordSaveStatus('error');
      setErrorMessage('保存できる内容がありません');
      return false;
    }

    setSupportRecordSaveStatus('running');
    try {
      const sectionsPayload = supportRecordSections.map((section) => ({
        id: section.id,
        value: mergeSupportRecordText(section.value ?? '', section.aiAppend ?? section.suggestion ?? null),
        suggestion: section.aiAppend ?? section.suggestion ?? null,
        updatedAt:
          typeof section.updatedAt === 'number' && Number.isFinite(section.updatedAt)
            ? new Date(section.updatedAt).toISOString()
            : null,
      }));


      const response = await fetchWithAuth('/api/support-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          participantId: talentId || null,
          sessionDate: sessionDate || null,
          sections: sectionsPayload,
          metadata: {
            keywords,
            memos,
            meetingTypeId: meetingTypeId ?? null,
            meetingTypeName: currentMeetingType?.name ?? null,
            sessionMode,
            facilitatorName,
            talentName,
            facilitatorId: facilitatorId || null,
            talentId: talentId || null,
            updatedFromClientAt: new Date().toISOString(),
          },
        }),
      });



      if (!response.ok) {

        const payload = await readErrorPayload(response);

        throw new Error(buildApiErrorMessage(payload, `save failed: ${response.status}`));

      }

      const json = await response.json();

      const serverUpdatedAt =
        typeof json?.record?.updatedAt === 'string' ? Date.parse(json.record.updatedAt) : Date.now();
      setSupportRecordLastUpdated(Number.isNaN(serverUpdatedAt) ? Date.now() : serverUpdatedAt);
      setSupportRecordSaveStatus('success');
      return true;
    } catch (error) {
      console.error('[support-record] failed to save', error);
      setSupportRecordSaveStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [
    ensureSupportRecordId,
    supportRecordHasContent,
    supportRecordSections,
    keywords,
    memos,
    meetingTypeId,
    currentMeetingType,
    sessionMode,
    sessionDate,
    facilitatorName,
    talentName,
    facilitatorId,
    talentId,
  ]);

  const completeSupportRecord = useCallback(async (overrideValues?: Record<string, string>) => {
    const recordId = ensureSupportRecordId();
    if (!recordId) {
      setSupportRecordCompleteStatus('error');
      setErrorMessage('支援記録IDの生成に失敗しました');
      return;
    }
    if (!sessionDate) {
      setSupportRecordCompleteStatus('error');
      setErrorMessage('面談日を入力してください');
      return;
    }
    if (!talentId || !talentId.trim()) {
      setSupportRecordCompleteStatus('error');
      setErrorMessage('タレントIDが未設定です。タレントを選び直してください。');
      return;
    }
    const cleanedText = cleaned.trim();
    if (!cleanedText) {
      setSupportRecordCompleteStatus('error');
      setErrorMessage('クリーン済みの文字起こしがありません。先にクリーンを実行してください。');
      return;
    }

    setSupportRecordCompleteStatus('running');
    setErrorMessage(null);

    const saved = NO_RETENTION_MODE ? true : await saveSupportRecordDraft();
    if (!saved) {
      setSupportRecordCompleteStatus('error');
      return;
    }

    try {
      const sectionsPayload = supportRecordSections.map((section) => {
        const aiAppend = section.aiAppend ?? section.suggestion ?? null;
        const hasOverride =
          overrideValues && Object.prototype.hasOwnProperty.call(overrideValues, section.id);
        const finalValue = hasOverride
          ? String(overrideValues?.[section.id] ?? '')
          : mergeSupportRecordText(section.value ?? '', aiAppend);
        return {
          id: section.id,
          title: section.title,
          manual: section.value ?? '',
          ai: aiAppend,
          value: finalValue,
        };
      });

      // BigQuery操作の前にトークンをリフレッシュ
      await refreshSubjectToken();

      const maxRetries = Math.max(0, SUPPORT_RECORD_POST_RETRIES);
      let attempt = 0;
      while (true) {
        let retryable = true;
        try {
          const response = await fetchWithAuth('/api/support-record-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recordId,
              sessionDate,
              meetingTypeId: meetingTypeId ?? null,
              meetingTypeName: currentMeetingType?.name ?? null,
              sessionMode,
              facilitatorId: facilitatorId || null,
              facilitatorName,
              talentId: talentId || null,
              talentName,
              cleanedText,
              supportRecord: sectionsPayload,
              sentAt: new Date().toISOString(),
            }),
          });

          if (!response.ok) {
            const detailText = await response.text().catch(() => '');
            let retryableFromBody: boolean | null = null;
            let parsedDetail: any = null;
            if (detailText) {
              try {
                parsedDetail = JSON.parse(detailText);
                if (typeof parsedDetail?.retryable === 'boolean') {
                  retryableFromBody = parsedDetail.retryable;
                }
              } catch {}
            }
            retryable =
              typeof retryableFromBody === 'boolean'
                ? retryableFromBody
                : RETRYABLE_COMPLETE_STATUS.has(response.status);
            if (!retryable || attempt >= maxRetries) {
              const payloadForMessage = parsedDetail ?? (detailText ? { error: detailText } : null);
              const message = buildApiErrorMessage(payloadForMessage, `complete failed: ${response.status}`);
              throw new Error(message);
            }
          } else {
            break;
          }
        } catch (error) {
          if (!retryable || attempt >= maxRetries) {
            throw error;
          }
        }
        const delay = computeRetryDelay(attempt);
        await sleep(delay);
        attempt += 1;
      }
      setSupportRecordCompleteStatus('success');

      // セッション要約を非同期で生成・保存（エラーは無視）
      const msAccountIdForSummary = msAccount?.homeAccountId || msAccount?.localAccountId || '';
      if (msAccountIdForSummary) {
        fetchWithAuth('/api/session-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recordId,
            cleanedText,
            supportRecordJson: JSON.stringify(sectionsPayload),
            meetingTypeId: meetingTypeId ?? null,
            meetingTypeName: currentMeetingType?.name ?? null,
            msAccountId: msAccountIdForSummary,
            facilitatorId: facilitatorId || null,
            facilitatorName,
            talentId: talentId || null,
            talentName,
            sessionDate,
          }),
        })
          .then((res) => {
            if (res.ok) {
              console.log('[session-summary] saved successfully');
            } else {
              console.warn('[session-summary] save failed', res.status);
            }
          })
          .catch((err) => {
            console.warn('[session-summary] save error', err);
          });
      }
    } catch (error) {
      console.error('[support-record] failed to complete', error);
      setSupportRecordCompleteStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    ensureSupportRecordId,
    sessionDate,
    cleaned,
    saveSupportRecordDraft,
    supportRecordSections,
    meetingTypeId,
    currentMeetingType,
    sessionMode,
    facilitatorId,
    facilitatorName,
    talentId,
    talentName,
    msAccount,
    refreshSubjectToken,
  ]);

  const finalizeSupportRecord = useCallback(async (): Promise<boolean> => {
    if (supportRecordFinalizeStatus === 'running') return false;

    const fullTranscript = serializeMessages(messagesRef.current).trim();
    const uncertainHints = buildUncertainHints(messagesRef.current);
    if (!fullTranscript) {
      setSupportRecordFinalizeStatus('error');
      setErrorMessage('文字起こしがありません。');
      return false;
    }

    setSupportRecordFinalizeStatus('running');
    setErrorMessage(null);

    try {
      const cleanResponse = await fetchWithAuth('/api/clean-two-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: fullTranscript,
          keywords,
          uncertainHints,
        }),
      });
      if (!cleanResponse.ok) {
        const payload = await readErrorPayload(cleanResponse);
        throw new Error(buildApiErrorMessage(payload, `final clean failed: ${cleanResponse.status}`));
      }
      const cleanJson = await cleanResponse.json();
      setGeminiUsage((prev) => ({ ...prev, cleanTwoStage: cleanJson?.usage ?? null }));
      const cleanedText = typeof cleanJson?.cleanedText === 'string' ? cleanJson.cleanedText.trim() : '';
      if (!cleanedText) {
        throw new Error('final clean returned empty text');
      }

      const messageCount = messagesRef.current.length;
      const normalizedKeywords = keywords.map((kw) => kw.trim()).filter(Boolean);
      setCleaned(cleanedText);
      setCleanedMessageCount(messageCount);
      lastCleanMetaRef.current = { keywords: normalizedKeywords, cleanedCount: messageCount };
      supportRecordDraftSnapshotRef.current = cleanedText;

      const sectionsPayload = supportRecordSections.map((section) => ({
        id: section.id,
        title: section.title,
        helperText: section.helperText ?? '',
        value: mergeSupportRecordText(section.value ?? '', section.aiAppend ?? section.suggestion ?? null),
      }));

      const refineResponse = await fetchWithAuth('/api/support-record-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleanedText,
          meetingType: currentMeetingType?.name ?? null,
          sections: sectionsPayload,
        }),
      });
      if (!refineResponse.ok) {
        const payload = await readErrorPayload(refineResponse);
        throw new Error(buildApiErrorMessage(payload, `final refine failed: ${refineResponse.status}`));
      }
      const refineJson = await refineResponse.json();
      setGeminiUsage((prev) => ({ ...prev, supportRecordRefine: refineJson?.usage ?? null }));
      const updates = Array.isArray(refineJson?.sections) ? refineJson.sections : [];

      if (updates.length > 0) {
        const now = Date.now();
        setSupportRecordDraft((prev) => {
          let mutated = false;
          const next: SupportRecordDraftState = { ...prev };
          updates.forEach((update: any) => {
            const id = typeof update?.id === 'string' ? update.id.trim() : '';
            if (!id) return;
            const text = typeof update?.text === 'string' ? update.text.trim() : '';
            if (!text) return;
            const previous = next[id] ?? { value: '', suggestion: null, updatedAt: null };
            if (previous.suggestion !== text) {
              next[id] = { ...previous, suggestion: text, updatedAt: now };
              mutated = true;
            }
          });
          if (mutated) {
            setSupportRecordLastUpdated(now);
            setSupportRecordSaveStatus('idle');
          }
          return mutated ? next : prev;
        });
      }

      setSupportRecordFinalizeStatus('success');
      return true;
    } catch (error) {
      console.error('[support-record] failed to finalize', error);
      setSupportRecordFinalizeStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [
    supportRecordFinalizeStatus,
    serializeMessages,
    keywords,
    supportRecordSections,
    currentMeetingType?.name,
  ]);

  const generateAgendaProposals = useCallback(async () => {
    const recordId = ensureSupportRecordId();
    if (!recordId) {

      setAgendaStatus('error');

      setErrorMessage('支援記録IDの生成に失敗しました');

      return;

    }



    setAgendaStatus('running');

    try {

      const sectionsPayload = supportRecordSections.map((section) => ({
        id: section.id,
        title: section.title,
        value: mergeSupportRecordText(section.value ?? '', section.aiAppend ?? section.suggestion ?? null),
      }));
      const response = await fetchWithAuth('/api/agenda-proposals', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          recordId,

          supportRecord: sectionsPayload,

          memos,

          keywords,

          summary: null,

          documents: [],

        }),

      });

      if (!response.ok) {
        const payload = await readErrorPayload(response);
        throw new Error(buildApiErrorMessage(payload, `agenda failed: ${response.status}`));
      }
      const json = await response.json();
      setGeminiUsage((prev) => ({ ...prev, agenda: json?.usage ?? null }));
      setAgendaProposals(
        Array.isArray(json.agenda)

          ? json.agenda.map((item: any) => ({

              title: typeof item?.title === 'string' ? item.title : '提案項目',

              why: typeof item?.why === 'string' ? item.why : undefined,

              relatedSections: Array.isArray(item?.relatedSections) ? item.relatedSections : undefined,

              followUps: Array.isArray(item?.followUps)

                ? item.followUps.filter((entry: any) => typeof entry === 'string')

                : undefined,

            }))

          : [],

      );

      setAgendaReminders(

        Array.isArray(json.reminders)

          ? json.reminders.filter((entry: any) => typeof entry === 'string')

          : [],

      );

      setAgendaStatus('success');

    } catch (error) {

      console.error('[agenda] failed to generate proposals', error);

      setAgendaStatus('error');

      setErrorMessage(error instanceof Error ? error.message : String(error));

    }

  }, [ensureSupportRecordId, supportRecordSections, memos, keywords]);

  const buildFinalReviewDraft = useCallback(() => {
    const draft: Record<string, string> = {};
    supportRecordSections.forEach((section) => {
      const merged = mergeSupportRecordText(section.value ?? '', section.aiAppend ?? section.suggestion ?? null);
      draft[section.id] = merged;
    });
    return draft;
  }, [supportRecordSections]);

  const openFinalReview = useCallback(() => {
    setFinalReviewDraft(buildFinalReviewDraft());
    setIsFinalReviewOpen(true);
  }, [buildFinalReviewDraft]);

  const handleFinalizeAndReview = useCallback(async () => {
    const ok = await finalizeSupportRecord();
    if (ok) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      openFinalReview();
    }
  }, [finalizeSupportRecord, openFinalReview]);

  const handleFinalReviewChange = useCallback((id: string, value: string) => {
    setFinalReviewDraft((prev) => ({ ...prev, [id]: value }));
  }, []);

  const closeFinalReview = useCallback(() => {
    if (supportRecordCompleteStatus === 'running') return;
    if (supportRecordCompleteStatus === 'success') {
      setIsFinalReviewOpen(false);
      return;
    }
    const ok = window.confirm('まだ送信していません。閉じますか？');
    if (ok) {
      setIsFinalReviewOpen(false);
    }
  }, [supportRecordCompleteStatus]);

  useEffect(() => {
    if (!isFinalReviewOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFinalReview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFinalReviewOpen, closeFinalReview]);

  const generateSupportRecordDraft = useCallback(
    async (sourceText: string) => {
      const transcript = sourceText.trim();
      if (!transcript) return false;
      if (supportRecordSections.length === 0) return false;

      if (supportRecordDraftAbortRef.current) {
        supportRecordDraftAbortRef.current.abort();
      }
      const controller = new AbortController();
      supportRecordDraftAbortRef.current = controller;

      setSupportRecordDraftStatus('running');
      setErrorMessage(null);
      try {
        const sectionsPayload = supportRecordSections.map((section) => ({
          id: section.id,
          title: section.title,
          helperText: section.helperText ?? '',
          value: mergeSupportRecordText(section.value ?? '', section.aiAppend ?? section.suggestion ?? null),
        }));

        const response = await fetchWithAuth('/api/support-record-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            meetingType: currentMeetingType?.name ?? null,
            sections: sectionsPayload,
          }),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return false;
        if (!response.ok) {
          const payload = await readErrorPayload(response);
          throw new Error(buildApiErrorMessage(payload, `draft failed: ${response.status}`));
        }

        const json = await response.json();
        setGeminiUsage((prev) => ({ ...prev, supportRecordDraft: json?.usage ?? null }));
        if (controller.signal.aborted) return false;
        const updates = Array.isArray(json?.sections) ? json.sections : [];
        if (updates.length === 0) {
          setSupportRecordDraftStatus('success');
          return true;
        }

        const now = Date.now();
        let didApply = false;
        setSupportRecordDraft((prev) => {
          let mutated = false;
          const next: SupportRecordDraftState = { ...prev };
          updates.forEach((update: any) => {
            const id = typeof update?.id === 'string' ? update.id.trim() : '';
            if (!id) return;
            const rawText = typeof update?.text === 'string' ? update.text : '';
            if (!rawText || !rawText.trim()) return;
            const { cleanedText, replacements } = parseDraftReplaceText(rawText);
            if (!cleanedText && replacements.length === 0) return;
            const action = update?.action === 'append' ? 'append' : 'replace';
            const previous = next[id] ?? { value: '', suggestion: null, updatedAt: null };
            const previousAi = typeof previous.suggestion === 'string' ? previous.suggestion : '';
            let nextSuggestion = previousAi;

            if (action === 'append') {
              let baseText = previousAi;
              if (replacements.length > 0 && baseText.trim()) {
                const applied = applyReplaceDirectives(baseText, replacements);
                baseText = applied.text;
              }
              if (cleanedText) {
                if (!baseText.includes(cleanedText)) {
                  nextSuggestion = baseText.trim() ? `${baseText}\n${cleanedText}` : cleanedText;
                } else {
                  nextSuggestion = baseText;
                }
              } else {
                nextSuggestion = baseText;
              }
            } else {
              if (cleanedText) {
                nextSuggestion = cleanedText;
              } else if (replacements.length > 0 && previousAi.trim()) {
                nextSuggestion = applyReplaceDirectives(previousAi, replacements).text;
              }
            }

            if (nextSuggestion !== previousAi) {
              next[id] = {
                ...previous,
                suggestion: nextSuggestion,
                updatedAt: now,
              };
              mutated = true;
              didApply = true;
            }
          });
          return mutated ? next : prev;
        });

        if (didApply) {
          setSupportRecordLastUpdated(now);
          setSupportRecordSaveStatus('idle');
        }
        setSupportRecordDraftStatus('success');
        return true;
      } catch (error) {
        if (controller.signal.aborted) return false;
        console.error('[support-record] failed to generate draft', error);
        setSupportRecordDraftStatus('error');
        setErrorMessage(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        if (supportRecordDraftAbortRef.current === controller) {
          supportRecordDraftAbortRef.current = null;
        }
      }
    },
    [supportRecordSections, currentMeetingType?.name],
  );

  useEffect(() => {
    if (activeView !== 'record') return;
    const snapshot = cleanPreviewText.trim();
    if (!snapshot) return;
    if (supportRecordDraftStatus === 'running' || supportRecordFinalizeStatus === 'running') return;
    if (snapshot === supportRecordDraftSnapshotRef.current) return;
    const previousSnapshot = supportRecordDraftSnapshotRef.current;
    let delta = snapshot;
    if (previousSnapshot && snapshot.startsWith(previousSnapshot)) {
      delta = snapshot.slice(previousSnapshot.length).trim();
    }
    supportRecordDraftSnapshotRef.current = snapshot;
    if (!delta) return;
    generateSupportRecordDraft(delta);
  }, [activeView, cleanPreviewText, supportRecordDraftStatus, supportRecordFinalizeStatus, generateSupportRecordDraft]);

  const appendFinal = useCallback((text: string, meta: Partial<TranscriptMessage> = {}) => {
    if (!text) return;

    setMessages((prev) => [

      ...prev,

      {

        id: `${Date.now()}-${prev.length}`,

        text,

        isFinal: true,

        ...meta,

      },

    ]);

  }, []);



  const appendPartial = useCallback((text: string) => {

    setPartialText(text);

  }, []);

  const resetState = useCallback(() => {

    setMessages([]);

    setPartialText('');

    setCleaned('');

    setCleanPreviewText('');

    setErrorMessage(null);

    setCleanStatus('idle');

    setMemos({ fact: '', interpretation: '', action: '' });

    setSupportRecordDraft(createInitialSupportRecordDraft());
    setSupportRecordLastUpdated(null);
    setSupportRecordDraftStatus('idle');
    setCleanedMessageCount(0);
    lastFinalTranscriptRef.current = '';
    lastSegmentsRef.current = [];
    lastCleanMetaRef.current = { keywords: [], cleanedCount: 0 };
    cleanPreviewUpdatedAtRef.current = 0;
    supportRecordDraftSnapshotRef.current = '';
    if (supportRecordDraftAbortRef.current) {
      supportRecordDraftAbortRef.current.abort();
      supportRecordDraftAbortRef.current = null;
    }
  }, []);


  const cleanupAudio = useCallback(() => {
    try {

      processorRef.current?.disconnect();

      processorRef.current?.removeEventListener('audioprocess', () => undefined);

    } catch {

      /* noop */

    }

    try {

      audioCtxRef.current?.close();

    } catch {

      /* noop */

    }

    processorRef.current = null;

    audioCtxRef.current = null;



    if (mediaStreamRef.current) {

      mediaStreamRef.current.getTracks().forEach((t) => {

        try {

          t.stop();

        } catch {

          /* noop */

        }

      });

      mediaStreamRef.current = null;

    }
  }, []);

  const finalizeAndClose = useCallback(() => {
    cleanupAudio();

    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    finalizePendingRef.current = false;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.close(1000, 'client_stop');
      } catch {
        /* noop */
      }
    }
    wsRef.current = null;
    wsReadyRef.current = false;
    chunkCounterRef.current = 0;
    prebufferRef.current = [];
    prebufferMaxChunksRef.current = 0;
    setStatus('idle');
    setPartialText('');
  }, [cleanupAudio]);

  const stopStreaming = useCallback(
    (closeWs = true) => {
      cleanupAudio();

      if (closeWs && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        if (!finalizePendingRef.current) {
          finalizePendingRef.current = true;
          try {
            wsRef.current.send(JSON.stringify({ type: 'finalize' }));
          } catch {
            finalizePendingRef.current = false;
            finalizeAndClose();
            return;
          }

          if (finalizeTimerRef.current !== null) {
            window.clearTimeout(finalizeTimerRef.current);
          }
          finalizeTimerRef.current = window.setTimeout(() => {
            finalizeAndClose();
          }, FINALIZE_TIMEOUT_MS);
          return;
        }
      }

      finalizeAndClose();
    },
    [cleanupAudio, finalizeAndClose],
  );


  const handleWsMessage = useCallback(

    (event: MessageEvent) => {

      try {

        const data = JSON.parse(event.data as string);

        if (data.type === 'stt') {

          const isFinal = Boolean(data.isFinal || data.speechFinal);

          const text = typeof data.text === 'string' ? data.text : '';

          if (!text) {

            appendPartial('');

            return;

          }



          if (isFinal) {
            const previousFull = lastFinalTranscriptRef.current;
            lastFinalTranscriptRef.current = text;

            const lowConfidence = normalizeLowConfidenceWords(data.lowConfidence);
            const confidenceAvg =
              typeof data.confidenceAvg === 'number' ? data.confidenceAvg : null;

            const nextSegments = splitTranscriptSegments(text);
            const lastSegments = lastSegmentsRef.current;

            let segmentsToAppend: string[] = nextSegments;


            const isReset = nextSegments.length < lastSegments.length || !previousFull;



            if (!isReset && lastSegments.length > 0) {

              let diffIndex = 0;

              while (

                diffIndex < nextSegments.length &&

                diffIndex < lastSegments.length &&

                nextSegments[diffIndex] === lastSegments[diffIndex]

              ) {

                diffIndex += 1;

              }

              segmentsToAppend = nextSegments.slice(diffIndex);

            } else if (isReset) {

              segmentsToAppend = nextSegments;

            }



            if (!segmentsToAppend.length && nextSegments.length === 0 && text.trim()) {

              segmentsToAppend = [text.trim()];

            }

            lastSegmentsRef.current = nextSegments;
            const segmentLowConfidence = distributeLowConfidence(segmentsToAppend, lowConfidence);
            const meta: Partial<TranscriptMessage> = {
              speaker: data.speaker,
              ts: data.ts,
              confidenceAvg,
            };
            segmentsToAppend.forEach((segment, index) => {
              if (segment) {
                appendFinal(segment, {
                  ...meta,
                  lowConfidence: segmentLowConfidence[index] ?? [],
                });
              }
            });
            appendPartial('');
          } else {

            appendPartial(text);

        }

        return;

      }



        if (data.type === 'dg_open') {
          setStatus('streaming');
          const wsClient = wsRef.current;
          if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
          if (!wsReadyRef.current) {
            const queue = prebufferRef.current;
            if (queue.length > 0) {
              queue.forEach((payload) => {
                try {
                  wsClient.send(payload);
                  chunkCounterRef.current += 1;
                } catch {
                  // ignore send errors for buffered audio
                }
              });
              prebufferRef.current = [];
            }
            wsReadyRef.current = true;
          }
          return;
        }

        if (data.type === 'finalize_ack') {
          finalizeAndClose();
          return;
        }

        if (data.type === 'dg_closed') {
          if (finalizePendingRef.current) {
            finalizeAndClose();
          } else {
            stopStreaming(false);
          }
          return;
        }

        if (data.type === 'dg_error') {
          setStatus('error');
          setErrorMessage(data.error ?? 'Deepgram error');
          if (finalizePendingRef.current) {
            finalizeAndClose();
          }
          return;
        }
      } catch (err) {
        console.warn('[ws] non JSON frame', err);
      }
    },
    [appendFinal, appendPartial, finalizeAndClose, stopStreaming],
  );


  const floatTo16LE = (buffer: Float32Array) => {
    const out = new ArrayBuffer(buffer.length * 2);
    const view = new DataView(out);
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, buffer[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return out;
  };

  const loadScreenSources = useCallback(async () => {
    if (!isElectron) return [];
    try {
      const api = (window as any).electronAPI;
      if (!api?.getDesktopSources) {
        setUseDisplayMediaFallback(true);
        return [];
      }
      const sources = await api.getDesktopSources();
      if (!Array.isArray(sources) || sources.length === 0) {
        throw new Error('empty_sources');
      }
      const normalized = sources
        .map((source: any) => ({
          id: typeof source?.id === 'string' ? source.id : '',
          name: typeof source?.name === 'string' ? source.name : '画面',
          thumbnail: typeof source?.thumbnail === 'string' ? source.thumbnail : '',
          appIcon: typeof source?.appIcon === 'string' ? source.appIcon : '',
        }))
        .filter((source: DesktopSource) => source.id);
      if (!normalized.length) {
        throw new Error('empty_sources');
      }
      setUseDisplayMediaFallback(false);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[screen] failed to load sources', error);
      if (message && message !== 'empty_sources') {
        setErrorMessage(`画面候補の取得に失敗しました。(${message})`);
      }
      setUseDisplayMediaFallback(true);
      return [];
    }
  }, [isElectron]);

  const ensureScreenSource = useCallback(async () => {
    if (!isElectron) return null;
    if (selectedScreenSource?.id) return selectedScreenSource;
    const sources = await loadScreenSources();
    if (!sources.length) return null;
    const preferred =
      sources.find((source) => source.id.startsWith('screen')) ?? sources[0] ?? null;
    if (preferred) {
      setSelectedScreenSource(preferred);
      selectedScreenSourceRef.current = preferred;
    }
    return preferred;
  }, [isElectron, selectedScreenSource, loadScreenSources]);

  const getElectronDisplayStream = useCallback(async (withAudio: boolean, sourceId: string) => {
    if (!sourceId) {
      throw new Error('画面が選択されていません。');
    }
    const isScreenSource = sourceId.startsWith('screen');
    const shouldCaptureAudio = withAudio && isScreenSource;
    const constraints: any = {
      audio: shouldCaptureAudio
        ? {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      },
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }, []);

  const getDisplayStream = useCallback(
    async (withAudio: boolean, allowAudioFallback: boolean) => {
      if (isElectron) {
        if (useDisplayMediaFallback) {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: Boolean(withAudio),
          });
          return { stream, hasAudio: stream.getAudioTracks().length > 0, fallbackUsed: true };
        }
        const source = selectedScreenSourceRef.current ?? selectedScreenSource;
        if (!source?.id) {
          throw new Error('画面が選択されていません。');
        }
        try {
          const stream = await getElectronDisplayStream(withAudio, source.id);
          return { stream, hasAudio: stream.getAudioTracks().length > 0, fallbackUsed: false };
        } catch (error) {
          if (withAudio && allowAudioFallback) {
            const stream = await getElectronDisplayStream(false, source.id);
            return { stream, hasAudio: false, fallbackUsed: true };
          }
          throw error;
        }
      }

      const constraints = {
        video: true,
        audio: withAudio ? true : false,
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      return { stream, hasAudio: stream.getAudioTracks().length > 0, fallbackUsed: false };
    },
    [getElectronDisplayStream, isElectron, selectedScreenSource, useDisplayMediaFallback],
  );

  const startStreaming = useCallback(async () => {
    if (status === 'streaming' || status === 'connecting') return;
    finalizePendingRef.current = false;
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    setErrorMessage(null);

    const lang = 'ja';
    const model = 'nova-3';
    const rate = '48000';

    const needsScreen = audioSource === 'mixed' || audioSource === 'screen';
    if (isElectron && needsScreen && !selectedScreenSource && !useDisplayMediaFallback) {
      const resolved = await ensureScreenSource();
      if (!resolved) {
        setErrorMessage('画面候補の取得に失敗しました。');
        return;
      }
    }
    setStatus('connecting');


    const keywordList = keywordsRef.current;

    const keywordsParam =

      keywordList.length > 0 ? `&keywords=${encodeURIComponent(keywordList.join(','))}` : '';

    const wsTokenParam = await getWsTokenParam();

    const wsUrl = `${window.location.origin.replace('http', 'ws')}/ws?lang=${encodeURIComponent(

      lang,

    )}&model=${encodeURIComponent(model)}&codec=${encodeURIComponent(STREAM_CODEC)}&rate=${encodeURIComponent(

      rate,

    )}${keywordsParam}${wsTokenParam}`;



    try {
      let displayStream: MediaStream | null = null;
      let micStream: MediaStream | null = null;
      let combinedStream: MediaStream;

      if (audioSource === 'mixed') {
        const [displayResult, mic] = await Promise.all([
          getDisplayStream(true, true),
          navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: Number(rate),
            },
          }),
        ]);
        const display = displayResult.stream;
        displayStream = display;
        micStream = mic;
        displayStreamRef.current = displayStream;
        micStreamRef.current = micStream;


        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({

          sampleRate: Number(rate),

        });

        audioCtxRef.current = ctx;



        const destination = ctx.createMediaStreamDestination();



        const displayAudioTracks = displayStream.getAudioTracks();
        if (displayAudioTracks.length > 0) {
          const displaySource = ctx.createMediaStreamSource(new MediaStream([displayAudioTracks[0]]));
          displaySource.connect(destination);
        } else {
          setErrorMessage(
            isElectron
              ? 'システム音が取得できませんでした。マイクのみで続行してください。'
              : '画面共有の音声が取得できませんでした。共有ダイアログで「音声を共有」にチェックしてください。',
          );
        }


        const micAudioTracks = micStream.getAudioTracks();

        if (micAudioTracks.length > 0) {

          const micSource = ctx.createMediaStreamSource(new MediaStream([micAudioTracks[0]]));

          const gain = ctx.createGain();

          gain.gain.value = 1;

          micSource.connect(gain).connect(destination);

        }



        const mixed = new MediaStream();

        const videoTracks = displayStream.getVideoTracks();

        videoTracks.forEach((track) => mixed.addTrack(track));

        destination.stream.getAudioTracks().forEach((track) => mixed.addTrack(track));



        mixedStreamRef.current = mixed;

        mediaStreamRef.current = mixed;

        combinedStream = mixed;

      } else if (audioSource === 'screen') {
        const displayResult = await getDisplayStream(true, false);
        displayStream = displayResult.stream;
        if (!displayResult.hasAudio) {
          const message = isElectron
            ? 'システム音が取得できませんでした。マイクのみのモードに切り替えてください。'
            : '画面共有の音声が取得できませんでした。共有ダイアログで「音声を共有」にチェックしてください。';
          setStatus('error');
          setErrorMessage(message);
          stopStreaming();
          return;
        }
        displayStreamRef.current = displayStream;
        mediaStreamRef.current = displayStream;
        combinedStream = displayStream;
      } else {
        micStream = await navigator.mediaDevices.getUserMedia({

          audio: {

            channelCount: 1,

            echoCancellation: true,

            noiseSuppression: true,

            autoGainControl: true,

            sampleRate: Number(rate),

          },

        });

        micStreamRef.current = micStream;

        mediaStreamRef.current = micStream;

        combinedStream = micStream;

      }



      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      wsReadyRef.current = false;

      const rateNumber = Number(rate) || 48000;
      const chunkSize = 2048;
      const prebufferMax = Math.max(
        1,
        Math.ceil((AUDIO_PREBUFFER_MS / 1000) * (rateNumber / chunkSize)),
      );
      prebufferMaxChunksRef.current = prebufferMax;
      prebufferRef.current = [];

      const ctx =
        audioCtxRef.current ??
        new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: rateNumber,
        });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(combinedStream);
      const processor = ctx.createScriptProcessor(chunkSize, source.channelCount || 1, 1);
      processorRef.current = processor;

      processor.addEventListener('audioprocess', (event: AudioProcessingEvent) => {
        const input = event.inputBuffer;
        let channel: Float32Array;
        if (input.numberOfChannels === 2) {
          const left = input.getChannelData(0);
          const right = input.getChannelData(1);
          channel = new Float32Array(left.length);
          for (let i = 0; i < left.length; i += 1) {
            channel[i] = (left[i] + right[i]) / 2;
          }
        } else {
          channel = input.getChannelData(0);
        }
        const payload = floatTo16LE(channel);
        const wsClient = wsRef.current;
        if (wsClient && wsClient.readyState === WebSocket.OPEN && wsReadyRef.current) {
          wsClient.send(payload);
          chunkCounterRef.current += 1;
        } else {
          const queue = prebufferRef.current;
          queue.push(payload);
          const maxChunks = prebufferMaxChunksRef.current;
          if (queue.length > maxChunks) {
            queue.splice(0, queue.length - maxChunks);
          }
        }
      });

      source.connect(processor);
      processor.connect(ctx.destination);

      ws.addEventListener('open', () => {
        // Wait for upstream "dg_open" before sending buffered audio.
      });

      ws.addEventListener('message', handleWsMessage);
      ws.addEventListener('close', () => stopStreaming(false));
      ws.addEventListener('error', () => {
        setStatus('error');

        setErrorMessage('WebSocket error');

        stopStreaming(false);

      });

    } catch (err) {
      console.error('[startStreaming]', err);
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : '';
      if (errorName === 'NotFoundError' || /Requested device not found/i.test(rawMessage)) {
        if (audioSource === 'mic') {
          setErrorMessage('マイクが見つかりません。デバイス接続・権限を確認してください。');
        } else {
          setSelectedScreenSource(null);
          setErrorMessage(
            '画面/音声デバイスが見つかりません。画面の選択をやり直すか、マイクのみで開始してください。',
          );
        }
      } else if (isElectron && /Could not start video source/i.test(rawMessage)) {
        setSelectedScreenSource(null);
        const resolved = await ensureScreenSource();
        setErrorMessage(
          resolved
            ? '画面の取得に失敗しました。もう一度開始してください。'
            : '画面候補の取得に失敗しました。',
        );
      } else if (errorName === 'NotAllowedError') {
        setErrorMessage('画面共有がキャンセルされました。もう一度「共有」を実行してください。');
      } else {
        setErrorMessage(rawMessage);
      }
      setStatus('error');
      stopStreaming();
    }
  }, [
    audioSource,
    handleWsMessage,
    status,
    stopStreaming,
    isElectron,
    selectedScreenSource,
    ensureScreenSource,
    getDisplayStream,
    useDisplayMediaFallback,
  ]);


  const runClean = useCallback(async () => {
    const snapshotMessages = messagesRef.current;
    const snapshotCount = snapshotMessages.length;


    if (!snapshotCount) {

      setErrorMessage('まだ書き起こしがありません。');

      setCleanStatus('error');

      return false;

    }



    const normalizedKeywords = keywords.map((kw) => kw.trim()).filter(Boolean);

    const prevKeywords = lastCleanMetaRef.current.keywords;

    const hasExistingClean = lastCleanMetaRef.current.cleanedCount > 0 && cleaned.trim().length > 0;

    const hasNewKeyword = normalizedKeywords.some((kw) => !prevKeywords.includes(kw));

    const shouldFullClean = !hasExistingClean || hasNewKeyword;

    const sliceStart = shouldFullClean ? 0 : lastCleanMetaRef.current.cleanedCount;

    const pendingMessages = shouldFullClean ? snapshotMessages : snapshotMessages.slice(sliceStart);
    const targetText = serializeMessages(pendingMessages).trim();
    const uncertainHints = buildUncertainHints(pendingMessages);


    if (!targetText) {

      setErrorMessage('新しくクリーニングする文章がありません。');

      setCleanStatus('error');

      return false;

    }



    setCleanStatus('running');

    setErrorMessage(null);

    try {

      const response = await fetchWithAuth('/api/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: targetText,
          keywords,
          uncertainHints,
        }),
      });
      if (!response.ok) {
        const payload = await readErrorPayload(response);
        throw new Error(buildApiErrorMessage(payload, `clean failed: ${response.status}`));
      }
      const json = await response.json();
      setGeminiUsage((prev) => ({ ...prev, clean: json?.usage ?? null }));
      const chunk = (json.cleanedText ?? '').trim();
      if (!chunk) {

        throw new Error('clean returned empty text');

      }



      const baseText = shouldFullClean ? '' : cleaned.trimEnd();

      const nextCleaned = shouldFullClean ? chunk : `${baseText}${baseText ? '\n\n' : ''}${chunk}`;



      setCleaned(nextCleaned);

      setCleanStatus('success');

      setCleanedMessageCount(snapshotCount);

      lastCleanMetaRef.current = { keywords: normalizedKeywords, cleanedCount: snapshotCount };

      return true;

    } catch (err) {

      setCleanStatus('error');

      setErrorMessage(err instanceof Error ? err.message : String(err));

      return false;

    }

  }, [cleaned, keywords, serializeMessages]);



  useEffect(() => {

    const timer = setInterval(() => {

      const pendingMessages = messagesRef.current?.length ?? 0;

      const cleanedCount = lastCleanMetaRef.current.cleanedCount ?? 0;

      if (cleanStatusRef.current === 'running') return;

      if (!pendingMessages || pendingMessages <= cleanedCount) return;

      runClean();

    }, AUTO_CLEAN_INTERVAL_MS);

    return () => {

      clearInterval(timer);

    };

  }, [runClean]);







  const cleanedParagraphs = useMemo(() => {

    if (!cleanPreviewText.trim()) return [];

    return cleanPreviewText

      .replace(/\r/g, '')

      .split(/\n{2,}/)

      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())

      .filter(Boolean);

  }, [cleanPreviewText]);



  const recentLiveLines = useMemo(() => {

    const items = liveMessages.map((message) => message.text);

    const pending = partialText.trim();

    if (pending) {

      items.push(pending);

    }

    return items.slice(-2);
  }, [liveMessages, partialText]);



  const liveLineSlots = useMemo(() => {
    const slots = Array<string>(2).fill('');
    if (recentLiveLines.length === 0) return slots;
    const slice = recentLiveLines.slice(-2);
    const offset = slots.length - slice.length;
    slice.forEach((line, index) => {
      slots[offset + index] = line;
    });
    return slots;
  }, [recentLiveLines]);

  const uncertainHintsText = useMemo(() => buildUncertainHints(messages), [messages]);

  const cleanUsageLabel = formatGeminiUsage(geminiUsage.clean);
  const cleanTwoStageUsageLabel = formatGeminiTwoStageUsage(geminiUsage.cleanTwoStage);
  const draftUsageLabel = formatGeminiUsage(geminiUsage.supportRecordDraft);
  const refineUsageLabel = formatGeminiUsage(geminiUsage.supportRecordRefine);
  const agendaUsageLabel = formatGeminiUsage(geminiUsage.agenda);

  const navItems: Array<{ id: NavTarget; label: string; view?: ActiveView }> = [
    { id: 'chat', label: '会話', view: 'chat' },
    { id: 'record', label: '支援記録', view: 'record' },
    { id: 'interview', label: '面接練習', view: 'interview' },
  ];


  const handleNavClick = useCallback(
    (target: NavTarget) => {
      const targetView: ActiveView | null = target;
      if (targetView && activeView !== targetView) {
        setActiveView(targetView);
      }

      setPendingScrollTarget(target);

    },
    [activeView, setActiveView, setPendingScrollTarget],
  );

  const msAuthEnabled = isElectron || MSAL_ENABLED;
  const msAccountLabel = msAccount?.name ?? msAccount?.username ?? '';
  const msAccountAllowed =
    Boolean(msAccount) &&
    (!allowedEmailDomain ||
      (msAccount?.username ?? '').toLowerCase().endsWith(`@${allowedEmailDomain}`));
  const msStatusText = msAuthEnabled
    ? msAccountAllowed
      ? msAccountLabel || '未ログイン'
      : msBypassUnlocked
        ? 'PIN解除中'
        : '許可外アカウント'
    : '未設定';
  const msIndicatorClass = msAccountAllowed
    ? 'bg-emerald-500'
    : msAuthEnabled
      ? msBypassUnlocked
        ? 'bg-sky-500'
        : 'bg-amber-400'
      : 'bg-slate-300';
  const msActionLabel = msAccount ? 'ログアウト' : msAuthStatus === 'running' ? 'ログイン中…' : 'ログイン';
  const msActionHandler = msAccount ? handleMsLogout : handleMsLogin;
  const msRedirectMismatch =
    !isElectron &&
    MSAL_ENABLED &&
    typeof window !== 'undefined' &&
    MSAL_REDIRECT_URI &&
    window.location.origin !== MSAL_REDIRECT_URI;


  return (

    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_#fff7fb,_#f3f7ff)] text-slate-900">

      <aside className="hidden w-64 bg-gradient-to-b from-pink-400 via-rose-400 to-indigo-400 px-6 py-8 text-white md:flex">

        <div className="sticky top-8 flex h-fit flex-col gap-8">

          <div className="space-y-1">

            <div className="text-xs uppercase tracking-[0.45em] text-white/70">Good Morning</div>

            <div className="text-2xl font-extrabold tracking-wide">アセス君</div>

            <p className="text-sm text-white/80">おはようアセスメントの相棒</p>

          </div>

          <nav className="flex flex-col gap-2 text-sm">

            {navItems.map((item) => {

              const isActive = item.view ? activeView === item.view : false;

              return (

                <button

                  key={item.id}

                  type="button"

                  onClick={() => handleNavClick(item.id)}

                  className={cn(

                    'rounded-full px-4 py-2 text-left text-white transition-colors',

                    isActive ? 'bg-white/25 shadow-lg shadow-white/20' : 'text-white/80 hover:bg-white/10',

                  )}

                  aria-current={isActive ? 'page' : undefined}

                >

                  {item.label}

                </button>

              );

            })}

          </nav>

          <div className="text-xs text-white/70">Powered by Deepgram × Gemini</div>

        </div>

      </aside>



      <main className="flex flex-1 flex-col overflow-hidden">

        <header className="flex-shrink-0 z-40 flex flex-wrap items-center gap-3 border-b border-pink-100 bg-white/95 px-6 py-4 shadow-[0_6px_25px_rgba(240,149,190,0.15)] backdrop-blur supports-[backdrop-filter]:bg-white/80">

          <div className="flex flex-col">

            <span className="text-sm font-medium text-slate-500">アセス君のごきげん</span>

          </div>

          <div className={cn('flex flex-1 flex-wrap items-center gap-2', activeView === 'record' ? '' : 'hidden')}>
              <div className="flex flex-col gap-1 text-xs text-slate-500">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-600">
                    {currentMeetingType?.name ?? '面談タイプ未設定'}
                  </span>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
                    {sessionDate ? `面談日: ${sessionDate}` : '面談日未設定'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-pink-200 text-pink-600 hover:bg-pink-50"
                    onClick={openInitialSetup}
                >
                  設定
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-200 text-slate-600 hover:bg-slate-50"
                  onClick={openConfigAdmin}
                >
                  テンプレート管理
                </Button>
              </div>
              <div>

                面談実施: {facilitatorName || '---'} ／ タレント: {talentName || '---'}

              </div>

              <div>実施形態: {sessionMode === 'offline' ? 'オフライン（マイクのみ）' : 'オンライン（マイク＋システム音）'}</div>

            </div>

            <div className="ml-auto flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
                <span className={cn('h-2 w-2 rounded-full', msIndicatorClass)} aria-hidden />
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Microsoft</span>
                  <span className="max-w-[140px] truncate text-xs">{msStatusText}</span>
                </div>
                {msAuthEnabled && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-1 h-7 rounded-full px-3 text-xs"
                    onClick={msActionHandler}
                    disabled={msAuthStatus === 'running'}
                  >
                    {msActionLabel}
                  </Button>
                )}
              </div>
              {isElectron && (
                <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 shadow-sm">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 rounded-full px-0 text-sm"
                    onClick={handleZoomOut}
                  >
                    −
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 rounded-full px-0 text-sm"
                    onClick={handleZoomIn}
                  >
                    ＋
                  </Button>
                </div>
              )}
            </div>
          </div>

        </header>

        {errorMessage && (
          <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}
        {msAuthError && (
          <div className="mx-6 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {msAuthError}
          </div>
        )}
        {needsReauth && (
          <div className="mx-6 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>{PARTICIPANTS_EXPIRED_TOKEN_MESSAGE}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleMsLogin(true)}
              disabled={msAuthStatus === 'running'}
            >
              {msAuthStatus === 'running' ? '再ログイン中…' : '再ログイン'}
            </Button>
          </div>
        )}
        {msDomainError && (
          <div className="mx-6 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {msDomainError}
          </div>
        )}
        {msRedirectMismatch && (
          <div className="mx-6 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            MicrosoftログインのリダイレクトURLが一致していません。
            現在のURL: {typeof window !== 'undefined' ? window.location.origin : ''} ／
            設定: {MSAL_REDIRECT_URI}
          </div>
        )}


        <div className="flex flex-1 flex-col gap-0 lg:flex-row min-h-0 overflow-hidden">

          <section className="flex flex-1 flex-col min-h-0 overflow-hidden">
            {activeView === 'record' && (
              <div className="flex-1 overflow-auto px-6 py-6">
                <section ref={supportRecordSectionRef} className="flex flex-col gap-6">
                <SupportRecordPanel
                  sections={supportRecordSections}
                  onSectionChange={handleSupportRecordChange}
                  onSave={NO_RETENTION_MODE ? undefined : saveSupportRecordDraft}
                  onFinalize={finalizeSupportRecord}
                  onComplete={handleFinalizeAndReview}
                  saveStatus={supportRecordSaveStatus}
                  finalizeStatus={supportRecordFinalizeStatus}
                  completeStatus={supportRecordCompleteStatus}
                  isSaveDisabled={!supportRecordHasContent || supportRecordSaveStatus === 'running'}
                  isFinalizeDisabled={
                    supportRecordFinalizeStatus === 'running' || messages.length === 0
                  }
                  isCompleteDisabled={
                    supportRecordCompleteStatus === 'running' ||
                    supportRecordFinalizeStatus === 'running'
                  }
                  lastUpdatedAt={supportRecordLastUpdated}
                  busy={supportRecordDraftStatus === 'running'}
                />
                {(draftUsageLabel || refineUsageLabel) && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <div className="font-semibold text-slate-500">Geminiトークン</div>
                    {draftUsageLabel && <div>ドラフト: {draftUsageLabel}</div>}
                    {refineUsageLabel && <div>リファイン: {refineUsageLabel}</div>}
                  </div>
                )}
                <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm shadow-slate-100">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-900">次回アジェンダの提案</h3>
                      <p className="text-xs text-slate-500">
                        保存済みドラフトと支援メモ、キーワードを参考に次回面談で確認したいテーマを提案します。
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={generateAgendaProposals}
                        disabled={agendaStatus === 'running'}
                      >
                        {agendaStatus === 'running' ? '生成中…' : '提案を生成'}
                      </Button>
                      {agendaStatus === 'error' && (
                        <span className="text-xs font-medium text-red-600">生成に失敗しました</span>
                      )}
                      {agendaStatus === 'success' && (
                        <span className="text-xs font-medium text-emerald-600">最新の提案を表示中</span>
                      )}
                    </div>
                  </div>
                  {agendaUsageLabel && (
                    <div className="mt-2 text-xs text-slate-500">
                      Geminiトークン: {agendaUsageLabel}
                    </div>
                  )}
                  <div className="mt-4 space-y-4">
                    {agendaStatus === 'running' && (
                      <p className="text-sm text-slate-500">提案を生成しています…</p>
                    )}
                    {agendaStatus !== 'running' && agendaProposals.length === 0 && agendaReminders.length === 0 && (
                      <p className="text-sm text-slate-500">
                        まだ提案が生成されていません。必要に応じて「提案を生成」を押してください。
                      </p>
                    )}
                    {agendaProposals.length > 0 && (
                      <div className="space-y-4">
                        {agendaProposals.map((item, index) => (
                          <div
                            key={`${item.title}-${index}`}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-sm font-semibold text-slate-900">
                                {index + 1}. {item.title}
                              </h4>
                              {item.relatedSections && item.relatedSections.length > 0 && (
                                <span className="text-xs text-slate-500">
                                  関連: {item.relatedSections.join(', ')}
                                </span>
                              )}
                            </div>
                            {item.why && <p className="mt-2 text-sm text-slate-600">{item.why}</p>}
                            {item.followUps && item.followUps.length > 0 && (
                              <div className="mt-3">
                                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                                  フォローアップ
                                </p>
                                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
                                  {item.followUps.map((followUp, followIndex) => (
                                    <li key={`${followUp}-${followIndex}`}>{followUp}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {agendaReminders.length > 0 && (
                      <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">注意事項</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                          {agendaReminders.map((reminder, reminderIndex) => (
                            <li key={`${reminder}-${reminderIndex}`}>{reminder}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
                </section>
              </div>
            )}

            {activeView === 'chat' && (
              <section ref={chatSectionRef} className="flex-1 flex flex-col min-h-0 p-4">
                <ChatPanel
                  disableVoice={status === 'streaming'}
                  onReauthRequired={() => setNeedsReauth(true)}
                  context={cleaned}
                  initialMessage={agendaSuggestion}
                  userInfo={{ name: msAccount?.name || msAccount?.username || '' }}
                  msAccountId={msAccount?.homeAccountId || msAccount?.localAccountId || ''}
                  prepareVoice={voicePrepared}
                />
              </section>
            )}

            {activeView === 'interview' && (
              <section ref={interviewSectionRef} className="flex-1 flex flex-col min-h-0 p-4">
                <InterviewPracticePanel cleanedText={cleaned} />
              </section>
            )}
          </section>


        </div>

      </main>

      {isInitialSetupOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/70 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl shadow-pink-200/40 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-pink-400 mb-2">Welcome</p>
            <h2 className="text-2xl font-semibold text-slate-900 mb-6">おはようアセス君</h2>

            <div className="mb-8 p-6 rounded-2xl bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500 mb-2">ログイン中のアカウント</p>
              <p className="text-lg font-semibold text-slate-900">{msAccount?.name || msAccount?.username || '不明'}</p>
              <p className="text-sm text-slate-500">{msAccount?.username || ''}</p>
            </div>

            <Button
              onClick={async () => {
                setIsWelcomeLoading(true);
                setAudioSource('mic');
                // 音声準備を開始（Deepgram接続）
                setVoicePrepared(true);
                // 議題提案を取得（待ってから画面を開く）
                const msAccountId = msAccount?.homeAccountId || msAccount?.localAccountId || '';
                if (msAccountId) {
                  try {
                    const res = await fetchWithAuth('/api/agenda-suggestion', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        msAccountId,
                        userName: msAccount?.name || msAccount?.username || '',
                        meetingTypeName: '',
                        sessionDate: new Date().toISOString().slice(0, 10),
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (data?.suggestion) {
                        setAgendaSuggestion(data.suggestion);
                      }
                    }
                  } catch (err) {
                    console.warn('[agenda-suggestion] fetch failed', err);
                  }
                }
                // 議題提案取得後に画面を開く
                setIsWelcomeLoading(false);
                setIsInitialSetupOpen(false);
              }}
              className="px-12 py-4 text-lg"
              disabled={isWelcomeLoading}
            >
              {isWelcomeLoading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  準備中...
                </span>
              ) : (
                'スタート'
              )}
            </Button>
          </div>
        </div>
      )}

      {/* 旧初期設定画面（非表示） */}
      {false && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/70 px-4 py-10">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl shadow-pink-200/40">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">

              <div>

                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-pink-400">Initial Setup</p>

                <h2 className="text-lg font-semibold text-slate-900">面談の初期設定</h2>

                <p className="text-sm text-slate-500">オンライン/オフライン、面談タイプ、参加者情報を設定します。</p>

              </div>

              {hasInitialSettings && (

                <Button variant="ghost" onClick={() => setIsInitialSetupOpen(false)}>

                  キャンセル

                </Button>

              )}

            </div>



            <div className="space-y-6">

              <section className="space-y-3">

                <h3 className="text-sm font-semibold text-slate-900">1. 面談の実施形態</h3>

                <div className="grid gap-3 md:grid-cols-2">

                  <label

                    className={cn(

                      'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm',

                      initialSetupDraft.mode === 'online' ? 'border-pink-400 bg-pink-50' : 'border-slate-200 bg-white',

                    )}

                  >

                    <input

                      type="radio"

                      className="mt-1"

                      checked={initialSetupDraft.mode === 'online'}

                      onChange={() =>

                        setInitialSetupDraft((prev) => ({

                          ...prev,

                          mode: 'online',

                        }))

                      }

                    />

                    <div>

                      <p className="text-sm font-semibold text-slate-900">オンライン（マイク＋システム音）</p>

                      <p className="text-xs text-slate-500">録音ソースをマイクとシステム音のミックスに設定します。</p>

                    </div>

                  </label>

                  <label

                    className={cn(

                      'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm',

                      initialSetupDraft.mode === 'offline' ? 'border-pink-400 bg-pink-50' : 'border-slate-200 bg-white',

                    )}

                  >

                    <input

                      type="radio"

                      className="mt-1"

                      checked={initialSetupDraft.mode === 'offline'}

                      onChange={() =>

                        setInitialSetupDraft((prev) => ({

                          ...prev,

                          mode: 'offline',

                        }))

                      }

                    />

                    <div>

                      <p className="text-sm font-semibold text-slate-900">オフライン（マイクのみ）</p>

                      <p className="text-xs text-slate-500">録音ソースをマイク入力のみに設定します。</p>

                    </div>

                  </label>

                </div>

              </section>



              <section className="space-y-3">

                <h3 className="text-sm font-semibold text-slate-900">2. 面談タイプの選択</h3>

                <div className="grid gap-3 md:grid-cols-2">

                  {supportRecordConfig.meetingTypes.map((type) => {
                    const isActive = initialSetupDraft.meetingTypeId === type.id;

                    return (

                      <button

                        key={type.id}

                        type="button"

                        onClick={() =>

                          setInitialSetupDraft((prev) => ({

                            ...prev,

                            meetingTypeId: type.id,

                          }))

                        }

                        className={cn(

                          'rounded-2xl border px-5 py-4 text-left shadow-sm transition hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent/40',

                          isActive ? 'border-pink-400 bg-pink-50' : 'border-slate-200 bg-white',

                        )}

                      >

                        <div className="flex items-center justify-between gap-2">

                          <h3 className="text-base font-semibold text-slate-900">{type.name}</h3>

                          {isActive && (

                            <span className="rounded-full bg-pink-500/20 px-2 py-0.5 text-xs font-semibold text-pink-700">

                              選択中

                            </span>

                          )}

                        </div>

                        <p className="mt-2 text-sm text-slate-600">{type.purpose}</p>

                        <dl className="mt-3 space-y-1 text-xs text-slate-500">

                          <div>

                            <dt className="font-semibold text-slate-700">タイミング</dt>

                            <dd>{type.timing}</dd>

                          </div>

                          <div>

                            <dt className="font-semibold text-slate-700">頻度</dt>

                            <dd>{type.frequency}</dd>

                          </div>

                          <div>

                            <dt className="font-semibold text-slate-700">参加者</dt>

                            <dd>{type.participants}</dd>

                          </div>

                        </dl>

                      </button>

                    );

                  })}

                </div>

              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">3. 面談日</h3>
                <div className="max-w-sm">
                  <input
                    type="date"
                    value={initialSetupDraft.sessionDate}
                    onChange={(event) =>
                      setInitialSetupDraft((prev) => ({
                        ...prev,
                        sessionDate: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">4. 参加者情報</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-600" htmlFor="facilitator-input">
                      面談実施者
                    </label>
                    <div className="relative">
                      <input
                        id="facilitator-input"
                        value={initialSetupDraft.facilitatorName}
                        onChange={(event) =>
                          setInitialSetupDraft((prev) => ({
                            ...prev,
                            facilitatorName: event.target.value,
                            facilitatorId: '',
                          }))
                        }
                        onFocus={() => openParticipantList('facilitator')}
                        onBlur={() => closeParticipantList('facilitator')}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="例: 佐藤 支援員"
                        autoComplete="off"
                      />
                      {isFacilitatorListOpen && (
                        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                          {participantsLoading.facilitator ? (
                            <div className="px-4 py-3 text-xs text-slate-500">読み込み中…</div>
                          ) : filteredFacilitators.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-slate-500">候補がありません</div>
                          ) : (
                            <div className="max-h-60 overflow-y-auto">
                              {filteredFacilitators.map((item) => {
                                const meta = formatParticipantMeta(item, 'facilitator');
                                return (
                                  <button
                                    key={`fac-${item.id}-${item.name}`}
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      handleSelectParticipant('facilitator', item);
                                    }}
                                    className="flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-slate-50"
                                  >
                                    <span className="font-medium text-slate-900">
                                      {item.name || item.id}
                                    </span>
                                    {meta && (
                                      <span className="text-xs text-slate-500">
                                        {meta}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-600" htmlFor="talent-input">
                      被面談者（タレント）
                    </label>
                    <div className="relative">
                      <input
                        id="talent-input"
                        value={initialSetupDraft.talentName}
                        onChange={(event) =>
                          setInitialSetupDraft((prev) => ({
                            ...prev,
                            talentName: event.target.value,
                            talentId: '',
                          }))
                        }
                        onFocus={() => openParticipantList('talent')}
                        onBlur={() => closeParticipantList('talent')}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="例: 田中 花子"
                        autoComplete="off"
                      />
                      {isTalentListOpen && (
                        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                          {participantsLoading.talent ? (
                            <div className="px-4 py-3 text-xs text-slate-500">読み込み中…</div>
                          ) : filteredTalents.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-slate-500">候補がありません</div>
                          ) : (
                            <div className="max-h-60 overflow-y-auto">
                              {filteredTalents.map((item) => {
                                const meta = formatParticipantMeta(item, 'talent');
                                return (
                                  <button
                                    key={`tal-${item.id}-${item.name}`}
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      handleSelectParticipant('talent', item);
                                    }}
                                    className="flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-slate-50"
                                  >
                                    <span className="font-medium text-slate-900">
                                      {item.name || item.id}
                                    </span>
                                    {meta && (
                                      <span className="text-xs text-slate-500">
                                        {meta}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {participantsError && (
                  <p className="text-xs text-amber-600">
                    {participantsError}（BigQueryの設定や接続を確認してください）
                  </p>
                )}
              </section>
            </div>



            {initialSetupError && (

              <p className="mt-4 text-sm text-red-600">{initialSetupError}</p>

            )}



            <div className="mt-6 flex justify-end gap-3">

              {hasInitialSettings && (

                <Button variant="ghost" onClick={() => setIsInitialSetupOpen(false)}>

                  キャンセル

                </Button>

              )}

              <Button onClick={handleInitialSetupSubmit}>設定を保存してはじめる</Button>

            </div>

          </div>

        </div>
      )}

      {isConfigAdminOpen && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-900/70 px-4 py-10">
          <div className="my-10 w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl shadow-slate-300/40">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Template Admin</p>
                <h2 className="text-lg font-semibold text-slate-900">支援記録テンプレート管理</h2>
                <p className="text-sm text-slate-500">PINを入力した管理者のみ編集できます。</p>
              </div>
              <Button variant="ghost" onClick={closeConfigAdmin}>
                閉じる
              </Button>
            </div>

            {!isAdminUnlocked ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-600" htmlFor="config-pin-input">
                    管理者PIN
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      id="config-pin-input"
                      type="password"
                      inputMode="numeric"
                      value={adminPin}
                      onChange={(event) => setAdminPin(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleAdminUnlock();
                        }
                      }}
                      className="w-48 rounded-2xl border border-slate-200 px-4 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      placeholder="PINを入力"
                      autoFocus
                    />
                    <Button onClick={handleAdminUnlock}>ロック解除</Button>
                  </div>
                </div>
                {configError && <p className="text-sm text-red-600">{configError}</p>}
                <p className="text-xs text-slate-500">
                  PINが一致するとテンプレート編集画面が表示されます。
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">テンプレート編集</h3>
                    <p className="text-xs text-slate-500">フォーム入力で壊れにくく編集できます。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fetchSupportRecordConfig()}
                      disabled={configSaveStatus === 'running'}
                    >
                      最新を読み込み
                    </Button>
                    <Button size="sm" onClick={handleSaveConfig} disabled={!canSaveConfig}>
                      {configSaveStatus === 'running' ? '保存中…' : '保存'}
                    </Button>
                  </div>
                </div>

                {configDraftValue ? (
                  <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                    <div className="space-y-6">
                      <section className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">面談タイプ</h4>
                          <Button size="sm" variant="outline" onClick={handleAddConfigMeetingType}>
                            面談タイプを追加
                          </Button>
                        </div>
                        {configDraftValue.meetingTypes.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                            面談タイプがまだありません。追加してください。
                          </div>
                        )}
                        <div className="space-y-4">
                          {configDraftValue.meetingTypes.map((type, index) => (
                            <details
                              key={`meeting-${index}`}
                              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                            >
                              <summary className="cursor-pointer list-none">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">
                                      {type.name || `面談タイプ ${index + 1}`}
                                    </p>
                                    <p className="text-xs text-slate-500">{type.id || 'id未設定'}</p>
                                  </div>
                                  <span className="text-xs text-slate-400">開く</span>
                                </div>
                              </summary>

                              <div className="mt-4 space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-slate-900">
                                    面談タイプ {index + 1} の詳細
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-600 hover:bg-red-50"
                                    onClick={() => handleRemoveConfigMeetingType(index)}
                                  >
                                    削除
                                  </Button>
                                </div>

                                <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-slate-600">id</label>
                                  <input
                                    value={type.id}
                                    onChange={(event) =>
                                      handleConfigMeetingTypeChange(index, 'id', event.target.value)
                                    }
                                    className={cn(
                                      'w-full rounded-2xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200',
                                      type.id.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                    )}
                                    placeholder="例: assessment"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-slate-600">name</label>
                                  <input
                                    value={type.name}
                                    onChange={(event) =>
                                      handleConfigMeetingTypeChange(index, 'name', event.target.value)
                                    }
                                    className={cn(
                                      'w-full rounded-2xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200',
                                      type.name.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                    )}
                                    placeholder="例: アセスメント面談"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-slate-600">timing</label>
                                  <input
                                    value={type.timing}
                                    onChange={(event) =>
                                      handleConfigMeetingTypeChange(index, 'timing', event.target.value)
                                    }
                                    className={cn(
                                      'w-full rounded-2xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200',
                                      type.timing.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                    )}
                                    placeholder="例: 利用開始時・計画更新時"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs font-semibold text-slate-600">frequency</label>
                                  <input
                                    value={type.frequency}
                                    onChange={(event) =>
                                      handleConfigMeetingTypeChange(index, 'frequency', event.target.value)
                                    }
                                    className={cn(
                                      'w-full rounded-2xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200',
                                      type.frequency.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                    )}
                                    placeholder="例: 必要なタイミングで実施"
                                  />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                  <label className="text-xs font-semibold text-slate-600">purpose</label>
                                  <textarea
                                    value={type.purpose}
                                    onChange={(event) =>
                                      handleConfigMeetingTypeChange(index, 'purpose', event.target.value)
                                    }
                                    className={cn(
                                      'min-h-[3.5rem] w-full resize-none rounded-2xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200',
                                      type.purpose.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                    )}
                                    placeholder="面談の目的"
                                  />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                  <label className="text-xs font-semibold text-slate-600">participants</label>
                                  <textarea
                                    value={type.participants}
                                    onChange={(event) =>
                                      handleConfigMeetingTypeChange(index, 'participants', event.target.value)
                                    }
                                    className={cn(
                                      'min-h-[3.5rem] w-full resize-none rounded-2xl border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200',
                                      type.participants.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                    )}
                                    placeholder="参加者"
                                  />
                                </div>
                                </div>

                                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-semibold text-slate-600">セクション</p>
                                      <p className="text-xs text-slate-500">
                                        この面談タイプに表示する項目を編集します。
                                      </p>
                                    </div>
                                    <Button size="sm" variant="outline" onClick={() => handleAddConfigSection(index)}>
                                      セクションを追加
                                    </Button>
                                  </div>
                                  {type.sections.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-xs text-slate-500">
                                      セクションがまだありません。追加してください。
                                    </div>
                                  )}
                                  <div className="space-y-3">
                                    {type.sections.map((section, sectionIndex) => (
                                      <div
                                        key={`${type.id}-section-${sectionIndex}`}
                                        className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <p className="text-xs font-semibold text-slate-700">
                                              セクション {sectionIndex + 1}
                                            </p>
                                            <p className="text-xs text-slate-400">{section.id || 'id未設定'}</p>
                                          </div>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-red-600 hover:bg-red-50"
                                            onClick={() => handleRemoveConfigSection(index, sectionIndex)}
                                          >
                                            削除
                                          </Button>
                                        </div>
                                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                                          <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-600">id</label>
                                            <input
                                              value={section.id}
                                              onChange={(event) =>
                                                handleConfigSectionChange(index, sectionIndex, 'id', event.target.value)
                                              }
                                              className={cn(
                                                'w-full rounded-xl border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-200',
                                                section.id.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                              )}
                                              placeholder="例: session_overview"
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-600">title</label>
                                            <input
                                              value={section.title}
                                              onChange={(event) =>
                                                handleConfigSectionChange(
                                                  index,
                                                  sectionIndex,
                                                  'title',
                                                  event.target.value,
                                                )
                                              }
                                              className={cn(
                                                'w-full rounded-xl border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-200',
                                                section.title.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                              )}
                                              placeholder="例: 面談サマリー"
                                            />
                                          </div>
                                          <div className="space-y-1 md:col-span-2">
                                          <label className="text-xs font-semibold text-slate-600">書き方のヒント</label>
                                            <textarea
                                              value={section.helperText}
                                              onChange={(event) =>
                                                handleConfigSectionChange(
                                                  index,
                                                  sectionIndex,
                                                  'helperText',
                                                  event.target.value,
                                                )
                                              }
                                              className={cn(
                                                'min-h-[2.5rem] w-full resize-none rounded-xl border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-200',
                                                section.helperText.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                              )}
                                            placeholder="書き方のヒント"
                                            />
                                          </div>
                                          <div className="space-y-1 md:col-span-2">
                                          <label className="text-xs font-semibold text-slate-600">記入例</label>
                                            <textarea
                                              value={section.placeholder}
                                              onChange={(event) =>
                                                handleConfigSectionChange(
                                                  index,
                                                  sectionIndex,
                                                  'placeholder',
                                                  event.target.value,
                                                )
                                              }
                                              className={cn(
                                                'min-h-[2.5rem] w-full resize-none rounded-xl border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-200',
                                                section.placeholder.trim() ? 'border-slate-200' : 'border-red-300 bg-red-50',
                                              )}
                                            placeholder="例: ◯◯について整理する"
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </details>
                          ))}
                        </div>
                      </section>
                    </div>

                    <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">Geminiプロンプトの見え方</h4>
                          <p className="text-xs text-slate-500">面談タイプを切り替えて影響を確認できます。</p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCopyConfigPrompt}
                          disabled={!configPromptPreview}
                        >
                          コピー
                        </Button>
                      </div>
                      <div className="mt-3 space-y-2">
                        <label className="text-xs font-semibold text-slate-600">プレビュー対象の面談タイプ</label>
                        <select
                          value={configPreviewMeetingTypeId ?? ''}
                          onChange={(event) => setConfigPreviewMeetingTypeId(event.target.value || null)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                        >
                          {configDraftValue.meetingTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                        </select>
                        <div className="text-xs text-slate-500">
                          表示セクション数: {configPromptSections.length}
                        </div>
                      </div>
                      <ScrollArea className="mt-3 h-[60vh] rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <pre className="whitespace-pre-wrap break-words text-xs text-slate-700">
                          {configPromptPreview || '---'}
                        </pre>
                      </ScrollArea>
                    </aside>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    設定を読み込み中…
                  </div>
                )}

                {configDraftIssues.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                    <p className="font-semibold">入力不足があります</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {configDraftIssues.slice(0, 4).map((issue, idx) => (
                        <li key={`${issue}-${idx}`}>{issue}</li>
                      ))}
                      {configDraftIssues.length > 4 && (
                        <li>ほか {configDraftIssues.length - 4} 件</li>
                      )}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {configSaveStatus === 'success' && (
                    <span className="font-semibold text-emerald-600">保存しました。</span>
                  )}
                  {configSaveStatus === 'error' && (
                    <span className="font-semibold text-red-600">保存に失敗しました。</span>
                  )}
                  {configError && <span className="text-red-600">{configError}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {msAuthEnabled && !msAccountAllowed && !msBypassUnlocked && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/70 px-4 py-10">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl shadow-slate-300/40">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Login Required</p>
              <h2 className="text-lg font-semibold text-slate-900">Microsoftログインが必要です</h2>
              <p className="text-sm text-slate-600">
                このアプリは社内アカウントでのログインが必須です。
              </p>
              {allowedEmailDomain && (
                <p className="text-sm text-slate-600">
                  利用できるドメイン: <span className="font-semibold">@{allowedEmailDomain}</span>
                </p>
              )}
            </div>
            {msDomainError && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {msDomainError}
              </div>
            )}
            {msAuthError && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {msAuthError}
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={handleMsLogin} disabled={msAuthStatus === 'running'}>
                {msAuthStatus === 'running' ? 'ログイン中…' : 'Microsoftでログイン'}
              </Button>
              {msAccount && (
                <Button variant="outline" onClick={handleMsLogout}>
                  ログアウト
                </Button>
              )}
            </div>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Admin Bypass</p>
              <p className="mt-1 text-sm">緊急時のみ、管理者PINで一時的に利用を許可できます。</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  value={msBypassPin}
                  onChange={(event) => setMsBypassPin(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleMsBypassUnlock();
                    }
                  }}
                  className="w-32 rounded-full border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  placeholder="PIN"
                />
                <Button variant="outline" onClick={handleMsBypassUnlock}>
                  PINで続行
                </Button>
              </div>
              {msBypassError && <p className="mt-2 text-sm text-red-600">{msBypassError}</p>}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              ログインできない場合は、管理者にアカウント権限をご確認ください。
            </p>
          </div>
        </div>
      )}

      {isFinalReviewOpen && (
        <div className="fixed inset-0 z-[180] flex items-start justify-center overflow-y-auto bg-slate-900/70 px-4 py-10">
          <div className="my-8 w-full max-w-5xl rounded-3xl bg-white p-6 shadow-2xl shadow-slate-300/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Final Review</p>
                <h2 className="text-lg font-semibold text-slate-900">送信前チェック</h2>
                <p className="text-sm text-slate-500">
                  AIメモと手書きメモを合体した最終版を編集できます（元のメモは変更しません）。
                </p>
              </div>
              <Button variant="ghost" onClick={closeFinalReview} disabled={supportRecordCompleteStatus === 'running'}>
                閉じる
              </Button>
            </div>
            {finalReviewNotice && (
              <div className={cn('mt-4 rounded-xl border px-4 py-3 text-sm', finalReviewNoticeClass)}>
                {finalReviewNotice}
              </div>
            )}

            <div className="mt-6 space-y-4">
              {supportRecordSections.map((section) => {
                const value = finalReviewDraft[section.id] ?? '';
                return (
                  <article
                    key={`final-${section.id}`}
                    className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                    <textarea
                      rows={6}
                      value={value}
                      onChange={(event) => handleFinalReviewChange(section.id, event.target.value)}
                      className="min-h-[12rem] w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-inner focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/60"
                    />
                  </article>
                );
              })}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <Button variant="outline" onClick={closeFinalReview} disabled={supportRecordCompleteStatus === 'running'}>
                戻る
              </Button>
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => completeSupportRecord(finalReviewDraft)}
                disabled={supportRecordCompleteStatus === 'running' || Boolean(completeGuardMessage)}
              >
                {supportRecordCompleteStatus === 'running' ? '送信中…' : 'この内容で送信'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


