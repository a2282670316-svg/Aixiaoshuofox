import type { AIStage, StageModelConfig } from "./types";

export const GPT55_STAGE_PRESETS: Record<AIStage, Pick<StageModelConfig, "temperature" | "reasoningEffort" | "verbosity">> = {
  ideation: { temperature: 0.9, reasoningEffort: "medium", verbosity: "high" },
  blueprint: { temperature: 0.6, reasoningEffort: "medium", verbosity: "medium" },
  chapter: { temperature: 0.8, reasoningEffort: "low", verbosity: "high" },
  memory: { temperature: 0.1, reasoningEffort: "low", verbosity: "low" },
  audit: { temperature: 0.1, reasoningEffort: "high", verbosity: "medium" },
  repair: { temperature: 0.2, reasoningEffort: "medium", verbosity: "medium" },
};

export function resolveStageRequestOptions(
  stageConfig: StageModelConfig | undefined,
  defaultTemperature: number,
  defaultMaxOutputTokens: number,
) {
  return {
    temperature: stageConfig?.temperature ?? defaultTemperature,
    reasoningEffort: stageConfig?.reasoningEffort,
    verbosity: stageConfig?.verbosity,
    maxOutputTokens: stageConfig?.maxOutputTokens || defaultMaxOutputTokens,
  };
}
