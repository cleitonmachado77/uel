# UEL Connect

Tradução de aulas em tempo real para alunos estrangeiros da UEL.

## Arquitetura

```
Professor (mic) → WebSocket → Backend Pipeline → WebSocket → Aluno (fones)
                                  │
                          STT (Whisper/OpenAI)
                          Tradução (Google Translate)
                          TTS (Google Cloud TTS)
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
- Chave de API OpenAI (para Whisper STT)
- Credenciais Google Cloud (Translation + TTS)

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
2. Áudio é capturado via MediaRecorder (blocos de ~500ms) e enviado via WebSocket
3. Backend processa: Whisper STT → Google Translate → Google TTS
4. Áudio traduzido é enviado via WebSocket para alunos conectados
5. Aluno acessa `/student`, escolhe idioma alvo, entra na sessão e ouve pelo player
