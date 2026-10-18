/**
 * Cover-derived ambient colour for the emm reader theme.
 *
 * The reading canvas gets a very faint wash of the open book's cover colour.
 * Sampling happens once per book on a 32×32 offscreen canvas: the cover is
 * scaled down (which is in effect a box filter, so the mean is cheap), then
 * the mean of all pixels that are neither near-white nor near-black is
 * returned. Near-white paper and near-black frames dominate most covers and
 * would otherwise wash the result out to grey.
 *
 * Every failure path — no cover, blocked image, tainted canvas, no usable
 * pixels — resolves to `null` so callers can simply leave the CSS variable
 * unset. Nothing here throws or logs.
 */

const SAMPLE_SIZE = 32;
/** Luminance ≥ this is treated as paper/white noise. */
const NEAR_WHITE_LUMINANCE = 240;
/** Luminance ≤ this is treated as frame/shadow noise. */
const NEAR_BLACK_LUMINANCE = 16;

type CacheEntry = { coverUrl: string; color: string | null };
const ambientCache = new Map<string, CacheEntry>();

const loadImage = (src: string): Promise<HTMLImageElement> => {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  // A cross-origin cover can only be read back from the canvas when the
  // request is anonymous; same-origin/blob/data URLs must keep their
  // default (setting crossOrigin there can break Tauri's asset protocol).
  if (/^https?:/i.test(src)) image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('cover image failed to load'));
  image.src = src;
  return promise;
};

/**
 * Mean colour of the cover in `rgb(r g b)` form, or null when it cannot be
 * sampled. Exported for callers that want a colour without the reader hook.
 */
export const extractCoverAmbientColor = async (coverUrl: string): Promise<string | null> => {
  try {
    const image = await loadImage(coverUrl);
    if (!image.naturalWidth || !image.naturalHeight) return null;

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 128) continue;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance >= NEAR_WHITE_LUMINANCE || luminance <= NEAR_BLACK_LUMINANCE) continue;
      red += r;
      green += g;
      blue += b;
      count += 1;
    }
    if (count === 0) return null;

    return `rgb(${Math.round(red / count)} ${Math.round(green / count)} ${Math.round(blue / count)})`;
  } catch {
    return null;
  }
};

/**
 * Cached ambient colour for one open book. A book with the same key but a new
 * cover (metadata edit, cover replacement) is re-sampled; results — including
 * failures — are cached so a book is only sampled once per session.
 */
export const resolveCoverAmbientColor = async (
  bookKey: string,
  coverUrl: string,
): Promise<string | null> => {
  const cached = ambientCache.get(bookKey);
  if (cached && cached.coverUrl === coverUrl) return cached.color;

  const color = await extractCoverAmbientColor(coverUrl);
  ambientCache.set(bookKey, { coverUrl, color });
  return color;
};
