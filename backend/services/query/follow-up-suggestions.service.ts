import { chatCompletionWithUserKey } from '../llm/llm.service';
import { LLMProvider } from '../../helpers/llm-config';

const MAX_INTERPRETATION_CHARS = 8000;
const MAX_SQL_CHARS = 4000;
const SAMPLE_ROWS = 15;
const MAX_RESULT_JSON_CHARS = 14000;
const MAX_QUESTIONS = 4;
const MAX_QUESTION_LEN = 220;

export interface FollowUpSuggestionsInput {
  userQuestion: string;
  interpretation: string;
  sqlQuery?: string | null;
  queryResults: unknown[];
  provider: LLMProvider;
  apiKey: string;
  model?: string;
}

function truncate(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function safeSampleRows(rows: unknown[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '[]';
  let n = SAMPLE_ROWS;
  while (n >= 1) {
    try {
      const json = JSON.stringify(rows.slice(0, n));
      if (json.length <= MAX_RESULT_JSON_CHARS) return json;
    } catch {
      break;
    }
    n = Math.floor(n / 2);
  }
  return '[]';
}

/** When JSON is valid but array lives in a slice, or model wrapped text oddly. */
function looseParseFollowUpQuestionsArray(raw: string): string[] {
  const idx = raw.indexOf('"followUpQuestions"');
  if (idx < 0) return [];
  const from = raw.slice(idx);
  const lb = from.indexOf('[');
  if (lb < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = lb; i < from.length; i++) {
    const c = from[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return [];
  try {
    const parsed = JSON.parse(from.slice(lb, end)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((q) => truncate(q, MAX_QUESTION_LEN));
  } catch {
    return [];
  }
}

function parseQuestionsJson(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let s = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/m, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const parsed = JSON.parse(s) as Record<string, unknown>;
    const arr =
      Array.isArray(parsed.followUpQuestions)
        ? parsed.followUpQuestions
        : Array.isArray(parsed.questions)
          ? parsed.questions
          : Array.isArray(parsed.suggestions)
            ? parsed.suggestions
            : null;
    if (!arr) {
      const loose = looseParseFollowUpQuestionsArray(trimmed);
      return finalizeQuestions(loose);
    }
    return finalizeQuestions(
      arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    );
  } catch {
    const loose = looseParseFollowUpQuestionsArray(trimmed);
    if (loose.length > 0) return finalizeQuestions(loose);
    return [];
  }
}

function finalizeQuestions(arr: string[]): string[] {
  return arr
    .map((q) => truncate(q, MAX_QUESTION_LEN))
    .filter((q, i, a) => a.indexOf(q) === i)
    .slice(0, MAX_QUESTIONS);
}

/**
 * Suggests short natural-language follow-up questions based on the user ask, answer, SQL, and sample rows.
 */
export async function generateFollowUpSuggestions(input: FollowUpSuggestionsInput): Promise<string[]> {
  const {
    userQuestion,
    interpretation,
    sqlQuery,
    queryResults,
    provider,
    apiKey,
    model,
  } = input;

  const systemPrompt = `You suggest concise follow-up questions a user might ask next in a data analytics chat.
Rules:
- Output valid JSON only, no markdown, no commentary.
- Schema: {"followUpQuestions": ["...", "..."]}
- Exactly 4 strings in followUpQuestions (or fewer if not enough good ideas).
- Each question is standalone, natural, and actionable for the same database/context.
- Reference concrete dimensions, metrics, or time ranges when the data supports it.
- Do not repeat the user's original question verbatim.
- Questions must be in the same language as the user's question when possible.`;

  const userContent = `User question:
${truncate(userQuestion, 2000)}

Assistant interpretation / insights:
${truncate(interpretation, MAX_INTERPRETATION_CHARS)}

Executed SQL (may be truncated):
${sqlQuery ? truncate(sqlQuery, MAX_SQL_CHARS) : '(none)'}

Sample query result rows (JSON array, up to ${SAMPLE_ROWS} rows):
${safeSampleRows(queryResults)}

Return JSON: {"followUpQuestions":["...","...","...","..."]}`;

  const raw = await chatCompletionWithUserKey(provider, apiKey, userContent, {
    systemPrompt,
    jsonMode: true,
    model,
    maxTokens: 1200,
    temperature: 0.45,
    callSite: 'followUpSuggestions',
  });

  return parseQuestionsJson(raw);
}
