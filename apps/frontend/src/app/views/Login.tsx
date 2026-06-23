import { useAuthStore } from '@/store/useAuthStore';
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';

import { toast } from 'sonner';
import { apiClient } from '../lib/axios-client';

export default function Login(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const loginStore = useAuthStore((state) => state.login);

  const navigate = useNavigate();
  const location = useLocation();

  // Récupère la page d'origine ou redirige vers le dashboard par défaut
  const from = (location.state as any)?.from?.pathname || '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Simulation de l'appel API d'authentification
      const response = await apiClient.post('/auth/login', { email, password });
      const { user, token } = response.data;

      // Injection dans le store global
      loginStore(user, token);

      toast.success('Connexion réussie');
      navigate(from, { replace: true });
    } catch (error) {
      // L'intercepteur Axios gère déjà l'affichage du toast d'erreur
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-800 p-8 rounded-xl max-w-sm w-full space-y-4"
      >
        <h2 className="text-xl font-bold text-white">Connexion SaaS</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white"
          required
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white"
          required
        />
        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded p-2 text-sm font-semibold"
        >
          Se connecter
        </button>
      </form>
    </div>
  );
}
