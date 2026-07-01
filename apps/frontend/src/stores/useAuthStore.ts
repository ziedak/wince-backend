import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  organizationId: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStoreOld = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('saas_auth_token'),
  isAuthenticated: !!localStorage.getItem('saas_auth_token'),

  login: (user, token) => {
    localStorage.setItem('saas_auth_token', token);
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('saas_auth_token');
    set({ user: null, token: null, isAuthenticated: false });
  },
}));
