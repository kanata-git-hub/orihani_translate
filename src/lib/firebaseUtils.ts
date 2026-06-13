import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "gen-lang-client-0165298283",
  appId: "1:610824131458:web:4fbc61e7216a4af4e0b59b",
  apiKey: "AIzaSyCtEbU2W0VZdxN45JVOdYtaxwe5tSg2bjY",
  authDomain: "gen-lang-client-0165298283.firebaseapp.com",
  // We don't define databaseURL or others if we rely on defaults, but firestore uses config
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use custom db if necessary, but firestore rule might be default
export const db = getFirestore(app, "ai-studio-17ef26a9-06ef-4913-97a0-d4e053a01777");

const provider = new GoogleAuthProvider();

export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error: any) {
    if (error.code === 'auth/unauthorized-domain') {
      alert("도메인이 승인되지 않았습니다. 관리자이신 경우 Firebase 콘솔에서 도메인을 추가하시거나,\\n사용자이신 경우 '새 탭에서 열기'를 사용해 주세요.");
    } else {
      console.error("Login failed:", error);
      alert(`로그인 실패: ${error.message}`);
    }
    throw error;
  }
};

export const logout = () => signOut(auth);
