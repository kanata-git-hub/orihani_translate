import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../lib/firebaseUtils';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isApproved: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  isApproved: false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser && currentUser.email) {
        try {
          const q = query(collection(db, 'approved_users'), where('email', '==', currentUser.email));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const role = snapshot.docs[0].data().role;
            setIsApproved(true);
            setIsAdmin(role === 'admin' || currentUser.email === 'kanata840@gmail.com');
          } else {
            setIsApproved(currentUser.email === 'kanata840@gmail.com');
            setIsAdmin(currentUser.email === 'kanata840@gmail.com');
          }
        } catch (e) {
          console.error("Error checking approval status", e);
          setIsApproved(currentUser.email === 'kanata840@gmail.com');
          setIsAdmin(currentUser.email === 'kanata840@gmail.com');
        }
      } else {
        setIsApproved(false);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, isApproved }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
