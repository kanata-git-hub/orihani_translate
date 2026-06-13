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
  const activeMicRef = useRef(activeMic);
  
  useEffect(() => {
    activeMicRef.current = activeMic;
  }, [activeMic]);
  
  const [foreignerText, setForeignerText] = useState('');
  const [userText, setUserText] = useState('');
  
  const foreignerCompleteRef = useRef('');
  const userCompleteRef = useRef('');
  const foreignerPendingRef = useRef('');
  const userPendingRef = useRef('');

  const [playingTTS, setPlayingTTS] = useState(false);
  const [processingRole, setProcessingRole] = useState<'foreigner' | 'user' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);

  const getEnsureWs = () => {
    return new Promise<WebSocket>((resolve, reject) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => {
        console.error("WS error", e);
        reject(e);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.error) {
            console.error("Live API Error:", msg.error);
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
          
          const currentMic = msg.role || activeMicRef.current;
          
          if (msg.partial) {
             if (msg.inputTranscription) {
               if (currentMic === 'foreigner') foreignerPendingRef.current = msg.inputTranscription;
               else userPendingRef.current = msg.inputTranscription;
             }
             if (msg.outputTranscription) {
               if (currentMic === 'foreigner') userPendingRef.current = msg.outputTranscription;
               else foreignerPendingRef.current = msg.outputTranscription;
             }
          } else if (msg.turnComplete) {
             // turn is done, move pending to complete
             if (foreignerPendingRef.current) {
                foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + foreignerPendingRef.current;
                foreignerPendingRef.current = '';
             }
             if (userPendingRef.current) {
                userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + userPendingRef.current;
                userPendingRef.current = '';
             }
             setProcessingRole(null);
          } else {
             // legacy single-shot WS event
             if (msg.inputTranscription) {
               if (currentMic === 'foreigner') {
                 foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + msg.inputTranscription;
               } else if (currentMic === 'user') {
                 userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + msg.inputTranscription;
               }
             }
             if (msg.outputTranscription) {
                if (currentMic === 'foreigner') {
                  userCompleteRef.current += (userCompleteRef.current ? ' ' : '') + msg.outputTranscription;
                } else if (currentMic === 'user') {
                  foreignerCompleteRef.current += (foreignerCompleteRef.current ? ' ' : '') + msg.outputTranscription;
                }
             }
          }
          
          setForeignerText((foreignerCompleteRef.current + " " + foreignerPendingRef.current).trim());
          setUserText((userCompleteRef.current + " " + userPendingRef.current).trim());
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };
      
      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      };
    });
  };

  useEffect(() => {
    getEnsureWs().catch(console.error);
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

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
    foreignerCompleteRef.current = '';
    userCompleteRef.current = '';
    foreignerPendingRef.current = '';
    userPendingRef.current = '';
    
    resetAudioQueue();
    initOutCtx();

    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
    }
    // 5분 자동 종료 타임아웃
    sessionTimeoutRef.current = setTimeout(() => {
      stopRecording();
    }, 5 * 60 * 1000);
    
    try {
      await getEnsureWs();

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("현재 브라우저에서 음성 인식 API를 지원하지 않습니다.");
        setActiveMic(null);
        return;
      }

      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      // Map standard ISO code to BCP-47 for foreignerLang
      let recLang = 'ko-KR';
      if (role === 'foreigner') {
        const langMap: Record<string, string> = { "ja": "ja-JP", "en": "en-US", "es": "es-ES", "zh": "zh-CN" };
        recLang = langMap[foreignerLang] || foreignerLang;
      }
      recognition.lang = recLang;

      recognition.onresult = (event: any) => {
        let fullTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
          fullTranscript += event.results[i][0].transcript;
        }

        if (role === 'foreigner') {
          foreignerPendingRef.current = fullTranscript;
        } else {
          userPendingRef.current = fullTranscript;
        }
        
        setForeignerText((foreignerCompleteRef.current + " " + foreignerPendingRef.current).trim());
        setUserText((userCompleteRef.current + " " + userPendingRef.current).trim());
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        if (event.error === 'not-allowed') {
           alert('마이크 접근이 거부되었습니다. 브라우저의 마이크 권한을 허용해주세요.');
           setActiveMic(null);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
        console.error('Failed to access microphone', err);
        setActiveMic(null);
    }
  };

  const stopRecording = () => {
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    
    if (wsRef.current?.readyState === WebSocket.OPEN && activeMic) {
      setProcessingRole(activeMic);
      
      const currentTurnText = activeMic === 'foreigner' 
        ? foreignerPendingRef.current.trim() 
        : userPendingRef.current.trim();
        
      if (currentTurnText) {
        if (activeMic === 'foreigner') foreignerPendingRef.current = '';
        else userPendingRef.current = '';

        wsRef.current.send(JSON.stringify({ 
          type: 'process_text',
          role: activeMic,
          text: currentTurnText,
          targetLanguageCode: activeMic === 'foreigner' ? 'ko' : foreignerLang
        }));
      } else {
        setProcessingRole(null);
      }
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
                {activeMic === 'foreigner' ? '듣는 중 (완료하려면 버튼을 다시 누르세요)...' : processingRole === 'foreigner' ? '번역 중...' : '외국인 대화 영역'}
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
                {activeMic === 'user' ? '듣는 중 (완료하려면 버튼을 다시 누르세요)...' : processingRole === 'user' ? '번역 중...' : '한국어 대화 영역'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

