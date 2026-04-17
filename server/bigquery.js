import { BigQuery } from '@google-cloud/bigquery';
import path from 'path';
import fs from 'fs/promises';

const CACHE_TTL_MS = Number(process.env.BQ_CACHE_TTL_MS ?? 5 * 60 * 1000);
const MAX_LIMIT = Number(process.env.BQ_MAX_LIMIT ?? 2000);
const INSERT_MAX_RETRIES = Number(process.env.BQ_INSERT_RETRIES ?? 2);
const RETRY_BASE_DELAY_MS = Number(process.env.BQ_INSERT_RETRY_BASE_MS ?? 500);
const RETRY_MAX_DELAY_MS = Number(process.env.BQ_INSERT_RETRY_MAX_MS ?? 4000);

const RETRYABLE_HTTP_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
]);
const RETRYABLE_ERROR_REASONS = new Set([
  'backendError',
  'rateLimitExceeded',
  'internalError',
  'quotaExceeded',
  'resourceInUse',
  'tableUnavailable',
  'connectionError',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorReasons = (error) => {
  const reasons = [];
  const list = Array.isArray(error?.errors) ? error.errors : [];
  list.forEach((entry) => {
    if (entry?.reason && typeof entry.reason === 'string') {
      reasons.push(entry.reason);
    }
  });
  if (typeof error?.reason === 'string') {
    reasons.push(error.reason);
  }
  return reasons;
};

const isRetryableBigQueryError = (error) => {
  const code = typeof error?.code === 'number' ? error.code : null;
  if (code && RETRYABLE_HTTP_CODES.has(code)) return true;
  if (typeof error?.code === 'string' && RETRYABLE_NETWORK_CODES.has(error.code)) {
    return true;
  }
  const reasons = getErrorReasons(error);
  return reasons.some((reason) => RETRYABLE_ERROR_REASONS.has(reason));
};

const summarizeInsertError = (error, retryable) => {
  const code = typeof error?.code === 'number' ? error.code : undefined;
  const reasons = getErrorReasons(error);
  // PartialFailureError の詳細を取得
  let rowErrors = [];
  if (Array.isArray(error?.errors)) {
    error.errors.forEach((rowErr) => {
      if (rowErr?.errors) {
        rowErrors.push(...rowErr.errors.map((e) => ({
          message: e?.message,
          reason: e?.reason,
          location: e?.location,
        })));
      }
    });
  }
  return {
    errorType: error?.name || 'Error',
    code,
    reason: reasons[0],
    retryable: Boolean(retryable),
    rowErrors: rowErrors.length > 0 ? rowErrors : undefined,
  };
};

const cache = new Map();

const sanitizeIdentifier = (value) => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_.]+$/.test(trimmed)) return null;
  return trimmed;
};

const sanitizeProjectId = (value) => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  // Project IDs can include hyphens; keep stricter rules for dataset/table/columns.
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) return null;
  return trimmed;
};

const parseList = (value, fallback = []) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return [];
  const items = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : [];
};

const sanitizeColumns = (columns) =>
  columns.map(sanitizeIdentifier).filter(Boolean);

const getRoleConfig = (role) => {
  const upper = role === 'facilitator' ? 'FACILITATOR' : 'TALENT';
  const projectId = process.env[`BQ_${upper}_PROJECT_ID`] || process.env.BQ_PROJECT_ID || '';
  const dataset = process.env[`BQ_${upper}_DATASET`] || process.env.BQ_DATASET || '';
  const table = process.env[`BQ_${upper}_TABLE`] || '';
  const idColumn = process.env[`BQ_${upper}_ID_COLUMN`] || 'id';
  const nameColumns = parseList(process.env[`BQ_${upper}_NAME_COLUMN`], ['name']);
  const kanaColumns = parseList(process.env[`BQ_${upper}_KANA_COLUMN`], ['name_kana']);
  const extraColumns = parseList(process.env[`BQ_${upper}_EXTRA_COLUMNS`], ['email', 'department']);
  const defaultSearchColumns = [...nameColumns, ...kanaColumns, 'email'].filter(Boolean);
  const searchColumns = parseList(process.env[`BQ_${upper}_SEARCH_COLUMNS`], defaultSearchColumns);

  return {
    projectId,
    dataset,
    table,
    idColumn,
    nameColumns,
    kanaColumns,
    extraColumns,
    searchColumns,
  };
};

const buildSelect = (config) => {
  const selectParts = [];
  const idColumn = sanitizeIdentifier(config.idColumn);
  const nameColumns = sanitizeColumns(config.nameColumns ?? []);
  const kanaColumns = sanitizeColumns(config.kanaColumns ?? []);
  if (!idColumn || nameColumns.length === 0) return null;

  const buildConcatExpr = (columns) => {
    if (columns.length === 1) {
      return `IFNULL(CAST(${columns[0]} AS STRING), '')`;
    }
    const parts = [];
    columns.forEach((col, index) => {
      if (index > 0) {
        parts.push(`' '`);
      }
      parts.push(`IFNULL(CAST(${col} AS STRING), '')`);
    });
    return `TRIM(CONCAT(${parts.join(', ')}))`;
  };

  const nameExpr = buildConcatExpr(nameColumns);
  selectParts.push(`${idColumn} as id`);
  selectParts.push(`${nameExpr} as name`);

  if (kanaColumns.length > 0) {
    const kanaExpr = buildConcatExpr(kanaColumns);
    selectParts.push(`${kanaExpr} as nameKana`);
  }

  const extraColumns = config.extraColumns
    .map(sanitizeIdentifier)
    .filter(Boolean)
    .filter((col) => col !== idColumn && !nameColumns.includes(col) && !kanaColumns.includes(col));
  extraColumns.forEach((col) => {
    selectParts.push(`${col} as ${col}`);
  });

  return {
    select: selectParts.join(', '),
    orderBy: 'name',
    extraColumns,
  };
};

const buildSearchClause = (config, q) => {
  if (!q) return null;
  const searchColumns = config.searchColumns
    .map(sanitizeIdentifier)
    .filter(Boolean)
    .filter((col, index, self) => self.indexOf(col) === index);
  if (!searchColumns.length) return null;
  const clauses = searchColumns.map(
    (col) => `LOWER(CAST(${col} AS STRING)) LIKE LOWER(CONCAT('%', @q, '%'))`,
  );
  return clauses.join(' OR ');
};

const getBigQueryClient = (projectId) => {
  const keyFilename =
    process.env.GCP_WIF_CREDENTIALS ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    undefined;
  const options = {};
  if (projectId) {
    options.projectId = projectId;
  }
  if (keyFilename) {
    options.keyFilename = keyFilename;
  }
  return new BigQuery(options);
};

const ensureSubjectToken = async () => {
  const subjectTokenFile = (process.env.GCP_WIF_SUBJECT_TOKEN_FILE || '').trim();
  if (!subjectTokenFile) return;
  const tokenPath = path.isAbsolute(subjectTokenFile)
    ? subjectTokenFile
    : path.join(process.cwd(), subjectTokenFile);
  const rawToken = await fs.readFile(tokenPath, 'utf8').catch(() => '');
  if (!rawToken || !rawToken.trim()) {
    throw new Error('missing_subject_token');
  }
};

const getExportConfig = () => {
  const projectId = process.env.BQ_EXPORT_PROJECT_ID || process.env.BQ_PROJECT_ID || '';
  const dataset = process.env.BQ_EXPORT_DATASET || '';
  const table = process.env.BQ_EXPORT_TABLE || '';
  return { projectId, dataset, table };
};

const insertWithRetry = async (tableRef, row, insertId) => {
  const maxRetries = Math.max(0, Number.isFinite(INSERT_MAX_RETRIES) ? INSERT_MAX_RETRIES : 0);
  let attempt = 0;

  while (true) {
    try {
      // raw: true で insertId を使用
      await tableRef.insert([{ insertId, json: row }], { raw: true });
      return;
    } catch (error) {
      const retryable = isRetryableBigQueryError(error);
      if (!retryable || attempt >= maxRetries) {
        const summary = summarizeInsertError(error, retryable);
        const wrapped = new Error('bigquery_insert_failed');
        wrapped.details = summary;
        wrapped.retryable = summary.retryable;
        wrapped.code = summary.code;
        throw wrapped;
      }
      const baseDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 250);
      const delay = Math.min(baseDelay + jitter, RETRY_MAX_DELAY_MS);
      await sleep(delay);
      attempt += 1;
    }
  }
};

export const fetchParticipants = async ({ role, q = '', limit = MAX_LIMIT }) => {
  if (!['facilitator', 'talent'].includes(role)) {
    throw new Error('invalid_role');
  }
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, MAX_LIMIT));
  const normalizedQuery = q.trim();

  const cacheKey = `${role}:${normalizedQuery}:${normalizedLimit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const config = getRoleConfig(role);
  const dataset = sanitizeIdentifier(config.dataset);
  const table = sanitizeIdentifier(config.table);
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !table) {
    throw new Error('missing_bigquery_config');
  }

  const selectInfo = buildSelect(config);
  if (!selectInfo) {
    throw new Error('invalid_column_config');
  }

  await ensureSubjectToken();

  const searchClause = buildSearchClause(config, normalizedQuery);
  const tableRef = `\`${projectId ? `${projectId}.` : ''}${dataset}.${table}\``;

  const sql = `
    SELECT ${selectInfo.select}
    FROM ${tableRef}
    ${searchClause ? `WHERE ${searchClause}` : ''}
    ORDER BY ${selectInfo.orderBy}
    LIMIT @limit
  `;

  const bigquery = getBigQueryClient(projectId || undefined);
  const params = { limit: normalizedLimit };
  if (searchClause) {
    params.q = normalizedQuery;
  }

  const [rows] = await bigquery.query({
    query: sql,
    params,
  });

  const toText = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return String(value);
  };

  const data = Array.isArray(rows)
    ? rows.map((row) => {
        const extras = selectInfo.extraColumns
          .map((col) => toText(row[col]).trim())
          .filter(Boolean);
        const uniqueExtras = extras.filter((value, index, self) => self.indexOf(value) === index);
        return {
          id: toText(row.id).trim(),
          name: toText(row.name).trim(),
          nameKana: toText(row.nameKana ?? row.name_kana).trim(),
          email: toText(row.email).trim(),
          department: toText(row.department).trim(),
          extras: uniqueExtras,
        };
      })
    : [];

  cache.set(cacheKey, { data, at: Date.now() });
  return data;
};

export const insertSupportRecord = async (payload) => {
  const config = getExportConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const table = sanitizeIdentifier(config.table);
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !table) {
    throw new Error('missing_export_config');
  }

  await ensureSubjectToken();

  const recordId = typeof payload?.recordId === 'string' ? payload.recordId.trim() : '';
  if (!recordId) {
    throw new Error('record_id_required');
  }

  const bigquery = getBigQueryClient(projectId || undefined);
  const sentAt = payload.sentAt || new Date().toISOString();

  const row = {
    record_id: recordId,
    session_date: payload.sessionDate || null,
    meeting_type_id: payload.meetingTypeId || null,
    meeting_type_name: payload.meetingTypeName || null,
    session_mode: payload.sessionMode || null,
    facilitator_id: payload.facilitatorId || null,
    facilitator_name: payload.facilitatorName || null,
    talent_id: payload.talentId || null,
    talent_name: payload.talentName || null,
    cleaned_text: payload.cleanedText || null,
    support_record_json: payload.supportRecordJson || null,
    sent_at: sentAt,
  };

  // ストリーミングINSERT（高速・全履歴保持）
  // 同じrecord_idでも毎回INSERTされる（履歴として保持）
  // 最新データの取得はROW_NUMBER() OVER (PARTITION BY record_id ORDER BY sent_at DESC)で対応
  const tableRef = bigquery.dataset(dataset).table(table);
  const insertId = `${recordId}_${Date.now()}`;
  await insertWithRetry(tableRef, row, insertId);

  return { ok: true };
};

const getSummaryConfig = () => {
  const projectId = process.env.BQ_SUMMARY_PROJECT_ID || process.env.BQ_EXPORT_PROJECT_ID || process.env.BQ_PROJECT_ID || '';
  const dataset = process.env.BQ_SUMMARY_DATASET || process.env.BQ_EXPORT_DATASET || '';
  const table = process.env.BQ_SUMMARY_TABLE || 'session_summaries';
  return { projectId, dataset, table };
};

export const insertSessionSummary = async (payload) => {
  const config = getSummaryConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const table = sanitizeIdentifier(config.table);
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !table) {
    throw new Error('missing_summary_config');
  }

  await ensureSubjectToken();

  const summaryId = typeof payload?.summaryId === 'string' ? payload.summaryId.trim() : '';
  if (!summaryId) {
    throw new Error('summary_id_required');
  }

  const bigquery = getBigQueryClient(projectId || undefined);
  const createdAt = payload.createdAt || new Date().toISOString();

  console.log(`[insertSessionSummary] inserting for msAccountId=${payload.msAccountId}`);
  const row = {
    summary_id: summaryId,
    record_id: payload.recordId || null,
    ms_account_id: payload.msAccountId || null,
    session_date: payload.sessionDate || null,
    meeting_type_id: payload.meetingTypeId || null,
    meeting_type_name: payload.meetingTypeName || null,
    facilitator_id: payload.facilitatorId || null,
    facilitator_name: payload.facilitatorName || null,
    talent_id: payload.talentId || null,
    talent_name: payload.talentName || null,
    summary: payload.summary || null,
    key_topics: payload.keyTopics || null,
    next_suggestions: payload.nextSuggestions || null,
    created_at: createdAt,
  };

  // ストリーミングINSERT（高速・全履歴保持）
  const tableRef = bigquery.dataset(dataset).table(table);
  const insertId = `${summaryId}_${Date.now()}`;
  await insertWithRetry(tableRef, row, insertId);

  return { ok: true };
};

export const fetchSessionSummaries = async ({ msAccountId, limit = 5 }) => {
  const config = getSummaryConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const table = sanitizeIdentifier(config.table);
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !table) {
    throw new Error('missing_summary_config');
  }

  if (!msAccountId || typeof msAccountId !== 'string') {
    throw new Error('ms_account_id_required');
  }

  await ensureSubjectToken();

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 5, 20));
  const tableRef = `\`${projectId ? `${projectId}.` : ''}${dataset}.${table}\``;

  const sql = `
    SELECT
      summary_id,
      record_id,
      ms_account_id,
      session_date,
      meeting_type_id,
      meeting_type_name,
      facilitator_id,
      facilitator_name,
      talent_id,
      talent_name,
      summary,
      key_topics,
      next_suggestions,
      created_at
    FROM ${tableRef}
    WHERE ms_account_id = @msAccountId
    ORDER BY session_date DESC, created_at DESC
    LIMIT @limit
  `;

  const bigquery = getBigQueryClient(projectId || undefined);
  console.log(`[fetchSessionSummaries] query table=${tableRef}, msAccountId=${msAccountId}, limit=${normalizedLimit}`);
  const [rows] = await bigquery.query({
    query: sql,
    params: { msAccountId, limit: normalizedLimit },
  });
  console.log(`[fetchSessionSummaries] found ${rows?.length || 0} rows`);

  const toText = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return String(value);
  };

  return Array.isArray(rows)
    ? rows.map((row) => ({
        summaryId: toText(row.summary_id),
        recordId: toText(row.record_id),
        msAccountId: toText(row.ms_account_id),
        sessionDate: toText(row.session_date),
        meetingTypeId: toText(row.meeting_type_id),
        meetingTypeName: toText(row.meeting_type_name),
        facilitatorId: toText(row.facilitator_id),
        facilitatorName: toText(row.facilitator_name),
        talentId: toText(row.talent_id),
        talentName: toText(row.talent_name),
        summary: toText(row.summary),
        keyTopics: toText(row.key_topics),
        nextSuggestions: toText(row.next_suggestions),
        createdAt: toText(row.created_at),
      }))
    : [];
};

// ユーザープロフィール（メタ要約）の取得
export const fetchUserProfile = async ({ msAccountId }) => {
  const config = getSummaryConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const profileTable = sanitizeIdentifier(process.env.BQ_PROFILE_TABLE || 'user_profiles');
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !profileTable) {
    console.log('[fetchUserProfile] missing config, skipping');
    return null;
  }

  if (!msAccountId || typeof msAccountId !== 'string') {
    return null;
  }

  await ensureSubjectToken();

  const tableRef = `\`${projectId ? `${projectId}.` : ''}${dataset}.${profileTable}\``;
  const sql = `
    SELECT
      ms_account_id,
      meta_summary,
      key_facts,
      interests,
      goals,
      notes,
      last_summary_count,
      updated_at
    FROM ${tableRef}
    WHERE ms_account_id = @msAccountId
    LIMIT 1
  `;

  const bigquery = getBigQueryClient(projectId || undefined);
  console.log(`[fetchUserProfile] query msAccountId=${msAccountId}`);

  try {
    const [rows] = await bigquery.query({
      query: sql,
      params: { msAccountId },
    });

    if (!rows || rows.length === 0) {
      console.log('[fetchUserProfile] no profile found');
      return null;
    }

    const row = rows[0];
    console.log(`[fetchUserProfile] found profile, lastSummaryCount=${row.last_summary_count}`);
    return {
      msAccountId: row.ms_account_id || '',
      metaSummary: row.meta_summary || '',
      keyFacts: row.key_facts || '',
      interests: row.interests || '',
      goals: row.goals || '',
      notes: row.notes || '',
      lastSummaryCount: Number(row.last_summary_count) || 0,
      updatedAt: row.updated_at || '',
    };
  } catch (error) {
    console.error('[fetchUserProfile] error', error?.message || error);
    return null;
  }
};

// ユーザープロフィール（メタ要約）の更新/作成
export const upsertUserProfile = async ({ msAccountId, metaSummary, keyFacts, interests, goals, notes, lastSummaryCount }) => {
  const config = getSummaryConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const profileTable = sanitizeIdentifier(process.env.BQ_PROFILE_TABLE || 'user_profiles');
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !profileTable) {
    throw new Error('missing_profile_config');
  }

  if (!msAccountId || typeof msAccountId !== 'string') {
    throw new Error('ms_account_id_required');
  }

  await ensureSubjectToken();

  const tableRef = `\`${projectId ? `${projectId}.` : ''}${dataset}.${profileTable}\``;
  const now = new Date().toISOString();

  // MERGEでUPSERT
  const sql = `
    MERGE ${tableRef} AS target
    USING (SELECT @msAccountId AS ms_account_id) AS source
    ON target.ms_account_id = source.ms_account_id
    WHEN MATCHED THEN
      UPDATE SET
        meta_summary = @metaSummary,
        key_facts = @keyFacts,
        interests = @interests,
        goals = @goals,
        notes = @notes,
        last_summary_count = @lastSummaryCount,
        updated_at = @updatedAt
    WHEN NOT MATCHED THEN
      INSERT (ms_account_id, meta_summary, key_facts, interests, goals, notes, last_summary_count, created_at, updated_at)
      VALUES (@msAccountId, @metaSummary, @keyFacts, @interests, @goals, @notes, @lastSummaryCount, @updatedAt, @updatedAt)
  `;

  const bigquery = getBigQueryClient(projectId || undefined);
  console.log(`[upsertUserProfile] msAccountId=${msAccountId}, lastSummaryCount=${lastSummaryCount}`);

  await bigquery.query({
    query: sql,
    params: {
      msAccountId,
      metaSummary: metaSummary || '',
      keyFacts: keyFacts || '',
      interests: interests || '',
      goals: goals || '',
      notes: notes || '',
      lastSummaryCount: lastSummaryCount || 0,
      updatedAt: now,
    },
  });

  console.log('[upsertUserProfile] done');
  return { ok: true };
};

// セッション要約の総数を取得
export const countSessionSummaries = async ({ msAccountId }) => {
  const config = getSummaryConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const table = sanitizeIdentifier(config.table);
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !table) {
    return 0;
  }

  if (!msAccountId || typeof msAccountId !== 'string') {
    return 0;
  }

  await ensureSubjectToken();

  const tableRef = `\`${projectId ? `${projectId}.` : ''}${dataset}.${table}\``;
  // DRAFTを除外してカウント
  const sql = `
    SELECT COUNT(*) as cnt
    FROM ${tableRef}
    WHERE ms_account_id = @msAccountId
      AND (summary IS NULL OR summary NOT LIKE '[DRAFT:%')
  `;

  const bigquery = getBigQueryClient(projectId || undefined);
  try {
    const [rows] = await bigquery.query({
      query: sql,
      params: { msAccountId },
    });
    const count = Number(rows?.[0]?.cnt) || 0;
    console.log(`[countSessionSummaries] msAccountId=${msAccountId}, count=${count}`);
    return count;
  } catch (error) {
    console.error('[countSessionSummaries] error', error?.message || error);
    return 0;
  }
};

// 議題候補を取得
export const fetchSuggestedTopics = async ({ msAccountId, meetingType, limit = 5 }) => {
  const config = getSummaryConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const topicsTable = sanitizeIdentifier(process.env.BQ_TOPICS_TABLE || 'suggested_topics');
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !topicsTable) {
    console.log('[fetchSuggestedTopics] missing config, skipping');
    return [];
  }

  await ensureSubjectToken();

  const tableRef = `\`${projectId ? `${projectId}.` : ''}${dataset}.${topicsTable}\``;
  const today = new Date().toISOString().slice(0, 10);

  // 条件：有効 AND (全員対象 OR 特定ユーザー) AND (全タイプ OR 特定タイプ) AND 期間内
  const sql = `
    SELECT
      id,
      topic_text,
      priority
    FROM ${tableRef}
    WHERE is_active = TRUE
      AND (target_ms_account_id IS NULL OR target_ms_account_id = @msAccountId)
      AND (target_meeting_type IS NULL OR target_meeting_type = @meetingType)
      AND (valid_from IS NULL OR valid_from <= @today)
      AND (valid_until IS NULL OR valid_until >= @today)
    ORDER BY priority ASC, created_at DESC
    LIMIT @limit
  `;

  const bigquery = getBigQueryClient(projectId || undefined);
  console.log(`[fetchSuggestedTopics] query msAccountId=${msAccountId}, meetingType=${meetingType}`);

  try {
    const [rows] = await bigquery.query({
      query: sql,
      params: {
        msAccountId: msAccountId || '',
        meetingType: meetingType || '',
        today,
        limit: Math.max(1, Math.min(Number(limit) || 5, 20)),
      },
    });

    const topics = Array.isArray(rows)
      ? rows.map((row) => row.topic_text).filter(Boolean)
      : [];

    console.log(`[fetchSuggestedTopics] found ${topics.length} topics`);
    return topics;
  } catch (error) {
    console.error('[fetchSuggestedTopics] error', error?.message || error);
    return [];
  }
};

const getSafetyLogConfig = () => {
  const projectId = process.env.BQ_SUMMARY_PROJECT_ID || process.env.BQ_EXPORT_PROJECT_ID || process.env.BQ_PROJECT_ID || '';
  const dataset = process.env.BQ_SUMMARY_DATASET || process.env.BQ_EXPORT_DATASET || '';
  const table = process.env.BQ_SAFETY_LOG_TABLE || 'safety_audit_logs';
  return { projectId, dataset, table };
};

export const insertSafetyLog = async (payload) => {
  const config = getSafetyLogConfig();
  const dataset = sanitizeIdentifier(config.dataset);
  const table = sanitizeIdentifier(config.table);
  const projectId = sanitizeProjectId(config.projectId);
  if (!dataset || !table) {
    console.warn('[insertSafetyLog] missing config, skipping');
    return { ok: false, reason: 'missing_config' };
  }

  try {
    await ensureSubjectToken();
  } catch {
    console.warn('[insertSafetyLog] no subject token, skipping');
    return { ok: false, reason: 'no_token' };
  }

  const bigquery = getBigQueryClient(projectId || undefined);
  const logId = `safety_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    log_id: logId,
    ms_account_id: payload.msAccountId || null,
    user_name: payload.userName || null,
    event_type: payload.eventType || null,
    crisis_level: payload.crisisLevel || null,
    matched_patterns: payload.matchedPatterns ? JSON.stringify(payload.matchedPatterns) : null,
    user_message_excerpt: payload.userMessage ? payload.userMessage.slice(0, 200) : null,
    action_taken: payload.actionTaken || null,
    created_at: new Date().toISOString(),
  };

  try {
    const tableRef = bigquery.dataset(dataset).table(table);
    await insertWithRetry(tableRef, row, logId);
    console.log(`[insertSafetyLog] logged: ${payload.eventType} level=${payload.crisisLevel}`);
    return { ok: true };
  } catch (error) {
    console.error('[insertSafetyLog] insert failed (non-blocking)', error?.message || error);
    return { ok: false, reason: 'insert_failed' };
  }
};
