/**
 * Vision prompt for manga pages and the tolerant parser for what the model
 * returns.
 *
 * Vision models do not guarantee strict JSON: they wrap the array in a
 * markdown fence, add a sentence before or after it, omit fields, or report
 * coordinates in a different space. The parser accepts the recoverable forms
 * and returns an empty array when the response cannot be trusted — skipping a
 * page is better than rendering misplaced text over the artwork.
 */

import type { MangaBox, MangaBubble } from './types';

// A model occasionally overflows the page by a pixel or two, which is fine.
// Overflow past 20% means the coordinate system is wrong, not the box.
const BOX_SLACK_RATIO = 0.2;
// After clamping, anything smaller than this is noise, not a text region.
const MIN_BOX_SIZE = 4;
// Too many invalid boxes means the whole response used the wrong coordinate
// space; one unusual bubble should not discard the page.
const MIN_VALID_RATIO = 0.5;

/**
 * The contract the model must follow: `[{box:[x1,y1,x2,y2], src, dst,
 * vertical}]`, with `box` in normalized 0–1 coordinates.
 *
 * Normalized coordinates are deliberate. Measured against real pages the
 * model is accurate to within 0.01 in both directions when it reports
 * fractions; when asked for pixels it systematically compresses y to roughly
 * 0.7× and every translation drifts upward.
 */
export const BASE_PROMPT = `你是漫画翻译引擎。检测图片中所有包含文字的气泡、对话框、旁白框和音效字,将其中文字翻译成简体中文,以严格 JSON 数组返回,不要输出任何其他内容:
[{"box":[x1,y1,x2,y2],"src":"原文","dst":"译文","vertical":true}]
要求:
1. box 用归一化坐标:0~1 之间的小数,x 除以图宽、y 除以图高(左上角是 [0,0],右下角是 [1,1]),保留 4 位小数,紧贴文字;
2. vertical:原文为竖排(日语漫画常见)则为 true,横排为 false;
3. 无文字的图返回 [];
4. 译文要求:忠实翻译气泡内的文字与潜台词,保留说话人语气;日语省略的主语和语气词(央求、抗拒、羞耻、兴奋等)要在中文体现出来;拟声词翻译为中文惯用拟声词;同一格内多个气泡按阅读顺序排列;
5. 只输出 JSON,不要 markdown 代码块标记。`;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Base instructions plus the reader's glossary and any per-site requirements.
 * Both are appended after the base prompt so the model keeps its output
 * contract; the closing line repeats that the format does not change.
 */
export function buildVisionPrompt(
  options: { glossary?: Record<string, string>; extra?: string } = {},
): string {
  const glossary = Object.entries(options.glossary ?? {})
    .map(([term, translation]) => [term.trim(), translation.trim()] as const)
    .filter(([term]) => term.length > 0);
  const extra = (options.extra ?? '').trim();
  if (glossary.length === 0 && !extra) return BASE_PROMPT;

  const sections = [BASE_PROMPT];
  if (glossary.length > 0) {
    const lines = glossary.map(([term, translation]) =>
      translation ? `${term} → ${translation}` : `${term} → 保留原文`,
    );
    sections.push(`术语表(优先使用下列译法,未列出的按语境直译):\n${lines.join('\n')}`);
  }
  if (extra) sections.push(`本站点补充要求:\n${extra}`);
  sections.push('以上补充要求不改变输出格式:仍然只输出 JSON 数组。');
  return sections.join('\n\n');
}

/**
 * Accepts one model item in any shape and returns a clean bubble, or null
 * when it cannot be rendered. Numeric strings are tolerated because some
 * models quote coordinates; a bubble without a translation is dropped.
 */
export function normalizeBubble(item: unknown): MangaBubble | null {
  if (!item || typeof item !== 'object') return null;
  const candidate = item as {
    box?: unknown;
    src?: unknown;
    dst?: unknown;
    vertical?: unknown;
  };
  const box = candidate.box;
  if (!Array.isArray(box) || box.length !== 4) return null;

  const [x1, y1, x2, y2] = box.map((value) => Number(value));
  if (
    !isFiniteNumber(x1) ||
    !isFiniteNumber(y1) ||
    !isFiniteNumber(x2) ||
    !isFiniteNumber(y2)
  ) {
    return null;
  }

  const dst = typeof candidate.dst === 'string' ? candidate.dst.trim() : '';
  if (!dst) return null;

  const normalizedBox: MangaBox = [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];
  return {
    box: normalizedBox,
    src: typeof candidate.src === 'string' ? candidate.src : '',
    dst,
    vertical: candidate.vertical === true,
  };
}

/**
 * Clamps a bubble's pixel box to the page.
 *
 * Some models answer with a page-sized grid (a 1500×1978 page reported as 32
 * cells reaching x=3200). Those coordinates belong to another image, so a box
 * entirely outside the page with more than the allowed slack is dropped.
 */
export function clampBubble(
  bubble: MangaBubble,
  width: number,
  height: number,
): MangaBubble | null {
  const [x1, y1, x2, y2] = bubble.box;
  const slackX = width * BOX_SLACK_RATIO;
  const slackY = height * BOX_SLACK_RATIO;
  if (x2 < -slackX || y2 < -slackY || x1 > width + slackX || y1 > height + slackY) {
    return null;
  }

  const box: MangaBox = [
    Math.max(0, Math.min(width, x1)),
    Math.max(0, Math.min(height, y1)),
    Math.max(0, Math.min(width, x2)),
    Math.max(0, Math.min(height, y2)),
  ];
  if (box[2] - box[0] < MIN_BOX_SIZE || box[3] - box[1] < MIN_BOX_SIZE) return null;
  return { ...bubble, box };
}

/** Converts a normalized bubble into pixels of the page that was sent. */
export function toPixel(bubble: MangaBubble, width: number, height: number): MangaBubble {
  const [x1, y1, x2, y2] = bubble.box;
  return {
    ...bubble,
    box: [x1 * width, y1 * height, x2 * width, y2 * height],
  };
}

const validate = (bubbles: MangaBubble[], width: number, height: number): MangaBubble[] => {
  const valid = bubbles
    .map((bubble) => clampBubble(bubble, width, height))
    .filter((bubble): bubble is MangaBubble => bubble !== null);
  if (bubbles.length > 0 && valid.length / bubbles.length < MIN_VALID_RATIO) return [];
  return valid;
};

/**
 * Extracts bubbles from a model reply.
 *
 * Tries, in order: the whole reply, the first fenced block, the first array
 * in the text. With `bounds` the normalized boxes are converted to pixels and
 * validated against the page; without bounds they stay normalized.
 */
export function parseVisionResult(
  raw: unknown,
  bounds: { width: number; height: number } | null = null,
): MangaBubble[] {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return [];

  const candidates = [text];
  const fenced = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fenced?.[1]?.trim()) candidates.push(fenced[1]!.trim());
  const arrayText = text.match(/\[[\s\S]*\]/);
  if (arrayText?.[0]) candidates.push(arrayText[0]);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      // This shape did not parse; try the next one.
      continue;
    }
    if (!Array.isArray(parsed)) continue;

    const bubbles = parsed
      .map(normalizeBubble)
      .filter((bubble): bubble is MangaBubble => bubble !== null);
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return bubbles;
    return validate(
      bubbles.map((bubble) => toPixel(bubble, bounds.width, bounds.height)),
      bounds.width,
      bounds.height,
    );
  }
  return [];
}
