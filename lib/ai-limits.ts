export const MIN_STAGE_OUTPUT_TOKENS = 256;
export const MAX_STAGE_OUTPUT_TOKENS = 65_536;
export const DEFAULT_STAGE_OUTPUT_TOKENS = 16_384;

export function clampStageOutputTokens(value: number | undefined, fallback = DEFAULT_STAGE_OUTPUT_TOKENS) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_STAGE_OUTPUT_TOKENS, Math.min(MAX_STAGE_OUTPUT_TOKENS, Math.trunc(value as number)));
}
