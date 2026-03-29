const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

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
      this.ws = new WebSocket(WS_URL);
      this.ws.binaryType = 'arraybuffer';

      // Ping a cada 15s pra manter conexão viva (mobile fecha WebSocket idle)
      let pingInterval: ReturnType<typeof setInterval> | null = null;

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = event.data;

        // Binário: pode ser ArrayBuffer ou Blob dependendo do browser/mobile
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
          this.handlers.onMessage?.(msg);
        } catch {
          console.warn('Unparseable message:', data);
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
