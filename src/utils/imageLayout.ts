export type Box = [number, number, number, number];
export type Point = [number, number]; // x/y, image pixels
export interface ArtworkRect { left: number; right: number; top: number; bottom: number }
export interface TextBlock {
  original: string;
  translation: string;
  box: Box; // original paragraph ymin/xmin/ymax/xmax, normalized 0..1000
  text_regions?: Box[];
  layout_polygon?: [number, number][]; // safe interior points, normalized y/x
}

export function validBox(box: unknown): box is Box {
  return Array.isArray(box) && box.length === 4 && box.every(n => Number.isFinite(n) && n >= 0 && n <= 1000)
    && box[2] > box[0] && box[3] > box[1];
}

export function insidePolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function layoutPolygon(block: TextBlock, width: number, height: number): Point[] {
  const raw = block.layout_polygon;
  if (Array.isArray(raw) && raw.length >= 3 && raw.length <= 32 && raw.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1000))) {
    const polygon: Point[] = raw.map(([y, x]) => [x * width / 1000, y * height / 1000]);
    const [y0, x0, y1, x1] = block.box;
    if (insidePolygon((x0 + x1) * width / 2000, (y0 + y1) * height / 2000, polygon)) return polygon;
  }
  const [y0, x0, y1, x1] = block.box;
  return [[x0 * width / 1000, y0 * height / 1000], [x1 * width / 1000, y0 * height / 1000], [x1 * width / 1000, y1 * height / 1000], [x0 * width / 1000, y1 * height / 1000]];
}

// A line must fit at every polygon vertex within its full glyph height, not only its baseline.
export function lineSpan(polygon: Point[], top: number, bottom: number, padding: number, protectedRects: ArtworkRect[] = []): [number, number] | null {
  let ranges: [number, number][] = [[-Infinity, Infinity]];
  const ys = [top, bottom, (top + bottom) / 2, ...polygon.map(p => p[1]).filter(y => y > top && y < bottom).flatMap(y => [y - 0.01, y + 0.01])];
  for (const y of ys) {
    const xs: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i], [x2, y2] = polygon[(i + 1) % polygon.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    const next: [number, number][] = [];
    for (const [left, right] of ranges) for (let i = 0; i + 1 < xs.length; i += 2) {
      const lo = Math.max(left, xs[i] + padding), hi = Math.min(right, xs[i + 1] - padding);
      if (hi > lo) next.push([lo, hi]);
    }
    ranges = next;
  }
  for (const rect of protectedRects) {
    if (rect.bottom + padding < top || rect.top - padding > bottom) continue;
    ranges = ranges.flatMap(([left, right]) => {
      if (right < rect.left - padding || left > rect.right + padding) return [[left, right] as [number, number]];
      return [[left, Math.min(right, rect.left - padding)], [Math.max(left, rect.right + padding), right]].filter(([a, b]) => b > a) as [number, number][];
    });
  }
  return ranges.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] || null;
}

export type ImageLayoutMode = 'comic' | 'photo';

export function photoTextSegments(block: TextBlock): TextBlock[] {
  const regions = block.text_regions?.filter(validBox) || [];
  const originals = block.original.split(/\r?\n/), translations = block.translation.split(/\r?\n/);
  // Matching line groups let a caption next to a QR code stay next to it,
  // instead of painting a rectangle across both the caption and the code.
  const segments = regions.length > 1 && originals.length === regions.length && translations.length === regions.length
    ? regions.map((box,i) => ({original: originals[i], translation: translations[i], box})) : [block];
  return segments.filter(segment => segment.translation.trim() && segment.translation.trim() !== segment.original.trim());
}

// Photographs and documents have colored/ textured backgrounds, not empty
// speech balloons. Fit the complete translation inside its own text rectangle.
export function fitInRectangle(text: string, box: ArtworkRect, maxSize: number, measure: (text: string, size: number) => number) {
  const width = box.right - box.left, height = box.bottom - box.top;
  if (!(width > 0 && height > 0)) throw new Error('글자 위치를 확인할 수 없습니다.');
  const paragraphs = text.trim().split(/\r?\n/);
  const wrap = (size: number) => {
    const pad = Math.min(2, width * .015, height * .04), available = width - 2 * pad;
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      const characters = Array.from(paragraph.trim());
      if (!characters.length) { lines.push(''); continue; }
      let start = 0;
      while (start < characters.length) {
        let lo = start + 1, hi = characters.length, end = start;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (measure(characters.slice(start, mid).join(''), size) <= available) { end = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (end === start) return null;
        if (end < characters.length && characters[end] !== ' ') {
          let space = end - 1;
          while (space > start && characters[space] !== ' ') space--;
          // Avoid breaking words when possible, but still fit long URLs/words.
          if (space > start) end = space;
        }
        lines.push(characters.slice(start, end).join(''));
        start = end;
        while (characters[start] === ' ') start++;
        if (lines.length * size * 1.2 > height - 2 * pad) return null;
      }
    }
    if (lines.length * size * 1.2 > height - 2 * pad) return null;
    return {size, lines: lines.map((line, i) => ({text: line, x: box.left + pad, y: box.top + pad + (i + .5) * size * 1.2}))};
  };
  // Search is bounded; dense paragraphs must not trigger thousands of polygon
  // scans or fail just because their translated words are longer than the source.
  let low = Math.min(.1, width / (2*Math.max(1, Array.from(text).length)), height / (2*Math.max(1,Array.from(text).length))), high = Math.min(maxSize, height / 1.2);
  let fitted = wrap(low);
  for (let step = 0; step < 14; step++) {
    const mid = (low + high) / 2, candidate = wrap(mid);
    if (candidate) { low = mid; fitted = candidate; } else high = mid;
  }
  if (!fitted) throw new Error('글자 영역을 확인할 수 없습니다.');
  return fitted;
}

function photoBackground(pixels: Uint8ClampedArray, width: number, height: number, box: ArtworkRect): number[] {
  const bins = new Map<string, number[][]>();
  const add = (x: number, y: number) => {
    const offset = (Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))) * 4;
    const rgb = Array.from(pixels.slice(offset, offset + 3)), key = rgb.map(c => Math.floor(c / 32)).join(',');
    const group = bins.get(key) || []; group.push(rgb); bins.set(key, group);
  };
  for (let i = 0; i <= 30; i++) {
    const x = box.left + (box.right - box.left) * i / 30, y = box.top + (box.bottom - box.top) * i / 30;
    add(x, box.top - 1); add(x, box.bottom + 1); add(box.left - 1, y); add(box.right + 1, y);
  }
  // Table rules often dominate the perimeter. Sample inside too so a blue
  // border does not turn the entire ingredient label into a dark blue patch.
  for (let y=1;y<16;y++) for(let x=1;x<16;x++) add(box.left+(box.right-box.left)*x/16,box.top+(box.bottom-box.top)*y/16);
  const group = [...bins.values()].sort((a,b) => b.length - a.length)[0];
  return [0,1,2].map(c => group.map(rgb => rgb[c]).sort((a,b) => a-b)[Math.floor(group.length / 2)]);
}

export function fitInPolygon(text: string, polygon: Point[], maxSize: number, measure: (text: string, size: number) => number, protectedRects: ArtworkRect[] = []): { size: number; lines: { text: string; x: number; y: number }[] } {
  const minY = Math.min(...polygon.map(p => p[1])), maxY = Math.max(...polygon.map(p => p[1]));
  const characters = Array.from(text.trim());
  // Prefer intact words at a slightly smaller size over breaking Korean syllables mid-word.
  for (const allowWordSplit of [false, true]) {
  for (let size = maxSize; size >= (allowWordSplit ? 2 : Math.max(2, maxSize * 0.5)); size -= 0.5) {
    const leading = size * 1.18, pad = Math.max(0.5, size * 0.08);
    const maxLines = Math.min(characters.length, Math.floor((maxY - minY - 2 * pad) / leading));
    for (let count = 1; count <= maxLines; count++) {
      const top = minY + (maxY - minY - count * leading) / 2;
      const lines: { text: string; x: number; y: number }[] = [];
      let offset = 0;
      for (let row = 0; row < count && offset < characters.length; row++) {
        const y = top + row * leading;
        const span = lineSpan(polygon, y + pad, y + leading - pad, pad, protectedRects);
        if (!span) break;
        const start = offset;
        let lastSpace = -1;
        while (offset < characters.length && characters[offset] !== '\n' && measure(characters.slice(start, offset + 1).join(''), size) <= span[1] - span[0]) {
          if (characters[offset] === ' ') lastSpace = offset;
          offset++;
        }
        if (offset === start) break;
        if (!allowWordSplit && offset < characters.length && characters[offset] !== '\n' && characters[offset] !== ' ' && lastSpace <= start) break;
        if (offset < characters.length && characters[offset] !== '\n' && characters[offset] !== ' ' && lastSpace > start) offset = lastSpace;
        lines.push({ text: characters.slice(start, offset).join('').trim(), x: (span[0] + span[1]) / 2, y: y + leading / 2 });
        while (characters[offset] === ' ' || characters[offset] === '\n') offset++;
      }
      if (offset === characters.length) return { size, lines };
    }
  }
  }
  throw new Error('번역 영역이 너무 작습니다. 원문 위치를 다시 분석해 주세요.');
}

// Restore only ink pixels inside OCR lines from nearby background. Never fill the layout polygon.
export function eraseTextInk(pixels: Uint8ClampedArray, width: number, height: number, regions: Box[]): Uint8ClampedArray {
  const result = new Uint8ClampedArray(pixels);
  for (const box of regions.filter(validBox)) {
    const left = Math.floor(box[1] * width / 1000), top = Math.floor(box[0] * height / 1000);
    const right = Math.min(width, Math.ceil(box[3] * width / 1000)), bottom = Math.min(height, Math.ceil(box[2] * height / 1000));
    const samples: number[][] = [];
    for (let x = left; x < right; x++) for (const y of [top, bottom - 1]) samples.push(Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3)));
    for (let y = top; y < bottom; y++) for (const x of [left, right - 1]) samples.push(Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3)));
    if (!samples.length) continue;
    const bins = new Map<string, number[][]>();
    for (const color of samples) {
      const key = color.map(c => Math.round(c / 32)).join(',');
      const bin = bins.get(key) || []; bin.push(color); bins.set(key, bin);
    }
    const bgSamples = [...bins.values()].sort((a, b) => b.length - a.length)[0];
    // Median resists dark antialiasing pixels along a tightly cropped glyph.
    const background = [0, 1, 2].map(c => bgSamples.map(p => p[c]).sort((a, b) => a - b)[Math.floor(bgSamples.length / 2)]);
    const distance = (index: number) => Math.sqrt([0, 1, 2].reduce((sum, c) => sum + (pixels[index + c] - background[c]) ** 2, 0));
    const masked: number[] = [];
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4;
      const color = [pixels[i], pixels[i + 1], pixels[i + 2]];
      // Dark text can be removed without treating a blue head or pink cheek as ink.
      // Saturated lettering is preserved until its color can be identified reliably.
      if (distance(i) > 12 && Math.max(...color) - Math.min(...color) < 55 && Math.max(...color) < 250) masked.push(i);
    }
    for (const index of masked) {
      const x = (index / 4) % width, y = Math.floor(index / 4 / width);
      const nearby: number[][] = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let step = 1; step <= 16; step++) {
          const sx = x + dx * step, sy = y + dy * step;
          if (sx < left || sx >= right || sy < top || sy >= bottom) break;
          const j = (sy * width + sx) * 4;
          if (distance(j) < 8) { nearby.push([pixels[j], pixels[j + 1], pixels[j + 2]]); break; }
        }
      }
      for (let c = 0; c < 3; c++) result[index + c] = nearby.length ? nearby.reduce((sum, p) => sum + p[c], 0) / nearby.length : background[c];
    }
  }
  return result;
}

export async function composeTranslation(src: string, blocks: TextBlock[], options: {mode?: ImageLayoutMode} = {}): Promise<Blob> {
  const img = new Image(); img.src = src; await img.decode();
  const mode = options.mode || 'comic';
  if (mode === 'comic') await document.fonts.load('20px KyoboHandwriting').catch(() => {});
  const width = img.naturalWidth, height = img.naturalHeight;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('이미지를 만들 수 없습니다.');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, width, height);
  const valid = blocks.filter(block => typeof block.translation === 'string' && block.translation.trim()).map(block => {
    if (validBox(block.box)) return block;
    const regions = block.text_regions?.filter(validBox);
    // Recover a malformed paragraph box from its independently located lines.
    return regions?.length ? {...block, box: [Math.min(...regions.map(r=>r[0])),Math.min(...regions.map(r=>r[1])),Math.max(...regions.map(r=>r[2])),Math.max(...regions.map(r=>r[3]))] as Box} : block;
  });
  if (valid.some(block => !validBox(block.box))) throw new Error('원문 위치를 다시 분석해야 합니다.');
  if (mode === 'photo') {
    const font = (size: number) => `${size}px "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif`;
    // Plan before painting. Patches never grow beyond their original paragraph,
    // and background sampling always uses the unchanged source photograph.
    const plans = valid.flatMap(photoTextSegments).map(block => {
      const [y0,x0,y1,x1] = block.box;
      const rect = {left:x0*width/1000,right:x1*width/1000,top:y0*height/1000,bottom:y1*height/1000};
      const originalSize = Math.sqrt((rect.right-rect.left)*(rect.bottom-rect.top)/Math.max(1,Array.from((block.original || '').replace(/\s/g,'')).length));
      const fitted = fitInRectangle(block.translation, rect, Math.min(width/16, originalSize*1.1), (text,size) => {ctx.font=font(size);return ctx.measureText(text).width;});
      return {rect,fitted,background:photoBackground(data.data,width,height,rect)};
    });
    // Paint all backgrounds first, so even overlapping OCR boxes cannot paint
    // over a translation that has already been drawn.
    for (const {rect,background} of plans) {
      ctx.fillStyle=`rgb(${background.join(',')})`;
      ctx.fillRect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);
    }
    for (const {rect,fitted,background} of plans) {
      ctx.save();ctx.beginPath();ctx.rect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);ctx.clip();
      ctx.font=font(fitted.size);ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillStyle=background[0]*.299+background[1]*.587+background[2]*.114>145?'#17202b':'#ffffff';
      fitted.lines.forEach(line=>ctx.fillText(line.text,line.x,line.y));ctx.restore();
    }
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지 저장 실패')),'image/png'));
  }
  const refined = refineImageLayout(data.data, width, height, valid);
  data.data.set(refined.pixels); ctx.putImageData(data, 0, 0);
  const font = (size: number) => `${size}px "KyoboHandwriting", sans-serif`;
  for (const [index, block] of valid.entries()) {
    const polygon = refined.polygons[index];
    const originalArea = (block.box[2] - block.box[0]) * height / 1000 * (block.box[3] - block.box[1]) * width / 1000;
    const originalSize = Math.sqrt(originalArea / Math.max(1, Array.from(block.original.replace(/\s/g, '')).length));
    const maxSize = Math.max(5, Math.min(width / 18, originalSize * 1.25));
    // A tightly traced sound-effect region may itself contain colored outlined
    // letters. Keep its existing placement instead of treating those as faces.
    const tightLayout = block.layout_polygon?.length && block.layout_polygon.every(([y,x]) => y >= block.box[0]-2 && y <= block.box[2]+2 && x >= block.box[1]-2 && x <= block.box[3]+2);
    const protectedRects = refined.artwork.filter(a => !(tightLayout && (a.left+a.right)/2 >= block.box[1]*width/1000 && (a.left+a.right)/2 <= block.box[3]*width/1000 && (a.top+a.bottom)/2 >= block.box[0]*height/1000 && (a.top+a.bottom)/2 <= block.box[2]*height/1000));
    const fitted = fitInPolygon(block.translation, polygon, maxSize, (text, size) => { ctx.font = font(size); return ctx.measureText(text).width; }, protectedRects);
    ctx.save(); ctx.beginPath();
    polygon.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.clip();
    ctx.font = font(fitted.size); ctx.fillStyle = '#33251f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitted.lines.forEach(line => ctx.fillText(line.text, line.x, line.y)); ctx.restore();
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 저장 실패')), 'image/png'));
}

// Refine coarse AI coordinates against actual ink. Large connected contours are
// artwork / balloon borders; they must neither be erased nor receive new text.
export function refineImageLayout(pixels: Uint8ClampedArray, width: number, height: number, blocks: TextBlock[]) {
  const labels = new Int32Array(width * height);
  const components: { points: number[]; left: number; right: number; top: number; bottom: number }[] = [];
  const dark = (p: number) => Math.max(pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]) < 190;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || !dark(p)) continue;
    const id = components.length + 1, points = [p]; labels[p] = id;
    let left = p % width, right = left, top = Math.floor(p / width), bottom = top;
    for (let k = 0; k < points.length; k++) {
      const q = points[k], x = q % width, y = Math.floor(q / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && !labels[n] && dark(n)) { labels[n] = id; points.push(n); }
      }
    }
    components.push({points, left, right, top, bottom});
  }
  // Protect the interior of small illustrated outlines as well as the outline
  // itself. A gap in a face contour can otherwise connect its eyes to the same
  // white background as a nearby speech balloon.
  const stride = width + 1;
  const colorSum = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 35) row++;
      colorSum[(y + 1) * stride + x + 1] = colorSum[y * stride + x + 1] + row;
    }
  }
  const coloredInside = (c: typeof components[number]) => {
    // Background at the corners of a curved balloon is outside its interior.
    const insetX=Math.ceil((c.right-c.left)*.15),insetY=Math.ceil((c.bottom-c.top)*.15);
    const l=c.left+insetX,r=c.right-insetX,t=c.top+insetY,b=c.bottom-insetY;
    return colorSum[(b+1)*stride+r+1]-colorSum[t*stride+r+1]-colorSum[(b+1)*stride+l]+colorSum[t*stride+l];
  };
  const illustrated = components.filter(c => c.right - c.left >= 8 && c.bottom - c.top >= 8 && (c.right - c.left) * (c.bottom - c.top) < width * height * 0.12 && coloredInside(c) > 3);
  // Use the innermost outline; a balloon containing a small character must
  // still have its surrounding dialogue translated.
  const artwork = illustrated.filter(c => !illustrated.some(inner => inner !== c && inner.left >= c.left && inner.right <= c.right && inner.top >= c.top && inner.bottom <= c.bottom && (inner.right-inner.left)*(inner.bottom-inner.top) < (c.right-c.left)*(c.bottom-c.top)));
  const backgroundLabels = new Int32Array(width * height);
  const isPaper = (p: number) => Math.min(pixels[p*4],pixels[p*4+1],pixels[p*4+2]) > 205 && Math.max(pixels[p*4],pixels[p*4+1],pixels[p*4+2])-Math.min(pixels[p*4],pixels[p*4+1],pixels[p*4+2]) < 35;
  let backgroundId=0;
  for(let p=0;p<labels.length;p++) {
    if(backgroundLabels[p]||!isPaper(p))continue;
    backgroundId++;const queue=[p];backgroundLabels[p]=backgroundId;
    for(let k=0;k<queue.length;k++) {
      const q=queue[k],x=q%width,y=Math.floor(q/width);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,ny=y+dy,n=ny*width+nx;
        if(nx>=0&&nx<width&&ny>=0&&ny<height&&!backgroundLabels[n]&&isPaper(n)){backgroundLabels[n]=backgroundId;queue.push(n);}
      }
    }
  }
  const erase = new Uint8Array(width * height);
  const regions: Box[] = [];
  for (const block of blocks) {
    const [y0,x0,y1,x1] = block.box;
    const glyph = Math.max(8, Math.sqrt((y1-y0)*height/1000*(x1-x0)*width/1000/Math.max(1,Array.from(block.original.replace(/\s/g,'')).length)));
    const margin = Math.min(36, glyph * 1.4);
    const textRegions = block.text_regions?.filter(validBox) || [];
    // Vision coordinates can be displaced by a whole glyph on hand-drawn text.
    // Keep that tolerance, but do not erase the large gaps between separate lines.
    const regionPad = margin;
    const votes=new Map<number,number>();
    for(let y=Math.floor(y0*height/1000);y<y1*height/1000;y+=2)for(let x=Math.floor(x0*width/1000);x<x1*width/1000;x+=2){const id=backgroundLabels[y*width+x];if(id)votes.set(id,(votes.get(id)||0)+1);}
    const paperId=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0];
    const l=x0*width/1000-margin,r=x1*width/1000+margin,t=y0*height/1000-margin,b=y1*height/1000+margin;
    for (const c of components) {
      const cx=(c.left+c.right)/2,cy=(c.top+c.bottom)/2;
      if(cx<l||cx>r||cy<t||cy>b||c.right-c.left>glyph*2.2||c.bottom-c.top>glyph*2.2) continue;
      if (artwork.some(a => cx >= a.left && cx <= a.right && cy >= a.top && cy <= a.bottom)) continue;
      if (textRegions.length) {
        const nearText = textRegions.some(([ry0, rx0, ry1, rx1]) => cx >= rx0 * width / 1000 - regionPad && cx <= rx1 * width / 1000 + regionPad && cy >= ry0 * height / 1000 - regionPad && cy <= ry1 * height / 1000 + regionPad);
        // A nearby eye, mouth or decoration is not text merely because it is small.
        if (!nearText) continue;
      }
      if(paperId && !c.points.some(p => [[-2,0],[2,0],[0,-2],[0,2]].some(([dx,dy])=>{const x=p%width+dx,y=Math.floor(p/width)+dy;return x>=0&&x<width&&y>=0&&y<height&&backgroundLabels[y*width+x]===paperId;})))continue;
      if(c.points.some(p=>Math.max(pixels[p*4],pixels[p*4+1],pixels[p*4+2])-Math.min(pixels[p*4],pixels[p*4+1],pixels[p*4+2])>40))continue;
      let enclosedColor=0;
      for(let y=c.top;y<=c.bottom;y++)for(let x=c.left;x<=c.right;x++){const i=(y*width+x)*4;if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>35)enclosedColor++;}
      if(enclosedColor>3)continue;
      let enclosedPaper=0;
      for(let y=c.top;y<=c.bottom;y++)for(let x=c.left;x<=c.right;x++){const id=backgroundLabels[y*width+x];if(id&&id!==paperId)enclosedPaper++;}
      if(enclosedPaper>Math.max(45,glyph*glyph*.13))continue;
      // The complete connected stroke is removed, including antialiasing just
      // outside a model-provided rectangle, but not adjacent disconnected art.
      for(const p of c.points) for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
        const x=p%width+dx,y=Math.floor(p/width)+dy;
        if(x>=0&&x<width&&y>=0&&y<height) {
          const q=y*width+x,i=q*4;
          if ((!labels[q] || labels[q]===labels[p]) && Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])<35) erase[q]=1;
        }
      }
      regions.push([Math.max(0,c.top-2)*1000/height,Math.max(0,c.left-2)*1000/width,Math.min(height,c.bottom+3)*1000/height,Math.min(width,c.right+3)*1000/width]);
    }
  }
  const restored = eraseTextInk(pixels,width,height,regions);
  // Only selected connected strokes may change, even when their rectangles overlap art.
  for(let p=0;p<erase.length;p++) if(!erase[p]) for(let c=0;c<4;c++) restored[p*4+c]=pixels[p*4+c];
  const polygons = blocks.map(block => {
    const polygon=layoutPolygon(block,width,height);
    const minY=Math.max(0,Math.ceil(Math.min(...polygon.map(p=>p[1])))),maxY=Math.min(height-1,Math.floor(Math.max(...polygon.map(p=>p[1]))));
    const left:Point[]=[],right:Point[]=[];
    for(let y=minY+2;y<maxY-2;y+=3) {
      const span=lineSpan(polygon,y,y+.1,2); if(!span) continue;
      const ranges:[number,number][]=[];let start=-1;
      for(let x=Math.max(0,Math.ceil(span[0]));x<=Math.min(width-1,Math.floor(span[1]));x++) {
        const p=y*width+x,i=p*4;
        const color=[pixels[i],pixels[i+1],pixels[i+2]];
        const obstacle=!erase[p] && (Math.max(...color)<190 || Math.max(...color)-Math.min(...color)>40);
        if(!obstacle && start<0) start=x;
        if(obstacle && start>=0){ranges.push([start,x-1]);start=-1;}
      }
      if(start>=0)ranges.push([start,Math.floor(span[1])]);
      const widest=ranges.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
      if(widest && widest[1]-widest[0]>8){left.push([widest[0]+2,y]);right.push([widest[1]-2,y]);}
    }
    return left.length>2?[...left,...right.reverse()]:polygon;
  });
  return { pixels: restored, polygons, artwork: artwork.map(({left, right, top, bottom}) => ({left, right, top, bottom})) };
}
