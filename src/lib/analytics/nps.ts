export const NPS_KEY = "mrt_nps";
export const NPS_MIN_VISITS = 3;
export const NPS_COOLDOWN_MS = 30 * 24 * 3_600_000;

/** Prompt from the 3rd visit (distinct days), never more than once per 30 days. */
export function shouldPromptNps(state: { visits: number; promptedAt: number | null }, now: number) {
  if (state.visits < NPS_MIN_VISITS) return false;
  return state.promptedAt == null || now - state.promptedAt >= NPS_COOLDOWN_MS;
}
