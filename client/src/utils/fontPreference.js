export const DEFAULT_FONT_SCALE = 100;
export const FONT_SCALE_MIN = 90;
export const FONT_SCALE_MAX = 130;
export const FONT_SCALE_STEP = 10;

export function normalizeFontScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FONT_SCALE;
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, number));
  return FONT_SCALE_MIN + Math.round((clamped - FONT_SCALE_MIN) / FONT_SCALE_STEP) * FONT_SCALE_STEP;
}

export function fontPreferenceKey(userId) {
  return `atm-font-scale:user:${userId}`;
}

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readFontScale(userId, storage = browserStorage()) {
  if (!userId || !storage) return DEFAULT_FONT_SCALE;
  try {
    return normalizeFontScale(storage.getItem(fontPreferenceKey(userId)) || DEFAULT_FONT_SCALE);
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

export function saveFontScale(userId, value, storage = browserStorage()) {
  const scale = normalizeFontScale(value);
  if (!userId || !storage) return scale;
  try {
    storage.setItem(fontPreferenceKey(userId), String(scale));
  } catch {
    // The preference remains active until this page is closed.
  }
  return scale;
}
