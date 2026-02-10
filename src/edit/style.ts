export function formatCoordinate(oldRaw: string, x: string, y: string): string {
  const exact = oldRaw.match(/^\((\s*)([^,)]*)(\s*),(\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${x}${exact[3]},${exact[4]}${y}${exact[6]})`;
  }

  const afterComma = /,\s+/.test(oldRaw) ? " " : "";
  return `(${x},${afterComma}${y})`;
}
