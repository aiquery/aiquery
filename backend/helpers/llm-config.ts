import { llmSettingsService, LLMSettings, EnvLLMPreference } from '../services/connection/llm-settings-service';

/** Aligned with DB / frontend — OpenAI, Google Gemini, Anthropic Claude. */
export enum LLMProvider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  ANTHROPIC = 'anthropic',
}

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  useLightModel: boolean;
}

function configForUserProvider(
  p: LLMProvider,
  s: LLMSettings
): LLMConfig | null {
  if (p === LLMProvider.OPENAI && s.openaiApiKey?.trim()) {
    return {
      provider: LLMProvider.OPENAI,
      apiKey: s.openaiApiKey.trim(),
      model: s.openaiModelName || undefined,
      useLightModel: s.modelType === 'light',
    };
  }
  if (p === LLMProvider.GEMINI && s.geminiApiKey?.trim()) {
    return {
      provider: LLMProvider.GEMINI,
      apiKey: s.geminiApiKey.trim(),
      model: s.geminiModelName || undefined,
      useLightModel: s.modelType === 'light',
    };
  }
  if (p === LLMProvider.ANTHROPIC && s.anthropicApiKey?.trim()) {
    return {
      provider: LLMProvider.ANTHROPIC,
      apiKey: s.anthropicApiKey.trim(),
      model: s.anthropicModelName || undefined,
      useLightModel: s.modelType === 'light',
    };
  }
  return null;
}

export function parseLLMProviderString(s?: string): LLMProvider | undefined {
  if (!s || typeof s !== 'string') return undefined;
  const x = s.toLowerCase().trim();
  if (x === 'gemini') return LLMProvider.GEMINI;
  if (x === 'anthropic' || x === 'claude') return LLMProvider.ANTHROPIC;
  if (x === 'openai') return LLMProvider.OPENAI;
  return undefined;
}

function configForEnvProvider(
  p: LLMProvider,
  keys: { o?: string; g?: string; a?: string }
): LLMConfig | null {
  if (p === LLMProvider.OPENAI && keys.o) {
    return {
      provider: LLMProvider.OPENAI,
      apiKey: keys.o,
      model: process.env.OPENAI_MODEL,
      useLightModel: false,
    };
  }
  if (p === LLMProvider.GEMINI && keys.g) {
    return {
      provider: LLMProvider.GEMINI,
      apiKey: keys.g,
      model: process.env.GEMINI_MODEL,
      useLightModel: false,
    };
  }
  if (p === LLMProvider.ANTHROPIC && keys.a) {
    return {
      provider: LLMProvider.ANTHROPIC,
      apiKey: keys.a,
      model: process.env.ANTHROPIC_MODEL,
      useLightModel: false,
    };
  }
  return null;
}

/** Pick env-backed provider: request hint → saved preference → random / first available. */
function pickEnvLLMConfig(
  preferredProvider: LLMProvider | undefined,
  envPreference: EnvLLMPreference | undefined,
  keys: { o?: string; g?: string; a?: string }
): LLMConfig | null {
  const available: LLMProvider[] = [];
  if (keys.o) available.push(LLMProvider.OPENAI);
  if (keys.g) available.push(LLMProvider.GEMINI);
  if (keys.a) available.push(LLMProvider.ANTHROPIC);

  if (available.length === 0) return null;

  const tryPreferred = (p: LLMProvider | undefined): LLMConfig | null => {
    if (!p) return null;
    const c = configForEnvProvider(p, keys);
    return c;
  };

  // 1) Explicit preference from API (e.g. RAG body llmProvider)
  const fromRequest = tryPreferred(preferredProvider);
  if (fromRequest) return fromRequest;

  // 2) If request asked for a provider but key missing, fall through to preference / random
  const pref = envPreference || 'random';

  if (pref === 'random') {
    const pick = available[Math.floor(Math.random() * available.length)];
    return configForEnvProvider(pick, keys)!;
  }

  const mapped =
    pref === 'openai'
      ? LLMProvider.OPENAI
      : pref === 'gemini'
        ? LLMProvider.GEMINI
        : LLMProvider.ANTHROPIC;
  const fromSaved = tryPreferred(mapped);
  if (fromSaved) return fromSaved;

  // 3) Fallback order when selected env key missing
  for (const p of [LLMProvider.OPENAI, LLMProvider.GEMINI, LLMProvider.ANTHROPIC]) {
    const c = tryPreferred(p);
    if (c) return c;
  }
  return null;
}

/**
 * Resolve LLM config:
 *
 * **User saved API keys (any of OpenAI / Gemini / Anthropic):** use **only** the user's
 * selected `provider` row and matching key — **no** environment fallback.
 *
 * **No user keys:** use environment variables with optional `preferredProvider` and
 * stored `envLlmPreference` (random vs fixed provider).
 */
export async function getLLMConfig(
  userId?: number,
  preferredProvider?: LLMProvider
): Promise<LLMConfig | null> {
  const envKeys = {
    o: process.env.OPENAI_API_KEY?.trim() || undefined,
    g:
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_AI_API_KEY?.trim() ||
      undefined,
    a: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  };

  let userSettings: LLMSettings | null = null;
  if (userId) {
    try {
      userSettings = await llmSettingsService.getLLMSettings(userId);
    } catch (e) {
      console.warn('[LLM Config] Error loading user LLM settings:', e);
    }
  }

  const hasUserOpenai = !!(userSettings?.openaiApiKey && String(userSettings.openaiApiKey).trim());
  const hasUserGemini = !!(userSettings?.geminiApiKey && String(userSettings.geminiApiKey).trim());
  const hasUserAnthropic = !!(userSettings?.anthropicApiKey && String(userSettings.anthropicApiKey).trim());
  const userHasAnyKey = hasUserOpenai || hasUserGemini || hasUserAnthropic;

  if (userId && userSettings && userHasAnyKey) {
    // User-owned keys always take precedence over env.
    // Try priority: explicit request provider -> saved active provider -> any other user key.
    const preferredUser = configForUserProvider(preferredProvider as LLMProvider, userSettings);
    if (preferredUser) {
      console.log(`[LLM Config] source=user userId=${userId} provider=${preferredUser.provider} reason=preferredProvider`);
      return preferredUser;
    }

    const activeProvider = userSettings.provider as LLMProvider;
    const activeUser = configForUserProvider(activeProvider, userSettings);
    if (activeUser) {
      console.log(`[LLM Config] source=user userId=${userId} provider=${activeUser.provider} reason=activeProvider`);
      return activeUser;
    }

    for (const p of [LLMProvider.OPENAI, LLMProvider.GEMINI, LLMProvider.ANTHROPIC]) {
      const fallbackUser = configForUserProvider(p, userSettings);
      if (fallbackUser) {
        console.warn(
          `[LLM Config] userId=${userId} activeProvider=${activeProvider} missing key; using other user provider=${p}`
        );
        console.log(`[LLM Config] source=user userId=${userId} provider=${fallbackUser.provider} reason=otherUserKey`);
        return fallbackUser;
      }
    }
  }

  // Environment fallback (no user keys, or anonymous)
  const envPref = userSettings?.envLlmPreference;
  const envConfig = pickEnvLLMConfig(preferredProvider, envPref, envKeys);
  if (envConfig) {
    console.log(
      `[LLM Config] source=env userId=${userId ?? 'anon'} provider=${envConfig.provider} reason=noUserKey`
    );
  } else {
    console.warn(`[LLM Config] source=none userId=${userId ?? 'anon'} reason=noUserKeyAndNoEnvKey`);
  }
  return envConfig;
}

/**
 * Env-only (e.g. Slack) — same selection rules without user keys.
 */
export async function getEnvOnlyLLMConfig(
  preferredProvider?: LLMProvider
): Promise<LLMConfig | null> {
  const envKeys = {
    o: process.env.OPENAI_API_KEY?.trim() || undefined,
    g:
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_AI_API_KEY?.trim() ||
      undefined,
    a: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  };
  return pickEnvLLMConfig(preferredProvider, 'random', envKeys);
}
