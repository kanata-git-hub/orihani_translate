import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { X, Loader2, Search } from 'lucide-react';
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

const FontAdjustableText = ({ text, onClick }: { text: string, onClick?: () => void }) => {
  return (
    <div 
      className="w-full h-full relative cursor-pointer rounded-md overflow-hidden bg-white/40 backdrop-blur-md shadow-sm border border-white/40 hover:bg-white/50 transition-colors duration-200"
      onClick={onClick}
    >
      <div 
        className="w-full h-full overflow-hidden text-left p-1.5"
        style={{
          maskImage: 'linear-gradient(to bottom, black 65%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 65%, transparent 100%)',
        }}
      >
        <div 
          className="text-[#3a1d17] font-bold leading-snug break-words text-[11px] sm:text-[13px]"
        >
          {text}
        </div>
      </div>
      
      {/* Subtle touch watermark icon */}
      <div className="absolute bottom-1 right-1 opacity-30 pointer-events-none">
        <Search size={14} className="text-[#3a1d17]" />
      </div>
    </div>
  );
};

export function ImageTranslateModal({ isOpen, onClose, targetLang, file }: ImageTranslateModalProps) {
  const [loading, setLoading] = useState(false);
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
      // 2. 모션과 연산의 분리 (Wait for modal motion to complete)
      await new Promise(resolve => setTimeout(resolve, 350));
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
        setBlocks(data.blocks || []);
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
          {loading && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90">
              <Loader2 className="w-12 h-12 animate-spin text-[#ffcd4a] mb-4" />
              <p className="text-[#552c24] font-medium animate-pulse">이미지를 분석하고 번역중입니다...</p>
            </div>
          )}
          
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
                
                {!loading && blocks.length > 0 && (
                  <div className="absolute inset-0">
                    {blocks.map((block, idx) => {
                      const [ymin, xmin, ymax, xmax] = block.box;
                      const top = `${ymin / 10}%`;
                      const left = `${xmin / 10}%`;
                      const height = `${(ymax - ymin) / 10}%`;
                      const width = `${(xmax - xmin) / 10}%`;

                      return (
                        <div
                          key={idx}
                          className="absolute z-20"
                          style={{
                            top,
                            left,
                            height,
                            width,
                          }}
                        >
                          <div className="absolute inset-x-0.5 inset-y-0.5">
                            <FontAdjustableText text={block.translation} onClick={() => setSelectedBlock(block)} />
                          </div>
                        </div>
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
