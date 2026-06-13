import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Languages, Volume2, Loader2, LogOut, Shield } from 'lucide-react';
import { pcmToBase64, playAudioChunk, resetAudioQueue } from '../audio';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { logout } from '../lib/firebaseUtils';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function App() {
  const [foreignerLang, setForeignerLang] = useLocalStorage<'ja' | 'en'>('app_foreignerLang', 'ja');
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  
  const handleLogout = async () => {
    await logout();
    navigate('/');
  };
  
  const [activeMic, setActiveMic] = useState<'foreigner' | 'user' | null>(null);
  
  const [foreignerText, setForeignerText] = useState('');
  const [userText, setUserText] = useState('');
  const [playingTTS, setPlayingTTS] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/live`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      console.log("WS message:", msg);
      if (msg.error) {
        console.error("Live API Error:", msg.error);
        alert("Live API Error: " + msg.error);
        stopRecording();
        return;
      }
      if (msg.audio) {
        if (!outCtxRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          outCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
        }
        if (outCtxRef.current.state === 'suspended') {
          outCtxRef.current.resume();
        }
        playAudioChunk(outCtxRef.current, msg.audio);
      }
      if (msg.interrupted) {
        resetAudioQueue();
      }
      
      if (msg.inputTranscription) {
        if (activeMic === 'foreigner') {
          setForeignerText(msg.inputTranscription);
        } else if (activeMic === 'user') {
          setUserText(msg.inputTranscription);
        }
      }
      if (msg.outputTranscription) {
         if (activeMic === 'foreigner') {
           setUserText(msg.outputTranscription);
         } else if (activeMic === 'user') {
           setForeignerText(msg.outputTranscription);
         }
      }
    };

    return () => {
      ws.close();
    };
  }, [activeMic]);

  const initOutCtx = () => {
    if (!outCtxRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      outCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
    }
    if (outCtxRef.current.state === 'suspended') {
      outCtxRef.current.resume();
    }
  };

  const startRecording = async (role: 'foreigner' | 'user') => {
    setActiveMic(role);
    setForeignerText('');
    setUserText('');
    resetAudioQueue();
    initOutCtx();
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ 
        type: 'start', 
        targetLanguageCode: role === 'foreigner' ? 'ko' : foreignerLang 
      }));
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;
      
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      source.connect(processor);
      processor.connect(audioCtx.destination);
      
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const base64 = pcmToBase64(e.inputBuffer.getChannelData(0), audioCtx.sampleRate);
          wsRef.current.send(JSON.stringify({ type: 'audio', audio: base64 }));
        }
      };
    } catch (err) {
        if (err instanceof Error) {
          if (err.name === 'NotAllowedError' || err.message.includes('Permission denied')) {
            alert('마이크 접근이 거부되었습니다. 브라우저의 마이크 권한을 허용해주세요. (카카오톡 등 인앱 브라우저라면 우측 하단/상단 메뉴를 눌러 Safari 또는 Chrome으로 열어주세요.)');
          } else {
            alert('마이크 초기화 실패: ' + err.message + '\n\n카카오톡 등 인앱 브라우저라면 Safari나 Chrome으로 앱을 열어주세요.');
          }
        }
        console.error('Failed to access microphone', err);
        setActiveMic(null);
      }
  };

  const stopRecording = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current && audioCtxRef.current) {
      processorRef.current.disconnect();
      audioCtxRef.current.close().catch(console.error);
      processorRef.current = null;
      audioCtxRef.current = null;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    setActiveMic(null);
  };

  const toggleForeignerMic = () => {
    if (activeMic === 'foreigner') stopRecording();
    else {
      if (activeMic === 'user') stopRecording();
      startRecording('foreigner');
    }
  };

  const toggleUserMic = () => {
    if (activeMic === 'user') stopRecording();
    else {
      if (activeMic === 'foreigner') stopRecording();
      startRecording('user');
    }
  };

  const toggleForeignerLang = () => {
    setForeignerLang(prev => prev === 'ja' ? 'en' : 'ja');
  };

  const playTTS = async (text: string) => {
    if (!text) return;
    setPlayingTTS(true);
    resetAudioQueue();
    initOutCtx();
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (data.audio) {
        if (!outCtxRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          outCtxRef.current = new AudioContextClass({ sampleRate: 24000 });
        }
        if (outCtxRef.current.state === 'suspended') {
          outCtxRef.current.resume();
        }
        playAudioChunk(outCtxRef.current, data.audio);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPlayingTTS(false);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto relative shadow-2xl overflow-hidden font-sans">
      {/* Top Half: Foreigner View */}
      <div className="flex-1 relative bg-[#552c24] text-white flex flex-col p-8 pb-24">
        <div className="flex justify-between items-center mb-6">
          <button 
            onClick={toggleForeignerLang}
            className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium z-10"
          >
            <Languages size={16} className="text-[#ffcd4a]" />
            {foreignerLang === 'ja' ? '일본어' : '영어'}
          </button>
          
          <div className="flex items-center gap-2 z-10">
            {isAdmin && (
              <button 
                onClick={() => navigate('/admin')}
                className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium"
              >
                <Shield size={16} className="text-white/80" />
                Admin
              </button>
            )}
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 bg-black/20 hover:bg-black/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium"
            >
              <LogOut size={16} className="text-white/80" />
              Sign Out
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto w-full">
          <div className="flex flex-col justify-center min-h-full py-4">
            {foreignerText ? (
              <div className="group relative pr-12">
                <p className="text-2xl sm:text-3xl leading-tight font-medium break-words text-white">
                  {foreignerText}
                </p>
                <button 
                  onClick={() => playTTS(foreignerText)} 
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                  disabled={playingTTS}
                >
                  {playingTTS ? <Loader2 size={20} className="animate-spin text-[#ffcd4a]" /> : <Volume2 size={20} className="text-[#ffcd4a]" />}
                </button>
              </div>
            ) : (
              <p className="text-2xl sm:text-3xl leading-tight text-white/50 font-normal">
                {activeMic === 'foreigner' ? 'Listening...' : '외국인 대화 영역'}
              </p>
            )}
          </div>
        </div>

        <div className="absolute bottom-8 left-0 right-0 flex justify-center z-10">
          <button
            onClick={toggleForeignerMic}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-xl ${
              activeMic === 'foreigner' 
                ? 'bg-red-500 animate-pulse text-white scale-110' 
                : 'bg-[#ffcd4a] text-[#552c24] hover:scale-105'
            }`}
          >
            {activeMic === 'foreigner' ? <Square fill="currentColor" size={24} /> : <Mic size={28} />}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-2 w-full bg-[#ffcd4a] z-20 shrink-0 shadow-sm relative" />

      {/* Bottom Half: User (Korean) View */}
      <div className="flex-1 relative bg-white text-[#552c24] flex flex-col p-8 pt-24">
        
        <div className="absolute top-8 left-0 right-0 flex justify-center z-10">
          <button
            onClick={toggleUserMic}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-xl ${
              activeMic === 'user' 
                ? 'bg-red-500 animate-pulse text-white scale-110' 
                : 'bg-[#552c24] text-white hover:scale-105'
            }`}
          >
            {activeMic === 'user' ? <Square fill="currentColor" size={24} /> : <Mic size={28} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto w-full">
          <div className="flex flex-col justify-center min-h-full py-4">
            {userText ? (
              <div className="group relative pr-12">
                <p className="text-2xl sm:text-3xl leading-tight font-medium break-words text-[#552c24]">
                  {userText}
                </p>
                <button 
                  onClick={() => playTTS(userText)} 
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-black/5 hover:bg-black/10 rounded-full transition-colors"
                  disabled={playingTTS}
                >
                  {playingTTS ? <Loader2 size={20} className="animate-spin text-[#ffcd4a]" /> : <Volume2 size={20} className="text-[#552c24]" />}
                </button>
              </div>
            ) : (
              <p className="text-2xl sm:text-3xl leading-tight text-[#552c24]/50 font-normal">
                {activeMic === 'user' ? '듣는 중...' : '한국어 대화 영역'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

