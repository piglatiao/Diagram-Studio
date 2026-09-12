/** 文本度量：不依赖 DOM/canvas 的近似估算，保证 SSR / Worker 场景也可用 */

const CJK_RE = /[ᄀ-ᇿ⺀-꓏ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/;

export function isWide(ch: string): boolean {
  return CJK_RE.test(ch);
}

export function textWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) w += isWide(ch) ? fontSize : fontSize * 0.55;
  return w;
}

/** 按最大宽度折行，支持 CJK 逐字断行与拉丁按词断行 */
export function wrapText(s: string, maxW: number, fontSize: number): string[] {
  if (!s) return [''];
  const out: string[] = [];
  for (const para of s.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    let w = 0;
    let word = '';
    const flushWord = () => { if (word) { line += word; w += textWidth(word, fontSize); word = ''; } };
    for (const ch of para) {
      const cw = textWidth(ch, fontSize);
      if (w + cw > maxW && (line || word)) {
        out.push(line);
        line = '';
        w = 0;
      }
      if (isWide(ch) || ch === ' ') {
        flushWord();
        line += ch;
        w += cw;
      } else {
        word += ch;
        if (w + textWidth(word, fontSize) > maxW) { out.push(line); line = ''; w = 0; }
      }
    }
    flushWord();
    out.push(line);
  }
  return out.length ? out : [''];
}

export function linesWidth(lines: string[], fontSize: number): number {
  return Math.max(0, ...lines.map((l) => textWidth(l, fontSize)));
}
