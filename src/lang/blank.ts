/**
 * L3 · 「源码实质为空」判定（零依赖，渲染层与 UI 层共用）
 *
 * 空源码不是错误：应当按空渲染，而不是抛渲染失败。
 */
export function isBlankSource(source: string): boolean {
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.length) return true;
  return lines.every((l) => l.startsWith('%%') || l.startsWith("'") || l.startsWith('//'));
}
