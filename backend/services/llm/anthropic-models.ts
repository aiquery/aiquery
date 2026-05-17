/**
 * Anthropic API model id resolution.
 * Retired snapshot IDs (e.g. claude-3-7-sonnet-20250219) must be mapped to active models.
 * @see https://docs.anthropic.com/en/docs/about-claude/model-deprecations
 */

/** Default API id when ANTHROPIC_MODEL is unset. */
export const DEFAULT_ANTHROPIC_API_MODEL = 'claude-sonnet-4-6';

const RETIRED_ANTHROPIC_TO_ACTIVE: Record<string, string> = {
  'claude-3-7-sonnet-20250219': 'claude-sonnet-4-6',
  'claude-3-7-sonnet-latest': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-latest': 'claude-sonnet-4-6',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-latest': 'claude-haiku-4-5-20251001',
  'claude-3-haiku-20240307': 'claude-haiku-4-5-20251001',
  'claude-3-opus-20240229': 'claude-opus-4-6',
  'claude-3-opus-latest': 'claude-opus-4-6',
};

function mapRetiredAnthropicModel(apiId: string): string {
  const key = apiId.trim().toLowerCase();
  return RETIRED_ANTHROPIC_TO_ACTIVE[key] ?? apiId;
}

function resolveAnthropicModelIdFromString(s: string): string {
  const lower = s.toLowerCase().trim();

  if (lower.includes('haiku')) return 'claude-haiku-4-5-20251001';
  if (lower.includes('opus') && lower.includes('3')) return 'claude-opus-4-6';
  if (lower.includes('3.7') && lower.includes('sonnet')) return 'claude-sonnet-4-6';
  if (lower.includes('3.5') && lower.includes('sonnet')) return 'claude-sonnet-4-6';

  if (lower === 'claude-3-7-sonnet') return 'claude-sonnet-4-6';
  if (lower === 'claude-3-5-sonnet') return 'claude-sonnet-4-6';

  if (lower.startsWith('claude-')) return mapRetiredAnthropicModel(s.trim());

  return DEFAULT_ANTHROPIC_API_MODEL;
}

/**
 * Maps settings/UI labels (e.g. "Claude 3.7 Sonnet") and short ids to Anthropic API model ids.
 */
export function resolveAnthropicModelId(raw?: string | null): string {
  const fromEnv = process.env.ANTHROPIC_MODEL?.trim();
  if (raw == null || !String(raw).trim()) {
    return fromEnv ? resolveAnthropicModelIdFromString(fromEnv) : DEFAULT_ANTHROPIC_API_MODEL;
  }
  return resolveAnthropicModelIdFromString(String(raw).trim());
}
