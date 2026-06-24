import { HelpCircle, X, Mic, Square, Pencil, Send, Volume2, Camera, Download } from 'lucide-react';
import { useState } from 'react';

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  const [activeTab, setActiveTab] = useState<'voice' | 'text' | 'image'>('voice');

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[320px] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="bg-[#552c24] text-[#ffcd4a] p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <HelpCircle size={20} />
            사용 방법
          </h2>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-[#552c24] text-[#ffcd4a]/70 text-[15px] font-bold">
          <button 
            className={`flex-1 py-2.5 text-center border-b-[3px] transition-colors ${activeTab === 'voice' ? 'border-[#ffcd4a] text-[#ffcd4a]' : 'border-transparent hover:text-[#ffcd4a]/90'}`}
            onClick={() => setActiveTab('voice')}
          >
            음성 번역
          </button>
          <button 
            className={`flex-1 py-2.5 text-center border-b-[3px] transition-colors ${activeTab === 'text' ? 'border-[#ffcd4a] text-[#ffcd4a]' : 'border-transparent hover:text-[#ffcd4a]/90'}`}
            onClick={() => setActiveTab('text')}
          >
            문자 번역
          </button>
          <button 
            className={`flex-1 py-2.5 text-center border-b-[3px] transition-colors ${activeTab === 'image' ? 'border-[#ffcd4a] text-[#ffcd4a]' : 'border-transparent hover:text-[#ffcd4a]/90'}`}
            onClick={() => setActiveTab('image')}
          >
            이미지 번역
          </button>
        </div>

        <div className="p-5 text-[#552c24] flex flex-col gap-6 text-[15px] min-h-[220px]">
          {activeTab === 'voice' && (
            <>
              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[17px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>🗣️</span> 내가 말할 때 <span className="font-normal text-xs opacity-70 ml-1">(한국어)</span>
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li>왼쪽 위에서 번역할 언어 선택</li>
                  <li><strong>아래쪽 흰색 배경</strong>의 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">마이크 버튼</strong>(<Mic size={15} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li>말하기가 끝나면 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">정지 버튼</strong>(<Square size={13} fill="currentColor" className="inline text-red-500 -mt-0.5" />) 누르기</li>
                  <li>외국어로 번역되어 음성 출력 완료</li>
                </ol>
              </div>
              
              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[17px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>👂</span> 상대방이 말할 때 <span className="font-normal text-xs opacity-70 ml-1">(외국어)</span>
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li><strong>위쪽 갈색 배경</strong>의 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">마이크 버튼</strong>(<Mic size={15} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li>상대방 이야기 듣기</li>
                  <li>말이 끝나면 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">정지 버튼</strong>(<Square size={13} fill="currentColor" className="inline text-red-500 -mt-0.5" />) 누르기</li>
                  <li>한국어로 번역되어 음성 출력 완료</li>
                </ol>
              </div>
            </>
          )}

          {activeTab === 'text' && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <h3 className="text-[17px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                <span>✍️</span> 문자 번역
              </h3>
              <ol className="list-decimal pl-4 space-y-2 text-black/80 font-medium">
                <li>하단 또는 중앙 메뉴에서 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">연필 버튼</strong>(<Pencil size={15} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                <li>번역하고 싶은 텍스트 직접 입력하기</li>
                <li>우측의 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">전송 버튼</strong>(<Send size={15} className="inline text-[#552c24] -mt-0.5" />) 눌러서 번역 결과 확인</li>
                <li>결과 문장 옆의 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">스피커 버튼</strong>(<Volume2 size={15} className="inline text-[#552c24] -mt-0.5" />)을 눌러 음성 듣기</li>
              </ol>
            </div>
          )}

          {activeTab === 'image' && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <h3 className="text-[17px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                <span>📸</span> 이미지 번역
              </h3>
              <ol className="list-decimal pl-4 space-y-2 text-black/80 font-medium">
                <li>메뉴 중앙의 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">카메라 버튼</strong>(<Camera size={15} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                <li>번역할 이미지(메뉴판, 간판 등) 선택</li>
                <li>잠시 기다리면 이미지 위 텍스트가 번역됨</li>
                <li>번역된 이미지를 <strong className="text-[#552c24] bg-[#ffcd4a] px-1.5 py-0.5 rounded-md">저장 버튼</strong>(<Download size={15} className="inline text-[#552c24] -mt-0.5" />)을 눌러 보관하기</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
