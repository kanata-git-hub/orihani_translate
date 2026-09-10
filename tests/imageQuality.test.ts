import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refineImageLayout, fitInPolygon } from '../src/utils/imageLayout.ts';

test('a translated line cannot cross a protected face inside its balloon', () => {
  const rect={left:55,right:90,top:20,bottom:75};
  const text='여기서 기다려 주세요.';
  const measure=(s:string,size:number)=>Array.from(s).length*size*.8;
  const fitted=fitInPolygon(text,[[0,0],[100,0],[100,100],[0,100]],18,measure,[rect]);
  assert.equal(fitted.lines.map(l=>l.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
  for(const line of fitted.lines){
    const half=measure(line.text,fitted.size)/2;
    const verticalOverlap=line.y+fitted.size/2>=rect.top&&line.y-fitted.size/2<=rect.bottom;
    if(verticalOverlap)assert.ok(line.x+half<=rect.left||line.x-half>=rect.right);
  }
});

test('eyes inside a face with an open contour survive a coarse text box', () => {
  const w=140,h=120,p=new Uint8ClampedArray(w*h*4).fill(255);
  const ink=(x:number,y:number)=>p.set([0,0,0,255],(y*w+x)*4);
  for(let y=10;y<18;y++)for(let x=50;x<55;x++)ink(x,y);
  for(let x=40;x<=70;x++){ink(x,35);if(x<51||x>60)ink(x,60);}
  for(let y=35;y<=60;y++){ink(40,y);ink(70,y);}
  for(let y=43;y<47;y++)for(let x=47;x<51;x++){ink(x,y);ink(x+12,y);}
  for(let y=49;y<53;y++)for(let x=44;x<49;x++)p.set([245,160,180,255],(y*w+x)*4);
  const r=refineImageLayout(p,w,h,[{original:'エッ？',translation:'에?',box:[50,250,520,550]}]);
  assert.equal(r.pixels[(13*w+52)*4],255,'dialogue still erased');
  for(let y=35;y<=60;y++)for(let x=40;x<=70;x++)assert.deepEqual(r.pixels.slice((y*w+x)*4,(y*w+x)*4+4),p.slice((y*w+x)*4,(y*w+x)*4+4));
});

test('colored background outside a balloon corner is not an illustrated interior', () => {
  const w=120,h=120,p=new Uint8ClampedArray(w*h*4).fill(255);
  for(let y=88;y<102;y++)for(let x=10;x<27;x++)p.set([240,150,170,255],(y*w+x)*4);
  // A continuous diamond balloon; the pink pixels are outside its left corner.
  for(let d=0;d<=40;d++)for(const[x,y]of[[60+d,10+d],[100-d,50+d],[60-d,90-d],[20+d,50-d]])p.set([0,0,0,255],(y*w+x)*4);
  const r=refineImageLayout(p,w,h,[]);
  assert.equal(r.artwork.length,0);
});

test('separate OCR regions preserve a small drawing between distant words', () => {
  const w=220,h=100,p=new Uint8ClampedArray(w*h*4).fill(255);
  const dot=(x:number,y:number)=>p.set([0,0,0,255],(y*w+x)*4);
  for(let y=20;y<30;y++)for(let x=15;x<22;x++){dot(x,y);dot(x+180,y);}
  for(let y=20;y<26;y++)for(let x=107;x<113;x++)dot(x,y);
  const r=refineImageLayout(p,w,h,[{original:'あい',translation:'안녕',box:[150,40,400,960],text_regions:[[180,60,320,110],[180,870,320,930]]}]);
  assert.equal(r.pixels[(25*w+18)*4],255);
  assert.equal(r.pixels[(25*w+198)*4],255);
  for(let y=20;y<26;y++)for(let x=107;x<113;x++)assert.equal(r.pixels[(y*w+x)*4],0);
});

test('erase antialiasing around detected ink without erasing a nearby contour', () => {
  const w=80,h=80,p=new Uint8ClampedArray(w*h*4).fill(255);
  for(let y=20;y<32;y++)for(let x=20;x<26;x++)p.set([230,230,230,255],(y*w+x)*4);
  for(let y=21;y<31;y++)for(let x=21;x<25;x++)p.set([0,0,0,255],(y*w+x)*4);
  for(let y=0;y<h;y++)p.set([0,0,0,255],(y*w+27)*4);
  const r=refineImageLayout(p,w,h,[{original:'あ',translation:'아',box:[240,240,410,320],text_regions:[[240,240,410,320]]}]);
  assert.equal(r.pixels[(25*w+22)*4],255);
  assert.ok(r.pixels[(25*w+20)*4]>=248,'gray letter fringe should be restored to paper');
  for(let y=0;y<h;y++)assert.equal(r.pixels[(y*w+27)*4],0,'panel contour must remain black');
});
