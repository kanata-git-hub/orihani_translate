import React from 'react';
import { Mic, Square, Volume2, Loader2, Pencil, Send, Camera, HelpCircle, Download } from 'lucide-react';
import { renderPronunciation } from '../../utils/textUtils';
import { AudioVisualizer } from './AudioVisualizer';

interface UserPanelProps {
  userLoc: any;
  inputTypeUser: 'mic' | 'text';
  setInputTypeUser: (type: 'mic' | 'text') => void;
  activeMic: 'foreigner' | 'user' | null;
  toggleUserMic: () => void;
  userText: string;
  localUnfinalizedUser: string;
  userPronunciation: string;
  textInputUser: string;
  setTextInputUser: (text: string) => void;
  handleSendText: (role: 'user') => void;
  playingTTS: boolean;
  playTTS: (text: string) => void;
  processingRole: 'foreigner' | 'user' | null;
  imageInputUserRef: React.RefObject<HTMLInputElement>;
  handleImageChange: (e: React.ChangeEvent<HTMLInputElement>, role: 'user') => void;
  setShowHelp: (show: boolean) => void;
  handleCaptureAndDownload: () => void;
  isCapturing: boolean;
  audioLevels?: number[];
}

export const UserPanel: React.FC<UserPanelProps> = ({
  userLoc, inputTypeUser, setInputTypeUser, activeMic, toggleUserMic,
  userText, localUnfinalizedUser, userPronunciation,
  textInputUser, setTextInputUser, handleSendText,
  playingTTS, playTTS, processingRole,
  imageInputUserRef, handleImageChange, setShowHelp,
  handleCaptureAndDownload, isCapturing, audioLevels
}) => {
  return (
    <div className="flex-1 shrink-0 relative bg-white text-[#552c24] flex flex-col p-8 pt-24">
      <div className="absolute top-6 left-8 z-10 flex flex-col gap-1.5">
        <span className="font-bold text-[13px] opacity-50 tracking-wide flex items-center gap-1.5">
          {userLoc.title}
        </span>
      </div>

      <div className="sticky top-8 left-0 right-0 flex justify-center z-10 h-0 overflow-visible pointer-events-none">
        <div className="flex items-center gap-1 bg-white/90 border border-black/10 backdrop-blur-md rounded-[60px] pl-4 pr-2 py-6 shadow-2xl pointer-events-auto -translate-y-full">
          <div className="flex items-center pr-3 mr-1 border-r border-black/10">
            <span className="text-[#3498db] font-bold text-[16px]">한국어</span>
            <span className="text-black/20 text-[10px] mx-1.5">▶</span>
            <span className="text-[#e74c3c] font-bold text-[16px]">외국어</span>
          </div>
          <button
            onClick={() => {
              if (inputTypeUser === 'mic') toggleUserMic();
              else setInputTypeUser('mic');
            }}
            className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${
              inputTypeUser === 'mic' 
                ? activeMic === 'user'
                  ? 'bg-red-500 animate-pulse text-white' 
                  : 'bg-[#552c24] text-white shadow-md'
                : 'text-[#552c24]/50 hover:bg-black/5 hover:text-[#552c24]'
            }`}
            title={inputTypeUser === 'mic' ? '말하기' : '음성 입력으로 전환'}
          >
            {inputTypeUser === 'mic' && activeMic === 'user' ? <Square fill="currentColor" size={16} /> : <Mic size={18} />}
          </button>
          <button
            onClick={() => setInputTypeUser('text')}
            className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${
              inputTypeUser === 'text'
                ? 'bg-[#552c24] text-white shadow-md'
                : 'text-[#552c24]/50 hover:bg-black/5 hover:text-[#552c24]'
            }`}
            title="텍스트 모드로 전환"
          >
            <Pencil size={18} />
          </button>
          <button
            onClick={() => imageInputUserRef.current?.click()}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 text-[#552c24]/50 hover:bg-black/5 hover:text-[#552c24]"
            title="이미지 번역"
          >
            <Camera size={18} />
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={imageInputUserRef}
              onChange={(e) => handleImageChange(e, 'user')} 
            />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-visible w-full flex flex-col">
        <div className="flex flex-col flex-1 justify-center py-4">
          {inputTypeUser === 'text' ? (
            <div className="flex flex-col gap-4 w-full h-full justify-center">
              {userText && (
                <p className="text-xl opacity-50 mb-2 break-words shrink-0">{userText}</p>
              )}
              <div className="relative w-full z-20 flex-1 flex">
                <textarea
                  value={textInputUser}
                  onChange={(e) => setTextInputUser(e.target.value)}
                  className="w-full flex-1 bg-black/5 rounded-2xl p-4 pr-16 resize-none outline-none text-2xl font-medium focus:bg-black/10 transition-colors text-[#552c24]"
                  placeholder={userLoc.typeHere || "여기에 입력하세요..."}
                />
                <button 
                  className="absolute right-3 bottom-4 w-10 h-10 bg-[#552c24] text-white rounded-full flex items-center justify-center disabled:opacity-50"
                  disabled={!textInputUser.trim()}
                  onClick={() => handleSendText('user')}
                >
                  <Send size={18} className="ml-0.5" />
                </button>
              </div>
            </div>
          ) : activeMic === 'user' ? (
            <div className="flex flex-col items-center justify-center py-4 w-full">
              <AudioVisualizer levels={audioLevels || []} color="#552c24" />
              <p className="text-xl text-[#552c24]/70 mt-4 animate-pulse font-medium">{userLoc.listening}</p>
            </div>
          ) : userText || localUnfinalizedUser ? (
            <div className="group relative pr-12">
              <p className="text-2xl sm:text-3xl leading-tight font-medium break-words text-[#552c24]">
                {userText} {localUnfinalizedUser && <span className="opacity-70">{localUnfinalizedUser}</span>}
              </p>
              {userPronunciation && (
                <p className="text-lg sm:text-xl font-normal text-[#552c24]/70 mt-2 break-words">
                  {renderPronunciation(userPronunciation)}
                </p>
              )}
              <button 
                onClick={() => playTTS(userText)} 
                className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/5 hover:bg-black/10 rounded-full transition-colors"
                disabled={playingTTS}
              >
                {playingTTS ? <Loader2 size={20} className="animate-spin text-[#ffcd4a]" /> : <Volume2 size={20} className="text-[#552c24]" />}
              </button>
            </div>
          ) : (
            <div className="flex flex-col justify-center">
              {processingRole === 'user' ? (
                <div className="flex items-center gap-3 text-2xl sm:text-3xl text-[#552c24]/70 font-medium">
                  <Loader2 size={24} className="animate-spin text-[#ffcd4a]" />
                  <span>{userLoc.translating}</span>
                </div>
              ) : (
                <p className="text-2xl sm:text-3xl leading-tight text-[#552c24]/50 font-normal whitespace-pre-line">
                  {userLoc.idle}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <button 
          onClick={handleCaptureAndDownload}
          disabled={isCapturing}
          className="flex items-center gap-2 bg-black/5 hover:bg-black/10 transition-colors px-4 py-2 rounded-full text-sm font-bold text-[#552c24] disabled:opacity-50"
          title="대화 캡처하기"
        >
          {isCapturing ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          화면 캡처
        </button>
      </div>

      <div className="absolute bottom-6 right-6 z-10">
        <button 
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-2 bg-black/5 hover:bg-black/10 transition-colors px-4 py-2 rounded-full text-sm font-bold text-[#552c24]"
        >
          <HelpCircle size={18} />
          사용법
        </button>
      </div>
    </div>
  );
};
