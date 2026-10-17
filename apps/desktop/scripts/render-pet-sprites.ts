/**
 * Derive the companion's sprites from the reaction art in `resources/`.
 *
 * The sources are opaque reaction images, so the background has to be removed
 * before the companion window — which is transparent and always on top — can
 * show them. Keying runs from the frame edge inwards rather than by colour:
 * the character wears a white bonnet and apron, and a global white key makes
 * holes in them. Whatever the flood fill cannot reach from the border is subject.
 *
 * Three steps answer what the art actually is, not what a generic keyer wants:
 * a crop keeps the baked-in captions out; `masks` cut props and labels that sit
 * on the subject; a second flood through pale pixels walks off floor shadows
 * that the subject encloses. Keeping only the largest connected region then
 * drops bowls, question marks and stray glyphs without hand-tuned column bounds.
 *
 * Rerun `pnpm run render:pet-sprites` in `apps/desktop` after replacing a source;
 * the committed PNGs under `renderer/pet/` are the output the window loads.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** A rectangle in source pixels. */
export interface PetRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** One source that becomes a transparent companion sprite. */
export interface PetSpriteSpec {
  /** Reaction art to derive from. */
  readonly source: string
  /** Sprite the companion window loads. */
  readonly output: string
  /**
   * Colour channels within this distance of the sampled background count as
   * background. Sized to absorb JPEG noise without eating the character's
   * light clothing.
   */
  readonly tolerance: number
  /** Baked-in captions and furniture kept out of the frame entirely. */
  readonly crop?: PetRect
  /**
   * Columns the subject may occupy, or undefined for the whole frame. A frame
   * holding a second character keeps it out of the sprite by bounding the search.
   */
  readonly columns?: { readonly from: number; readonly to: number }
  /**
   * Regions forced to background before keying: props and labels whose outline
   * touches the character, so no colour key or component pass can separate them.
   */
  readonly masks?: readonly PetRect[]
  /**
   * A second flood that walks only through pale, unsaturated pixels from the
   * frame edge. It removes floor shadows the subject encloses while leaving her
   * white apron, which the dark dress wall in.
   */
  readonly lightFlood?: { readonly lightness: number; readonly saturation: number }
}

/** Sources this repository derives companion sprites from. */
export const PET_SPRITES: readonly PetSpriteSpec[] = [
  {
    source: fileURLToPath(new URL('../resources/whale_girl-happy.jpg', import.meta.url)),
    output: fileURLToPath(new URL('../renderer/pet/happy.png', import.meta.url)),
    tolerance: 42,
    // The reaction frame pairs her with a second character on the right.
    columns: { from: 0, to: 460 },
    // The floor shadow comes with the source; the shipped sprite still had it.
    lightFlood: { lightness: 190, saturation: 32 },
  },
  {
    source: fileURLToPath(new URL('../resources/whale_girl-work.jpg', import.meta.url)),
    output: fileURLToPath(new URL('../renderer/pet/work.png', import.meta.url)),
    tolerance: 34,
    // Caption above y≈190; the two question marks sit beside her shoulders and
    // fall out as separate components.
    crop: { left: 40, top: 170, width: 780, height: 684 },
  },
  {
    source: fileURLToPath(new URL('../resources/whale_girl-idle.jpg', import.meta.url)),
    output: fileURLToPath(new URL('../renderer/pet/idle.png', import.meta.url)),
    tolerance: 58,
    // Captions above y≈320 and the bowl below y≈620 stay out of the frame.
    crop: { left: 70, top: 300, width: 690, height: 420 },
    masks: [
      // The bowl shares the pale shadow under her body, so the component pass
      // cannot separate it from her.
      { left: 470, top: 320, width: 220, height: 100 },
      // The right-hand "打滚~" label runs up against her tail. Cut only the two
      // glyphs; the trailing squiggle reads as one of the art's motion marks.
      { left: 430, top: 55, width: 72, height: 55 },
    ],
    // The shadow plate is enclosed by her silhouette, so the edge flood never
    // reaches it.
    lightFlood: { lightness: 190, saturation: 32 },
  },
]

/** Pixels of margin kept around the subject so the matte is never cropped tight. */
const SUBJECT_PADDING = 4
/**
 * Widest sprite the window can use. The companion draws her at 150 CSS pixels,
 * so twice that covers high-density displays without shipping a 700-pixel PNG.
 */
const OUTPUT_MAX_WIDTH = 300
/** Edge strip ignored when sampling the background: every source carries a dark rim. */
const BORDER_INSET = 4

/** One decoded frame with the channels the keying reads. */
interface Frame {
  readonly data: Buffer
  readonly width: number
  readonly height: number
  readonly channels: number
}

/** Read one source as raw RGB, ignoring any embedded profile. */
async function decode(path: string): Promise<Frame> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** Copy the spec's crop out of a decoded frame. */
function crop(frame: Frame, rect: PetRect | undefined): Frame {
  if (rect === undefined) return frame
  const left = Math.min(Math.max(rect.left, 0), frame.width - 1)
  const top = Math.min(Math.max(rect.top, 0), frame.height - 1)
  const width = Math.min(rect.width, frame.width - left)
  const height = Math.min(rect.height, frame.height - top)
  const data = Buffer.alloc(width * height * frame.channels)
  for (let y = 0; y < height; y++) {
    const from = ((y + top) * frame.width + left) * frame.channels
    const to = y * width * frame.channels
    frame.data.copy(data, to, from, from + width * frame.channels)
  }
  return { data, width, height, channels: frame.channels }
}

/** Median border colour, sampled from a ring just inside the frame edge. */
function backgroundColour(frame: Frame): [number, number, number] {
  const { data, width, height, channels } = frame
  const samples: Array<[number, number, number]> = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 128))
  const push = (x: number, y: number): void => {
    const at = (y * width + x) * channels
    samples.push([data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0])
  }
  for (let x = BORDER_INSET; x < width - BORDER_INSET; x += step) {
    for (const y of [BORDER_INSET, height - 1 - BORDER_INSET]) push(x, y)
  }
  for (let y = BORDER_INSET; y < height - BORDER_INSET; y += step) {
    for (const x of [BORDER_INSET, width - 1 - BORDER_INSET]) push(x, y)
  }
  const channel = (index: number): number => {
    const values = samples.map(sample => sample[index] ?? 0).sort((left, right) => left - right)
    return values[Math.floor(values.length / 2)] ?? 0
  }
  return [channel(0), channel(1), channel(2)]
}

/**
 * Mark every background pixel reachable from the frame edge without leaving the
 * tolerance band, so enclosed regions of the same colour stay part of the subject.
 * @param frame - Decoded source.
 * @param background - Colour the source's background resolves to.
 * @param tolerance - Channel distance still counted as background.
 * @returns one flag per pixel, row-major.
 */
function floodBackground(frame: Frame, background: [number, number, number], tolerance: number): Uint8Array {
  const { data, width, height, channels } = frame
  const near = new Uint8Array(width * height)
  const limit = tolerance * tolerance
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * channels
    const red = (data[at] ?? 0) - background[0]
    const green = (data[at + 1] ?? 0) - background[1]
    const blue = (data[at + 2] ?? 0) - background[2]
    if (red * red + green * green + blue * blue <= limit) near[pixel] = 1
  }
  return floodFrom(near, width, height)
}

/**
 * Flood one pixel predicate inwards from every frame edge.
 * @param candidate - one flag per pixel: whether the flood may enter it.
 * @param width - Frame width.
 * @param height - Frame height.
 * @returns one flag per pixel: whether the flood reached it.
 */
function floodFrom(candidate: Uint8Array, width: number, height: number): Uint8Array {
  const reached = new Uint8Array(width * height)
  const queue: number[] = []
  const seed = (pixel: number): void => {
    if (candidate[pixel] === 1 && reached[pixel] === 0) { reached[pixel] = 1; queue.push(pixel) }
  }
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1) }
  for (let head = 0; head < queue.length; head++) {
    const pixel = queue[head] ?? 0
    const x = pixel % width
    if (x > 0) seed(pixel - 1)
    if (x < width - 1) seed(pixel + 1)
    if (pixel >= width) seed(pixel - width)
    if (pixel < width * (height - 1)) seed(pixel + width)
  }
  return reached
}

/** Mark pale, unsaturated pixels the frame edge can reach. */
function floodPale(frame: Frame, lightness: number, saturation: number): Uint8Array {
  const { data, width, height, channels } = frame
  const pale = new Uint8Array(width * height)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * channels
    const red = data[at] ?? 0
    const green = data[at + 1] ?? 0
    const blue = data[at + 2] ?? 0
    const low = Math.min(red, green, blue)
    const high = Math.max(red, green, blue)
    if (low >= lightness && high - low <= saturation) pale[pixel] = 1
  }
  return floodFrom(pale, width, height)
}

/** Force the spec's mask rectangles to background. */
function applyMasks(background: Uint8Array, frame: Frame, masks: readonly PetRect[] | undefined): void {
  for (const rect of masks ?? []) {
    const right = Math.min(rect.left + rect.width, frame.width)
    const bottom = Math.min(rect.top + rect.height, frame.height)
    for (let y = Math.max(rect.top, 0); y < bottom; y++) {
      for (let x = Math.max(rect.left, 0); x < right; x++) background[y * frame.width + x] = 1
    }
  }
}

/**
 * Keep only the largest 4-connected opaque region.
 * @param matte - one flag per pixel, 255 for subject.
 * @param width - Frame width.
 * @param height - Frame height.
 * @returns how many regions were seen and how many pixels were dropped.
 */
function keepLargestRegion(matte: Uint8Array, width: number, height: number): { components: number; dropped: number } {
  const label = new Int32Array(width * height).fill(-1)
  let best = -1
  let bestSize = 0
  let next = 0
  for (let start = 0; start < matte.length; start++) {
    if (matte[start] === 0 || label[start] !== -1) continue
    const queue = [start]
    label[start] = next
    let size = 0
    for (let head = 0; head < queue.length; head++) {
      const pixel = queue[head] ?? 0
      size++
      const x = pixel % width
      const neighbours = [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= matte.length) continue
        if (matte[neighbour] === 0 || label[neighbour] !== -1) continue
        label[neighbour] = next
        queue.push(neighbour)
      }
    }
    if (size > bestSize) { bestSize = size; best = next }
    next++
  }
  let dropped = 0
  for (let pixel = 0; pixel < matte.length; pixel++) {
    if (matte[pixel] !== 0 && label[pixel] !== best) { matte[pixel] = 0; dropped++ }
  }
  return { components: next, dropped }
}

/** Drop one pixel from the matte's edge, which is where the source's background colour bleeds. */
function erode(matte: Uint8Array, width: number, height: number): Uint8Array {
  const eroded = new Uint8Array(matte.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let keep = 255
      for (let dy = -1; dy <= 1 && keep === 255; dy++) {
        const row = y + dy
        if (row < 0 || row >= height) { keep = 0; break }
        for (let dx = -1; dx <= 1; dx++) {
          const column = x + dx
          if (column < 0 || column >= width || (matte[row * width + column] ?? 0) === 0) { keep = 0; break }
        }
      }
      eroded[y * width + x] = keep
    }
  }
  return eroded
}

/** Soften a hard matte by one pixel so the sprite has no stair-stepped edge. */
function soften(matte: Uint8Array, width: number, height: number): Uint8Array {
  const soft = new Uint8Array(matte.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let total = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        const row = y + dy
        if (row < 0 || row >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const column = x + dx
          if (column < 0 || column >= width) continue
          total += matte[row * width + column] ?? 0
          count++
        }
      }
      soft[y * width + x] = Math.round(total / count)
    }
  }
  return soft
}

/** Bounds of the subject within the columns a spec allows. */
interface SubjectBounds {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** Bounds of the subject within the allowed columns, or undefined for an empty one. */
function subjectBounds(frame: Frame, matte: Uint8Array, spec: PetSpriteSpec): SubjectBounds | undefined {
  const { width, height } = frame
  const from = spec.columns?.from ?? 0
  const to = Math.min(spec.columns?.to ?? width, width)
  let left = to
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = from; x < to; x++) {
      if ((matte[y * width + x] ?? 0) === 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0 || bottom < 0) return undefined
  return {
    left: Math.max(0, left - SUBJECT_PADDING),
    right: Math.min(width - 1, right + SUBJECT_PADDING),
    top: Math.max(0, top - SUBJECT_PADDING),
    bottom: Math.min(height - 1, bottom + SUBJECT_PADDING),
  }
}

/** Derive one transparent sprite from its source. */
async function renderSprite(spec: PetSpriteSpec): Promise<void> {
  const frame = crop(await decode(spec.source), spec.crop)
  const background = backgroundColour(frame)
  const keyed = floodBackground(frame, background, spec.tolerance)
  applyMasks(keyed, frame, spec.masks)
  if (spec.lightFlood !== undefined) {
    const pale = floodPale(frame, spec.lightFlood.lightness, spec.lightFlood.saturation)
    for (let pixel = 0; pixel < keyed.length; pixel++) if (pale[pixel] === 1) keyed[pixel] = 1
  }
  if (spec.columns !== undefined) {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        if (x < spec.columns.from || x >= spec.columns.to) keyed[y * frame.width + x] = 1
      }
    }
  }
  const matte = new Uint8Array(keyed.length)
  for (let pixel = 0; pixel < matte.length; pixel++) matte[pixel] = keyed[pixel] === 1 ? 0 : 255
  const kept = keepLargestRegion(matte, frame.width, frame.height)
  const soft = soften(erode(matte, frame.width, frame.height), frame.width, frame.height)
  const bounds = subjectBounds(frame, soft, spec)
  if (bounds === undefined) throw new Error(`pet sprite: no subject found in ${spec.source}`)
  const width = bounds.right - bounds.left + 1
  const height = bounds.bottom - bounds.top + 1
  // Crop in the buffers rather than through sharp's pipeline: `extract` there
  // resolves against the pipeline's own ordering, not the call order.
  const sprite = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((y + bounds.top) * frame.width + (x + bounds.left)) * frame.channels
      const to = (y * width + x) * 4
      sprite[to] = frame.data[from] ?? 0
      sprite[to + 1] = frame.data[from + 1] ?? 0
      sprite[to + 2] = frame.data[from + 2] ?? 0
      sprite[to + 3] = soft[(y + bounds.top) * frame.width + (x + bounds.left)] ?? 0
    }
  }
  await mkdir(dirname(spec.output), { recursive: true })
  const png = await sharp(sprite, { raw: { width, height, channels: 4 } })
    .resize({ width: Math.min(width, OUTPUT_MAX_WIDTH), withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(spec.output, png)
  console.log(`${spec.output}\n  from ${spec.source}\n  background ${background.join(',')}  subject ${width}x${height}  components ${kept.components} (dropped ${kept.dropped}px)`)
}

if (import.meta.main) {
  for (const spec of PET_SPRITES) await renderSprite(spec)
}
