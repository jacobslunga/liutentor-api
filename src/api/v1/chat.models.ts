export type Provider = "google";
export type ThinkingLevel = "minimal" | "medium" | "high";

export interface ModelConfig {
  provider: Provider;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  /** The deep tier remains protected from anonymous abuse. */
  requiresAuth?: boolean;
  /** Keep tool support explicit so a future tier cannot silently 400. */
  supportsWebSearch?: boolean;
}

export const GEMINI_CHAT_MODEL_ID = "gemini-3.1-flash-lite";

export const CHAT_TIER_IDS = {
  low: "gemini-flash-lite-minimal",
  balanced: "gemini-flash-lite-medium",
  deep: "gemini-flash-lite-high",
} as const;

/** The public selection ID used when a client omits or sends an unknown tier. */
export const DEFAULT_MODEL_ID = CHAT_TIER_IDS.low;

const LOW_CONFIG: ModelConfig = {
  provider: "google",
  modelId: GEMINI_CHAT_MODEL_ID,
  thinkingLevel: "minimal",
  supportsWebSearch: true,
};

const BALANCED_CONFIG: ModelConfig = {
  provider: "google",
  modelId: GEMINI_CHAT_MODEL_ID,
  thinkingLevel: "medium",
  supportsWebSearch: true,
};

const DEEP_CONFIG: ModelConfig = {
  provider: "google",
  modelId: GEMINI_CHAT_MODEL_ID,
  thinkingLevel: "high",
  requiresAuth: true,
  supportsWebSearch: true,
};

const MODEL_MAP: Record<string, ModelConfig> = {
  [CHAT_TIER_IDS.low]: LOW_CONFIG,
  [CHAT_TIER_IDS.balanced]: BALANCED_CONFIG,
  [CHAT_TIER_IDS.deep]: DEEP_CONFIG,

  // Compatibility aliases let the Hono service deploy before the Nuxt client.
  // They can be removed after old bundles and v11 cookies have aged out.
  "gemini-3.1-flash-lite": LOW_CONFIG,
  "gpt-5.6-luna": BALANCED_CONFIG,
  "gpt-5.6-terra": DEEP_CONFIG,
};

export const getModelConfig = (modelId?: string): ModelConfig =>
  (modelId ? MODEL_MAP[modelId] : undefined) ?? LOW_CONFIG;

export const getModelLogId = (config: ModelConfig): string =>
  `${config.modelId}:${config.thinkingLevel}`;
