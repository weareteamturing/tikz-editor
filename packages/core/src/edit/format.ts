export const PT_PER_CM = 28.4527559055;
export const CM_PER_PT = 1 / PT_PER_CM;

export type NumberFormatOptions = {
  fractionDigits?: number;
};

export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const fractionDigits = options.fractionDigits ?? 2;
  const scale = 10 ** fractionDigits;
  const rounded = fractionDigits === 0 ? Math.round(value) : Math.round(value * scale) / scale;
  const normalized = Math.abs(rounded) < 1e-9 ? 0 : rounded;
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return normalized.toFixed(fractionDigits).replace(/\.?0+$/, "");
}
