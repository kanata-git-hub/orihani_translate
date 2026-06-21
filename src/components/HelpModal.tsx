import { HelpCircle, X } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[320px] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="bg-[#552c24] text-[#ffcd4a] p-4 flex justify-between items-center">
          <h2 className="text-base font-bold flex items-center gap-2">
            <HelpCircle size={18} />
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
        <div className="p-5 text-[#552c24] flex flex-col gap-6 text-[15px]">
          <div className="space-y-3">
            <h3 className="font-bold border-b border-black/10 pb-1 flex items-center gap-2">
              <span>🗣️</span> 내가 말할 때 <span className="font-normal text-xs opacity-70 ml-1">(한국어)</span>
            </h3>
            <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
              <li>왼쪽 위에서 번역할 언어 선택</li>
              <li><strong>아래쪽 흰색 배경</strong>의 마이크 누르기</li>
              <li>말하기가 끝나면 정지(⏹️) 누르기</li>
              <li>외국어로 번역되어 음성 출력 완료</li>
            </ol>
          </div>
          
          <div className="space-y-3">
            <h3 className="font-bold border-b border-black/10 pb-1 flex items-center gap-2">
              <span>👂</span> 상대방이 말할 때 <span className="font-normal text-xs opacity-70 ml-1">(외국어)</span>
            </h3>
            <ol className="list-decimal pl-4 space-y-1.5 text-black/80 font-medium">
              <li><strong>위쪽 갈색 배경</strong>의 마이크 누르기</li>
              <li>상대방 이야기 듣기</li>
              <li>말이 끝나면 정지(⏹️) 누르기</li>
              <li>한국어로 번역되어 음성 출력 완료</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
