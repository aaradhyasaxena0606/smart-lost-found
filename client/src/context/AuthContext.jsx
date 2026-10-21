/**
 * Authentication context.
 *
 * Holds the current user and token, restores the session from localStorage on
 * startup by calling GET /auth/me, and exposes login/register/logout. The backend
 * remains the authority: this context only decides what the UI shows.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/endpoints.js';
import { getToken, setToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  const loadProfile = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setStatus('anonymous');
      return null;
    }
    try {
      const { data } = await authApi.me();
      setUser(data);
      setStatus('authenticated');
      return data;
    } catch {
      // An expired or invalid token means the session is over.
      setToken(null);
      setUser(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const login = useCallback(async (credentials) => {
    const { data } = await authApi.login(credentials);
    setToken(data.token);
    const profile = await authApi.me();
    setUser(profile.data);
    setStatus('authenticated');
    return profile.data;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await authApi.register(payload);
    setToken(data.token);
    const profile = await authApi.me();
    setUser(profile.data);
    setStatus('authenticated');
    return profile.data;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
      refresh: loadProfile,
    }),
    [user, status, login, register, logout, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}

export default AuthContext;
