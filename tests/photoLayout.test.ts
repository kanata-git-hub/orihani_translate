import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitInRectangle, photoTextSegments, type TextBlock} from '../src/utils/imageLayout.ts';
const measure=(text:string,size:number)=>Array.from(text).reduce((w,c)=>w+(c===' '?.3:.8)*size,0);
const stripped=(text:string)=>text.replace(/\s/g,'');

test('dense ingredients retain every character inside their original rectangle',()=>{
  const text=('원재료: 밀가루, 설탕, 우유 성분·대두 포함. 28℃ 이하 보관. 18봉지. ').repeat(30);
  const box={left:40,right:350,top:20,bottom:180};
  const result=fitInRectangle(text,box,20,measure);
  assert.equal(stripped(result.lines.map(l=>l.text).join('')),stripped(text));
  for(const line of result.lines){assert.ok(line.x>=box.left);assert.ok(line.x+measure(line.text,result.size)<=box.right+.01);assert.ok(line.y-result.size*.6>=box.top);assert.ok(line.y+result.size*.6<=box.bottom+.01);}
});
test('long URLs and blank lines fit without truncation or an image-wide failure',()=>{
  const text='제품 안내\n\nhttps://example.com/'+ 'longpath'.repeat(20)+'\n문의 0120-917-111';
  const result=fitInRectangle(text,{left:0,right:90,top:0,bottom:45},14,measure);
  assert.equal(stripped(result.lines.map(l=>l.text).join('')),stripped(text));
});
test('a tiny valid label can fit below the comic renderer minimum size',()=>{
  const text='이곳을 눌러 접어 주세요.';
  const result=fitInRectangle(text,{left:0,right:16,top:0,bottom:3},8,measure);
  assert.ok(result.size>0 && result.size<2);
  assert.equal(stripped(result.lines.map(l=>l.text).join('')),stripped(text));
});
test('labels separated by a QR code keep independent source regions',()=>{
  const block:TextBlock={original:'製品情報\n詳細はこちら',translation:'제품 정보\n자세한 내용 보기',box:[100,100,350,500],text_regions:[[100,350,180,500],[300,100,350,500]]};
  const result=photoTextSegments(block);
  assert.deepEqual(result.map(b=>b.box),block.text_regions);
  assert.equal(stripped(result.map(b=>b.translation).join('')),stripped(block.translation));
});
test('unchanged URLs and codes are preserved rather than repainted',()=>{
  assert.deepEqual(photoTextSegments({original:'https://example.com',translation:'https://example.com',box:[0,0,20,400]}),[]);
});

test('a single OCR line supplies its full text area when the paragraph box is too small',()=>{
  const block:TextBlock={original:'直射日光を避けて保存',translation:'직사광선을 피해 보관',box:[100,100,120,300],text_regions:[[90,80,160,500]]};
  const [segment]=photoTextSegments(block);
  assert.deepEqual(segment.box,block.text_regions![0]);
  const fit=(box:number[])=>fitInRectangle(segment.translation,{left:box[1],right:box[3],top:box[0],bottom:box[2]},24,measure);
  const result=fit(segment.box);
  assert.ok(result.size>fit(block.box).size,'use the available line height instead of shrinking to the erroneous paragraph');
  assert.equal(stripped(result.lines.map(l=>l.text).join('')),stripped(block.translation));
  assert.deepEqual(block.box,[100,100,120,300],'do not mutate the source OCR response');
});

test('a single OCR line avoids an adjacent code included in a coarse paragraph box',()=>{
  const block:TextBlock={original:'詳細はこちら',translation:'자세한 내용 보기',box:[100,100,300,700],text_regions:[[110,400,160,680]]};
  assert.deepEqual(photoTextSegments(block).map(b=>b.box),block.text_regions);
});

test('invalid OCR regions cannot create a false line correspondence when removed',()=>{
  const block:TextBlock={original:'製品情報\n詳細はこちら',translation:'제품 정보\n자세한 내용 보기',box:[100,100,350,500],text_regions:[[0,0,0,0],[100,350,180,500],[300,100,350,500]]};
  assert.deepEqual(photoTextSegments(block),[block]);
});

test('missing, invalid or unmatched OCR lines keep the paragraph fallback',()=>{
  const block:TextBlock={original:'製品情報',translation:'제품 정보',box:[100,100,200,500]};
  for(const regions of [undefined,[],[[0,0,0,0]],[[100,100,150,500],[150,100,200,500]]] as (TextBlock['text_regions'])[]){
    const input={...block,text_regions:regions};
    assert.deepEqual(photoTextSegments(input),[input]);
  }
});
