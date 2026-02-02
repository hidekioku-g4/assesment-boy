// server/server.js (ESM) - ���A���^�C�������x���@�\�Ή��Łi2�i�K�^�C���A�E�g���S�Łj
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { getCleaningPrompt } from './prompts/cleaning.js';
import { getCleaningStage1Prompt, getCleaningStage2Prompt } from './prompts/cleaning-two-stage.js';
import { getAgendaPrompt } from './prompts/agenda.js';
import { getSupportRecordDraftPrompt } from './prompts/support-record-draft.js';
import { getSupportRecordRefinePrompt } from './prompts/support-record-refine.js';
import { getInterviewFeedbackPrompt } from './prompts/interview-feedback.js';
import { getChatPrompt } from './prompts/chat.js';
import { getSessionSummaryPrompt, getAgendaSuggestionPrompt } from './prompts/session-summary.js';
import { getFaceFeedbackPrompt } from './prompts/face-feedback.js';
import { getMetaSummaryPrompt } from './prompts/meta-summary.js';
import { fetchParticipants, insertSupportRecord, insertSessionSummary, fetchSessionSummaries, fetchUserProfile, upsertUserProfile, countSessionSummaries, fetchSuggestedTopics } from './bigquery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DATA_DIR = process.env.APP_DATA_DIR
  ? path.resolve(process.env.APP_DATA_DIR)
  : path.join(__dirname, '..');


const PORT = process.env.PORT || 3000;
const DG_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const EMIT_TRANSCRIPT_COMPAT = (process.env.EMIT_TRANSCRIPT_COMPAT ?? 'true') !== 'false';
const NO_RETENTION_MODE = (process.env.NO_RETENTION_MODE ?? 'true') !== 'false';
const DEFAULT_DEEPGRAM_MODEL = process.env.DG_DEFAULT_MODEL || 'nova-3';
const DEFAULT_KEYWORDS = [
  'Thankslab:5',
  '�A�J�p���x��:5',
  '�A�Z�X�����g:3',
  '�T�e���{:5',
  '���j�^�����O:3',
  '�ʎx���v��:4',
];

const LOW_CONFIDENCE_THRESHOLD = Number(process.env.DG_LOW_CONFIDENCE_THRESHOLD ?? 0.75);
const LOW_CONFIDENCE_MAX_WORDS = Number(process.env.DG_LOW_CONFIDENCE_MAX_WORDS ?? 24);


console.log('[boot] ENV OK:', Boolean(DG_API_KEY), 'Gemini:', Boolean(GEMINI_API_KEY));

const app = express();
app.use(express.json({ limit: '10mb' }));

const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const DEFAULT_GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  process.env.GEMINI_DEFAULT_MODEL ||
  'gemini-2.0-flash';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 60000);
const GEMINI_RETRIES = Number(process.env.GEMINI_RETRIES ?? 2);
const GEMINI_RETRY_BASE_MS = Number(process.env.GEMINI_RETRY_BASE_MS ?? 800);
const GEMINI_RETRY_MAX_MS = Number(process.env.GEMINI_RETRY_MAX_MS ?? 5000);
const RETRYABLE_GEMINI_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const SUPPORT_RECORD_CONFIG_DIR = path.join(APP_DATA_DIR, 'config');
const SUPPORT_RECORD_CONFIG_FILE = path.join(SUPPORT_RECORD_CONFIG_DIR, 'support-record.json');
const SUPPORT_RECORD_CONFIG_PIN = process.env.SUPPORT_RECORD_CONFIG_PIN || '4109';
const SUBJECT_TOKEN_FILE =
  process.env.GCP_WIF_SUBJECT_TOKEN_FILE ||
  process.env.WIF_SUBJECT_TOKEN_FILE ||
  path.join(APP_DATA_DIR, 'config', 'ms-id-token.txt');

const TTS_VOICE_NAME = process.env.TTS_VOICE_NAME || 'ja-JP-Neural2-B';
const TTS_LANGUAGE_CODE = process.env.TTS_LANGUAGE_CODE || 'ja-JP';
const TTS_AUDIO_ENCODING = process.env.TTS_AUDIO_ENCODING || 'MP3';
const TTS_SPEAKING_RATE = Number(process.env.TTS_SPEAKING_RATE ?? 1.25);
const TTS_PITCH = Number(process.env.TTS_PITCH ?? 0);
const TTS_MAX_CHARS = Number(process.env.TTS_MAX_CHARS ?? 4000);

let ttsClientPromise = null;
const resolveCredentialPath = (value) => {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
};
const resolveSubjectTokenPath = () =>
  path.isAbsolute(SUBJECT_TOKEN_FILE) ? SUBJECT_TOKEN_FILE : path.join(process.cwd(), SUBJECT_TOKEN_FILE);
const parseJwtPayload = (token) => {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw.padEnd(raw.length + ((4 - (raw.length % 4)) % 4), '=');
  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};
const persistSubjectToken = async (token) => {
  const filePath = resolveSubjectTokenPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, token, 'utf8');
  return filePath;
};
const getTtsClient = async () => {
  if (!ttsClientPromise) {
    ttsClientPromise = import('@google-cloud/text-to-speech')
      .then((mod) => {
        const Client = mod.TextToSpeechClient || mod.default?.TextToSpeechClient;
        if (!Client) {
          throw new Error('TextToSpeechClient not found');
        }
        const keyFilename = resolveCredentialPath(
          process.env.GCP_WIF_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
        );
        const projectId =
          process.env.GCP_PROJECT_ID ||
          process.env.GOOGLE_CLOUD_PROJECT ||
          process.env.BQ_PROJECT_ID ||
          undefined;
        const options = {};
        if (keyFilename) {
          options.keyFilename = keyFilename;
        }
        if (projectId) {
          options.projectId = projectId;
        }
        return new Client(options);
      });
  }
  return ttsClientPromise;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const computeRetryDelay = (attempt, baseMs = GEMINI_RETRY_BASE_MS, maxMs = GEMINI_RETRY_MAX_MS) => {
  const jitter = Math.random() * baseMs;
  return Math.min(maxMs, baseMs * Math.pow(2, attempt) + jitter);
};

const withTimeout = (promise, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('gemini_timeout');
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const summarizeGeminiError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof error?.response?.status === 'number'
        ? error.response.status
        : typeof error?.statusCode === 'number'
          ? error.statusCode
          : typeof error?.response?.statusCode === 'number'
            ? error.response.statusCode
            : null;
  const code =
    typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null;
  const reason = typeof error?.reason === 'string' ? error.reason : null;
  const lower = String(message || '').toLowerCase();
  const retryable =
    RETRYABLE_GEMINI_STATUS.has(status) ||
    ['etimedout', 'econnreset', 'eai_again', 'enotfound'].includes(String(code).toLowerCase()) ||
    lower.includes('timeout') ||
    lower.includes('rate') ||
    lower.includes('quota') ||
    lower.includes('resource exhausted') ||
    lower.includes('unavailable') ||
    lower.includes('response was empty') ||
    lower.includes('stage1 response was empty') ||
    lower.includes('stage2 response was empty');
  return { retryable, status, code, reason, message };
};

const generateGeminiContent = async (payload, label = 'gemini') => {
  const maxRetries = Math.max(0, GEMINI_RETRIES);
  let attempt = 0;
  while (true) {
    try {
      return await withTimeout(genAI.models.generateContent(payload), GEMINI_TIMEOUT_MS);
    } catch (error) {
      const summary = summarizeGeminiError(error);
      if (!summary.retryable || attempt >= maxRetries) {
        const wrapped = new Error(summary.message || 'gemini_error');
        wrapped.details = summary;
        wrapped.label = label;
        throw wrapped;
      }
      const delay = computeRetryDelay(attempt);
      await sleep(delay);
      attempt += 1;
    }
  }
};

const respondGeminiError = (res, error, label) => {
  const details = error?.details ?? summarizeGeminiError(error);
  const retryable = Boolean(details?.retryable);
  const status = details?.status ?? null;
  const code = details?.code ?? null;
  const reason = details?.reason ?? null;
  const safeMessage =
    typeof details?.message === 'string' && details.message.trim().length > 0
      ? details.message
      : 'gemini_error';
  console.error(`[${label}] error`, { message: safeMessage, status, code, reason, retryable });
  res.status(500).json({ error: 'gemini_error', retryable, status, code, reason });
};

const DEFAULT_SUPPORT_RECORD_CONFIG = {
  sections: [
    {
      id: 'session_overview',
      title: '�ʒk�T�}���[',
      helperText: '�ʒk�ŋ��L���ꂽ��Șb���w�i�A���p�҂̋C�������܂Ƃ߂܂��B',
      placeholder:
        '��: ���p�҂͒ʏ��y�[�X���T3���ɑ��₷���j����]���A�ʒk�ł͒��߂̉ۑ�Ɛ����̌������L�B',
    },
    {
      id: 'current_status',
      title: '����E�ۑ�',
      helperText: '�A�J�����Ɍ��������݁E���育�ƁE�����󋵂ȂǁA�x�������c�������ŐV�����L�ڂ��܂��B',
      placeholder: '��: ���̋N����9���O��ň���B�������Y���͉��P�X�������A�T�㔼�͔�ꂪ�o�₷���B',
    },
    {
      id: 'support_plan',
      title: '�x�����j�E�x�����e',
      helperText: '�ʒk�ō��ӂ����x�����j�┺�����e�A���������𐮗����܂��B',
      placeholder: '��: ����O�X�g���b�`�Ɠ���̃`�F�b�N���p���B����܂łɊ�ƌ��w�̓����Ă��x�������񎦂���B',
    },
    {
      id: 'next_actions',
      title: '����܂ł̃A�N�V����',
      helperText: '���p�ҁE�x�������ꂼ��̏h���m�F������񋓂��܂��B',
      placeholder: '��: ���p�҂�1�T�Ԃ̍s���L�^�������B�x�����͖ʐڗ��K�̌��������L�B',
    },
    {
      id: 'shared_notes',
      title: '���L�E���L����',
      helperText: '��Â�Ƒ��A�g�A���ӂ��K�v�Ȏ����A���X�N�Ȃǂ𐮗����ċ��L���܂��B',
      placeholder: '��: �ʉ@����������萅�j�ߑO�ɕύX�B�Ƒ��Ƃ̎O�Җʒk���������B',
    },
  ],
  meetingTypes: [
    {
      id: 'assessment',
      name: '�A�Z�X�����g�ʒk',
      timing: '���p�J�n���E�v��X�V��',
      frequency: '�K�v�ȃ^�C�~���O�Ŏ��{',
      purpose: '�{�l�̐S�g�󋵂��]�A��������c���E���͂���B',
      participants: '�T�[�r�X�Ǘ��ӔC�ҁA���p��',
      sectionOverrides: {
        session_overview: {
          helperText: '�A�Z�X�����g�Ŋm�F�����w�i�E��]�E�C�Â��̗v�_�𐮗����܂��B',
          placeholder:
            '��: ���p�J�n�O�̑̒��␶�����Y���A�A�J�Ɍ����ďd�����Ă��鉿�l�ςɂ��ăq�A�����O�B�Ƒ��̈ӌ���x���������L�B',
        },
        current_status: {
          helperText: '�S�g�̏�ԁE�������Y���E���݂Ɖۑ�ȂǁA�A�Z�X�����g���ʂ��܂Ƃ߂܂��B',
          placeholder:
            '��: ������6���ԑO��A�T2?3��̒ʏ��ő̗͂�����B�W�����Ԃ�40�����x�ŁA���ӂȍ�Ƃ͐ڋq�B�ۑ�͒��̋N���Ə�񐮗��B',
        },
        support_plan: {
          helperText: '����̎x���ŗD�悵�����e�[�}��K�v�Ȋ��������L�ڂ��܂��B',
          placeholder: '��: �������Y���̈��艻�x���A�K���]���A�R�~���j�P�[�V�������K��3�����ڕW�Ōv��B�K�v�ɉ�����Ë@�ւƘA�g�B',
        },
      },
    },
    {
      id: 'individual_support',
      name: '�ʎx����c',
      timing: '�ʎx���v��̍쐬�E�ύX��',
      frequency: '�v�挩�����̓x�Ɏ��{',
      purpose: '�ʎx���v��̌��Ă��������A���e���m�肷��B',
      participants: '�T�[�r�X�Ǘ��ӔC�ҁA�S���E���A���p�ҁA�K�v�ɉ����ĉƑ���',
      sectionOverrides: {
        session_overview: {
          helperText: '�ʎx���v��Ăɉ����āA�c�_�����|�C���g���܂Ƃ߂܂��B',
          placeholder: '��: �ڕW3�{���i�������Y���^�E�ƃX�L���^���N�Ǘ��j���m�F�B�{�l�̊�]�𓥂܂��Ď����X�e�b�v�𒲐��B',
        },
        support_plan: {
          helperText: '�v��Ăɐ��荞�ގx�����j�E�������S�𖾊m�ɋL�ڂ��܂��B',
          placeholder:
            '��: �����ʂ͎x����A�����j�^�����O�A�E�ƃX�L���͐E�Ǝw����B���T1���b�X���A��Öʂ͉Ƒ��Ƌ��L���Ď�f����񋟁B',
        },
        shared_notes: {
          helperText: '���莖����֌W�҂Ƃ̋��L�����A���ӓ_���L�ڂ��܂��B',
          placeholder: '��: 3������̌v�挩������ݒ�B�Ƒ��֌v����e��X���\��B�x����c�c���^�𗈏T�܂łɋ��L�B',
        },
        next_actions: {
          helperText: '�v�搄�i�̂��߂̃^�X�N�E���؂�񋓂��܂��B',
          placeholder: '��: ���p�ҁ�����t�H�[�}�b�g�����s�A�x�������T���ʒk�����{�A�Ƒ������}�̐����m�F���ĘA���B',
        },
      },
    },
    {
      id: 'monitoring',
      name: '���j�^�����O�ʒk',
      timing: '�Œ�3������1��i�K�v�ɉ����Ė����j',
      frequency: '���',
      purpose: '�v��̎��{�󋵂�B���x���m�F���A�p���E�ύX�𔻒f����B',
      participants: '�T�[�r�X�Ǘ��ӔC�ҁA���p��',
      sectionOverrides: {
        session_overview: {
          helperText: '�O�񂩂獡��܂ł̎��g�ݏ󋵂ƕω����܂Ƃ߂܂��B',
          placeholder:
            '��: �N�������͕���7:30�Œ蒅�B�ʏ������͌�12��14��ɑ����B�ʐڗ��K��1����{���A���M�������Ɣ����B',
        },
        next_actions: {
          helperText: '���񃂃j�^�����O�܂łɊm�F�������s����ڕW��񋓂��܂��B',
          placeholder: '��: ���̃��[�e�B���L�^���p���B����܂łɐE�ƍu����1��Q���B�x�����͎��K�����2���񎦂���B',
        },
        support_plan: {
          helperText: '�p���E�ύX����x�����e��T�|�[�g�����|�C���g���L�ڂ��܂��B',
          placeholder: '��: �ʐڗ��K�̕p�x���u�T�����T�֕ύX�B�ʏ����Y������ɍ��킹�ĒʋΌP�����āB',
        },
      },
    },
    {
      id: 'service_meeting',
      name: '�T�[�r�X�S���҉�c',
      timing: '�v��쐬�E�X�V���i�v�摊�k�x���𗘗p����ꍇ�j',
      frequency: '�v��̍X�V��',
      purpose: '���k�x��������Ẩ�c�ŘA�g�Ɩ������S���m�F����B',
      participants: '���k�x�������A�T�[�r�X�Ǘ��ӔC�ҁA���p�ҁA���̑��֌W��',
      sectionOverrides: {
        session_overview: {
          helperText: '��c�ŋ��L���ꂽ�w�i�E�ړI�E���k���e���L���܂��B',
          placeholder: '��: �v�摊�k�x���̍X�V�Ɍ����A�A�J�ڍs�����ʏA�J�ւ̃X�e�b�v�𐮗��B�A�J�p��B�^���I�����Ƃ��Č����B',
        },
        shared_notes: {
          helperText: '�֌W�@�ւƂ̘A�g���e��������S�A���ӎ������ڂ����L���܂��B',
          placeholder: '��: ���k�x���������n���[���[�N�A�g�A���Ə����E����K�����A�Ƒ��������x���̐��̊m�F�B',
        },
        support_plan: {
          helperText: '�e�@�ցE�S���҂��S���x�����e�ƃX�P�W���[���𖾊m�ɂ��܂��B',
          placeholder: '��: 4�����ɍ����K������{���A5������A�J�A�Z�X�����g�ֈڍs�B�T���Ői�����`���b�g���L�B',
        },
      },
    },
    {
      id: 'case_meeting',
      name: '�P�[�X��c',
      timing: '�K�v���i�����j',
      frequency: '�K�v�ɉ����ĊJ��',
      purpose: '�A�E�����E�g���u���E��ØA�g�Ȃǉۑ肪�������ۂɏ�񋤗L�ƕ��j������s���B',
      participants: '�֌W�@�ցi�n���[���[�N�A�a�@���j�A�E���A���p��',
      sectionOverrides: {
        session_overview: {
          helperText: '���������ۑ��w�i�A���L���ꂽ���𐮗����܂��B',
          placeholder: '��: �E��ł̃g���u���ɂ��A�J�p��������Ƃ̘A���B�{�l�̏󋵂Ɗ�Ƒ��̗v�]�𐮗����A��Ï������L�B',
        },
        support_plan: {
          helperText: '���ӂ����Ή���E�����E�������ӏ������ł܂Ƃ߂܂��B',
          placeholder:
            '��: �@��ƖK��ŏ󋵊m�F�i�x����A�A���T�Ηj�j�A�A��t�Ə��A�g�i�Ƒ��o�R�A���j�j�A�B�K�v�Ȃ畔���ύX���āi��Ƒ��j�B',
        },
        shared_notes: {
          helperText: '�֌W�@�ււ̘A�������⃊�X�N�Ǘ��|�C���g���L�^���܂��B',
          placeholder: '��: ��s���莞�̑Ή��}�j���A�������L�B�A����������{���B�ً}���͉Ƒ�����Á����Ə��̏��ŘA���B',
        },
        next_actions: {
          helperText: '�ً}�x�E�D��x�̍����A�N�V�����𖾊m�ɂ��܂��B',
          placeholder: '��: 3���ȓ��ɃP�[�X�J���t�@�����X���ʂ��֌W�҂֑��t�B�����c����2�T�Ԍ�ɐݒ�B',
        },
      },
    },
  ],
};

const SUPPORT_RECORD_DATA_DIR = path.join(APP_DATA_DIR, 'data');
const SUPPORT_RECORD_STORE_FILE = path.join(SUPPORT_RECORD_DATA_DIR, 'support-records.json');

const parseKeyword = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return null;
  const idx = value.indexOf(':');
  if (idx === -1) return { term: value, boost: null };
  const term = value.slice(0, idx).trim();
  const boostRaw = value.slice(idx + 1).trim();
  if (!term) return null;
  const boost = Number(boostRaw);
  return Number.isFinite(boost) ? { term, boost } : { term, boost: null };
};

const mergeKeywords = (base, extra) => {
  const merged = new Map();
  const add = (value) => {
    const parsed = parseKeyword(value);
    if (!parsed) return;
    const key = parsed.term.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, parsed);
      return;
    }
    if (parsed.boost !== null && (existing.boost === null || parsed.boost > existing.boost)) {
      merged.set(key, parsed);
    }
  };
  base.forEach(add);
  extra.forEach(add);
  return Array.from(merged.values()).map((item) =>
    item.boost !== null ? `${item.term}:${item.boost}` : item.term,
  );
};

const appendUncertainHints = (prompt, uncertainHints) => {
  const hints = typeof uncertainHints === 'string' ? uncertainHints.trim() : '';
  if (!hints) return prompt;
  return `${prompt}

[Uncertain recognition hints]
${hints}

Instructions: Focus on correcting only these uncertain parts. Do not rewrite other content. If unsure, leave the original text as-is.`;
};

const collectSupportRecordSectionIds = (config) => {
  const ids = new Set();
  if (Array.isArray(config?.meetingTypes)) {
    config.meetingTypes.forEach((type) => {
      if (!Array.isArray(type?.sections)) return;
      type.sections.forEach((section) => {
        const id = typeof section?.id === 'string' ? section.id.trim() : '';
        if (id) ids.add(id);
      });
    });
  }
  if (ids.size === 0 && Array.isArray(config?.sections)) {
    config.sections.forEach((section) => {
      const id = typeof section?.id === 'string' ? section.id.trim() : '';
      if (id) ids.add(id);
    });
  }
  return ids;
};

let supportRecordConfig = DEFAULT_SUPPORT_RECORD_CONFIG;
let supportRecordSectionIds = collectSupportRecordSectionIds(supportRecordConfig);

async function ensureSupportRecordDataDir() {
  try {
    if (!existsSync(SUPPORT_RECORD_DATA_DIR)) {
      mkdirSync(SUPPORT_RECORD_DATA_DIR, { recursive: true });
    }
  } catch (error) {
    console.error('[support-record] �f�B���N�g���쐬���s', error);
    throw error;
  }
}

async function ensureSupportRecordConfigDir() {
  try {
    if (!existsSync(SUPPORT_RECORD_CONFIG_DIR)) {
      mkdirSync(SUPPORT_RECORD_CONFIG_DIR, { recursive: true });
    }
  } catch (error) {
    console.error('[config] �f�B���N�g���쐬���s', error);
    throw error;
  }
}

const normalizeSectionList = (sectionsRaw) => {
  if (!Array.isArray(sectionsRaw)) return null;
  const sections = [];
  const ids = new Set();
  for (const section of sectionsRaw) {
    const id = typeof section?.id === 'string' ? section.id.trim() : '';
    const title = typeof section?.title === 'string' ? section.title.trim() : '';
    const helperText = typeof section?.helperText === 'string' ? section.helperText.trim() : '';
    const placeholder = typeof section?.placeholder === 'string' ? section.placeholder.trim() : '';
    if (!id || !title || !helperText || !placeholder) return null;
    if (ids.has(id)) return null;
    ids.add(id);
    sections.push({ id, title, helperText, placeholder });
  }
  if (!sections.length) return null;
  return { sections, ids };
};

const applySectionOverrides = (baseSections, overridesRaw) =>
  baseSections.map((section) => {
    const patch = overridesRaw && typeof overridesRaw === 'object' ? overridesRaw[section.id] : null;
    if (!patch || typeof patch !== 'object') return section;
    const next = { ...section };
    if (typeof patch.title === 'string' && patch.title.trim()) {
      next.title = patch.title.trim();
    }
    if (typeof patch.helperText === 'string' && patch.helperText.trim()) {
      next.helperText = patch.helperText.trim();
    }
    if (typeof patch.placeholder === 'string' && patch.placeholder.trim()) {
      next.placeholder = patch.placeholder.trim();
    }
    return next;
  });

const normalizeSupportRecordConfig = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw;
  const meetingTypesRaw = Array.isArray(candidate.meetingTypes) ? candidate.meetingTypes : null;
  if (!meetingTypesRaw) return null;

  const meetingTypeIds = new Set();
  const hasInlineSections = meetingTypesRaw.some((type) => Array.isArray(type?.sections));

  if (hasInlineSections) {
    const meetingTypes = meetingTypesRaw
      .map((type) => {
        const id = typeof type?.id === 'string' ? type.id.trim() : '';
        const name = typeof type?.name === 'string' ? type.name.trim() : '';
        const timing = typeof type?.timing === 'string' ? type.timing.trim() : '';
        const frequency = typeof type?.frequency === 'string' ? type.frequency.trim() : '';
        const purpose = typeof type?.purpose === 'string' ? type.purpose.trim() : '';
        const participants = typeof type?.participants === 'string' ? type.participants.trim() : '';
        if (!id || !name || !timing || !frequency || !purpose || !participants) return null;
        if (meetingTypeIds.has(id)) return null;
        meetingTypeIds.add(id);
        const normalizedSections = normalizeSectionList(type?.sections);
        if (!normalizedSections) return null;
        return {
          id,
          name,
          timing,
          frequency,
          purpose,
          participants,
          sections: normalizedSections.sections,
        };
      })
      .filter(Boolean);
    return meetingTypes.length ? { meetingTypes } : null;
  }

  const baseSections = normalizeSectionList(candidate.sections);
  if (!baseSections) return null;
  const meetingTypes = meetingTypesRaw
    .map((type) => {
      const id = typeof type?.id === 'string' ? type.id.trim() : '';
      const name = typeof type?.name === 'string' ? type.name.trim() : '';
      const timing = typeof type?.timing === 'string' ? type.timing.trim() : '';
      const frequency = typeof type?.frequency === 'string' ? type.frequency.trim() : '';
      const purpose = typeof type?.purpose === 'string' ? type.purpose.trim() : '';
      const participants = typeof type?.participants === 'string' ? type.participants.trim() : '';
      if (!id || !name || !timing || !frequency || !purpose || !participants) return null;
      if (meetingTypeIds.has(id)) return null;
      meetingTypeIds.add(id);
      const sections = applySectionOverrides(baseSections.sections, type?.sectionOverrides);
      return { id, name, timing, frequency, purpose, participants, sections };
    })
    .filter(Boolean);

  return meetingTypes.length ? { meetingTypes } : null;
};

const updateSupportRecordConfigCache = (config) => {
  supportRecordConfig = config;
  supportRecordSectionIds = collectSupportRecordSectionIds(config);
};

async function loadSupportRecordConfig() {
  try {
    await ensureSupportRecordConfigDir();
    const raw = await fs.readFile(SUPPORT_RECORD_CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeSupportRecordConfig(parsed);
    if (!normalized) {
      throw new Error('invalid config');
    }
    updateSupportRecordConfigCache(normalized);
    return normalized;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const fallback = normalizeSupportRecordConfig(DEFAULT_SUPPORT_RECORD_CONFIG) ?? { meetingTypes: [] };
      await saveSupportRecordConfig(fallback);
      return fallback;
    }
    console.error('[config] �ǂݍ��ݎ��s', error);
    const fallback = normalizeSupportRecordConfig(DEFAULT_SUPPORT_RECORD_CONFIG) ?? { meetingTypes: [] };
    updateSupportRecordConfigCache(fallback);
    return fallback;
  }
}

async function saveSupportRecordConfig(config) {
  await ensureSupportRecordConfigDir();
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(SUPPORT_RECORD_CONFIG_FILE, payload, 'utf8');
  updateSupportRecordConfigCache(config);
}

async function readSupportRecordStore() {
  if (NO_RETENTION_MODE) {
    return { records: {} };
  }
  try {
    const raw = await fs.readFile(SUPPORT_RECORD_STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { records: {} };
    }
    if (!parsed.records || typeof parsed.records !== 'object') {
      parsed.records = {};
    }
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { records: {} };
    }
    console.error('[support-record] �X�g�A�ǂݍ��ݎ��s', error);
    throw error;
  }
}

async function writeSupportRecordStore(store) {
  if (NO_RETENTION_MODE) return;
  await ensureSupportRecordDataDir();
  const payload = JSON.stringify(store, null, 2);
  await fs.writeFile(SUPPORT_RECORD_STORE_FILE, payload, 'utf8');
}

function sectionsArrayToMap(sectionsArray, fallbackTimestamp) {
  const map = {};
  if (!Array.isArray(sectionsArray)) return map;
  sectionsArray.forEach((section) => {
    if (!section || typeof section !== 'object') return;
    const sectionId = typeof section.id === 'string' ? section.id.trim() : '';
    if (!sectionId || !supportRecordSectionIds.has(sectionId)) return;
    const value =
      typeof section.value === 'string'
        ? section.value
        : section.value === undefined || section.value === null
          ? ''
          : String(section.value);
    const suggestion =
      typeof section.suggestion === 'string' && section.suggestion.trim().length > 0
        ? section.suggestion.trim()
        : null;
    const updatedIso = section.updatedAt ? new Date(section.updatedAt).toISOString() : fallbackTimestamp;
    map[sectionId] = {
      value,
      suggestion,
      updatedAt: updatedIso,
    };
  });
  return map;
}

function sectionsMapToArray(sectionMap = {}) {
  return Object.entries(sectionMap).map(([id, payload]) => ({
    id,
    value: typeof payload?.value === 'string' ? payload.value : '',
    suggestion: typeof payload?.suggestion === 'string' ? payload.suggestion : null,
    updatedAt: payload?.updatedAt ?? null,
  }));
}

// JSON�𒊏o���錘�S�Ȋ֐�
function extractJSON(text) {
  text = text.trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '');
  text = text.replace(/\s*```\s*$/g, '');
  
  let depth = 0;
  let start = -1;
  let inString = false;
  let i = 0;
  let maxDepth = 0;
  let lastValidPos = -1;
  
  while (i < text.length) {
    const char = text[i];
    
    if (char === '"') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && text[j] === '\\') {
        backslashCount++;
        j--;
      }
      
      if (backslashCount % 2 === 0) {
        inString = !inString;
      }
    }
    
    if (!inString) {
      if (char === '{') {
        if (depth === 0) start = i;
        depth++;
        maxDepth = Math.max(maxDepth, depth);
      } else if (char === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          return text.substring(start, i + 1);
        }
        if (depth >= 0) {
          lastValidPos = i;
        }
      }
    }
    
    i++;
  }
  
  if (start !== -1 && maxDepth > 0 && depth > 0) {
    console.warn('[extractJSON] �s���S��JSON��⊮���܂�');
    let incomplete = text.substring(start);
    incomplete += '}'.repeat(depth);
    
    try {
      JSON.parse(incomplete);
      console.log('[extractJSON] �⊮����');
      return incomplete;
    } catch (e) {
      console.error('[extractJSON] �⊮����p�[�X���s:', e.message);
    }
  }
  
  throw new Error('�L����JSON��������܂���ł���');
}

function parseJSON(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch (firstError) {
    console.log('[parseJSON] ����p�[�X���s�A����������s���C�����čĎ��s...');
    const fixed = fixJSONStringNewlines(jsonText);
    
    try {
      const result = JSON.parse(fixed);
      console.log('[parseJSON] �C����̃p�[�X����');
      return result;
    } catch (secondError) {
      console.error('[parseJSON] �C������p�[�X���s');
      throw firstError;
    }
  }
}

const toUsageSummary = (result) => {
  const usage = result?.usageMetadata ?? result?.response?.usageMetadata ?? null;
  if (!usage) return null;
  const promptTokens =
    typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : null;
  const outputTokens =
    typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : null;
  const totalTokens =
    typeof usage.totalTokenCount === 'number' ? usage.totalTokenCount : null;
  if (promptTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }
  return { promptTokens, outputTokens, totalTokens };
};

const sumUsageField = (left, right) => {
  const leftNum = typeof left === 'number' ? left : null;
  const rightNum = typeof right === 'number' ? right : null;
  if (leftNum === null && rightNum === null) return null;
  return (leftNum ?? 0) + (rightNum ?? 0);
};

const mergeUsageSummary = (left, right) => {
  if (!left && !right) return null;
  return {
    promptTokens: sumUsageField(left?.promptTokens, right?.promptTokens),
    outputTokens: sumUsageField(left?.outputTokens, right?.outputTokens),
    totalTokens: sumUsageField(left?.totalTokens, right?.totalTokens),
  };
};

function fixJSONStringNewlines(jsonText) {
  let result = '';
  let inString = false;
  let i = 0;
  
  while (i < jsonText.length) {
    const char = jsonText[i];
    
    if (char === '"') {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && jsonText[j] === '\\') {
        backslashCount++;
        j--;
      }
      
      if (backslashCount % 2 === 0) {
        inString = !inString;
      }
      
      result += char;
      i++;
      continue;
    }
    
    if (!inString) {
      result += char;
      i++;
      continue;
    }
    
    if (char === '\\') {
      if (i + 1 < jsonText.length) {
        const nextChar = jsonText[i + 1];
        if ('"\\/bfnrtu'.includes(nextChar)) {
          result += char + nextChar;
          i += 2;
          continue;
        } else {
          result += '\\\\';
          i++;
          continue;
        }
      } else {
        result += '\\\\';
        i++;
        continue;
      }
    }
    
    if (char === '\n') {
      result += '\\n';
    } else if (char === '\r') {
      result += '\\r';
    } else if (char === '\t') {
      result += '\\t';
    } else if (char === '\b') {
      result += '\\b';
    } else if (char === '\f') {
      result += '\\f';
    } else {
      const code = char.charCodeAt(0);
      if (code < 32) {
        result += '\\u' + code.toString(16).padStart(4, '0');
      } else {
        result += char;
      }
    }
    
    i++;
  }
  
  return result;
}

loadSupportRecordConfig().catch((error) => {
  console.error('[config] �����ǂݍ��ݎ��s', error);
});

app.get('/healthz', (req, res) => {
  const lang = String(req.query.lang || 'ja');
  const { upstream, model } = decideUpstreamAndModel(lang, undefined);
  res.json({ 
    ok: true, 
    upstream, 
    model, 
    compat: { transcript: EMIT_TRANSCRIPT_COMPAT },
    gemini: Boolean(GEMINI_API_KEY)
  });
});

app.post('/api/clean', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const { transcript, keywords = [], uncertainHints = '' } = req.body;
  
  if (!transcript || transcript.trim().length === 0) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  console.log(`[clean] �����J�n (${transcript.length}����, �L�[���[�h:${keywords.length}��)`);
  
  try {
    const prompt = appendUncertainHints(getCleaningPrompt(transcript, keywords), uncertainHints);
    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
    });
    const rawResponse = result.text ?? '';
    const cleanedText = rawResponse.trim();
    if (!cleanedText) {
      throw new Error('Gemini response was empty');
    }
    
    console.log(`[clean] ���� (�o��:${cleanedText.length}����)`);
    
    res.json({ 
      cleanedText,
      usage: toUsageSummary(result),
      _debug: { rawResponse }
    });
  } catch (error) {
    respondGeminiError(res, error, 'clean');
  }
});

app.post('/api/clean-two-stage', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const { transcript, keywords = [], uncertainHints = '' } = req.body;
  const transcriptText = typeof transcript === 'string' ? transcript.trim() : '';
  if (!transcriptText) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  console.log(
    `[clean-two-stage] �����J�n (${transcriptText.length}����, �L�[���[�h:${keywords.length}��)`,
  );

  try {
    const stage1Prompt = appendUncertainHints(getCleaningStage1Prompt(transcriptText, keywords), uncertainHints);
    const stage1Result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: stage1Prompt }]}],
    });
    const stage1Text = (stage1Result.text ?? '').trim();
    if (!stage1Text) {
      throw new Error('stage1 response was empty');
    }

    const stage2Prompt = getCleaningStage2Prompt(stage1Text);
    const stage2Result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: stage2Prompt }]}],
    });
    const cleanedText = (stage2Result.text ?? '').trim();
    if (!cleanedText) {
      throw new Error('stage2 response was empty');
    }

    const stage1Usage = toUsageSummary(stage1Result);
    const stage2Usage = toUsageSummary(stage2Result);

    console.log(
      `[clean-two-stage] ���� (stage1:${stage1Text.length}����, stage2:${cleanedText.length}����)`,
    );

    res.json({
      cleanedText,
      stage1Text,
      usage: {
        stage1: stage1Usage,
        stage2: stage2Usage,
        total: mergeUsageSummary(stage1Usage, stage2Usage),
      },
    });
  } catch (error) {
    respondGeminiError(res, error, 'clean-two-stage');
  }
});

app.get('/api/support-record-config', (req, res) => {
  res.json({ config: supportRecordConfig });
});


app.post('/api/interview-feedback', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
  if (!question || !answer) {
    return res.status(400).json({ error: 'question and answer are required' });
  }

  console.log(`[interview-feedback] start (q:${question.length}, a:${answer.length})`);

  try {
    const prompt = getInterviewFeedbackPrompt(question, answer);
    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
    }, 'interview-feedback');
    const feedback = (result.text ?? '').trim();
    if (!feedback) {
      throw new Error('feedback_empty');
    }
    res.json({ feedback, usage: toUsageSummary(result) });
  } catch (error) {
    respondGeminiError(res, error, 'interview-feedback');
  }
});

app.post('/api/chat', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const context = typeof req.body?.context === 'string' ? req.body.context : '';
  const userInfo = typeof req.body?.userInfo === 'object' && req.body.userInfo ? req.body.userInfo : {};
  const maxMessages = Number(process.env.CHAT_HISTORY_MAX_MESSAGES ?? 9999);
  const maxChars = Number(process.env.CHAT_HISTORY_MESSAGE_CHARS ?? 800);
  const maxContextChars = Number(process.env.CHAT_CONTEXT_MAX_CHARS ?? 4000);
  const history = rawHistory
    .map((entry) => {
      const role = entry?.role === 'assistant' ? 'assistant' : 'user';
      const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
      if (!text) return null;
      return { role, text: text.slice(0, maxChars) };
    })
    .filter(Boolean)
    .slice(-Math.max(0, maxMessages));

  const trimmedContext = context.slice(0, maxContextChars);
  const startTime = Date.now();
  console.log(`[chat] start (len:${message.length}, history:${history.length}, context:${trimmedContext.length}, user:${userInfo.name || 'unknown'})`);

  try {
    const prompt = getChatPrompt(message, history, trimmedContext, userInfo);
    const geminiStart = Date.now();
    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
    }, 'chat');
    const geminiEnd = Date.now();
    let reply = (result.text ?? '').trim();
    if (!reply) {
      throw new Error('chat_empty');
    }
    // 表情タグを解析: [表情:smile] テキスト → { expression: 'smile', text: 'テキスト' }
    let expression = 'neutral';
    const expressionMatch = reply.match(/^\[表情:(\w+)\]\s*/);
    if (expressionMatch) {
      expression = expressionMatch[1];
      reply = reply.slice(expressionMatch[0].length).trim();
    }
    console.log(`[chat] done - Gemini: ${geminiEnd - geminiStart}ms, Total: ${Date.now() - startTime}ms, reply: ${reply.length}chars, expression: ${expression}`);
    res.json({ reply, expression, usage: toUsageSummary(result) });
  } catch (error) {
    respondGeminiError(res, error, 'chat');
  }
});

// ストリーミングチャットエンドポイント（高速応答用）
app.post('/api/chat-stream', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const context = typeof req.body?.context === 'string' ? req.body.context : '';
  const userInfo = typeof req.body?.userInfo === 'object' && req.body.userInfo ? req.body.userInfo : {};
  const faceAnalysis = typeof req.body?.faceAnalysis === 'object' && req.body.faceAnalysis ? req.body.faceAnalysis : null;
  const maxMessages = Number(process.env.CHAT_HISTORY_MAX_MESSAGES ?? 9999);
  const maxChars = Number(process.env.CHAT_HISTORY_MESSAGE_CHARS ?? 800);
  const maxContextChars = Number(process.env.CHAT_CONTEXT_MAX_CHARS ?? 4000);
  const history = rawHistory
    .map((entry) => {
      const role = entry?.role === 'assistant' ? 'assistant' : 'user';
      const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
      if (!text) return null;
      return { role, text: text.slice(0, maxChars) };
    })
    .filter(Boolean)
    .slice(-Math.max(0, maxMessages));

  const trimmedContext = context.slice(0, maxContextChars);
  const startTime = Date.now();
  console.log(`[chat-stream] start (len:${message.length}, history:${history.length}, context:${trimmedContext.length})`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const prompt = getChatPrompt(message, history, trimmedContext, userInfo, faceAnalysis);
    const geminiStart = Date.now();

    const stream = await genAI.models.generateContentStream({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    let fullText = '';
    let firstChunkTime = null;

    for await (const chunk of stream) {
      const text = chunk.text ?? '';
      if (text) {
        if (firstChunkTime === null) {
          firstChunkTime = Date.now();
          console.log(`[chat-stream] first chunk in ${firstChunkTime - geminiStart}ms`);
        }
        fullText += text;
        res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
      }
    }

    const geminiEnd = Date.now();
    console.log(`[chat-stream] done - Gemini: ${geminiEnd - geminiStart}ms, Total: ${Date.now() - startTime}ms, reply: ${fullText.length}chars`);

    res.write(`data: ${JSON.stringify({ type: 'done', fullText: fullText.trim() })}\n\n`);
    res.end();
  } catch (error) {
    const summary = summarizeGeminiError(error);
    console.error('[chat-stream] error', summary);
    res.write(`data: ${JSON.stringify({ type: 'error', error: summary.message || 'gemini_error' })}\n\n`);
    res.end();
  }
});

app.post('/api/ms-subject-token', async (req, res) => {
  const raw =
    (typeof req.body?.token === 'string' && req.body.token) ||
    (typeof req.body?.idToken === 'string' && req.body.idToken) ||
    (typeof req.body?.subjectToken === 'string' && req.body.subjectToken) ||
    '';
  const token = raw.trim();
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }
  if (token.split('.').length < 2) {
    return res.status(400).json({ error: 'invalid_token' });
  }
  const payload = parseJwtPayload(token);
  if (payload?.exp && Number.isFinite(payload.exp)) {
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now - 60) {
      return res.status(400).json({ error: 'expired_token' });
    }
  }
  try {
    await persistSubjectToken(token);
    res.json({ ok: true });
  } catch (error) {
    console.error('[auth] persist subject token failed', error);
    res.status(500).json({ error: 'persist_failed' });
  }
});

// 利用可能なTTS音声オプション
const TTS_VOICE_OPTIONS = [
  { id: 'ja-JP-Neural2-B', name: 'Neural2-B (女性・標準)', gender: 'FEMALE' },
  { id: 'ja-JP-Neural2-C', name: 'Neural2-C (男性)', gender: 'MALE' },
  { id: 'ja-JP-Neural2-D', name: 'Neural2-D (男性・低め)', gender: 'MALE' },
  { id: 'ja-JP-Wavenet-A', name: 'Wavenet-A (女性)', gender: 'FEMALE' },
  { id: 'ja-JP-Wavenet-B', name: 'Wavenet-B (女性・落ち着き)', gender: 'FEMALE' },
  { id: 'ja-JP-Wavenet-C', name: 'Wavenet-C (男性)', gender: 'MALE' },
  { id: 'ja-JP-Wavenet-D', name: 'Wavenet-D (男性・落ち着き)', gender: 'MALE' },
  { id: 'ja-JP-Standard-A', name: 'Standard-A (女性・軽量)', gender: 'FEMALE' },
  { id: 'ja-JP-Standard-B', name: 'Standard-B (女性)', gender: 'FEMALE' },
  { id: 'ja-JP-Standard-C', name: 'Standard-C (男性)', gender: 'MALE' },
  { id: 'ja-JP-Standard-D', name: 'Standard-D (男性)', gender: 'MALE' },
];

app.get('/api/tts/voices', (req, res) => {
  res.json({ voices: TTS_VOICE_OPTIONS, default: TTS_VOICE_NAME });
});

// TTS読み上げ用の単語置換辞書（読み間違え対策）
// キー: 元の単語, 値: 読み上げ用のテキスト（ひらがな/カタカナ推奨）
const TTS_PRONUNCIATION_MAP = {
  // 例: 'Thankslab': 'サンクスラボ',
  // 例: 'アセス君': 'アセスくん',
};

const preprocessTtsText = (text) => {
  let result = text;

  // 読み仮名付きの名前を処理: 山田太郎《やまだたろう》 → やまだたろう
  // 漢字・ひらがな・カタカナの連続 + 《読み仮名》 → 読み仮名に置き換え
  const beforeFurigana = result;
  result = result.replace(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FFー]+《([^》]+)》/g, '$1');
  if (beforeFurigana !== result) {
    console.log(`[tts] furigana処理: "${beforeFurigana.slice(0, 80)}" → "${result.slice(0, 80)}"`);
  }

  // 辞書による置換
  for (const [word, pronunciation] of Object.entries(TTS_PRONUNCIATION_MAP)) {
    result = result.replaceAll(word, pronunciation);
  }
  return result;
};

app.post('/api/tts', async (req, res) => {
  const raw = typeof req.body?.text === 'string' ? req.body.text : '';
  console.log(`[tts] 受信テキスト: "${raw.slice(0, 100)}"`);
  const preprocessed = preprocessTtsText(raw.trim());
  console.log(`[tts] 処理後テキスト: "${preprocessed.slice(0, 100)}"`);
  const text = preprocessed.slice(0, Math.max(1, TTS_MAX_CHARS));
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  // クライアントからspeakingRateを受け取る（0.5〜2.0の範囲でクランプ）
  const requestedRate = Number(req.body?.speakingRate);
  const speakingRate = Number.isFinite(requestedRate) && requestedRate > 0
    ? Math.max(0.5, Math.min(2.0, requestedRate))
    : TTS_SPEAKING_RATE;

  // クライアントから音声タイプを受け取る（許可リストでバリデーション）
  const requestedVoice = typeof req.body?.voice === 'string' ? req.body.voice.trim() : '';
  const isValidVoice = TTS_VOICE_OPTIONS.some(v => v.id === requestedVoice);
  const voiceName = isValidVoice ? requestedVoice : TTS_VOICE_NAME;
  console.log(`[tts] voice selection: requested="${requestedVoice}", valid=${isValidVoice}, using="${voiceName}"`);

  // ピッチも受け取れるように（-20.0〜20.0）
  const requestedPitch = Number(req.body?.pitch);
  const pitch = Number.isFinite(requestedPitch)
    ? Math.max(-20, Math.min(20, requestedPitch))
    : TTS_PITCH;

  const startTime = Date.now();
  console.log(`[tts] start (len:${text.length}, rate:${speakingRate}, voice:${voiceName}, pitch:${pitch})`);

  try {
    const client = await getTtsClient();
    const clientReady = Date.now();
    const audioConfig = {
      audioEncoding: TTS_AUDIO_ENCODING,
    };
    if (Number.isFinite(speakingRate) && speakingRate > 0) {
      audioConfig.speakingRate = speakingRate;
    }
    if (Number.isFinite(pitch)) {
      audioConfig.pitch = pitch;
    }
    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice: { languageCode: TTS_LANGUAGE_CODE, name: voiceName },
      audioConfig,
    });
    const synthesizeEnd = Date.now();
    const audioContent = response?.audioContent;
    if (!audioContent) {
      throw new Error('tts_empty');
    }
    const buffer = Buffer.isBuffer(audioContent)
      ? audioContent
      : Buffer.from(audioContent, 'base64');
    const contentType =
      TTS_AUDIO_ENCODING === 'MP3'
        ? 'audio/mpeg'
        : TTS_AUDIO_ENCODING === 'OGG_OPUS'
          ? 'audio/ogg'
          : 'audio/wav';
    console.log(`[tts] done - Client: ${clientReady - startTime}ms, Synthesize: ${synthesizeEnd - clientReady}ms, Total: ${Date.now() - startTime}ms`);
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error?.code === 'number' || typeof error?.code === 'string' ? error.code : undefined;
    const isAuthError = /invalid_grant|stale|missing_subject_token|expired/i.test(message);
    console.error('[tts] failed', message);
    res.status(isAuthError ? 401 : 500).json({ error: 'tts_failed', message, code });
  }
});

// 顔分析フィードバック生成
app.post('/api/face-analysis-feedback', async (req, res) => {
  const { analysisData } = req.body || {};
  if (!analysisData || typeof analysisData.eyeContactRate !== 'number') {
    return res.status(400).json({ error: 'invalid_analysis_data' });
  }

  try {
    const prompt = getFaceFeedbackPrompt(analysisData);
    const response = await genAI.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    const feedback = response.text?.trim() || '';
    res.json({ feedback });
  } catch (error) {
    console.error('[face-analysis-feedback] error:', error);
    res.status(500).json({ error: 'feedback_generation_failed' });
  }
});

app.post('/api/support-record-config', async (req, res) => {
  const { pin, config } = req.body || {};
  if (String(pin || '').trim() !== SUPPORT_RECORD_CONFIG_PIN) {
    return res.status(403).json({ error: 'invalid_pin' });
  }
  const normalized = normalizeSupportRecordConfig(config);
  if (!normalized) {
    return res.status(400).json({ error: 'invalid_config' });
  }

  try {
    await saveSupportRecordConfig(normalized);
    res.json({ config: normalized });
  } catch (error) {
    console.error('[config] �ۑ����s', error);
    res.status(500).json({ error: 'failed_to_save_config' });
  }
});

app.post('/api/support-record-draft', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const { transcript, meetingType = null, sections = [] } = req.body || {};
  const transcriptText = typeof transcript === 'string' ? transcript.trim() : '';
  if (!transcriptText) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  const normalizedSections = Array.isArray(sections)
    ? sections
        .map((item) => {
          const id = typeof item?.id === 'string' ? item.id.trim() : '';
          if (!id || !supportRecordSectionIds.has(id)) return null;
          const title = typeof item?.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : id;
          const helperText =
            typeof item?.helperText === 'string' && item.helperText.trim().length > 0
              ? item.helperText.trim()
              : '';
          const value = typeof item?.value === 'string' ? item.value : '';
          return { id, title, helperText, value };
        })
        .filter(Boolean)
    : [];

  if (!normalizedSections.length) {
    return res.status(400).json({ error: 'sections are required' });
  }

  const currentDraft = normalizedSections.reduce((acc, section) => {
    acc[section.id] = { value: section.value };
    return acc;
  }, {});

  console.log(`[support-record-draft] �����J�n (������:${transcriptText.length})`);

  try {
    const prompt = getSupportRecordDraftPrompt(
      transcriptText,
      typeof meetingType === 'string' && meetingType.trim().length > 0 ? meetingType.trim() : null,
      normalizedSections,
      currentDraft,
    );
    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
    });
    const responseText = (result.text ?? '').trim();
    if (!responseText) {
      throw new Error('Gemini response was empty');
    }

    const jsonText = extractJSON(responseText);
    const draftData = parseJSON(jsonText);
    const payload = Array.isArray(draftData?.sections) ? draftData.sections : [];

    res.json({
      sections: payload,
      usage: toUsageSummary(result),
      _debug: { rawResponse: responseText },
    });
  } catch (error) {
    respondGeminiError(res, error, 'support-record-draft');
  }
});

app.post('/api/support-record-refine', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const { cleanedText = '', meetingType = null, sections = [] } = req.body || {};
  const transcriptText = typeof cleanedText === 'string' ? cleanedText.trim() : '';
  if (!transcriptText) {
    return res.status(400).json({ error: 'cleanedText is required' });
  }

  const normalizedSections = Array.isArray(sections)
    ? sections
        .map((item) => {
          const id = typeof item?.id === 'string' ? item.id.trim() : '';
          if (!id || !supportRecordSectionIds.has(id)) return null;
          const title = typeof item?.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : id;
          const helperText =
            typeof item?.helperText === 'string' && item.helperText.trim().length > 0
              ? item.helperText.trim()
              : '';
          const value = typeof item?.value === 'string' ? item.value : '';
          return { id, title, helperText, value };
        })
        .filter(Boolean)
    : [];

  if (!normalizedSections.length) {
    return res.status(400).json({ error: 'sections are required' });
  }

  console.log(`[support-record-refine] �����J�n (������:${transcriptText.length})`);

  try {
    const prompt = getSupportRecordRefinePrompt(
      transcriptText,
      typeof meetingType === 'string' && meetingType.trim().length > 0 ? meetingType.trim() : null,
      normalizedSections,
    );
    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
    });
    const responseText = (result.text ?? '').trim();
    if (!responseText) {
      throw new Error('Gemini response was empty');
    }

    const jsonText = extractJSON(responseText);
    const refineData = parseJSON(jsonText);
    const payload = Array.isArray(refineData?.sections) ? refineData.sections : [];

    res.json({
      sections: payload,
      usage: toUsageSummary(result),
      _debug: { rawResponse: responseText },
    });
  } catch (error) {
    respondGeminiError(res, error, 'support-record-refine');
  }
});

app.get('/api/support-record/:recordId', async (req, res) => {
  const recordId = String(req.params.recordId || '').trim();
  if (!recordId) {
    return res.status(400).json({ error: 'recordId is required' });
  }

  if (NO_RETENTION_MODE) {
    return res.status(403).json({ error: 'retention_disabled' });
  }

  try {
    const store = await readSupportRecordStore();
    const record = store.records?.[recordId];
    if (!record) {
      return res.status(404).json({ error: 'record_not_found' });
    }
    res.json({
      record: {
        ...record,
        sections: sectionsMapToArray(record.sections || {}),
      },
    });
  } catch (error) {
    console.error('[support-record] �ǂݍ��ݎ��s', error);
    res.status(500).json({ error: 'failed_to_load_support_record' });
  }
});

app.post('/api/support-record', async (req, res) => {
  const {
    recordId,
    participantId = null,
    sessionDate = null,
    sections = [],
    metadata = {},
  } = req.body || {};

  if (!recordId || typeof recordId !== 'string') {
    return res.status(400).json({ error: 'recordId must be a non-empty string' });
  }
  if (!Array.isArray(sections)) {
    return res.status(400).json({ error: 'sections must be an array' });
  }

  if (NO_RETENTION_MODE) {
    return res.status(403).json({ error: 'retention_disabled' });
  }

  const nowIso = new Date().toISOString();

  try {
    const store = await readSupportRecordStore();
    const normalizedSections = sectionsArrayToMap(sections, nowIso);

    if (!store.records) {
      store.records = {};
    }

    const existing = store.records[recordId];

    const record = {
      recordId,
      participantId: participantId ?? existing?.participantId ?? null,
      sessionDate: sessionDate ?? existing?.sessionDate ?? null,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      sections: normalizedSections,
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
      },
    };

    store.records[recordId] = record;
    await writeSupportRecordStore(store);

    res.json({
      ok: true,
      record: {
        ...record,
        sections: sectionsMapToArray(record.sections),
      },
    });
  } catch (error) {
    console.error('[support-record] �ۑ����s', error);
    res.status(500).json({ error: 'failed_to_save_support_record' });
  }
});

app.post('/api/support-record-complete', async (req, res) => {
  const {
    recordId,
    sessionDate = null,
    meetingTypeId = null,
    meetingTypeName = null,
    sessionMode = null,
    facilitatorId = null,
    facilitatorName = null,
    talentId = null,
    talentName = null,
    cleanedText = '',
    supportRecord = [],
    sentAt = null,
  } = req.body || {};

  if (!recordId || typeof recordId !== 'string' || !recordId.trim()) {
    return res.status(400).json({ error: 'recordId is required' });
  }
  if (!cleanedText || typeof cleanedText !== 'string' || !cleanedText.trim()) {
    return res.status(400).json({ error: 'cleanedText is required' });
  }

  try {
    const supportRecordJson = JSON.stringify(
      Array.isArray(supportRecord) ? supportRecord : [],
    );
    await insertSupportRecord({
      recordId: recordId.trim(),
      sessionDate,
      meetingTypeId,
      meetingTypeName,
      sessionMode,
      facilitatorId,
      facilitatorName,
      talentId,
      talentName,
      cleanedText,
      supportRecordJson,
      sentAt,
    });
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = error && typeof error === 'object' ? error.details : null;
    const retryable = Boolean(details?.retryable || error?.retryable);
    const code = details?.code || error?.code;
    const reason = details?.reason;
    const safeMessage =
      message === 'missing_subject_token' ||
      message === 'missing_export_config' ||
      message === 'bigquery_insert_failed' ||
      message.includes('invalid_grant') ||
      message.includes('stale to sign-in')
        ? message
        : 'redacted';
    console.error('[support-record-complete] failed', { message: safeMessage, code, reason, retryable });

    if (message === 'missing_subject_token') {
      return res.status(401).json({ error: 'missing_subject_token', detail: 'missing_subject_token' });
    }
    if (message.includes('invalid_grant') || message.includes('stale to sign-in')) {
      return res.status(401).json({ error: 'invalid_subject_token', detail: 'invalid_subject_token' });
    }
    if (message === 'missing_export_config') {
      return res.status(500).json({ error: 'missing_export_config' });
    }
    res.status(500).json({ error: 'failed_to_complete_support_record', retryable, code, reason });
  }
});

app.post('/api/agenda-proposals', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const {
    recordId = null,
    supportRecord = [],
    memos = {},
    keywords = [],
    summary = null,
    documents = [],
  } = req.body || {};

  try {
    const store = await readSupportRecordStore();
    const historyRecords = Object.values(store.records ?? {})
      .filter((record) => record && record.recordId !== recordId)
      .sort((a, b) => {
        const left = Date.parse(b?.updatedAt || '') || 0;
        const right = Date.parse(a?.updatedAt || '') || 0;
        return left - right;
      })
      .slice(0, 3)
      .map((record) => ({
        label: record.recordId,
        updatedAt: record.updatedAt || record.createdAt || null,
        sections: sectionsMapToArray(record.sections || {}),
      }));

    const prompt = getAgendaPrompt({
      supportRecordSections: Array.isArray(supportRecord) ? supportRecord : [],
      memos,
      keywords,
      summary,
      documents: Array.isArray(documents) ? documents : [],
      historyRecords,
    });

    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
    });
    const responseText = (result.text ?? '').trim();
    if (!responseText) {
      throw new Error('Gemini response was empty');
    }

    const jsonText = extractJSON(responseText);
    const proposals = parseJSON(jsonText);

    res.json({
      agenda: Array.isArray(proposals?.agenda) ? proposals.agenda : [],
      reminders: Array.isArray(proposals?.reminders) ? proposals.reminders : [],
      usage: toUsageSummary(result),
      _debug: { rawResponse: responseText },
    });
  } catch (error) {
    respondGeminiError(res, error, 'agenda-proposals');
  }
});

app.get('/api/participants', async (req, res) => {
  const role = typeof req.query.role === 'string' ? req.query.role : '';
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;

  if (!['facilitator', 'talent'].includes(role)) {
    return res.status(400).json({ error: 'role must be facilitator or talent' });
  }

  try {
    const items = await fetchParticipants({ role, q, limit });
    res.json({ items });
  } catch (error) {
    console.error('[participants] fetch failed', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'missing_subject_token') {
      return res.status(401).json({
        error: 'missing_subject_token',
        detail: 'missing_subject_token',
      });
    }
    if (message.includes('invalid_grant') || message.includes('stale to sign-in')) {
      return res.status(401).json({
        error: 'invalid_subject_token',
        detail: 'invalid_subject_token',
      });
    }
    res.status(500).json({
      error: 'failed_to_fetch_participants',
      detail: message,
    });
  }
});

// セッション要約を生成して保存
app.post('/api/session-summary', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const {
    recordId,
    cleanedText,
    supportRecordJson,
    meetingTypeId,
    meetingTypeName,
    msAccountId,
    facilitatorId,
    facilitatorName,
    talentId,
    talentName,
    sessionDate,
  } = req.body || {};

  if (!msAccountId) {
    return res.status(400).json({ error: 'ms_account_id_required' });
  }

  console.log(`[session-summary] start (msAccount:${msAccountId}, date:${sessionDate})`);

  try {
    const prompt = getSessionSummaryPrompt({
      cleanedText: cleanedText || '',
      supportRecord: supportRecordJson || '',
      meetingTypeName: meetingTypeName || '',
      talentName: talentName || '',
      sessionDate: sessionDate || '',
    });

    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }, 'session-summary');

    const rawText = (result.text ?? '').trim();
    let parsed = { summary: '', keyTopics: [], nextSuggestions: [] };

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.warn('[session-summary] JSON parse failed, using raw text', parseErr.message);
      parsed.summary = rawText;
    }

    const summaryId = `sum_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    await insertSessionSummary({
      summaryId,
      recordId: recordId || null,
      msAccountId: msAccountId || null,
      sessionDate: sessionDate || null,
      meetingTypeId: meetingTypeId || null,
      meetingTypeName: meetingTypeName || null,
      facilitatorId: facilitatorId || null,
      facilitatorName: facilitatorName || null,
      talentId: talentId || null,
      talentName: talentName || null,
      summary: parsed.summary || '',
      keyTopics: JSON.stringify(parsed.keyTopics || []),
      nextSuggestions: JSON.stringify(parsed.nextSuggestions || []),
    });

    console.log(`[session-summary] saved (id:${summaryId})`);
    res.json({ ok: true, summaryId, summary: parsed });
  } catch (error) {
    const message = error?.message || String(error);
    const details = error?.details || null;
    const code = error?.code || null;
    console.error('[session-summary] failed', JSON.stringify({ message, details, code }, null, 2));
    res.status(500).json({ error: 'session_summary_failed', detail: message, code, details });
  }
});

// セッションハートビート（軽量保存、AI要約なし）
app.post('/api/session-heartbeat', async (req, res) => {
  const {
    sessionId,
    msAccountId,
    cleanedText,
    talentName,
    sessionDate,
    messageCount,
    isFinal = false,
  } = req.body || {};

  if (!msAccountId) {
    return res.status(400).json({ error: 'ms_account_id_required' });
  }
  if (!sessionId) {
    return res.status(400).json({ error: 'session_id_required' });
  }

  console.log(`[session-heartbeat] ${isFinal ? 'FINAL' : 'draft'} (session:${sessionId}, messages:${messageCount})`);

  try {
    const summaryId = `${sessionId}_${Date.now()}`;

    await insertSessionSummary({
      summaryId,
      recordId: sessionId,
      msAccountId: msAccountId || null,
      sessionDate: sessionDate || new Date().toISOString().slice(0, 10),
      meetingTypeId: null,
      meetingTypeName: '会話セッション',
      facilitatorId: null,
      facilitatorName: null,
      talentId: null,
      talentName: talentName || null,
      summary: isFinal ? cleanedText : `[DRAFT:${messageCount}messages]`,
      keyTopics: JSON.stringify([]),
      nextSuggestions: JSON.stringify([]),
    });

    console.log(`[session-heartbeat] saved (id:${summaryId})`);
    res.json({ ok: true, summaryId });
  } catch (error) {
    const message = error?.message || String(error);
    const details = error?.details || null;
    const code = error?.code || null;
    console.error('[session-heartbeat] failed', { message, details, code });

    if (message === 'missing_subject_token') {
      return res.status(401).json({ error: 'missing_subject_token' });
    }
    res.status(500).json({ error: 'heartbeat_failed', detail: message, code, details });
  }
});

// 過去のセッション要約を取得
app.get('/api/session-summaries', async (req, res) => {
  const msAccountId = typeof req.query.msAccountId === 'string' ? req.query.msAccountId.trim() : '';
  const limit = Number(req.query.limit) || 5;

  if (!msAccountId) {
    return res.status(400).json({ error: 'ms_account_id_required' });
  }

  console.log(`[session-summaries] fetch (msAccount:${msAccountId}, limit:${limit})`);

  try {
    const summaries = await fetchSessionSummaries({ msAccountId, limit });
    res.json({ summaries });
  } catch (error) {
    const message = error?.message || String(error);
    console.error('[session-summaries] failed', message);

    if (message === 'missing_subject_token') {
      return res.status(401).json({ error: 'missing_subject_token' });
    }
    if (message.includes('invalid_grant') || message.includes('stale')) {
      return res.status(401).json({ error: 'invalid_subject_token' });
    }
    res.status(500).json({ error: 'fetch_summaries_failed', detail: message });
  }
});

// メタ要約の更新間隔（セッション数）
const META_SUMMARY_UPDATE_INTERVAL = Number(process.env.META_SUMMARY_UPDATE_INTERVAL) || 3;

// メタ要約を更新する必要があるかチェックし、必要なら更新
const checkAndUpdateMetaSummary = async (msAccountId, summaries) => {
  try {
    // 現在のプロフィールを取得
    const currentProfile = await fetchUserProfile({ msAccountId });
    const lastCount = currentProfile?.lastSummaryCount || 0;

    // 現在の要約数をカウント
    const currentCount = await countSessionSummaries({ msAccountId });
    console.log(`[meta-summary] lastCount=${lastCount}, currentCount=${currentCount}, interval=${META_SUMMARY_UPDATE_INTERVAL}`);

    // 更新が必要か判断（前回から指定数以上増えている場合）
    if (currentCount - lastCount < META_SUMMARY_UPDATE_INTERVAL) {
      console.log('[meta-summary] no update needed');
      return currentProfile;
    }

    console.log('[meta-summary] updating...');

    // より多くの要約を取得してメタ要約を生成
    const allSummaries = await fetchSessionSummaries({ msAccountId, limit: 10 });
    const prompt = getMetaSummaryPrompt({
      summaries: allSummaries,
      currentProfile,
    });

    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }, 'meta-summary');

    const rawText = (result.text ?? '').trim();
    let parsed = { metaSummary: '', keyFacts: '', interests: '', goals: '' };

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        parsed.metaSummary = json.metaSummary || '';
        parsed.keyFacts = Array.isArray(json.keyFacts) ? JSON.stringify(json.keyFacts) : (json.keyFacts || '');
        parsed.interests = json.interests || '';
        parsed.goals = json.goals || '';
      }
    } catch (parseErr) {
      console.warn('[meta-summary] JSON parse failed, using raw text');
      parsed.metaSummary = rawText;
    }

    // プロフィールを更新
    await upsertUserProfile({
      msAccountId,
      metaSummary: parsed.metaSummary,
      keyFacts: parsed.keyFacts,
      interests: parsed.interests,
      goals: parsed.goals,
      notes: currentProfile?.notes || '',
      lastSummaryCount: currentCount,
    });

    console.log('[meta-summary] updated successfully');
    return {
      msAccountId,
      metaSummary: parsed.metaSummary,
      keyFacts: parsed.keyFacts,
      interests: parsed.interests,
      goals: parsed.goals,
      lastSummaryCount: currentCount,
    };
  } catch (error) {
    console.error('[meta-summary] update error', error?.message || error);
    return null;
  }
};

// 議題提案を生成
app.post('/api/agenda-suggestion', async (req, res) => {
  if (!genAI) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const { msAccountId, userName, meetingTypeName, sessionDate, suggestedTopics } = req.body || {};

  if (!msAccountId) {
    return res.status(400).json({ error: 'ms_account_id_required' });
  }

  let topics = Array.isArray(suggestedTopics) ? suggestedTopics.filter(t => typeof t === 'string' && t.trim()) : [];
  console.log(`[agenda-suggestion] start (msAccount:${msAccountId}, clientTopics:${topics.length})`);

  try {
    // BigQueryから議題候補を取得（クライアントから指定がなければ）
    if (topics.length === 0) {
      const bqTopics = await fetchSuggestedTopics({ msAccountId, meetingType: meetingTypeName });
      if (bqTopics.length > 0) {
        topics = bqTopics;
        console.log(`[agenda-suggestion] loaded ${topics.length} topics from BigQuery`);
      }
    }

    // 過去の要約を取得
    const summaries = await fetchSessionSummaries({ msAccountId, limit: 5 });
    console.log(`[agenda-suggestion] found ${summaries.length} past summaries`);
    if (summaries.length > 0) {
      console.log(`[agenda-suggestion] latest summary date: ${JSON.stringify(summaries[0].sessionDate)}, summary: ${summaries[0].summary?.slice(0, 50)}...`);
    }

    // メタ要約を更新（必要なら）し、取得
    const userProfile = await checkAndUpdateMetaSummary(msAccountId, summaries);
    if (userProfile?.metaSummary) {
      console.log(`[agenda-suggestion] has meta-summary (len:${userProfile.metaSummary.length})`);
    }

    const prompt = getAgendaSuggestionPrompt({
      summaries,
      userName: userName || '',
      meetingTypeName: meetingTypeName || '',
      sessionDate: sessionDate || new Date().toISOString().slice(0, 10),
      suggestedTopics: topics,
      userProfile, // メタ要約を渡す
    });

    const result = await generateGeminiContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }, 'agenda-suggestion');

    const suggestion = (result.text ?? '').trim();
    console.log(`[agenda-suggestion] generated (len:${suggestion.length})`);

    res.json({ suggestion, summaries, userProfile });
  } catch (error) {
    const message = error?.message || String(error);
    console.error('[agenda-suggestion] failed', message);

    if (message === 'missing_subject_token') {
      return res.status(401).json({ error: 'missing_subject_token' });
    }
    if (message.includes('invalid_grant') || message.includes('stale')) {
      return res.status(401).json({ error: 'invalid_subject_token' });
    }
    res.status(500).json({ error: 'agenda_suggestion_failed', detail: message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);

const MAX_PORT_FALLBACKS = Number(process.env.PORT_FALLBACK_ATTEMPTS ?? 10);
const ALLOW_PORT_FALLBACK =
  (process.env.PORT_FALLBACK ?? 'true') !== 'false' &&
  process.env.ELECTRON_RUN_AS_NODE !== '1';

const startServer = (port, attemptsLeft) => {
  const onError = (error) => {
    if (
      error &&
      error.code === 'EADDRINUSE' &&
      ALLOW_PORT_FALLBACK &&
      attemptsLeft > 0
    ) {
      const nextPort = port + 1;
      console.warn(`[server] port ${port} is in use, retrying on ${nextPort}`);
      startServer(nextPort, attemptsLeft - 1);
      return;
    }
    console.error('[server] failed to listen', error);
    process.exit(1);
  };

  server.once('error', onError);
  server.listen(port, () => {
    server.removeListener('error', onError);
    const address = server.address();
    const actualPort =
      typeof address === 'object' && address && typeof address.port === 'number'
        ? address.port
        : port;
    process.env.PORT = String(actualPort);
    console.log(`[server] listening on http://localhost:${actualPort}`);
  });
};

const basePort = Number(PORT);
const initialPort = Number.isFinite(basePort) && basePort > 0 ? basePort : 3000;
startServer(initialPort, MAX_PORT_FALLBACKS);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE' && ALLOW_PORT_FALLBACK) {
    return;
  }
  console.error('[wss] error', error);
});

wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const lang = url.searchParams.get('lang') || 'ja';
  const requestedModel = url.searchParams.get('model') || undefined;
  const codec = (url.searchParams.get('codec') || 'linear16').toLowerCase();
  const rate = String(url.searchParams.get('rate') || '48000');
  
  const keywordsParam = url.searchParams.get('keywords') || '';
  const userKeywords = keywordsParam ? keywordsParam.split(',').map(k => k.trim()).filter(Boolean) : [];
  const keywords = mergeKeywords(DEFAULT_KEYWORDS, userKeywords);

  console.log('[client] connected', { lang, model: requestedModel, codec, rate, keywords: keywords.length });

  const { upstream, model, warn } = decideUpstreamAndModel(lang, requestedModel);

  const attempts = [];
  if (upstream === 'v2') {
    const params = {
      model: 'flux-general-en',
      encoding: codec === 'opus' ? 'opus' : 'linear16',
      sample_rate: rate
    };
    if (keywords.length > 0) {
      params.keywords = keywords.join(',');
    }
    attempts.push({
      note: 'v2 primary (flux-general-en only)',
      endpoint: 'wss://api.deepgram.com/v2/listen',
      params
    });
  }
  
  const keyterms =
    model === 'nova-3'
      ? keywords
          .map((entry) => String(entry).split(':')[0].trim())
          .filter(Boolean)
      : [];

  const v1Params = {
    model,
    language: normalizeLangForV1(lang),
    encoding: codec === 'opus' ? 'opus' : 'linear16',
    sample_rate: rate
  };
  if (model === 'nova-3') {
    if (keyterms.length > 0) {
      v1Params.keyterm = keyterms.join(',');
    }
  } else if (keywords.length > 0) {
    v1Params.keywords = keywords.join(',');
  }
  attempts.push({
    note: upstream === 'v2' ? 'v1 fallback' : 'v1 primary',
    endpoint: 'wss://api.deepgram.com/v1/listen',
    params: v1Params
  });

  let attemptIdx = 0;
  let dg;
  let keepAliveTimer = null;
  let upstreamOpen = false;
  let downstreamOpen = true;
  let loggedRequestId = false;
  let messageCount = 0;
  let finalizeRequested = false;
  let finalizeAckSent = false;

  const openUpstream = () => {
    const a = attempts[attemptIdx];
    const qs = new URLSearchParams(a.params).toString();
    const u = `${a.endpoint}?${qs}`;
    console.log('[dg attempt]', `#${attemptIdx}`, a.note, u);

    dg = new WebSocket(u, { headers: { Authorization: `Token ${DG_API_KEY}` } });

    dg.on('unexpected-response', async (_req, res) => {
      try {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          console.error('[dg unexpected-response]', res.statusCode, body);
          if (++attemptIdx < attempts.length) {
            setTimeout(openUpstream, 10);
          } else {
            try { clientWs.send(JSON.stringify({ type: 'dg_error', error: `HTTP ${res.statusCode}`, body })); } catch {}
            try { clientWs.close(1011, 'upstream_http_error'); } catch {}
          }
        });
      } catch (e) {
        console.error('[dg unexpected-response/read-error]', e);
      }
    });

    dg.on('open', () => {
      upstreamOpen = true;
      console.log('[dg] upstream opened');
      try {
        const configFeatures = {
          punctuate: true,
          interim_results: true,
          smart_format: true,
          diarize: true,
          utterances: true,
          utterance_end_ms: 1000,
          filler_words: false,
          // 頭切れ対策: VAD感度とエンドポイント設定
          vad_events: true,
          endpointing: 300, // 300ms（デフォルト10msより長く、話し始めを拾いやすく）
        };
        
        if (model !== 'nova-3' && keywords.length > 0) {
          configFeatures.keywords = keywords;
        }
        
        dg.send(JSON.stringify({
          type: 'Configure',
          features: configFeatures
        }));
        
        console.log('[dg] Configure sent', { diarization: true, punctuate: true, keywords: keywords.length });
        
        clientWs.send(JSON.stringify({ 
          type: 'dg_open', 
          upstream: a.endpoint.includes('/v2/') ? 'v2' : 'v1', 
          model: a.params.model, 
          language: lang, 
          codec, 
          rate,
          keywords: keywords.length
        }));
        
        if (warn) {
          clientWs.send(JSON.stringify({ 
            type: 'state', 
            level: 'warn', 
            code: 'model_language_mismatch', 
            message: warn, 
            resolved: { 
              upstream: a.endpoint.includes('/v2/') ? 'v2' : 'v1', 
              model: a.params.model 
            } 
          }));
        }
      } catch (e) {
        console.error('[dg] configure send error', e);
      }

      keepAliveTimer = setInterval(() => {
        if (dg.readyState === WebSocket.OPEN) {
          try { dg.send(JSON.stringify({ type: 'KeepAlive' })); } catch {}
        }
      }, 5000);
    });

    dg.on('message', (msg, isBinary) => {
      if (!downstreamOpen) return;
      messageCount++;
      const text = isBinary ? msg.toString('utf8') : String(msg);
      
      if (messageCount <= 3) {
        console.log(`[dg message #${messageCount}]`, text.substring(0, 300));
      }
      
      try {
        const j = JSON.parse(text);

        if (!loggedRequestId) {
          const rid = j?.metadata?.request_id || j?.request_id || j?.id || j?.metadata?.id;
          if (rid) {
            const up = a.endpoint.includes('/v2/') ? 'v2' : 'v1';
            console.log(`[dg] request_id=${rid} upstream=${up} model=${a.params.model} keywords=${keywords.length}`);
            loggedRequestId = true;
          }
        }

        const alt = j?.channel?.alternatives?.[0] || j?.alternatives?.[0];
        const transcript = alt?.transcript || j?.transcript || '';

        const words = Array.isArray(alt?.words) ? alt.words : [];
        const lowConfidence = words
          .map((word) => {
            const confidence = typeof word?.confidence === 'number' ? word.confidence : null;
            const token = typeof word?.punctuated_word === 'string'
              ? word.punctuated_word
              : typeof word?.word === 'string'
                ? word.word
                : '';
            if (!token || confidence === null) return null;
            if (confidence >= LOW_CONFIDENCE_THRESHOLD) return null;
            return { word: token, confidence, start: word.start, end: word.end };
          })
          .filter(Boolean)
          .slice(0, LOW_CONFIDENCE_MAX_WORDS);

        const confidenceAvg =
          words.length > 0
            ? words.reduce((sum, word) =>
                sum + (typeof word?.confidence === 'number' ? word.confidence : 0),
              0) / words.length
            : null;
        const wordsAllFinal = words.length > 0 ? words.every((w) => w?.is_final || w?.final) : false;
        const speechFinal = Boolean(
          j?.speech_final ?? (typeof j?.speech_final === 'undefined' && wordsAllFinal)
        );

        const isFinalCandidate = Boolean(
          j?.is_final ?? j?.final ?? (typeof j?.is_final === 'undefined' && wordsAllFinal)
        );
        const isFinal = speechFinal || isFinalCandidate;

        let speaker = undefined;
        if (words.length > 0) {
          speaker = words[0]?.speaker;
        }
        
        if (transcript) {
          if (messageCount <= 10) {
            console.log(`[stt] "${transcript.substring(0, 50)}" isFinal=${isFinal} speechFinal=${speechFinal} speaker=${speaker}`);
          }
          
          let displayText = transcript;
          if (speaker !== undefined && isFinal) {
            displayText = `??�b��${speaker}: ${transcript}`;
          }
          
          const ts = computeTsFromMessage(j, alt);
          clientWs.send(JSON.stringify({ type: 'stt', text: transcript, isFinal, speechFinal, ts, lang, model: a.params.model, speaker, lowConfidence, confidenceAvg }));
          
          if (EMIT_TRANSCRIPT_COMPAT) {
            clientWs.send(JSON.stringify({ type: 'transcript', text: transcript, isFinal, start: j?.start, end: j?.end }));
          }
          
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    dg.on('close', (code, reason) => {
      console.warn('[dg] close', code, reason?.toString?.() || '');
      if (downstreamOpen) {
        try { clientWs.send(JSON.stringify({ type: 'dg_closed', code, reason: String(reason || '') })); } catch {}
        if (finalizeRequested) {
          sendFinalizeAck();
        }
      }
      try { clearInterval(keepAliveTimer); } catch {}
    });

    dg.on('error', (e) => {
      console.error('[dg] error', e);
      try { clientWs.send(JSON.stringify({ type: 'dg_error', error: String(e) })); } catch {}
    });
  };

  const sendFinalizeAck = () => {
    if (!downstreamOpen || finalizeAckSent) return;
    finalizeAckSent = true;
    try { clientWs.send(JSON.stringify({ type: 'finalize_ack' })); } catch {}
    try { clientWs.close(1000, 'finalized'); } catch {}
  };

  openUpstream();

  let chunkCount = 0;
  clientWs.on('message', (chunk, isBinary) => {
    if (!isBinary) {
      const text = chunk.toString();
      if (text) {
        try {
          const payload = JSON.parse(text);
          if (payload?.type === 'finalize') {
            finalizeRequested = true;
            if (!dg || dg.readyState !== WebSocket.OPEN) {
              sendFinalizeAck();
            } else {
              tidyUp('client_finalize');
            }
            return;
          }
        } catch {
          // ignore non-JSON control frames
        }
      }
    }
    if (finalizeRequested) return;
    if (!upstreamOpen || !dg || dg.readyState !== WebSocket.OPEN) return;
    chunkCount++;
    if (chunkCount <= 3) {
      console.log(`[audio chunk #${chunkCount}] size=${chunk.length} bytes`);
    }
    try { dg.send(chunk); } catch (e) { console.error('[pipe] client->dg send error', e); }
  });

  const tidyUp = (why = 'client_closed') => {
    try { clearInterval(keepAliveTimer); } catch {}
    try {
      if (dg && dg.readyState === WebSocket.OPEN) {
        dg.send(JSON.stringify({ type: 'Finalize' }));
        dg.close(1000, why);
      }
    } catch {}
  };

  clientWs.on('close', () => {
    console.log('[client] disconnected');
    downstreamOpen = false;
    tidyUp('downstream_closed');
  });
  
  clientWs.on('error', () => {
    downstreamOpen = false;
    tidyUp('downstream_error');
  });
});

function decideUpstreamAndModel(langRaw, requestedModel) {
  const lang = String(langRaw || '').toLowerCase();
  const gateIsJa = lang.startsWith('ja');
  let upstream = gateIsJa ? 'v1' : 'v2';
  let model = gateIsJa ? DEFAULT_DEEPGRAM_MODEL : 'flux-general-en';
  let warn;

  if (requestedModel) {
    const req = String(requestedModel).toLowerCase();
    if (req.startsWith('flux-general')) {
      if (!lang.startsWith('en')) {
        warn = `flux-general* is English-only. Reverting to language gate for lang=${lang}.`;
      } else {
        upstream = 'v2'; model = 'flux-general-en';
      }
    } else if (req === 'nova-2' || req === 'nova-3') {
      upstream = 'v1'; model = req;
    } else {
      warn = `Unknown model '${requestedModel}'. Using language gate: upstream=${upstream}, model=${model}.`;
    }
  }

  return { upstream, model, warn };
}

function normalizeLangForV1(langRaw) {
  const s = String(langRaw || '').toLowerCase();
  if (s.startsWith('ja')) return 'ja';
  if (s.startsWith('en')) return 'en-US';
  return 'ja';
}

function computeTsFromMessage(msg, alt) {
  const start = typeof msg?.start === 'number' ? msg.start : (typeof msg?.metadata?.start === 'number' ? msg.metadata.start : undefined);
  const duration = typeof msg?.duration === 'number' ? msg.duration : (typeof msg?.metadata?.duration === 'number' ? msg.metadata.duration : undefined);
  if (typeof start === 'number' && typeof duration === 'number') return +(start + duration);
  if (typeof msg?.end === 'number') return +msg.end;
  const words = alt?.words;
  if (Array.isArray(words) && words.length) {
    const last = words[words.length - 1];
    const t = last?.end ?? last?.end_time ?? last?.time;
    if (typeof t === 'number') return +t;
  }
  return undefined;
}







