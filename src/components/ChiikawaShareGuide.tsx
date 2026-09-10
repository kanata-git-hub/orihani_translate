import { useState } from 'react';

export function ChiikawaShareGuide() {
  const [phone, setPhone] = useState<'android' | 'ios'>(() => /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : 'android');
  const [copyMessage, setCopyMessage] = useState('');
  const shortcutPrefix = `${window.location.origin}/share#`;
  return <details className="rounded-2xl border border-[#552c24]/15 bg-white">
    <summary className="cursor-pointer p-3 font-bold text-sm">링크 복사 없이 공유 메뉴에서 보내기</summary>
    <div className="px-3 pb-4 space-y-3 text-sm leading-relaxed">
      <div role="group" aria-label="휴대폰 선택" className="flex gap-2">
        {([['android', '갤럭시 · 안드로이드'], ['ios', '아이폰']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={phone === value} onClick={() => setPhone(value)} className={`flex-1 rounded-xl p-2 font-bold ${phone === value ? 'bg-[#ffcd4a]' : 'bg-[#552c24]/5'}`}>{label}</button>)}
      </div>
      {phone === 'android' ? <>
        <p className="font-bold">한 번 설치하면 X에서 공유 → 오리 가이드</p>
        <ol className="list-decimal pl-5 space-y-2">
          <li>이 앱을 <strong>Chrome</strong>에서 열고 메뉴(⋮) → <strong>홈 화면에 추가 → 설치</strong>를 선택해 주세요. 메뉴 이름은 기기에 따라 달라요.</li>
          <li>X에서 만화 게시물의 <strong>공유 → 다른 앱으로 공유</strong>를 눌러 <strong>오리 가이드</strong>를 골라 주세요. 목록에 없으면 ‘더보기’를 열어 보세요.</li>
          <li>앱이 열리면 사진을 바로 가져와요. 여러 장이면 원하는 사진만 눌러 주세요.</li>
        </ol>
        <p className="text-xs opacity-75">주소만 여는 홈 화면 바로가기에는 공유 기능이 없어요. 기존 설치 앱에 공유 항목이 아직 없다면 Chrome에서 앱을 열어 업데이트를 기다려 주세요. 급하면 아래 링크 붙여넣기로 이용할 수 있어요.</p>
      </> : <>
        <p>아이폰은 웹앱을 공유 대상에 직접 추가할 수 없어, <strong>단축어를 한 번 설정</strong>해야 해요. 이후에는 X에서 공유 → <strong>치이카와 번역</strong>만 누르면 돼요.</p>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong>단축어</strong> 앱에서 새 단축어를 만들고 이름을 <strong>치이카와 번역</strong>으로 정해 주세요. 세부사항에서 <strong>공유 시트에서 보기</strong>를 켜고 입력은 <strong>URL과 텍스트</strong>를 선택해 주세요.</li>
          <li><strong>URL 인코딩</strong> 동작을 추가하고 입력으로 <strong>단축어 입력</strong>을 선택해 주세요.</li>
          <li><strong>텍스트</strong> 동작을 추가해 아래 주소를 붙여넣고, 끝의 # 바로 뒤에 앞 동작의 <strong>URL 인코딩 결과 변수</strong>를 넣어 주세요. 공백이나 줄바꿈은 넣지 않아요.</li>
          <li><strong>URL 열기</strong> 동작을 추가하고 입력으로 위의 <strong>텍스트</strong>를 선택한 뒤 저장해 주세요.</li>
        </ol>
        <label className="block text-xs font-bold">단축어에 넣을 주소
          <input aria-label="단축어 연결 주소" readOnly value={shortcutPrefix} onFocus={event => event.target.select()} className="mt-1 w-full min-w-0 rounded-lg border border-[#552c24]/20 p-2 text-xs font-normal" />
        </label>
        <button type="button" className="w-full rounded-xl bg-[#ffcd4a] p-2 font-bold" onClick={async () => {
          try { await navigator.clipboard.writeText(shortcutPrefix); setCopyMessage('주소를 복사했어요. 텍스트 동작에 붙여넣어 주세요.'); }
          catch { setCopyMessage('위 주소를 길게 눌러 복사해 주세요.'); }
        }}>단축어 연결 주소 복사</button>
        {copyMessage && <p role="status" className="text-xs">{copyMessage}</p>}
        <p className="text-xs opacity-75">공유 목록에 없으면 ‘동작 편집’에서 확인해 주세요. 단축어 설정 전에는 아래 링크 붙여넣기로도 번역할 수 있어요.</p>
      </>}
      <p className="text-xs opacity-75">앱 로그인이 필요하면 로그인 후 공유한 만화를 이어서 열어요.</p>
    </div>
  </details>;
}
