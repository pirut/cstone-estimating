export const BATMAN_GIF_TRANSITION_CHANCE_STORAGE_KEY =
  "cstone:theme-transition:batman-gif-chance";
export const DEFAULT_BATMAN_GIF_TRANSITION_CHANCE = 0.1;
export const MAX_BATMAN_GIF_TRANSITION_CHANCE = 1;

export function normalizeBatmanGifTransitionChance(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BATMAN_GIF_TRANSITION_CHANCE;
  if (parsed < 0) return 0;
  if (parsed > MAX_BATMAN_GIF_TRANSITION_CHANCE) {
    return MAX_BATMAN_GIF_TRANSITION_CHANCE;
  }
  return parsed;
}
