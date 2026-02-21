# Oculory

VoiceAgent interface for your Lexicon knowledge base.

## Quick Start

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your API keys
```

3. **Start Convex dev server:**
```bash
npx convex dev
```

4. **Sync your Lexicon data:**
```bash
npm run sync
```

5. **Start the voice agent (CLI mode):**
```bash
npm run voice
```

## Project Structure

```
oculory/
├── convex/                  # Convex backend
│   ├── schema.ts           # Database schema
│   ├── knowledge/          # RAG functions
│   └── invites.ts         # Invitation system
├── voice-agent/            # Voice service
│   └── service.ts         # VAPI + MiniMax
├── web/                    # Web interface
│   └── app.ts            # Invite page
├── .temporal/scripts/
│   └── sync-lexicon.ts   # Sync Lexicon files
└── .env.example           # Environment config
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| CONVEX_URL | Convex dev server URL |
| MINIMAX_API_KEY | MiniMax API key for LLM |
| VAPI_API_KEY | VAPI API key for voice |
| LEXICON_PATH | Path to Lexicon folder |

## How It Works

1. **Sync**: Lexicon files → Convex (with layer metadata)
2. **Query**: Voice → VAPI → MiniMax → Layer-based RAG
3. **Security**: ArmorIQ policies (optional)

## Layer-Based RAG

The RAG system mirrors your Lexicon search rules:

1. **Memory/** - Most distilled (search FIRST)
2. **People/** - Per-person (if about person)
3. **Meetings/** - Structured evidence
4. **Metadata/** - Registries
5. **Transcripts/** - Raw (last resort)
