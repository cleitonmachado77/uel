# UEL Connect

Tradução de aulas em tempo real para alunos estrangeiros da UEL.

## Arquitetura

```
Professor (mic) → WebSocket → Backend Pipeline → WebSocket → Aluno (fones)
                                  │
                          STT (Deepgram Nova-3)
                          Tradução (DeepL)
                          TTS (Inworld AI 1.5 Max)
```

## Estrutura

```
uel-connect/
├── frontend/    # Next.js 14 + Tailwind (PWA)
├── backend/     # Node.js + WebSocket + Pipeline IA
└── package.json # Workspace root
```

## Setup

### Pré-requisitos
- Node.js 18+
- Chave de API Deepgram (STT)
- Chave de API DeepL (Tradução)
- Chave de API Inworld AI (TTS)

### Backend

```bash
cp backend/.env.example backend/.env
# Edite backend/.env com suas chaves de API
```

### Frontend

```bash
cp frontend/.env.local.example frontend/.env.local
```

### Instalação e execução

```bash
cd uel-connect
npm install
npm run dev
```

O backend roda em `http://localhost:3001` e o frontend em `http://localhost:3000`.

## Cores do projeto

| Cor | Hex | Uso |
|-----|-----|-----|
| Verde | `#01884d` | Primária |
| Amarelo | `#fce029` | Secundária |
| Azul | `#004aad` | Terciária |

## Fluxo

1. Professor acessa `/professor`, configura nome/disciplina/idioma e inicia transmissão
2. Áudio é capturado via MediaRecorder (blocos de ~2s) e enviado via WebSocket
3. Backend processa: Deepgram STT → DeepL Translate → Inworld AI TTS
4. Áudio traduzido é enviado via WebSocket para alunos conectados
5. Aluno acessa `/student`, escolhe idioma alvo, entra na sessão e ouve pelo player
