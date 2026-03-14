export function normalizeEscapedTextSpaces(text: string): string {
  if (text.length === 0) {
    return text;
  }

  return text.replaceAll("\\space", " ").replaceAll("\\ ", " ");
}
