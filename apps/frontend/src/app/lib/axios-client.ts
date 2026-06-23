import axios from 'axios';
import { toast } from 'sonner';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'https://votre-saas.com',
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('saas_auth_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// INTERCEPTEUR D'ERREURS GLOBAL
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    let errorMessage = "Une erreur réseau est survenue.";
    
    if (error.response) {
      // Le serveur a répondu avec un code d'erreur (4xx, 5xx)
      const status = error.response.status;
      if (status === 401) {
        errorMessage = "Session expirée. Veuillez vous reconnecter.";
        localStorage.removeItem('saas_auth_token');
        window.location.href = '/login';
      } else if (status === 403) {
        errorMessage = "Vous n'avez pas les droits pour accéder à ces données.";
      } else if (status === 500) {
        errorMessage = "Erreur interne du serveur de données.";
      }
    }

    // Affichage du toast d'alerte global
    toast.error("Erreur de chargement", {
      description: errorMessage,
    });

    return Promise.reject(error);
  }
);