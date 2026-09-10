import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { readSharedPost } from '../utils/chiikawaShare';
import HomePage from './HomePage';

export default function SharePage() {
  const { user, isApproved } = useAuth();
  const location = useLocation();
  // Keep the incoming URL in the address bar through sign-in, including reloads.
  // Only the approved app route may fetch a photo or start translation.
  if (!user || !isApproved) return <HomePage sharedPost />;
  const link = readSharedPost(location.search, location.hash);
  return <Navigate to="/app" replace state={{ chiikawaShare: {
    link: link || '',
    error: link ? '' : '공유한 내용에서 작가의 게시물 링크를 찾지 못했어요. @ngnchiikawa의 사진이 있는 게시물에서 공유해 주세요.',
  } }} />;
}
