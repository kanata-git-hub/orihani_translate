export type Box = [number, number, number, number];
export type Point = [number, number]; // x/y, image pixels
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
export function lineSpan(polygon: Point[], top: number, bottom: number, padding: number): [number, number] | null {
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
  return ranges.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] || null;
}

export function fitInPolygon(text: string, polygon: Point[], maxSize: number, measure: (text: string, size: number) => number): { size: number; lines: { text: string; x: number; y: number }[] } {
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
        const span = lineSpan(polygon, y + pad, y + leading - pad, pad);
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
    const background = [0, 1, 2].map(c => bgSamples.reduce((sum, p) => sum + p[c], 0) / bgSamples.length);
    const distance = (index: number) => Math.sqrt([0, 1, 2].reduce((sum, c) => sum + (pixels[index + c] - background[c]) ** 2, 0));
    const masked: number[] = [];
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4;
      const color = [pixels[i], pixels[i + 1], pixels[i + 2]];
      // Dark text can be removed without treating a blue head or pink cheek as ink.
      // Saturated lettering is preserved until its color can be identified reliably.
      if (distance(i) > 38 && Math.max(...color) - Math.min(...color) < 55 && Math.max(...color) < 235) masked.push(i);
    }
    for (const index of masked) {
      const x = (index / 4) % width, y = Math.floor(index / 4 / width);
      const nearby: number[][] = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let step = 1; step <= 16; step++) {
          const sx = x + dx * step, sy = y + dy * step;
          if (sx < left || sx >= right || sy < top || sy >= bottom) break;
          const j = (sy * width + sx) * 4;
          if (distance(j) < 24) { nearby.push([pixels[j], pixels[j + 1], pixels[j + 2]]); break; }
        }
      }
      for (let c = 0; c < 3; c++) result[index + c] = nearby.length ? nearby.reduce((sum, p) => sum + p[c], 0) / nearby.length : background[c];
    }
  }
  return result;
}

export async function composeTranslation(src: string, blocks: TextBlock[]): Promise<Blob> {
  const img = new Image(); img.src = src; await img.decode();
  await document.fonts.load('20px KyoboHandwriting');
  const width = img.naturalWidth, height = img.naturalHeight;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('이미지를 만들 수 없습니다.');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, width, height);
  const valid = blocks.filter(block => typeof block.translation === 'string' && block.translation.trim());
  if (valid.some(block => !validBox(block.box))) throw new Error('원문 위치를 다시 분석해야 합니다.');
  const refined = refineImageLayout(data.data, width, height, valid);
  data.data.set(refined.pixels); ctx.putImageData(data, 0, 0);
  const font = (size: number) => `${size}px "KyoboHandwriting", sans-serif`;
  for (const [index, block] of valid.entries()) {
    const polygon = refined.polygons[index];
    const originalArea = (block.box[2] - block.box[0]) * height / 1000 * (block.box[3] - block.box[1]) * width / 1000;
    const originalSize = Math.sqrt(originalArea / Math.max(1, Array.from(block.original.replace(/\s/g, '')).length));
    const maxSize = Math.max(5, Math.min(width / 18, originalSize * 1.25));
    const fitted = fitInPolygon(block.translation, polygon, maxSize, (text, size) => { ctx.font = font(size); return ctx.measureText(text).width; });
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
    const votes=new Map<number,number>();
    for(let y=Math.floor(y0*height/1000);y<y1*height/1000;y+=2)for(let x=Math.floor(x0*width/1000);x<x1*width/1000;x+=2){const id=backgroundLabels[y*width+x];if(id)votes.set(id,(votes.get(id)||0)+1);}
    const paperId=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0];
    const l=x0*width/1000-margin,r=x1*width/1000+margin,t=y0*height/1000-margin,b=y1*height/1000+margin;
    for (const c of components) {
      const cx=(c.left+c.right)/2,cy=(c.top+c.bottom)/2;
      if(cx<l||cx>r||cy<t||cy>b||c.right-c.left>glyph*2.2||c.bottom-c.top>glyph*2.2) continue;
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
      for(const p of c.points) for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const x=p%width+dx,y=Math.floor(p/width)+dy;
        if(x>=0&&x<width&&y>=0&&y<height) erase[y*width+x]=1;
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
  return { pixels: restored, polygons };
}
