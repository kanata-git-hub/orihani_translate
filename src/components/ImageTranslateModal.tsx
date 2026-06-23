import React, { useState, useRef, useEffect, useLayoutEffect, startTransition } from 'react';
import { X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  
  // 3. 도출된 '줄당 글자수(C)'를 100cqw에 분배하여 정확한 최적의 폰트 사이즈 cqw 도출
  const optimalCqw = 100 / Math.max(1, charsPerLine);

  // 4. 표시할 텍스트가 차지하게 될 실제 줄(Line) 수를 역산하여 유연하게 클램핑
  const optimalLines = Math.ceil(targetLen / Math.max(1, charsPerLine));

  return (
    <div 
      className="@container w-full h-full flex flex-col items-center justify-center relative cursor-pointer rounded-md overflow-hidden bg-white/95 shadow-[0_2px_8px_rgba(0,0,0,0.15)] border border-white/60 hover:bg-white hover:shadow-[0_4px_12px_rgba(0,0,0,0.25)] hover:-translate-y-[1px] transition-all duration-200"
      onClick={onClick}
      style={{ containerType: 'size' as any }}
    >
      <div className="w-full h-full overflow-hidden text-center flex items-center justify-center p-0.5 sm:p-1">
        <div 
          className="text-[#3a1d17] font-bold"
          style={{ 
            lineHeight: 1.25,
            // 수학적으로 계산된 optimalCqw를 적용하되, 지나치게 뭉개지는 것을 방지하기 위해 8px 최후 마지노선을 둡니다.
            fontSize: `clamp(8px, min(45cqh, ${optimalCqw}cqw), 32px)`,
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
  
  const containerRef = useRef<HTMLDivElement>(null);

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

    // 1. 초고속 이미지 선-렌더링 (Fast initial image rendering)
    const objectUrl = URL.createObjectURL(file);
    setImageSrc(objectUrl);
    setLoading(true);
    setError('');

    let isMounted = true;

    const processImage = async () => {
      // 2. 모션과 연산의 분리 (Absolute Delay)
      // 모달이 처음 뜨는 애니메이션이 완전히 끝날 때까지 600ms 동안 무거운 작업을 하지 않습니다.
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!isMounted) return;

      try {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        if (!isMounted) return;

        const base64 = base64Data.split(',')[1];
        const mimeType = file.type;

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
      URL.revokeObjectURL(objectUrl);
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
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white z-20">
          <h2 className="text-xl font-bold text-[#552c24]">이미지 번역</h2>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors text-[#552c24]"
          >
            <X size={20} />
          </button>
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

          {imageSrc && (
            <div className="relative flex justify-center items-center w-full h-full p-2 md:p-6 min-h-0">
              <div className="relative inline-block max-w-full max-h-full shadow-lg rounded-xl">
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
                          <div className="absolute -inset-1 sm:-inset-1.5">
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
        </div>
        
        {/* Bottom Details Panel */}
        <AnimatePresence>
          {selectedBlock && (
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
