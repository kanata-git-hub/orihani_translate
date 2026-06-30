import React, { useState } from 'react';
import { X, Search, Loader2, MapPin, ExternalLink } from 'lucide-react';

interface LocalSmartSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLanguageCode: string;
}

export function LocalSmartSearchModal({ isOpen, onClose, targetLanguageCode }: LocalSmartSearchModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const codeMap: Record<string, string> = {
    "ko": "Korean",
    "en": "English",
    "ja": "Japanese",
    "es": "Spanish",
    "zh": "Chinese"
  };
  const targetLanguageName = codeMap[targetLanguageCode.toLowerCase()] || "English";

  const categories = [
    {
      title: "🎯 현지 미식",
      items: ["🍚 현지 식당", "🍺 현지 선술집", "☕ 현지 다방/카페", "🥐 아침 식사가 가능한 식당"]
    },
    {
      title: "🛒 현지 쇼핑",
      items: ["🛒 대형 마트 / 슈퍼마켓", "👗 빈티지 / 구제 옷가게", "🍶 주류 전문 상점", "🧸 문구 / 잡화점"]
    },
    {
      title: "🚨 편의 시설",
      items: ["🚽 대형 상업 시설", "🔌 콘센트/와이파이 제공 카페", "🧳 짐 보관소 / 코인 락커", "💊 약국"]
    }
  ];

  const handleCategoryClick = async (category: string) => {
    // 팝업 차단을 피하기 위해 클릭 즉시 새 창을 엽니다.
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map(s => s.outerHTML)
        .join('\n');
      const baseHref = window.location.origin;

      newWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>구글 지도 준비 중...</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <base href="${baseHref}">
            ${styles}
            <style>
              body { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #fcfcfc; font-family: 'KyoboHandwriting', sans-serif; }
              .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #ffcd4a; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
              p { color: #552c24; font-weight: 600; font-size: 20px; margin: 0; text-align: center; }
              .sub { color: #888; font-size: 16px; margin-top: 8px; font-weight: normal; }
            </style>
          </head>
          <body>
            <div class="spinner"></div>
            <p>최적의 현지 검색어를<br/>찾고 있습니다...</p>
            <p class="sub">잠시만 기다려주시면 구글 지도로 이동합니다.</p>
          </body>
        </html>
      `);
      newWindow.document.close();
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, targetLanguage: targetLanguageName })
      });
      const data = await res.json();
      if (data.keyword) {
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.keyword)}`;
        
        if (newWindow) {
          newWindow.location.href = url;
        }
      } else {
        if (newWindow) newWindow.close();
        alert('검색어 생성에 실패했습니다.');
      }
    } catch (e) {
      if (newWindow) newWindow.close();
      console.error(e);
      alert('오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white">
      <div className="flex justify-between items-center p-4 border-b border-[#ffcd4a]/30">
        <h2 className="text-xl font-bold flex items-center text-[#552c24]">
          <MapPin className="w-5 h-5 mr-2 text-[#ffcd4a]" />
          현지 스마트 검색
        </h2>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-[#552c24] rounded-full hover:bg-[#ffcd4a]/20 transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-[#fcfcfc]">
        {!isLoading && (
          <div className="space-y-6">
            <p className="text-[16px] text-[#552c24]/80 mb-2 leading-relaxed">
              현지인들이 실제로 사용하는 자연스러운 검색어로 구글 지도에서 원하는 장소를 바로 찾아보세요.
            </p>
            {categories.map((group, i) => (
              <div key={i}>
                <h3 className="font-semibold text-[#552c24] mb-3 text-base">{group.title}</h3>
                <div className="grid grid-cols-1 gap-2">
                  {group.items.map((item, j) => (
                    <button
                      key={j}
                      onClick={() => handleCategoryClick(item)}
                      className="text-left w-full px-4 py-4 bg-white border border-[#ffcd4a]/30 rounded-xl shadow-sm text-[#552c24] font-medium text-[16px] hover:bg-[#ffcd4a]/10 hover:border-[#ffcd4a] transition-all flex items-center justify-between"
                    >
                      <span>{item}</span>
                      <Search className="w-4 h-4 text-[#ffcd4a]" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-[#ffcd4a]" />
            <p className="text-[#552c24] font-medium text-center text-[16px]">
              최적의 현지 검색어를<br />찾고 있습니다...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
