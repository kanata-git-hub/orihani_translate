import { HelpCircle, X, Mic, Square, Pencil, Send, Volume2, Camera, Download } from 'lucide-react';
import { useState } from 'react';

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  const [activeTab, setActiveTab] = useState<'voice' | 'text' | 'image'>('voice');

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[380px] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="bg-[#552c24] text-[#ffcd4a] p-5 flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <HelpCircle size={24} />
            사용 방법
          </h2>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
            aria-label="닫기"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-[#552c24] text-[#ffcd4a]/70 text-[16px] font-bold">
          <button 
            className={`flex-1 py-3 text-center border-b-[3px] transition-colors ${activeTab === 'voice' ? 'border-[#ffcd4a] text-[#ffcd4a]' : 'border-transparent hover:text-[#ffcd4a]/90'}`}
            onClick={() => setActiveTab('voice')}
          >
            음성 번역
          </button>
          <button 
            className={`flex-1 py-3 text-center border-b-[3px] transition-colors ${activeTab === 'text' ? 'border-[#ffcd4a] text-[#ffcd4a]' : 'border-transparent hover:text-[#ffcd4a]/90'}`}
            onClick={() => setActiveTab('text')}
          >
            문자 번역
          </button>
          <button 
            className={`flex-1 py-3 text-center border-b-[3px] transition-colors ${activeTab === 'image' ? 'border-[#ffcd4a] text-[#ffcd4a]' : 'border-transparent hover:text-[#ffcd4a]/90'}`}
            onClick={() => setActiveTab('image')}
          >
            이미지 번역
          </button>
        </div>

        <div className="p-6 text-[#552c24] flex flex-col gap-6 text-[16px] min-h-[260px]">
          {activeTab === 'voice' && (
            <>
              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[18px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>🗣️</span> 내가 말할 때 <span className="font-bold text-[18px] ml-1">(<span className="text-rose-600">한국어</span> {'>'} <span className="text-sky-600">외국어</span>)</span>
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li>왼쪽 위에서 번역할 <strong className="text-sky-600">외국어</strong> 선택</li>
                  <li><strong>아래쪽 흰색 배경</strong>의 <strong className="text-[#ffcd4a]">마이크 버튼</strong>(<Mic size={16} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li>말하기가 끝나면 <strong className="text-[#ffcd4a]">정지 버튼</strong>(<Square size={14} fill="currentColor" className="inline text-red-500 -mt-0.5" />) 누르기</li>
                  <li><strong className="text-sky-600">외국어</strong>로 번역되어 음성 출력 완료</li>
                </ol>
              </div>
              
              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[18px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>👂</span> 상대방이 말할 때 <span className="font-bold text-[18px] ml-1">(<span className="text-sky-600">외국어</span> {'>'} <span className="text-rose-600">한국어</span>)</span>
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li><strong>위쪽 갈색 배경</strong>의 <strong className="text-[#ffcd4a]">마이크 버튼</strong>(<Mic size={16} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li>상대방 이야기 듣기</li>
                  <li>말이 끝나면 <strong className="text-[#ffcd4a]">정지 버튼</strong>(<Square size={14} fill="currentColor" className="inline text-red-500 -mt-0.5" />) 누르기</li>
                  <li><strong className="text-rose-600">한국어</strong>로 번역되어 음성 출력 완료</li>
                </ol>
              </div>
            </>
          )}

          {activeTab === 'text' && (
            <>
              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[18px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>✍️</span> 내가 입력할 때 <span className="font-bold text-[18px] ml-1">(<span className="text-rose-600">한국어</span> {'>'} <span className="text-sky-600">외국어</span>)</span>
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li><strong>아래쪽 흰색 배경</strong>의 <strong className="text-[#ffcd4a]">연필 버튼</strong>(<Pencil size={16} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li><strong className="text-rose-600">한국어</strong> 텍스트 직접 입력하기</li>
                  <li>우측의 <strong className="text-[#ffcd4a]">전송 버튼</strong>(<Send size={16} className="inline text-[#552c24] -mt-0.5" />) 눌러서 <strong className="text-sky-600">외국어</strong> 번역 결과 확인</li>
                  <li>결과가 나오면 자동으로 음성이 재생되며, <strong className="text-[#ffcd4a]">스피커 버튼</strong>(<Volume2 size={16} className="inline text-[#552c24] -mt-0.5" />)을 눌러 다시 들을 수 있음</li>
                </ol>
              </div>
              
              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[18px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>✍️</span> 상대방이 입력할 때 <span className="font-bold text-[18px] ml-1">(<span className="text-sky-600">외국어</span> {'>'} <span className="text-rose-600">한국어</span>)</span>
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li><strong>위쪽 갈색 배경</strong>의 <strong className="text-[#ffcd4a]">연필 버튼</strong>(<Pencil size={16} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li><strong className="text-sky-600">외국어</strong>로 텍스트 입력하기</li>
                  <li>우측의 <strong className="text-[#ffcd4a]">전송 버튼</strong>(<Send size={16} className="inline text-[#552c24] -mt-0.5" />) 눌러서 <strong className="text-rose-600">한국어</strong> 번역 확인</li>
                  <li>결과가 나오면 자동으로 음성이 재생되며, <strong className="text-[#ffcd4a]">스피커 버튼</strong>(<Volume2 size={16} className="inline text-[#552c24] -mt-0.5" />)을 눌러 다시 들을 수 있음</li>
                </ol>
              </div>
            </>
          )}

          {activeTab === 'image' && (
            <>
              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[18px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>📸</span> <span className="text-sky-600">외국어</span> 이미지를 <span className="text-rose-600">한국어</span>로 번역
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li><strong>아래쪽 흰색 배경</strong>의 <strong className="text-[#ffcd4a]">카메라 버튼</strong>(<Camera size={16} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li>번역할 <strong className="text-sky-600">외국어</strong> 이미지 선택</li>
                  <li><strong className="text-rose-600">한국어</strong>로 번역된 결과 확인 및 <strong className="text-[#ffcd4a]">저장 버튼</strong>(<Download size={16} className="inline text-[#552c24] -mt-0.5" />)으로 보관</li>
                </ol>
              </div>

              <div className="space-y-3 animate-in fade-in duration-300">
                <h3 className="text-[18px] font-bold border-b border-black/10 pb-1 flex items-center gap-2">
                  <span>📸</span> <span className="text-rose-600">한국어</span> 이미지를 <span className="text-sky-600">외국어</span>로 번역
                </h3>
                <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
                  <li><strong>위쪽 갈색 배경</strong>의 <strong className="text-[#ffcd4a]">카메라 버튼</strong>(<Camera size={16} className="inline text-[#552c24] -mt-0.5" />) 누르기</li>
                  <li>번역할 <strong className="text-rose-600">한국어</strong> 이미지 선택</li>
                  <li><strong className="text-sky-600">외국어</strong>로 번역된 결과 확인 및 <strong className="text-[#ffcd4a]">저장 버튼</strong>(<Download size={16} className="inline text-[#552c24] -mt-0.5" />)으로 보관</li>
                </ol>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
