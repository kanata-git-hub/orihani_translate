import React, { useState, useRef, useEffect, useLayoutEffect, startTransition } from 'react';
import { X, Loader2, Download, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';

interface TextBlock {
  original: string;
  translation: string;
  box: [number, number, number, number]; // ymin, xmin, ymax, xmax (0-1000)
}

interface ImageTranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLang: string;
  file: File | null;
}

const FontAdjustableText = ({ text, box, onClick }: { text: string, box: number[], onClick?: () => void }) => {
  // 박스의 절대 좌표를 바탕으로 가로세로 비율(aspect ratio)을 계산합니다.
  const [ymin, xmin, ymax, xmax] = box;
  const boxWidth = Math.max(1, xmax - xmin);
  const boxHeight = Math.max(1, ymax - ymin);
  const aspectRatio = boxWidth / boxHeight;

  // 1. 최소한 완벽히 가시성을 보장할 "한 문장(목표 텍스트)"의 길이를 잡습니다.
  // 텍스트가 아무리 길어도 30자 정도까지만 최적 크기로 맞추고 나머지는 클램핑 처리합니다.
  const targetLen = Math.min(text.length, 30);
  
  // 2. 박스의 종횡비(Box Aspect Ratio)와 컨텐츠 길이(targetLen)의 면적을 수학적으로 병합합니다.
  // 공식: (가로 글자수 C) / (세로 줄수 L * 줄간격 1.25) = aspectRatio
  // C * L = targetLen  =>  C = Math.sqrt(1.25 * aspectRatio * targetLen)
  const charsPerLine = Math.sqrt(1.25 * aspectRatio * Math.max(1, targetLen));
  
  // 3. 도출된 '줄당 글자수(C)'를 100cqw에 분배하여 정확한 최적의 폰트 사이즈 cqw 도출 (약간 축소)
  const optimalCqw = (100 / Math.max(1, charsPerLine)) * 0.9;

  // 4. 표시할 텍스트가 차지하게 될 실제 줄(Line) 수를 역산하여 유연하게 클램핑
  const optimalLines = Math.ceil(targetLen / Math.max(1, charsPerLine));

  // 5. 세로 높이 기준 최대 폰트 크기 계산 (줄 수와 줄간격 1.25를 고려하여 세로로 넘치지 않게 제한)
  const maxCqh = 85 / (Math.max(1, optimalLines) * 1.25);

  return (
    <div 
      className="@container w-full h-full flex flex-col items-center justify-center relative cursor-pointer rounded-md overflow-hidden bg-white/85 backdrop-blur-md shadow-[0_2px_10px_rgba(0,0,0,0.1)] border border-white/60 hover:bg-white/90 hover:shadow-[0_4px_15px_rgba(0,0,0,0.15)] hover:-translate-y-[1px] transition-all duration-200"
      onClick={onClick}
      style={{ containerType: 'size' as any }}
    >
      <div className="w-full h-full overflow-hidden text-center flex items-center justify-center p-0.5 sm:p-1">
        <div 
          className="text-[#3a1d17] font-bold"
          style={{ 
            lineHeight: 1.25,
            // 수학적으로 계산된 optimalCqw를 적용하되, 세로로 넘치지 않도록 maxCqh 상한을 적용
            fontSize: `clamp(4px, min(${maxCqh}cqh, ${optimalCqw}cqw), 120px)`,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            display: '-webkit-box',
            // 세로로 긴 박스의 경우 강제로 3줄에서 자르지 않고, 계산된 필요 줄수만큼 충분히 공간을 줍니다.
            WebkitLineClamp: Math.max(2, optimalLines + 1),
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};

export function ImageTranslateModal({ isOpen, onClose, targetLang, file }: ImageTranslateModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<TextBlock | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'image' | 'text'>('image');
  const [copiedIndex, setCopiedIndex] = useState<number | 'all' | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const handleCopy = async (text: string, index: number | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleSaveImage = async () => {
    if (!exportRef.current) return;
    try {
      setIsSaving(true);
      
      // 화질을 높게 유지하기 위해 pixelRatio를 최소 2 이상으로 설정합니다.
      const pixelRatio = Math.max(2, window.devicePixelRatio || 1);
      
      const canvas = await html2canvas(exportRef.current, {
        scale: pixelRatio,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
      });
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      
      const link = document.createElement('a');
      link.download = `translated_${Date.now()}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Save failed', err);
      setError('이미지 저장에 실패했습니다: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      // Allow exit animations to complete before thoroughly purging states
      const timer = setTimeout(() => {
        setBlocks([]);
        setImageSrc(null);
        setError('');
        setSelectedBlock(null);
        setLoading(true);
      }, 400);
      return () => clearTimeout(timer);
    }
    
    if (!file) return;

    let isMounted = true;

    // 1. 초고속 이미지 선-렌더링 (Fast initial image rendering)
    // Safari html-to-image 호환성 및 메모리 문제(초고해상도 원본 렌더링 시 하얗게 나오는 현상)를 방지하기 위해,
    // 초기 원본 Data URL 렌더링을 생략하고, 워커에서 압축된 이미지만을 렌더링합니다.
    setLoading(true);
    setError('');

    const processImage = async () => {
      // 2. 모션과 연산의 분리 (Absolute Delay)
      // 모달이 처음 뜨는 애니메이션이 완전히 끝날 때까지 600ms 동안 무거운 작업을 하지 않습니다.
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!isMounted) return;

      try {
        const processAndCompressImage = async (f: File): Promise<{ mimeType: string, base64: string }> => {
          // 1. Web Worker와 OffscreenCanvas 지원 여부 확인 (최신 삼성 인터넷, 크롬 등 완벽 지원)
          if (window.Worker && window.OffscreenCanvas && window.createImageBitmap) {
            try {
              // createImageBitmap은 메인 스레드를 멈추지 않는 매우 빠른 비동기 디코딩 함수입니다.
              const imageBitmap = await createImageBitmap(f);
              
              return await new Promise((resolve, reject) => {
                // 워커 소스 코드를 문자열로 바로 정의 (프론트엔드 환경에서 별도 파일 없이 구동)
                const workerCode = `
                  self.onmessage = async function(e) {
                    try {
                      const { imageBitmap, maxSize, quality } = e.data;
                      let width = imageBitmap.width;
                      let height = imageBitmap.height;

                      if (width > height) {
                        if (width > maxSize) {
                          height = Math.round(height * (maxSize / width));
                          width = maxSize;
                        }
                      } else {
                        if (height > maxSize) {
                          width = Math.round(width * (maxSize / height));
                          height = maxSize;
                        }
                      }

                      // 화면에 보이지 않는 워커 전용 캔버스 생성
                      const canvas = new OffscreenCanvas(width, height);
                      const ctx = canvas.getContext('2d');
                      ctx.drawImage(imageBitmap, 0, 0, width, height);

                      // Web Worker 내에서 압축 처리
                      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
                      
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        // 결과값을 메인 스레드로 전송
                        self.postMessage({ success: true, base64: reader.result, mimeType: 'image/jpeg' });
                      };
                      reader.onerror = () => {
                        self.postMessage({ success: false, error: 'Failed to read blob object' });
                      };
                      reader.readAsDataURL(blob);
                    } catch (err) {
                      self.postMessage({ success: false, error: err.message });
                    }
                  };
                `;
                
                const blobCode = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blobCode);
                const worker = new Worker(workerUrl);

                worker.onmessage = (e) => {
                  URL.revokeObjectURL(workerUrl);
                  worker.terminate();
                  if (e.data.success) {
                    // "data:image/jpeg;base64," 접두사 제거
                    const base64Data = e.data.base64.split(',')[1];
                    resolve({ mimeType: e.data.mimeType, base64: base64Data });
                  } else {
                    reject(new Error(e.data.error));
                  }
                };

                worker.onerror = (err) => {
                  URL.revokeObjectURL(workerUrl);
                  worker.terminate();
                  reject(err);
                };

                // 워커로 비트맵 "소유권"을 완전히 넘김 (Zero-copy 방식, 초고속)
                worker.postMessage({ imageBitmap, maxSize: 2048, quality: 0.92 }, [imageBitmap]);
              });
            } catch (err) {
              console.warn('Web Worker compression failed, falling back to main thread.', err);
              // 웹 워커 처리가 모종의 이유로 실패하면, 기존 로직(메인 스레드 방식)으로 자연스럽게 넘어갑니다.
            }
          }

          // --- [폴백(Fallback)] 웹 워커를 지원하거나 실패했을 경우 실행되는 메인 스레드 로직 ---
          return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(f);
            
            img.onload = () => {
              URL.revokeObjectURL(url);
              const MAX_SIZE = 2048;
              let width = img.width;
              let height = img.height;
              
              if (width > height) {
                if (width > MAX_SIZE) {
                  height = Math.round(height * (MAX_SIZE / width));
                  width = MAX_SIZE;
                }
              } else {
                if (height > MAX_SIZE) {
                  width = Math.round(width * (MAX_SIZE / height));
                  height = MAX_SIZE;
                }
              }
              
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error("Failed to get canvas 2d context"));
                return;
              }
              
              ctx.drawImage(img, 0, 0, width, height);
              // 압축 품질 92% 적용 (100%시 파일 크기 비대화 방지)
              const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
              const base64Data = dataUrl.split(',')[1];
              resolve({ mimeType: 'image/jpeg', base64: base64Data });
            };
            
            img.onerror = () => {
              URL.revokeObjectURL(url);
              reject(new Error("Failed to load image for compression"));
            };
            
            img.src = url;
          });
        };

        const { mimeType, base64 } = await processAndCompressImage(file);

        if (!isMounted) return;
        
        // Safari html-to-image 버그 방지 (초고해상도 원본 대신 압축된 이미지 사용)
        setImageSrc(`data:${mimeType};base64,${base64}`);

        const response = await fetch('/api/translate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageParams: { mimeType, data: base64 },
            targetLang
          })
        });

        if (!isMounted) return;

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed to translate image');
        }

        const data = await response.json();
        if (!isMounted) return;
        
        // 3. 상태 동기화 단절 및 보이지 않는 렌더링
        // 박스들을 DOM에 먼저 주입하되, loading 상태는 유지합니다.
        startTransition(() => {
          setBlocks(data.blocks || []);
        });
        
        // 박스들이 Reflow 되면서 브라우저가 버벅거릴 수 있으므로 300ms 후에 loading을 풀어줍니다.
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (err: any) {
        if (!isMounted) return;
        setError(err.message || 'Error processing image');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    processImage();

    return () => {
      isMounted = false;
    };
  }, [isOpen, file, targetLang]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 md:p-4"
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-[95vw] lg:max-w-6xl h-full max-h-[95vh] bg-gray-50 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 bg-white z-20">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-[#552c24] whitespace-nowrap">이미지 번역</h2>
                
                {!loading && blocks.length > 0 && (
                  <div className="flex bg-gray-100/80 rounded-lg p-0.5 flex-shrink-0">
                    <button 
                      onClick={() => setViewMode('image')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${viewMode === 'image' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      이미지
                    </button>
                    <button 
                      onClick={() => setViewMode('text')}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${viewMode === 'text' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      문자
                    </button>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-1">
                {!loading && blocks.length > 0 && viewMode === 'image' && (
                  <button 
                    onClick={handleSaveImage}
                    disabled={isSaving}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors text-[#552c24] disabled:opacity-50"
                    title="이미지 저장"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  </button>
                )}
                <button 
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors text-[#552c24]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-[#e5e5e5] z-10 w-full h-full">
          <AnimatePresence>
            {loading && (
              <motion.div 
                key="loading-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90"
              >
                <Loader2 className="w-12 h-12 animate-spin text-[#ffcd4a] mb-4" />
                <p className="text-[#552c24] font-medium animate-pulse">이미지를 분석하고 번역중입니다...</p>
              </motion.div>
            )}
          </AnimatePresence>
          
          {error && (
            <div className="absolute z-30 top-4 left-4 right-4 bg-red-100 text-red-700 p-4 rounded-xl text-center font-medium shadow-md">
              {error}
            </div>
          )}

          {imageSrc && viewMode === 'image' && (
            <div className="relative flex justify-center items-center w-full h-full p-2 md:p-6 min-h-0">
              <div 
                ref={exportRef}
                className="relative inline-block max-w-full max-h-full shadow-lg rounded-xl"
              >
                <img 
                  src={imageSrc} 
                  alt="Original to translate" 
                  className="block max-w-full max-h-full rounded-xl"
                  style={{ width: 'auto', height: 'auto' }}
                />
                
                {blocks.length > 0 && (
                  <div className="absolute inset-0">
                    {blocks.map((block, idx) => {
                      const [ymin, xmin, ymax, xmax] = block.box;
                      const top = `${ymin / 10}%`;
                      const left = `${xmin / 10}%`;
                      const height = `${(ymax - ymin) / 10}%`;
                      const width = `${(xmax - xmin) / 10}%`;

                      return (
                        <motion.div
                          key={idx}
                          className="absolute z-20"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: loading ? 0 : 1 }}
                          transition={{ 
                            duration: 0.4, 
                            delay: loading ? 0 : 0.1 + (idx * 0.03),
                            ease: "easeOut" 
                          }}
                          style={{
                            top,
                            left,
                            height,
                            width,
                            willChange: 'transform, opacity',
                            transform: 'translateZ(0)',
                          }}
                        >
                          <div className="absolute inset-0 sm:-inset-0.5">
                            <FontAdjustableText text={block.translation} box={block.box} onClick={() => setSelectedBlock(block)} />
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading && blocks.length > 0 && viewMode === 'text' && (
            <div className="absolute inset-0 overflow-y-auto p-4 flex justify-center items-start bg-gray-50/50">
              <div className="w-full max-w-2xl bg-white rounded-xl shadow-sm border border-black/5 p-5 sm:p-8 my-2 sm:my-8 flex flex-col gap-6">
                
                {/* 번역문 그룹 */}
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col gap-3"
                >
                  <h3 className="text-sm font-bold text-gray-500 border-b border-gray-100 pb-2">번역문</h3>
                  <div className="flex flex-col gap-1.5">
                    {blocks.map((block, idx) => (
                      <p key={idx} className="text-[16px] font-bold text-gray-900 leading-snug break-keep">
                        {block.translation}
                      </p>
                    ))}
                  </div>
                </motion.div>

                {/* 원문 그룹 */}
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="flex flex-col gap-3"
                >
                  <h3 className="text-sm font-bold text-gray-500 border-b border-gray-100 pb-2">원문</h3>
                  <div className="flex flex-col gap-0.5">
                    {blocks.map((block, idx) => (
                      <div key={idx} className="flex items-start gap-3 group">
                        <p className="text-[14px] text-gray-400 font-medium leading-snug break-all flex-1 py-1">
                          {block.original}
                        </p>
                        <button
                          onClick={() => handleCopy(block.original, idx)}
                          className="w-7 h-7 flex items-center justify-center flex-shrink-0 rounded-full bg-gray-50 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all text-gray-400 hover:text-gray-600 mt-0.5"
                          title="원문 복사"
                        >
                          {copiedIndex === idx ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>

              </div>
            </div>
          )}
        </div>
        
        {/* Bottom Details Panel */}
        <AnimatePresence>
          {selectedBlock && viewMode === 'image' && (
            <motion.div 
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.15)] rounded-t-3xl p-6 z-40 border-t border-black/5"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-bold text-lg text-[#552c24]">번역 상세</h3>
                <button 
                  onClick={() => setSelectedBlock(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors text-[#552c24]"
                >
                  <X size={16} />
                </button>
              </div>
              
              <div className="space-y-4 max-h-[30vh] overflow-y-auto no-scrollbar">
                <div className="bg-[#ffcd4a]/10 p-3 rounded-xl border border-[#ffcd4a]/20">
                  <p className="text-xs font-semibold text-[#552c24]/50 mb-1">번역</p>
                  <p className="text-lg font-bold text-[#552c24] break-words leading-relaxed">{selectedBlock.translation}</p>
                </div>
                <div className="px-1">
                  <p className="text-xs font-semibold text-black/30 mb-1">원문</p>
                  <p className="text-sm text-gray-500 break-words">{selectedBlock.original}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
  );
}
