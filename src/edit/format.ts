export const PT_PER_CM = 28.4527559055;
export const CM_PER_PT = 1 / PT_PER_CM;

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  const normalized = Math.abs(rounded) < 1e-9 ? 0 : rounded;
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return normalized.toFixed(3).replace(/\.?0+$/, "");
}
