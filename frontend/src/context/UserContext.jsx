import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";

const UserContext = createContext(null);

// Simple local "session": stores the created backend user id in localStorage.
// This is intentionally minimal -- there's no auth/login system in scope here,
// just a way to identify "which backend user am I" across page reloads.
export function UserProvider({ children }) {
  const [userId, setUserId] = useState(() => {
    const saved = localStorage.getItem("aica_user_id");
    return saved ? Number(saved) : null;
  });
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    api.getUser(userId).then(setUser).catch(() => {
      localStorage.removeItem("aica_user_id");
      setUserId(null);
    }).finally(() => setLoading(false));
  }, [userId]);

  async function createAndSetUser(data) {
    const created = await api.createUser(data);
    localStorage.setItem("aica_user_id", created.id);
    setUserId(created.id);
    setUser(created);
    return created;
  }

  async function signInWithGoogleCredential(credential) {
    const account = await api.googleSignIn(credential);
    localStorage.setItem("aica_user_id", String(account.id));
    setUserId(account.id); setUser(account);
    return account;
  }

  function logout() {
    localStorage.removeItem("aica_user_id");
    setUserId(null);
    setUser(null);
  }

  return (
    <UserContext.Provider value={{ userId, user, loading, createAndSetUser, signInWithGoogleCredential, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
