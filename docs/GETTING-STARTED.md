# Getting Started

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| Node.js | 20.x LTS | 22.x LTS |
| npm | 10.x | Latest |
| OS | Windows 10, macOS 12, Ubuntu 22.04 | Windows 11, macOS 14, Ubuntu 24.04 |
| RAM | 8 GB | 16 GB |
| Disk | 4 GB free | 10 GB free (with local models) |
| GPU | Not required | CUDA-capable GPU for faster local inference |

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/imara-vision/imara-vision-agent.git
cd imara-vision-agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Download Local Models (Optional)

For on-device inference without cloud calls:

```bash
npm run models:download
```

This fetches the default ONNX model set (~2 GB) into the `models/` directory. Skip this step if you plan to use cloud inference only.

### 4. Configure Environment

Create a `.env.local` file in the project root:

```bash
# Required for cloud inference
NEURA_CLOUD_API_KEY=your-anthropic-api-key

# Optional: override defaults
NEURA_AUTONOMY_LEVEL=L1
NEURA_SYNC_ENABLED=false
NEURA_TELEMETRY=false
```

See [ARCHITECTURE.md — Configuration Hierarchy](ARCHITECTURE.md#configuration-hierarchy) for all available options.

---

## Running the Agent

### Desktop Agent (Development)

```bash
npm run dev
```

This starts the Electron app in development mode with hot reload. The agent appears in your system tray.

### Desktop Agent (Production Build)

```bash
npm run build
npm run agent:start
```

### App Engine (Headless Server)

```bash
npm run engine:start
```

The engine starts an HTTP server on `http://localhost:4100` by default. Override with `NEURA_ENGINE_PORT`.

```bash
NEURA_ENGINE_PORT=8080 npm run engine:start
```

### App Engine (Docker)

```bash
docker build -t imara-vision-agent .
docker run -p 4100:4100 -e NEURA_CLOUD_API_KEY=your-key imara-vision-agent
```

---

## First-Run Setup

On first launch the agent walks you through:

| Step | What Happens |
|---|---|
| 1. Authentication | Sign in with your Imara account or create one. Offline mode skips this. |
| 2. Permissions | Grant file access, notifications, and accessibility permissions (desktop only). |
| 3. Preferences | Set autonomy level (L0–L4), theme, and sync preferences. |
| 4. Ready | Agent runs in the background. Open from system tray (desktop) or call the API (engine). |

---

## Verify Installation

### Desktop

1. Look for the Neura icon in your system tray.
2. Click it and select **Status**. You should see `Agent: running`.

### App Engine

```bash
curl http://localhost:4100/api/agent/health
```

Expected response:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime": 12,
  "inference": "local",
  "memory": "ready"
}
```

### CLI

```bash
neura status
```

Expected output:

```
Neura Agent v0.1.0
Status:    running
Inference: local (onnx-v1)
Memory:    42 entries
Sync:      enabled (last: 2 min ago)
Tasks:     0 active, 12 completed
```

---

## Running Tests

```bash
# Unit and integration tests
npm test

# End-to-end tests (requires running agent)
npm run test:e2e

# Watch mode during development
npm run test:watch
```

---

## Project Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start desktop agent in dev mode |
| `npm run build` | Production build |
| `npm run agent:start` | Launch production desktop agent |
| `npm run engine:start` | Launch app engine server |
| `npm test` | Run unit + integration tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run test:watch` | Watch mode for tests |
| `npm run lint` | Lint source files |
| `npm run typecheck` | TypeScript type checking |
| `npm run models:download` | Download local ONNX models |
| `npm run package:win` | Package for Windows (.exe) |
| `npm run package:mac` | Package for macOS (.dmg) |
| `npm run package:linux` | Package for Linux (.AppImage, .deb) |

---

## Directory Orientation

| Path | What's There |
|---|---|
| `src/core/` | Agent loop, scheduler, memory, policy, telemetry |
| `src/inference/` | Local ONNX + cloud API inference |
| `src/plugins/` | Plugin host and registry |
| `src/desktop/` | Electron shell, tray, UI |
| `src/engine/` | App engine HTTP/WS server |
| `src/products/` | Imara product adapters (Pen, Overlay, ImaraPlus) |
| `src/shared/` | Types, config, utilities |
| `plugins/` | Built-in plugins |
| `models/` | Local ONNX model files |
| `docs/` | Documentation |
| `tests/` | Test suites |
| `scripts/` | Build and packaging scripts |

---

## Common Issues

### `ENOENT: no such file or directory, open 'package.json'`

You are in the wrong directory. Make sure you `cd` into the project root.

### `Module not found`

Run `npm install` to install missing dependencies.

### Port already in use (engine mode)

Another process is using port 4100. Either stop it or override:

```bash
NEURA_ENGINE_PORT=4101 npm run engine:start
```

### Local inference slow or failing

- Check that models are downloaded: `ls models/`
- Ensure sufficient RAM (8 GB minimum).
- If using GPU: verify CUDA drivers are installed.
- Fallback: set `NEURA_PREFER_LOCAL=false` to use cloud inference.

### Agent not appearing in system tray

- **Windows:** Check the hidden icons area in the taskbar.
- **macOS:** Grant accessibility permissions in System Settings > Privacy & Security.
- **Linux:** Ensure your desktop environment supports system tray (e.g., GNOME with AppIndicator extension).

---

## Next Steps

- [Architecture](ARCHITECTURE.md) — Understand the system design in depth.
- [SDK Reference](SDK-REFERENCE.md) — Integrate the agent into your app.
- [Plugin System](PLUGIN-SYSTEM.md) — Extend the agent with custom plugins.
- [Deployment](DEPLOYMENT.md) — Package and deploy for production.
