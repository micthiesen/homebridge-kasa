export const EMETER_MODELS = ["HS110", "HS300", "KP115", "KP125", "EP25"];

export function modelSupportsEmeter(model: string): boolean {
  return EMETER_MODELS.some((m) => model.toUpperCase().includes(m));
}
