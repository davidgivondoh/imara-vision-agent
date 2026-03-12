# Deployment Guide

## Deployment Modes

The Imara Vision Agent ships as three distinct artifacts from the same codebase:

| Artifact | Target | Build Command | Output |
|---|---|---|---|
| Desktop Agent | End users (Windows, macOS, Linux) | `npm run package:<platform>` | Installer (.exe, .dmg, .AppImage) |
| App Engine | Servers, containers, cloud | `npm run engine:build` | Docker image or Node.js bundle |
| Embedded Core | Imara hardware (Pen, Overlay, ImaraPlus) | `npm run embed:build` | Lightweight runtime bundle |

---

## Desktop Agent Packaging

### Prerequisites

- Node.js 20+ and npm 10+
- Platform-specific build tools:
  - **Windows:** Visual Studio Build Tools (for native modules)
  - **macOS:** Xcode command-line tools
  - **Linux:** `dpkg`, `rpm`, or `AppImage` tooling

### Build for Current Platform

```bash
npm run package
```

### Build for Specific Platforms

```bash
npm run package:win     # Windows — produces .exe installer
npm run package:mac     # macOS — produces .dmg
npm run package:linux   # Linux — produces .AppImage and .deb
```

### Build Output

All artifacts land in `dist/`:

```
dist/
├── neura-agent-win-x64.exe
├── neura-agent-mac.dmg
├── neura-agent-linux.AppImage
└── neura-agent-linux.deb
```

### Code Signing

| Platform | Signing Method | Configuration |
|---|---|---|
| Windows | EV code signing certificate | Set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` env vars |
| macOS | Apple Developer ID | Set `CSC_LINK` and `CSC_KEY_PASSWORD`, plus notarisation credentials |
| Linux | GPG signing | Optional; set `GPG_KEY_ID` |

### Auto-Update

The desktop agent uses `electron-updater` to check for updates on launch and every 6 hours.

- **Update feed URL:** Configured in `electron.config.ts` under `publish`.
- **Channels:** `stable`, `beta`, `nightly`.
- **User control:** Users can disable auto-update via Settings or `neura config set general.autoUpdate false`.

### Distribution

| Channel | Audience | Update Frequency |
|---|---|---|
| Stable | General users | On release |
| Beta | Early adopters, testers | Weekly |
| Nightly | Internal team | Daily |

---

## App Engine Deployment

The App Engine runs the agent as a headless HTTP/WebSocket server for integration into backend services and third-party applications.

### Docker (Recommended)

```dockerfile
# Dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run engine:build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/dist/engine ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/models ./models
EXPOSE 4100
CMD ["node", "server.js"]
```

```bash
docker build -t imara-vision-agent-engine .
docker run -d \
  --name neura-engine \
  -p 4100:4100 \
  -e NEURA_CLOUD_API_KEY=your-key \
  -e NEURA_ENGINE_PORT=4100 \
  -v neura-data:/app/data \
  imara-vision-agent-engine
```

### Docker Compose

```yaml
version: '3.8'
services:
  neura-engine:
    build: .
    ports:
      - '4100:4100'
    environment:
      - NEURA_CLOUD_API_KEY=${NEURA_CLOUD_API_KEY}
      - NEURA_ENGINE_PORT=4100
      - NEURA_AUTONOMY_LEVEL=L2
      - NEURA_SYNC_ENABLED=true
    volumes:
      - neura-data:/app/data
      - neura-models:/app/models
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:4100/api/agent/health']
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  neura-data:
  neura-models:
```

### Node.js Direct

For environments where Docker is not available:

```bash
npm run engine:build
cd dist/engine
NEURA_CLOUD_API_KEY=your-key node server.js
```

### Cloud Providers

#### AWS (ECS / Fargate)

1. Push Docker image to ECR.
2. Create ECS task definition with the image.
3. Configure service with ALB for HTTP and NLB for WebSocket.
4. Set environment variables in task definition.
5. Mount EFS volume for persistent data.

#### Google Cloud (Cloud Run)

```bash
gcloud run deploy neura-engine \
  --image gcr.io/your-project/imara-vision-agent-engine \
  --port 4100 \
  --set-env-vars NEURA_CLOUD_API_KEY=your-key \
  --allow-unauthenticated
```

Note: Cloud Run does not natively support WebSocket. Use Cloud Run with HTTP/2 or deploy to GKE for full WebSocket support.

#### Azure (Container Apps)

```bash
az containerapp create \
  --name neura-engine \
  --resource-group imara-rg \
  --image imara.azurecr.io/imara-vision-agent-engine \
  --target-port 4100 \
  --env-vars NEURA_CLOUD_API_KEY=your-key \
  --ingress external
```

### Scaling

| Dimension | Strategy |
|---|---|
| Horizontal | Multiple engine instances behind a load balancer. Stateless task execution; state in shared database. |
| Vertical | Increase CPU/RAM for heavier local inference workloads. |
| Memory Store | Use external database (PostgreSQL + pgvector) for shared memory across instances. |
| Inference | Offload to dedicated inference service or GPU nodes for high-throughput workloads. |

### Environment Variables (Engine)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEURA_CLOUD_API_KEY` | Yes (for cloud inference) | — | API key for cloud LLM provider |
| `NEURA_ENGINE_PORT` | No | `4100` | HTTP server port |
| `NEURA_ENGINE_HOST` | No | `0.0.0.0` | Bind address |
| `NEURA_AUTONOMY_LEVEL` | No | `L1` | Default autonomy |
| `NEURA_SYNC_ENABLED` | No | `true` | Cloud sync for memory |
| `NEURA_DATABASE_URL` | No | `sqlite://data/neura.db` | Database connection string |
| `NEURA_CORS_ORIGINS` | No | `*` | Allowed CORS origins |
| `NEURA_LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |
| `NEURA_MAX_CONCURRENT_TASKS` | No | `10` | Max parallel tasks per instance |

---

## Embedded Core (Imara Products)

The embedded core is a stripped-down build of the agent runtime designed for resource-constrained devices.

### Build

```bash
npm run embed:build
```

Output: `dist/embed/neura-core.bundle.js` — a single-file runtime with no external dependencies.

### Integration Points

Each Imara product loads the embedded core and connects it to hardware-specific I/O through the product adapter interface.

| Product | Adapter | Host Environment |
|---|---|---|
| Imara Pen | `src/products/pen.ts` | Custom firmware (ARM Cortex) |
| Wearable Overlay | `src/products/overlay.ts` | Android-based wearable OS |
| ImaraPlus | `src/products/imara-plus.ts` | Android fork (custom ROM) |
| Neura Standalone | `src/products/neura-standalone.ts` | Android / iOS (React Native bridge) |

### Embedded Constraints

| Constraint | Desktop/Engine | Embedded |
|---|---|---|
| Runtime | Full Node.js | Minimal JS runtime or native bridge |
| Inference | ONNX + cloud fallback | On-device only (no cloud dependency) |
| Memory | SQLite + vector | Lightweight key-value store |
| Plugins | Full plugin system | No plugins (fixed capability set) |
| Telemetry | Full event stream | Batched telemetry (uploaded when connected) |

### Firmware Update Flow

```
1. New embedded core build tagged and signed
        │
        ▼
2. OTA update package created (core + adapter)
        │
        ▼
3. Device checks for updates on Wi-Fi connect
        │
        ▼
4. Download + verify signature
        │
        ▼
5. Install on next reboot (A/B partition swap)
        │
        ▼
6. Telemetry confirms successful boot
```

---

## CI/CD Pipeline

### Recommended Pipeline

```
Push to main
    │
    ├── Lint + Typecheck
    ├── Unit Tests
    ├── Integration Tests
    │
    ▼
Build Artifacts
    │
    ├── Desktop installers (Windows, macOS, Linux)
    ├── Engine Docker image
    ├── Embedded core bundle
    │
    ▼
E2E Tests (against engine in Docker)
    │
    ▼
Publish
    │
    ├── Desktop: upload to update feed (stable/beta/nightly)
    ├── Engine: push Docker image to registry
    ├── Embedded: upload to OTA server
    └── SDK: publish @imara/neura-sdk to npm
```

### GitHub Actions Example

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
      - run: npm run package
      - uses: actions/upload-artifact@v4
        with:
          name: desktop-${{ matrix.os }}
          path: dist/

  engine:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/imara-vision/neura-engine:${{ github.ref_name }}
```

---

## Monitoring

### Health Check

All deployments expose `/api/agent/health`:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime": 3600,
  "inference": "local",
  "memory": "ready",
  "activeTasks": 2,
  "completedTasks": 147
}
```

### Recommended Alerts

| Metric | Threshold | Action |
|---|---|---|
| Health check failure | 3 consecutive failures | Restart instance |
| Task failure rate | > 10% over 5 min | Investigate logs |
| Inference latency (p95) | > 5s | Check model load or cloud API |
| Memory usage | > 80% | Scale up or clean old memory entries |
| WebSocket connections | > 1000 per instance | Scale horizontally |
