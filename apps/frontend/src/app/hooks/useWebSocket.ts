import { useEffect, useRef } from 'react';

// Interface générique pour rendre le hook compatible avec n'importe quel type de payload SaaS
interface UseWebSocketOptions<T> {
  url: string;
  onMessage: (data: T) => void;
  onError?: (error: Event) => void;
}

export function useWebSocket<T>({ url, onMessage, onError }: UseWebSocketOptions<T>): void {
  // Utilisation d'une ref pour le callback afin d'éviter de recréer la connexion WebSocket 
  // si la fonction onMessage change d'identité lors d'un re-render du composant parent.
  const messageCallbackRef = useRef(onMessage);

  useEffect(() => {
    messageCallbackRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const parsedData = JSON.parse(event.data) as T;
        messageCallbackRef.current(parsedData);
      } catch (err) {
        console.error('Erreur lors du parsing du message WebSocket:', err);
      }
    };

    ws.onerror = (event: Event) => {
      if (onError) {
        onError(event);
      } else {
        console.error('Erreur WebSocket détectée sur la route:', url);
      }
    };

    // Nettoyage automatique : ferme la connexion dès que le composant qui utilise le hook est démonté
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [url, onError]);
}