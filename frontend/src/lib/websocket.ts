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

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.handlers.onAudio?.(event.data);
        } else {
          try {
            const msg = JSON.parse(event.data);
            this.handlers.onMessage?.(msg);
          } catch {
            console.warn('Unparseable message:', event.data);
          }
        }
      };

      this.ws.onclose = () => {
        this.handlers.onClose?.();
      };

      this.ws.onerror = (err) => {
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
