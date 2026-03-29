const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

/**
 * Garante que o protocolo WS corresponda ao protocolo da página.
 * Páginas HTTPS exigem WSS — browsers mobile bloqueiam ws:// em contexto seguro.
 */
function getWsUrl(): string {
  if (typeof window === 'undefined') return WS_URL;

  // Se a página é HTTPS mas a URL do WS é ws://, converte para wss://
  if (window.location.protocol === 'https:' && WS_URL.startsWith('ws://')) {
    return WS_URL.replace('ws://', 'wss://');
  }
  // Se a página é HTTP mas a URL do WS é wss://, converte para ws://
  if (window.location.protocol === 'http:' && WS_URL.startsWith('wss://')) {
    return WS_URL.replace('wss://', 'ws://');
  }
  return WS_URL;
}

export type WSMessage = {
  type: string;
  [key: string]: unknown;
};

export type WSEventHandler = {
  onMessage?: (msg: WSMessage) => void;
  onAudio?: (data: ArrayBuffer) => void;
  onClose?: () => void;
  onError?: (err: Event) => void;
};

export class WSClient {
  private ws: WebSocket | null = null;
  private handlers: WSEventHandler;

  constructor(handlers: WSEventHandler) {
    this.handlers = handlers;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(getWsUrl());
      this.ws.binaryType = 'arraybuffer';

      // Ping a cada 10s pra manter conexão viva (mobile fecha WebSocket idle rapidamente)
      let pingInterval: ReturnType<typeof setInterval> | null = null;

      this.ws.onopen = () => {
        console.log('WebSocket connected to', getWsUrl());
        pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 10000);
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = event.data;

        // Binário direto (legacy/fallback)
        if (data instanceof ArrayBuffer) {
          this.handlers.onAudio?.(data);
          return;
        }
        if (data instanceof Blob) {
          data.arrayBuffer().then((buf) => {
            this.handlers.onAudio?.(buf);
          });
          return;
        }

        // Texto (JSON)
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'pong') return;

          // Áudio enviado como base64 dentro de JSON
          if (msg.type === 'audio' && msg.data) {
            try {
              const binaryStr = atob(msg.data as string);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              this.handlers.onAudio?.(bytes.buffer);
            } catch (e) {
              console.warn('Failed to decode audio base64:', e);
            }
            return;
          }

          this.handlers.onMessage?.(msg);
        } catch {
          console.warn('Unparseable message:', typeof data);
        }
      };

      this.ws.onclose = () => {
        if (pingInterval) clearInterval(pingInterval);
        this.handlers.onClose?.();
      };

      this.ws.onerror = (err) => {
        if (pingInterval) clearInterval(pingInterval);
        this.handlers.onError?.(err);
        reject(err);
      };
    });
  }

  send(msg: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendBinary(data: ArrayBuffer | Blob) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
