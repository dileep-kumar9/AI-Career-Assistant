import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { authEnabled, firebaseAuth } from '@/lib/firebase';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/sessions';

interface AuthState {
  enabled: boolean;
  user: User | null;
  loading: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (name: string, email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/** Moves resumes created in this browser before signing in into the account. */
async function claimLocalResumes() {
  for (const s of sessionStore.list()) {
    try {
      await api.claim(s.id);
    } catch {
      /* already owned, expired or deleted — skip */
    }
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(authEnabled);

  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) claimLocalResumes();
    });
  }, []);

  const value = useMemo<AuthState>(() => {
    const auth = () => {
      const a = firebaseAuth();
      if (!a) throw new Error('Sign-in is not configured.');
      return a;
    };
    return {
      enabled: authEnabled,
      user,
      loading,
      signInEmail: async (email, password) => {
        await signInWithEmailAndPassword(auth(), email, password);
      },
      signUpEmail: async (name, email, password) => {
        const cred = await createUserWithEmailAndPassword(auth(), email, password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      },
      signInGoogle: async () => {
        await signInWithPopup(auth(), new GoogleAuthProvider());
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth(), email);
      },
      signOut: async () => {
        await fbSignOut(auth());
        // Account resumes stay in the account; forget this browser's copies of the links.
        for (const s of sessionStore.list()) sessionStore.remove(s.id);
      },
    };
  }, [user, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Friendly text for Firebase auth error codes. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with this email. Create one instead.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'That email address is not valid.',
    'auth/too-many-requests': 'Too many attempts. Please wait a minute and try again.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in pop-up. Allow pop-ups for this site and try again.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/unauthorized-domain': 'This domain is not authorised for sign-in yet (add it in Firebase → Authentication → Settings → Authorized domains).',
  };
  return map[code] || (e instanceof Error ? e.message : 'Sign-in failed.');
}
