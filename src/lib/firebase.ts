import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

/**
 * Firebase web config. These values are public identifiers (not secrets); set
 * them as VITE_FIREBASE_* in .env / Vercel. When they are missing, sign-in is
 * disabled and the app works in guest mode (resumes saved in this browser).
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const authEnabled = !!(config.apiKey && config.authDomain && config.projectId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function firebaseAuth(): Auth | null {
  if (!authEnabled) return null;
  if (!auth) {
    app = initializeApp(config as Record<string, string>);
    auth = getAuth(app);
  }
  return auth;
}

/** Fresh ID token for API calls (the SDK refreshes it before it expires). */
export async function idToken(): Promise<string | null> {
  const user = firebaseAuth()?.currentUser;
  return user ? user.getIdToken() : null;
}
