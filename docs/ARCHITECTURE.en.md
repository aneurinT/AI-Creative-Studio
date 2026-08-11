# AI Creative Studio - Architecture Design

> Version: v2.0 | Updated: 2026-08-11

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    External Integration Layer                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────────┐ │
│  │ A2A      │ │ Douyin/  │ │ DingTalk │ │ LangGraph/CrewAI    │ │
│  │ Protocol │ │ Kuaishou │ │ Feishu   │ │ External Agent Ops  │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                │
┌──────────────────────────────────────────────────────────────────┐
│                    Frontend (React 18 + Vite + TailwindCSS)       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ AI Chat  │ │ Image/   │ │ OCR/BG   │ │ Social/Office      │  │
│  │ Assistant│ │ Video    │ │ Remove   │ │ Integration Panel  │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                                │ HTTP / SSE
┌──────────────────────────────────────────────────────────────────┐
│                    Backend (Express + TypeScript)                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Core Agent Engine                         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │ │
│  │  │ Hermes   │  │ Review   │  │ Orches-  │  │ Model    │   │ │
│  │  │ Intent   │→ │ Agent    │→ │ trator   │→ │ Router   │   │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ MCP Registry │ │ Memory System│ │ RAG Knowledge            │ │
│  │ 8 Tools      │ │ Short/Long   │ │ Vector+Keyword Hybrid    │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ A2A Service  │ │ Collab Svc   │ │ Concurrency Protection   │ │
│  │ Agent Card   │ │ Room/Lock    │ │ Rate/Circuit/Timeout     │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Social Media │ │ Office Tools │ │ Quota/Log/DB             │ │
│  │ Douyin/KS/   │ │ DingTalk/FS/ │ │ 9 Tables + Daily Logs    │ │
│  │ XHS          │ │ WeCom        │ │                          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                │
┌──────────────────────────────────────────────────────────────────┐
│                    External AI Model Layer                        │
│  GLM-4V │ DeepSeek V4 │ Wanxiang │ Volcengine │ Seedance │ Agnes │
│       LTX │ CogView-4 │ Trae AI │ ocr.space                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Agent Collaboration System

### 2.1 Five-Agent Collaboration Chain

```
User Input
  │
  ├─ Hermes Agent (Intent Recognition)
  │    ├─ Reasoning model first (DeepSeek-V4-Pro / GLM-Z1)
  │    ├─ Instruction model fallback (GLM-4-Flash)
  │    └─ Local fallback as last resort
  │
  ├─ Review Agent (Quality Check)
  │    ├─ Script review (video-review) — 5-item checklist
  │    ├─ Parameter review — chain-of-thought reasoning
  │    └─ Final result review
  │
  ├─ Orchestrator (Scheduling)
  │    ├─ Parallel judgment (sequential / parallel / hybrid)
  │    ├─ Dynamic scheduling (by dependency)
  │    └─ Retry with exponential backoff (1s→2s→4s, max 3)
  │
  └─ Execution Agents
       ├─ StoryWriter (story creation → video script)
       ├─ VideoMaker (param extraction → storyboard, ≤18s per segment)
       └─ ImageCreator (image params → prompt optimization)
```

### 2.2 Agent Context Construction

Each agent's context is built from the following layers:

```
System Prompt (role + available tools)
  ├─ Long-term Memory (vector recall top-3 relevant experiences)
  ├─ Short-term Memory (last 10 conversation turns in session)
  ├─ Other Agent Context (shared context snapshots)
  ├─ Task History (previous task params and results)
  └─ RAG Knowledge (vector + keyword hybrid retrieval)
```

---

## 3. Core Service Modules

### 3.1 Service Layer Architecture

```
api/services/
├── orchestrator.ts          # Agent scheduling orchestrator
├── agentMemory.ts           # Short/long-term memory system
├── modelRouter.ts           # Smart model router (4-tier)
├── toolRegistry.ts          # MCP protocol + tool registry
├── llmConfig.ts             # LLM model unified config
├── imageService.ts          # Image/video model service
├── embeddingService.ts      # Vector embedding service
├── vectorStore.ts           # Vector storage
├── ragKnowledge.ts          # RAG knowledge retrieval
├── reviewAgent.ts           # Content review agent
├── videoReviewAgent.ts      # Video three-tier review
├── a2aService.ts            # A2A protocol service [NEW]
├── socialMediaService.ts    # Social media publishing [NEW]
├── officeService.ts         # Office tools integration [NEW]
├── collaborationService.ts  # Multi-user collaboration
├── concurrencyService.ts    # High-concurrency protection
├── quotaService.ts          # Quota management
├── sseService.ts            # SSE streaming output
├── database.ts              # JSON file database
├── loggerService.ts         # Structured logging
└── ...                      # Other services
```

### 3.2 Smart Model Router

4-tier routing strategy with 6-dimensional auto-decision:

| Complexity | Model | Scenario |
|------------|-------|----------|
| **simple** | Local RAG | Simple Q&A, keyword matching |
| **medium** | GLM-4-Flash (Zhipu) | Intent recognition, param extraction, review |
| **complex** | DeepSeek-V4-Pro | Multi-turn context fusion, deep reasoning |
| **vision** | GLM-4V-Flash (Zhipu) | Multimodal visual understanding |

### 3.3 Memory System

```
Working Memory
  └─ Current conversation context, real-time available

Episodic Memory
  └─ Historical interaction records, auto-compress at 15 turns, keep last 5

Semantic Memory
  └─ Vectorized knowledge base (Zhipu Embedding-2), cosine similarity search

Procedural Memory
  └─ Review agent self-learning, records user corrections, 7-day validity
```

---

## 4. Integration Layer Architecture

### 4.1 A2A Protocol Layer

```
External Agent Request
  │
  ├─ Agent Card Discovery
  │    └─ GET /.well-known/agent-card.json
  │
  └─ Task API
       ├─ POST /api/a2a/tasks (create task)
       ├─ GET /api/a2a/tasks/:id (query status)
       ├─ DELETE /api/a2a/tasks/:id (cancel task)
       ├─ POST /api/a2a/tasks/:id/messages (append message)
       └─ GET /api/a2a/tasks/:id/artifacts (get artifacts)
```

### 4.2 Social Media Publishing Layer

```
AI Creative Generation
  │
  ├─ Generate image/video
  │
  └─ One-Click Publish
       ├─ POST /api/social/publish/douyin
       ├─ POST /api/social/publish/kuaishou
       └─ POST /api/social/publish/xiaohongshu
```

### 4.3 Office Tools Notification Layer

```
AI Task Complete
  │
  └─ Auto-notify office platforms
       ├─ POST /api/office/send/dingtalk
       ├─ POST /api/office/send/feishu
       └─ POST /api/office/send/wecom
```

---

## 5. Data Flow Design

### 5.1 Image Generation Flow

```
User Input → Hermes Intent Recognition → Review Agent Check
  → Orchestrator schedules ImageCreator
  → Model Router selects engine (Trae AI / Wanxiang / CogView-4 / Volcengine)
  → imageService calls API → Review Agent final check
  → Return result → Optional: auto-publish to social media
```

### 5.2 Video Generation Flow

```
User Input → Hermes Intent Recognition → Review Agent Script Check
  → Orchestrator schedules StoryWriter to generate script
  → VideoMaker extracts params + storyboard detection
  → Model Router selects engine (Agnes / CogVideoX / Seedance / Wanxiang / LTX)
  → Long video auto-split → parallel generation → merge
  → Review Agent final check → Return result
  → Optional: office platform notification + social media auto-publish
```

---

## 6. Deployment Architecture

### 6.1 Docker Compose

```
┌──────────────────────────────────────┐
│              Nginx (80)              │
│   Static files + API reverse proxy   │
└──────────────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼──────┐    ┌───────▼──────┐
│ Backend  │    │ LTX Server   │
│ Express  │    │ FastAPI      │
│ :3001    │    │ :8000 (GPU)  │
└──────────┘    └──────────────┘
```

### 6.2 Deployment Options

| Option | Use Case | Command |
|--------|----------|---------|
| Docker Compose | Production | `docker-compose up -d` |
| Electron Desktop | Personal | `pnpm electron:build` |
| Vercel Serverless | Lightweight | `pnpm dist` |
| Traditional | Custom | `pnpm dev` |

---

## 7. Security Design

- **JWT Authentication**: Whitelist + route guard, auth routes and static resources exempt
- **Concurrency Protection**: Sliding window rate limiting + LLM call queue + circuit breaker + timeout
- **Quota Management**: Per-model daily/total limits to prevent API abuse
- **A2A Security**: Bearer token authentication, Agent Card only exposes capability descriptions
- **Social Media**: OAuth 2.0 authorization, tokens stored with local encryption
- **Office Tools**: Webhook method, tokens managed via environment variables