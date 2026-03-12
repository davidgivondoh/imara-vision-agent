# Plugin System

## Overview

The Imara Vision Agent supports a plugin system that extends its capabilities without modifying the core runtime. Plugins run in sandboxed V8 isolates for safety and stability.

Plugins are available in **Desktop Agent** and **App Engine** modes. The Embedded Core does not support plugins.

---

## Plugin Lifecycle

```
Discovery → Install → Register → Initialize → Active → Uninstall
```

| Phase | What Happens |
|---|---|
| Discovery | Plugin found in registry or local `plugins/` directory |
| Install | Package downloaded and verified |
| Register | Plugin manifest validated, capabilities declared |
| Initialize | Plugin `onInit()` called, resources allocated |
| Active | Plugin responds to tasks and events |
| Uninstall | Plugin `onDestroy()` called, resources freed, files removed |

---

## Creating a Plugin

### Plugin Structure

```
my-plugin/
├── manifest.json    # Plugin metadata and capability declarations
├── index.ts         # Entry point
├── README.md        # Usage documentation
└── package.json     # Dependencies (optional)
```

### Manifest (`manifest.json`)

```json
{
  "name": "calendar-sync",
  "version": "1.0.0",
  "description": "Sync agent tasks with external calendars",
  "author": "Your Name",
  "capabilities": ["read-calendar", "create-events", "schedule-tasks"],
  "permissions": ["network", "storage"],
  "minAgentVersion": "0.1.0",
  "entryPoint": "index.ts"
}
```

### Manifest Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique plugin identifier (kebab-case) |
| `version` | Yes | Semver version string |
| `description` | Yes | Short description of what the plugin does |
| `author` | Yes | Author name or organisation |
| `capabilities` | Yes | List of capability strings the plugin provides |
| `permissions` | Yes | Sandbox permissions: `network`, `storage`, `filesystem`, `notifications` |
| `minAgentVersion` | No | Minimum compatible agent version |
| `entryPoint` | No | Entry file (default: `index.ts`) |

### Plugin Entry Point

```ts
import type { PluginContext, PluginDefinition } from '@imara/neura-sdk/plugins'

const plugin: PluginDefinition = {
  name: 'calendar-sync',
  version: '1.0.0',
  capabilities: ['read-calendar', 'create-events'],

  async onInit(context: PluginContext) {
    // Called once when the plugin is loaded
    // Use context to access agent APIs
    console.log('Calendar sync plugin initialised')
  },

  async onTask(context: PluginContext, task: TaskContext) {
    // Called when the agent routes a task to this plugin
    if (task.intent === 'schedule') {
      const events = await fetchCalendarEvents(context)
      return { availableSlots: findOpenSlots(events) }
    }
    return null // Not handled by this plugin
  },

  async onEvent(context: PluginContext, event: AgentEvent) {
    // Called on agent lifecycle events
    if (event.name === 'task.completed' && event.properties.type === 'meeting') {
      await createCalendarEntry(context, event)
    }
  },

  async onDestroy(context: PluginContext) {
    // Cleanup when plugin is unloaded
    console.log('Calendar sync plugin destroyed')
  },
}

export default plugin
```

### Plugin Context API

The `PluginContext` object gives plugins controlled access to agent systems:

```ts
interface PluginContext {
  // Agent memory (scoped to plugin namespace)
  memory: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }

  // HTTP requests (subject to network permission)
  fetch(url: string, options?: RequestInit): Promise<Response>

  // Local storage (subject to storage permission)
  storage: {
    read(path: string): Promise<string>
    write(path: string, data: string): Promise<void>
    delete(path: string): Promise<void>
  }

  // Notifications (subject to notification permission)
  notify(title: string, body: string): Promise<void>

  // Logging
  log: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }

  // Agent configuration (read-only)
  config: Record<string, unknown>
}
```

---

## Installing Plugins

### From the Registry

```bash
neura plugin install calendar-sync
```

### From a Local Directory

```bash
neura plugin install ./my-plugin
```

### From a Git Repository

```bash
neura plugin install https://github.com/user/neura-calendar-sync
```

### Via SDK

```ts
agent.plugins.register({
  name: 'calendar-sync',
  version: '1.0.0',
  capabilities: ['read-calendar', 'create-events'],

  async onTask(context) {
    if (context.intent === 'schedule') {
      const events = await this.getCalendarEvents()
      return { availableSlots: findOpenSlots(events) }
    }
  },
})
```

---

## Managing Plugins

### CLI Commands

```bash
neura plugin list                    # List installed plugins
neura plugin install <name>          # Install from registry
neura plugin install ./path          # Install from local path
neura plugin uninstall <name>        # Remove a plugin
neura plugin update <name>           # Update to latest version
neura plugin update --all            # Update all plugins
neura plugin info <name>             # Show plugin details
neura plugin enable <name>           # Enable a disabled plugin
neura plugin disable <name>          # Disable without uninstalling
```

### SDK

```ts
const plugins = await agent.plugins.list()
// [{ name: 'calendar-sync', version: '1.0.0', status: 'active' }]

await agent.plugins.install('note-taker')
await agent.plugins.uninstall('calendar-sync')
```

---

## Sandbox Security

Plugins run inside sandboxed V8 isolates with the following restrictions:

| Restriction | Enforced By |
|---|---|
| No direct filesystem access | Only `context.storage` (within plugin namespace) |
| No raw network access | Only `context.fetch` (subject to `network` permission) |
| No process spawning | Blocked at runtime level |
| Memory limit | 128 MB per plugin isolate (configurable) |
| CPU time limit | 30s per task handler (configurable) |
| No access to other plugins | Each plugin runs in its own isolate |
| No agent core modification | Only read-only config access |

### Permission Model

Plugins declare permissions in their manifest. Users approve permissions on install.

| Permission | Grants Access To |
|---|---|
| `network` | `context.fetch()` for HTTP requests |
| `storage` | `context.storage` for local file read/write |
| `filesystem` | Broader file access (requires explicit user approval) |
| `notifications` | `context.notify()` for system notifications |

---

## Built-in Plugins

The agent ships with these plugins in the `plugins/` directory:

| Plugin | Capabilities | Description |
|---|---|---|
| `note-summariser` | `summarise-notes`, `extract-topics` | Summarises captured notes and extracts key topics |
| `revision-planner` | `create-plan`, `track-progress` | Generates revision plans based on exam dates and weak areas |
| `accessibility-assist` | `adapt-ui`, `voice-control` | Adapts the agent UI based on accessibility profile |
| `environment-mapper` | `map-space`, `detect-obstacles` | Builds spatial models for navigation (ImaraPlus/Neura) |
| `communication-assist` | `draft-message`, `speak-aloud` | Assists users who need communication support |

---

## Plugin Development Best Practices

1. **Keep plugins focused.** One plugin should do one thing well. Don't bundle unrelated capabilities.

2. **Handle errors gracefully.** Return `null` from `onTask` if the plugin can't handle a task. Never throw unhandled exceptions.

3. **Respect the sandbox.** Don't try to escape the isolate or access restricted APIs. The agent will terminate misbehaving plugins.

4. **Use plugin memory.** Store state via `context.memory` rather than global variables. This persists across restarts and syncs across devices.

5. **Declare minimum permissions.** Only request the permissions you actually need. Users are more likely to trust plugins with fewer permissions.

6. **Version your manifest.** Bump the version on every release. The agent uses semver to manage updates and compatibility.

7. **Test in isolation.** Use the plugin test harness to test your plugin without a full agent running:

```bash
npm run plugin:test -- --plugin ./my-plugin
```

---

## Plugin Registry

The Neura Plugin Registry is a curated directory of community and official plugins.

### Publishing

```bash
neura plugin publish ./my-plugin
```

Requirements:
- Valid `manifest.json` with all required fields.
- No security policy violations detected by the automated scanner.
- README with usage instructions.
- Tests pass in the plugin test harness.

### Discovery

```bash
neura plugin search "calendar"
```

Or browse the registry at the Imara Vision developer portal.
