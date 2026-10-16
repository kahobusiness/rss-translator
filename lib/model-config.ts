// Context capacity is not an output/latency budget. Keep translation chunks
// bounded even for 1M-context models so a worker can checkpoint before timeout.
export const MODEL_NAME = process.env.MODEL_NAME || 'MiniMax-M3.1-Flash-Preview';
export const API_BASE_URL = process.env.API_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.minimax.cn/anthropic';
export function modelProfile(model = MODEL_NAME) {
  const flash = model === 'MiniMax-M3.1-Flash-Preview';
  return { chunkTokens: flash ? 3600 : 1800, maxOutputTokens: flash ? 16384 : 8192,
    timeoutMs: flash ? 100_000 : 75_000,
    ...(flash ? { output_config: { effort: 'low' as const } } : {}) };
}
