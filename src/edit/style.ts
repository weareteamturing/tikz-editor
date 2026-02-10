export function formatCoordinate(oldRaw: string, x: string, y: string): string {
  const exact = oldRaw.match(/^\((\s*)(\[[^\]]*\]\s*)?([^,)]*)(\s*),(\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${exact[2] ?? ""}${x}${exact[4]},${exact[5]}${y}${exact[7]})`;
  }

  const afterComma = /,\s+/.test(oldRaw) ? " " : "";
  return `(${x},${afterComma}${y})`;
}
