import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Languages, Volume2, VolumeX, Loader2, LogOut, Shield, HelpCircle, X, Pencil, Send, RotateCcw, Camera, Compass } from 'lucide-react';
import { playAudioChunk, resetAudioQueue, setHoldPlayback } from '../audio';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { logout } from '../lib/firebaseUtils';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { TutorialModal } from '../components/TutorialModal';
import { LOCALIZATION } from '../constants/localization';
import { ImageTranslateModal } from '../components/ImageTranslateModal';
import { DocumentTranslateModal } from '../components/DocumentTranslateModal';
import { LocalSmartSearchModal } from '../components/LocalSmartSearchModal';
import { renderPronunciation } from '../utils/textUtils';
import { ForeignerPanel } from '../components/chat/ForeignerPanel';
import { UserPanel } from '../components/chat/UserPanel';
import { domToJpeg } from 'modern-screenshot';

export default function App() {
  const [foreignerLang, setForeignerLang] = useLocalStorage<string>('app_foreignerLang', 'ja');
  const [ttsEnabled, setTtsEnabled] = useLocalStorage<boolean>('app_tts_enabled', true);
  const ttsEnabledRef = useRef(ttsEnabled);
  
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  
  const handleLogout = async () => {
    await logout();
    navigate('/');
  };
  
  const [activeMic, setActiveMic] = useState<'foreigner' | 'user' | null>(null);
  const activeMicRef = useRef(activeMic);
  
  const [inputTypeForeigner, setInputTypeForeigner] = useState<'mic' | 'text'>('mic');
  const [inputTypeUser, setInputTypeUser] = useState<'mic' | 'text'>('mic');
  const [textInputForeigner, setTextInputForeigner] = useState('');
  const [textInputUser, setTextInputUser] = useState('');

  useEffect(() => {
    activeMicRef.current = activeMic;
  }, [activeMic]);
  
  const [foreignerText, setForeignerText] = useState('');
  const [userText, setUserText] = useState('');
  const [foreignerPronunciation, setForeignerPronunciation] = useState('');
  const [userPronunciation, setUserPronunciation] = useState('');
  
  const foreignerCompleteRef = useRef('');
  const userCompleteRef = useRef('');
  const foreignerPendingRef = useRef('');
  const userPendingRef = useRef('');

  const foreignerPronunciationCompleteRef = useRef('');
  const userPronunciationCompleteRef = useRef('');
  const foreignerPronunciationPendingRef = useRef('');
  const userPronunciationPendingRef = useRef('');

  const [localUnfinalizedForeigner, setLocalUnfinalizedForeigner] = useState('');
  const [localUnfinalizedUser, setLocalUnfinalizedUser] = useState('');

  const lastProcessedIndex = useRef(0);
  const unfinalizedBufferRef = useRef('');

  const [playingTTS, setPlayingTTS] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showSmartSearch, setShowSmartSearch] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [imageTargetLang, setImageTargetLang] = useState<string>('Korean');
  const imageInputForeignerRef = useRef<HTMLInputElement>(null);
  const imageInputUserRef = useRef<HTMLInputElement>(null);
  const [processingRole, setProcessingRole] = useState<'foreigner' | 'user' | null>(null);

  useEffect(() => {
    const isDismissed = localStorage.getItem('tutorialDismissed');
    if (isDismissed !== 'true') {
      setIsFirstVisit(true);
      setShowHelp(true);
    }
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const visualizerIntervalRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(15).fill(10));

  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestartRef = useRef<boolean>(false);
  const outCtxRef = useRef<AudioContext | null>(null);

  const appContainerRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCaptureAndDownload = async () => {
    if (!appContainerRef.current) return;
    setIsCapturing(true);
    try {
      // 폰트나 레이아웃이 준비될 수 있도록 약간의 지연
      await new Promise(resolve => setTimeout(resolve, 100));
      const pixelRatio = Math.max(2, window.devicePixelRatio || 1);
      const dataUrl = await domToJpeg(appContainerRef.current, {
        scale: pixelRatio,
        quality: 0.95,
        backgroundColor: '#ffffff'
      });
      
      const link = document.createElement('a');
      link.download = `translation_capture_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Capture failed', error);
      alert('화면 캡처에 실패했습니다.');
    } finally {
      setIsCapturing(false);
    }
  };

  const lastUserOriginalSpeechRef = useRef<{text: string, time: number}>({text: '', time: 0});
  const lastForeignerOriginalSpeechRef = useRef<{text: string, time: number}>({text: '', time: 0});
  const lastSpeakerRef = useRef<string | null>(null);
  const lastStopTimeRef = useRef<number>(0);
  const activeTurnContextRef = useRef<string>('');

  const handleReset = () => {
    if (activeMic) stopRecording();
    setForeignerText('');
    setUserText('');
    setForeignerPronunciation('');
    setUserPronunciation('');
    setTextInputForeigner('');
    setTextInputUser('');
    setLocalUnfinalizedForeigner('');
    setLocalUnfinalizedUser('');
    foreignerCompleteRef.current = '';
    userCompleteRef.current = '';
    foreignerPendingRef.current = '';
    userPendingRef.current = '';
    foreignerPronunciationCompleteRef.current = '';
    userPronunciationCompleteRef.current = '';
    foreignerPronunciationPendingRef.current = '';
    userPronunciationPendingRef.current = '';
    lastSpeakerRef.current = null;
    activeTurnContextRef.current = '';
    lastProcessedIndex.current = 0;
  };

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
            setProcessingRole(null);
            if (msg.error === "NO_SPEECH_DETECTED") {
              if (msg.role === "foreigner") {
                const guide = foreignerLang === "ja" ? "⚠️ 音声が検出されませんでした。もう一度お話しください。" : foreignerLang === "zh" ? "⚠️ 未检测到语音。请再试一次。" : foreignerLang === "es" ? "⚠️ No se detectó voz. Por favor, inténtelo de nuevo." : "⚠️ No speech detected. Please try again.";
                setForeignerText(guide);
              } else {
                setUserText("⚠️ 음성이 감지되지 않았습니다. 조금 더 크고 명확하게 말씀해주세요.");
              }
            }
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
             if (msg.outputPronunciation) {
                if (currentMic === 'foreigner') userPronunciationPendingRef.current = msg.outputPronunciation;
                else foreignerPronunciationPendingRef.current = msg.outputPronunciation;
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
             if (foreignerPronunciationPendingRef.current) {
                foreignerPronunciationCompleteRef.current += (foreignerPronunciationCompleteRef.current ? ' ' : '') + foreignerPronunciationPendingRef.current;
                foreignerPronunciationPendingRef.current = '';
             }
             if (userPronunciationPendingRef.current) {
                userPronunciationCompleteRef.current += (userPronunciationCompleteRef.current ? ' ' : '') + userPronunciationPendingRef.current;
                userPronunciationPendingRef.current = '';
             }
             setProcessingRole(null);
          } else if (msg.correctedTranscription) {
             const targetRef = currentMic === 'foreigner' ? foreignerCompleteRef : userCompleteRef;
             const lastIdx = targetRef.current.lastIndexOf(msg.originalTranscription);
             if (lastIdx !== -1) {
                targetRef.current = 
                   targetRef.current.substring(0, lastIdx) + 
                   msg.correctedTranscription + 
                   targetRef.current.substring(lastIdx + msg.originalTranscription.length);
             }
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
          setForeignerPronunciation((foreignerPronunciationCompleteRef.current + " " + foreignerPronunciationPendingRef.current).trim());
          setUserPronunciation((userPronunciationCompleteRef.current + " " + userPronunciationPendingRef.current).trim());
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
    if (lastSpeakerRef.current === 'user' && userCompleteRef.current.trim()) {
       lastUserOriginalSpeechRef.current = { text: userCompleteRef.current, time: lastStopTimeRef.current };
    } else if (lastSpeakerRef.current === 'foreigner' && foreignerCompleteRef.current.trim()) {
       lastForeignerOriginalSpeechRef.current = { text: foreignerCompleteRef.current, time: lastStopTimeRef.current };
    }
    lastSpeakerRef.current = role;

    const opponentSpeechObj = role === 'foreigner' ? lastUserOriginalSpeechRef.current : lastForeignerOriginalSpeechRef.current;
    if (Date.now() - opponentSpeechObj.time < 2 * 60 * 1000) {
       activeTurnContextRef.current = opponentSpeechObj.text;
    } else {
       activeTurnContextRef.current = '';
    }

    setActiveMic(role);
    setForeignerText('');
    setUserText('');
    setForeignerPronunciation('');
    setUserPronunciation('');
    setLocalUnfinalizedForeigner('');
    setLocalUnfinalizedUser('');
    foreignerCompleteRef.current = '';
    userCompleteRef.current = '';
    foreignerPendingRef.current = '';
    userPendingRef.current = '';
    foreignerPronunciationCompleteRef.current = '';
    userPronunciationCompleteRef.current = '';
    foreignerPronunciationPendingRef.current = '';
    userPronunciationPendingRef.current = '';
    lastProcessedIndex.current = 0;
    didRestartRef.current = false;
    unfinalizedBufferRef.current = '';
    
    resetAudioQueue();
    initOutCtx();
    if (outCtxRef.current) {
       setHoldPlayback(true, outCtxRef.current);
    }

    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
    }
    sessionTimeoutRef.current = setTimeout(() => {
      stopRecording();
    }, 5 * 60 * 1000);
    
    try {
      await getEnsureWs();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const options = { mimeType: 'audio/webm' };
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Data = (reader.result as string).split(',')[1];
          sendAudioToBackend(role, base64Data, mediaRecorder.mimeType || 'audio/webm');
        };
      };

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      visualizerIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        const newLevels = [];
        const step = Math.floor(bufferLength / 15) || 1;
        for (let i = 0; i < 15; i++) {
          const val = dataArray[i * step] || 0;
          const percentage = Math.max(8, Math.min(100, (val / 255) * 100 * 1.5));
          newLevels.push(percentage);
        }
        setAudioLevels(newLevels);
      }, 80);

      mediaRecorder.start();

    } catch (err) {
      console.error('Failed to access microphone or start recording', err);
      setActiveMic(null);
    }
  };

  const stopRecording = () => {
    lastStopTimeRef.current = Date.now();
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (visualizerIntervalRef.current) {
      clearInterval(visualizerIntervalRef.current);
      visualizerIntervalRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevels(new Array(15).fill(10));
    
    initOutCtx();
    if (outCtxRef.current) {
       // iOS Web Audio API unlock trick: play a short silent buffer under direct user gesture
       try {
         const buffer = outCtxRef.current.createBuffer(1, 1, 22050);
         const source = outCtxRef.current.createBufferSource();
         source.buffer = buffer;
         source.connect(outCtxRef.current.destination);
         source.start(0);
       } catch (e) {
         console.warn("Failed to play silent buffer for iOS unlock", e);
       }
       setHoldPlayback(false, outCtxRef.current);
    }
    
    setActiveMic(null);
    setLocalUnfinalizedForeigner('');
    setLocalUnfinalizedUser('');
    unfinalizedBufferRef.current = '';
  };

  const sendAudioToBackend = (role: 'foreigner' | 'user', base64Audio: string, mimeType: string) => {
    setProcessingRole(role);
    lastSpeakerRef.current = role;

    if (role === 'foreigner') {
      setForeignerText('');
      setForeignerPronunciation('');
    } else {
      setUserText('');
      setUserPronunciation('');
    }

    const currentComplete = role === 'foreigner' ? foreignerCompleteRef.current : userCompleteRef.current;
    const opponentComplete = activeTurnContextRef.current;

    getEnsureWs().then(ws => {
      ws.send(JSON.stringify({ 
        type: 'process_audio',
        role: role,
        audio: base64Audio,
        mimeType: mimeType,
        previousText: currentComplete.trim(),
        opponentText: opponentComplete.trim(),
        targetLanguageCode: role === 'foreigner' ? 'Korean' : foreignerLang,
        foreignerLang: foreignerLang,
        ttsEnabled: ttsEnabledRef.current
      }));
    }).catch(console.error);
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

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>, role: 'foreigner' | 'user') => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      if (activeMic) stopRecording();
      setImageTargetLang(role === 'foreigner' ? 'Korean' : foreignerLang);
      
      if (files.length === 1) {
        setImageFile(files[0]);
        setShowImageModal(true);
      } else {
        setDocumentFiles(files);
        setShowDocumentModal(true);
      }
    }
    // reset input
    e.target.value = '';
  };

  const handleSendText = (role: 'foreigner' | 'user') => {
    const textToSend = role === 'foreigner' ? textInputForeigner.trim() : textInputUser.trim();
    if (!textToSend) return;

    if (activeMic) stopRecording();

    setProcessingRole(role);
    lastSpeakerRef.current = role;

    if (role === 'foreigner') {
       setTextInputForeigner('');
    } else {
       setTextInputUser('');
    }

    const currentComplete = role === 'foreigner' ? foreignerCompleteRef.current : userCompleteRef.current;
    const opponentComplete = activeTurnContextRef.current;

    getEnsureWs().then(ws => {
      ws.send(JSON.stringify({ 
        type: 'process_text',
        role: role,
        text: textToSend,
        previousText: currentComplete.trim(),
        opponentText: opponentComplete.trim(),
        targetLanguageCode: role === 'foreigner' ? 'Korean' : foreignerLang,
        foreignerLang: foreignerLang,
        ttsEnabled: ttsEnabledRef.current
      }));
    }).catch(console.error);
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

  const foreignLoc = LOCALIZATION[foreignerLang] || LOCALIZATION.en;
  const userLoc = LOCALIZATION.ko;

  return (
    <div ref={appContainerRef} className="flex flex-col h-[100dvh] w-full max-w-md mx-auto relative shadow-2xl overflow-y-auto font-sans bg-white">
      <ForeignerPanel
        foreignLoc={foreignLoc}
        foreignerLang={foreignerLang}
        setForeignerLang={setForeignerLang}
        ttsEnabled={ttsEnabled}
        setTtsEnabled={setTtsEnabled}
        isAdmin={isAdmin}
        handleLogout={handleLogout}
        navigate={navigate}
        handleReset={handleReset}
        inputTypeForeigner={inputTypeForeigner}
        setInputTypeForeigner={setInputTypeForeigner}
        activeMic={activeMic}
        toggleForeignerMic={toggleForeignerMic}
        foreignerText={foreignerText}
        localUnfinalizedForeigner={localUnfinalizedForeigner}
        foreignerPronunciation={foreignerPronunciation}
        textInputForeigner={textInputForeigner}
        setTextInputForeigner={setTextInputForeigner}
        handleSendText={handleSendText}
        playingTTS={playingTTS}
        playTTS={playTTS}
        processingRole={processingRole}
        imageInputForeignerRef={imageInputForeignerRef}
        handleImageChange={handleImageChange}
        audioLevels={audioLevels}
      />

      {/* Divider */}
      <div className="h-2 w-full bg-[#ffcd4a] z-20 shrink-0 shadow-sm relative flex items-center justify-center">
        <button 
          onClick={() => setShowSmartSearch(true)}
          className="absolute bg-white text-[#552c24] px-4 py-1.5 rounded-full shadow-md border border-[#ffcd4a] hover:bg-[#ffcd4a]/10 transition-colors z-30 flex items-center gap-1.5"
        >
          <Compass className="w-4 h-4 text-[#ffcd4a]" />
          <span className="text-[13px] font-bold">현지 검색</span>
        </button>
      </div>

      <UserPanel
        userLoc={userLoc}
        inputTypeUser={inputTypeUser}
        setInputTypeUser={setInputTypeUser}
        activeMic={activeMic}
        toggleUserMic={toggleUserMic}
        userText={userText}
        localUnfinalizedUser={localUnfinalizedUser}
        userPronunciation={userPronunciation}
        textInputUser={textInputUser}
        setTextInputUser={setTextInputUser}
        handleSendText={handleSendText}
        playingTTS={playingTTS}
        playTTS={playTTS}
        processingRole={processingRole}
        imageInputUserRef={imageInputUserRef}
        handleImageChange={handleImageChange}
        setShowHelp={setShowHelp}
        handleCaptureAndDownload={handleCaptureAndDownload}
        isCapturing={isCapturing}
        audioLevels={audioLevels}
      />

      {/* Help Modal */}
      {showHelp && <TutorialModal onClose={() => { setShowHelp(false); setIsFirstVisit(false); }} isFirstVisit={isFirstVisit} />}

      <LocalSmartSearchModal 
        isOpen={showSmartSearch}
        onClose={() => setShowSmartSearch(false)}
        targetLanguageCode={foreignerLang}
      />

      <ImageTranslateModal 
        isOpen={showImageModal} 
        onClose={() => {
          setShowImageModal(false);
          setImageFile(null);
        }} 
        targetLang={imageTargetLang}
        file={imageFile}
      />

      <DocumentTranslateModal
        isOpen={showDocumentModal}
        onClose={() => {
          setShowDocumentModal(false);
          setDocumentFiles([]);
        }}
        targetLang={imageTargetLang}
        files={documentFiles}
      />
    </div>
  );
}

