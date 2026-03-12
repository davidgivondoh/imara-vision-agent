import { AgentInstance } from '../engine/agent-instance.js'
import { createInterface, type Interface as RLInterface } from 'readline'

// Suppress internal log noise in desktop mode — the CLI provides its own output
process.env.NEURA_LOG_LEVEL = process.env.NEURA_LOG_LEVEL ?? 'warn'
import {
  loadMemory, saveMemory,
  loadHistory, saveTaskToHistory,
  loadPersistedConfig, setConfigValue, getConfigValue,
  getNeuraDir,
} from './persistence.js'
import type { UserRole } from '../shared/types.js'
import { createLogger } from '../shared/logger.js'

const log = createLogger('desktop')

// ── Visual Formatting ───────────────────────────────────────

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const MAGENTA = '\x1b[35m'

const STAGE_ICONS: Record<string, string> = {
  sense: `${CYAN}[sense]${RESET}`,
  interpret: `${MAGENTA}[interpret]${RESET}`,
  plan: `${YELLOW}[plan]${RESET}`,
  act: `${GREEN}[act]${RESET}`,
  verify: `${CYAN}[verify]${RESET}`,
  adapt: `${DIM}[adapt]${RESET}`,
}

function printBanner(): void {
  console.log('')
  console.log(`  ${BOLD}Imara Vision Agent${RESET}  ${DIM}v0.1.0${RESET}`)
  console.log(`  ${DIM}Assistive AI for inclusive learning & independent living${RESET}`)
  console.log('')
  console.log(`  ${DIM}Type any instruction to run a task, or use a command:${RESET}`)
  console.log(`  ${DIM}  help, status, tasks, memory, history, plugins,${RESET}`)
  console.log(`  ${DIM}  remember, forget, recommend, config, clear, exit${RESET}`)
  console.log('')
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatConfidence(c: number): string {
  const pct = (c * 100).toFixed(0)
  if (c >= 0.85) return `${GREEN}${pct}%${RESET}`
  if (c >= 0.65) return `${YELLOW}${pct}%${RESET}`
  return `${RED}${pct}%${RESET}`
}

function formatStatus(status: string): string {
  switch (status) {
    case 'completed': return `${GREEN}completed${RESET}`
    case 'running': return `${CYAN}running${RESET}`
    case 'failed': return `${RED}failed${RESET}`
    case 'cancelled': return `${DIM}cancelled${RESET}`
    case 'queued': return `${YELLOW}queued${RESET}`
    default: return status
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  printBanner()

  // Load persisted config overrides
  const persistedConfig = loadPersistedConfig()
  const agent = new AgentInstance({ product: 'desktop', configOverrides: persistedConfig })

  // Load persisted memory
  const savedMemory = loadMemory()
  if (savedMemory.length > 0) {
    agent.memory.loadEntries(savedMemory)
    console.log(`  ${DIM}Loaded ${savedMemory.length} memories from previous sessions${RESET}`)
  }

  // Auto-save memory on changes (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  agent.memory.onChanged(async () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      const entries = await agent.memory.export()
      saveMemory(entries)
    }, 500)
  })

  await agent.start()

  const { autonomyLevel } = agent.config.agent
  const inf = agent.inference.getStatus()
  console.log(`  ${DIM}Autonomy: ${autonomyLevel} | Inference: ${inf.preferred} | Plugins: ${agent.plugins.count}${RESET}`)
  console.log(`  ${DIM}Data dir: ${getNeuraDir()}${RESET}`)
  console.log('')

  // Subscribe to real-time step events
  agent.bus.on('task.step', (event: unknown) => {
    const data = event as { taskId: string; step: { type: string; description: string; durationMs: number } }
    const icon = STAGE_ICONS[data.step.type] ?? `[${data.step.type}]`
    console.log(`  ${icon} ${data.step.description} ${DIM}${formatDuration(data.step.durationMs)}${RESET}`)
  })

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = () => {
    rl.question(`\n${BOLD}neura>${RESET} `, async (input) => {
      const trimmed = input.trim()
      if (!trimmed) {
        prompt()
        return
      }

      try {
        await handleInput(trimmed, agent, rl)
      } catch (err) {
        console.error(`  ${RED}Error: ${err instanceof Error ? err.message : 'Unknown error'}${RESET}`)
      }

      prompt()
    })
  }

  prompt()

  const shutdown = async () => {
    console.log(`\n  ${DIM}Saving memory and shutting down...${RESET}`)
    const entries = await agent.memory.export()
    saveMemory(entries)
    rl.close()
    await agent.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
}

// ── Command Router ──────────────────────────────────────────

async function handleInput(input: string, agent: AgentInstance, rl: RLInterface) {
  const parts = input.split(/\s+/)
  const command = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ')

  switch (command) {
    case 'exit':
    case 'quit': {
      console.log(`  ${DIM}Saving memory...${RESET}`)
      const entries = await agent.memory.export()
      saveMemory(entries)
      console.log(`  Goodbye!`)
      rl.close()
      await agent.stop()
      process.exit(0)
      break
    }

    case 'help':
      printHelp()
      break

    case 'status':
      printStatus(agent)
      break

    case 'tasks':
      printTasks(agent)
      break

    case 'history':
      printHistory()
      break

    case 'memory':
      await printMemory(agent, args)
      break

    case 'remember':
      await handleRemember(agent, args)
      break

    case 'forget':
      await handleForget(agent, args)
      break

    case 'recommend':
      await handleRecommend(agent, args)
      break

    case 'plugins':
      printPlugins(agent)
      break

    case 'config':
      handleConfig(args)
      break

    case 'clear':
      console.clear()
      printBanner()
      break

    default:
      await runTask(input, agent)
      break
  }
}

// ── Commands ────────────────────────────────────────────────

function printHelp(): void {
  console.log('')
  console.log(`  ${BOLD}Commands${RESET}`)
  console.log('')
  console.log(`  ${CYAN}status${RESET}                      Agent health, inference, and stats`)
  console.log(`  ${CYAN}tasks${RESET}                       List recent tasks from this session`)
  console.log(`  ${CYAN}history${RESET}                     List tasks from previous sessions`)
  console.log(`  ${CYAN}memory${RESET}                      Show all memory entries`)
  console.log(`  ${CYAN}memory search <query>${RESET}       Search memory for a keyword`)
  console.log(`  ${CYAN}remember <key> = <value>${RESET}    Store a fact in long-term memory`)
  console.log(`  ${CYAN}forget <keyword>${RESET}            Delete matching memory entries`)
  console.log(`  ${CYAN}recommend <intent>${RESET}          Get recommendations for an intent`)
  console.log(`  ${CYAN}plugins${RESET}                     List active plugins`)
  console.log(`  ${CYAN}config get <key>${RESET}            Read a config value`)
  console.log(`  ${CYAN}config set <key> <value>${RESET}    Set and persist a config value`)
  console.log(`  ${CYAN}clear${RESET}                       Clear the screen`)
  console.log(`  ${CYAN}exit${RESET}                        Save memory and shut down`)
  console.log('')
  console.log(`  ${DIM}Or type any instruction to create and run a task.${RESET}`)
  console.log(`  ${DIM}Examples:${RESET}`)
  console.log(`  ${DIM}  Summarise my physics notes${RESET}`)
  console.log(`  ${DIM}  Generate a practice quiz for biology${RESET}`)
  console.log(`  ${DIM}  Plan my revision for the March exam${RESET}`)
  console.log(`  ${DIM}  Navigate to the library${RESET}`)
}

function printStatus(agent: AgentInstance): void {
  const health = agent.health()
  const tasks = health.tasks as { total: number; running: number; queued: number; completed: number; failed: number }

  console.log('')
  console.log(`  ${BOLD}Imara Vision Agent${RESET} ${DIM}v${health.version}${RESET}`)
  console.log('')
  console.log(`  Status:     ${health.status === 'healthy' ? `${GREEN}healthy${RESET}` : `${RED}${health.status}${RESET}`}`)
  console.log(`  Uptime:     ${formatDuration((health.uptime as number) * 1000)}`)
  console.log(`  Inference:  ${health.inference} ${DIM}(local: ${health.inferenceLocal}, cloud: ${health.inferenceCloud})${RESET}`)
  console.log(`  Memory:     ${health.memory} entries`)
  console.log(`  Plugins:    ${health.plugins} active`)
  console.log(`  Tasks:      ${GREEN}${tasks.completed}${RESET} completed, ${CYAN}${tasks.running}${RESET} running, ${RED}${tasks.failed}${RESET} failed`)
  console.log(`  Data dir:   ${DIM}${getNeuraDir()}${RESET}`)
}

function printTasks(agent: AgentInstance): void {
  const tasks = agent.scheduler.listTasks({ limit: 15 })
  if (tasks.length === 0) {
    console.log(`  ${DIM}No tasks in this session.${RESET}`)
    return
  }
  console.log('')
  for (const task of tasks) {
    const status = formatStatus(task.status)
    const confidence = task.result ? ` ${formatConfidence(task.result.confidence)}` : ''
    const duration = task.result ? ` ${DIM}${formatDuration(task.result.durationMs)}${RESET}` : ''
    console.log(`  ${status}${confidence}${duration}  ${task.instruction.slice(0, 60)}`)
  }
}

function printHistory(): void {
  const history = loadHistory()
  if (history.length === 0) {
    console.log(`  ${DIM}No task history yet.${RESET}`)
    return
  }

  console.log(`\n  ${BOLD}Task History${RESET} ${DIM}(${history.length} entries)${RESET}\n`)

  for (const entry of history.slice(0, 20)) {
    const status = formatStatus(entry.status)
    const confidence = formatConfidence(entry.confidence)
    const date = new Date(entry.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    console.log(`  ${DIM}${date}${RESET}  ${status} ${confidence}  ${entry.instruction.slice(0, 50)}`)
  }

  if (history.length > 20) {
    console.log(`  ${DIM}... and ${history.length - 20} more${RESET}`)
  }
}

async function printMemory(agent: AgentInstance, args: string): Promise<void> {
  if (args.startsWith('search ')) {
    const query = args.slice(7).trim()
    if (!query) {
      console.log(`  ${DIM}Usage: memory search <query>${RESET}`)
      return
    }
    const results = await agent.memory.search(query, { limit: 10 })
    if (results.length === 0) {
      console.log(`  ${DIM}No matches for "${query}".${RESET}`)
      return
    }
    console.log(`\n  ${BOLD}Memory search: "${query}"${RESET} ${DIM}(${results.length} results)${RESET}\n`)
    for (const entry of results) {
      console.log(`  ${CYAN}[${entry.type}]${RESET} ${BOLD}${entry.key}${RESET}: ${entry.value.slice(0, 70)}`)
    }
    return
  }

  const entries = await agent.memory.export()
  if (entries.length === 0) {
    console.log(`  ${DIM}Memory is empty. Use "remember" to store facts.${RESET}`)
    return
  }

  console.log(`\n  ${BOLD}Agent Memory${RESET} ${DIM}(${entries.length} entries)${RESET}\n`)

  // Group by type
  const grouped = new Map<string, typeof entries>()
  for (const entry of entries) {
    if (!grouped.has(entry.type)) grouped.set(entry.type, [])
    grouped.get(entry.type)!.push(entry)
  }

  for (const [type, group] of grouped) {
    console.log(`  ${YELLOW}${type}${RESET} ${DIM}(${group.length})${RESET}`)
    for (const entry of group.slice(0, 8)) {
      console.log(`    ${BOLD}${entry.key}${RESET}: ${entry.value.slice(0, 60)}`)
    }
    if (group.length > 8) {
      console.log(`    ${DIM}... and ${group.length - 8} more${RESET}`)
    }
  }
}

async function handleRemember(agent: AgentInstance, args: string): Promise<void> {
  const match = args.match(/^(.+?)\s*=\s*(.+)$/)
  if (!match) {
    console.log(`  ${DIM}Usage: remember <key> = <value>${RESET}`)
    console.log(`  ${DIM}Example: remember physics exam = March 25${RESET}`)
    return
  }

  const [, key, value] = match
  await agent.memory.store({
    key: key.trim(),
    value: value.trim(),
    type: 'fact',
    scope: 'user',
  })

  console.log(`  ${GREEN}Remembered:${RESET} ${BOLD}${key.trim()}${RESET} = ${value.trim()}`)
}

async function handleForget(agent: AgentInstance, query: string): Promise<void> {
  if (!query) {
    console.log(`  ${DIM}Usage: forget <keyword>${RESET}`)
    return
  }

  const matches = await agent.memory.search(query, { limit: 50 })
  if (matches.length === 0) {
    console.log(`  ${DIM}No memory entries match "${query}".${RESET}`)
    return
  }

  for (const entry of matches) {
    await agent.memory.delete(entry.id)
  }

  console.log(`  ${YELLOW}Forgot ${matches.length} entries matching "${query}".${RESET}`)
}

async function handleRecommend(agent: AgentInstance, intent: string): Promise<void> {
  if (!intent) {
    console.log(`  ${DIM}Usage: recommend <intent>${RESET}`)
    console.log(`  ${DIM}Example: recommend prepare for physics exam${RESET}`)
    return
  }

  console.log(`\n  ${DIM}Generating recommendations...${RESET}\n`)

  const recs = await agent.loop.generateRecommendations({
    role: 'student' as UserRole,
    intent,
    context: {},
    limit: 3,
  })

  for (const rec of recs) {
    console.log(`  ${BOLD}${rec.title}${RESET}`)
    console.log(`  ${DIM}Type: ${rec.type} | Confidence: ${RESET}${formatConfidence(rec.confidence)}`)
    console.log(`  ${rec.summary}`)
    if (rec.actions.length > 0) {
      console.log(`  ${DIM}Actions:${RESET}`)
      for (const action of rec.actions) {
        console.log(`    ${CYAN}-${RESET} ${action.label}`)
      }
    }
    console.log('')
  }
}

function printPlugins(agent: AgentInstance): void {
  const plugins = agent.plugins.list()
  if (plugins.length === 0) {
    console.log(`  ${DIM}No plugins loaded.${RESET}`)
    return
  }

  console.log(`\n  ${BOLD}Plugins${RESET} ${DIM}(${plugins.length})${RESET}\n`)
  for (const p of plugins) {
    const statusColor = p.status === 'active' ? GREEN : p.status === 'error' ? RED : DIM
    console.log(`  ${statusColor}${p.status}${RESET}  ${BOLD}${p.name}${RESET} ${DIM}v${p.version}${RESET}`)
    console.log(`  ${DIM}       ${p.capabilities.join(', ')}${RESET}`)
  }
}

function handleConfig(args: string): void {
  const parts = args.split(/\s+/)
  const subcommand = parts[0]

  if (subcommand === 'get') {
    const key = parts[1]
    if (!key) {
      console.log(`  ${DIM}Usage: config get <key>${RESET}`)
      console.log(`  ${DIM}Example: config get agent.autonomyLevel${RESET}`)
      return
    }
    const value = getConfigValue(key)
    if (value === undefined) {
      console.log(`  ${DIM}No value set for "${key}" (using default)${RESET}`)
    } else {
      console.log(`  ${BOLD}${key}${RESET} = ${JSON.stringify(value)}`)
    }
    return
  }

  if (subcommand === 'set') {
    const key = parts[1]
    const rawValue = parts.slice(2).join(' ')
    if (!key || !rawValue) {
      console.log(`  ${DIM}Usage: config set <key> <value>${RESET}`)
      console.log(`  ${DIM}Example: config set agent.autonomyLevel L2${RESET}`)
      return
    }

    let value: unknown = rawValue
    try {
      value = JSON.parse(rawValue)
    } catch {
      // Keep as string
    }

    setConfigValue(key, value)
    console.log(`  ${GREEN}Saved:${RESET} ${BOLD}${key}${RESET} = ${JSON.stringify(value)}`)
    console.log(`  ${DIM}Restart the agent for changes to take effect.${RESET}`)
    return
  }

  // No subcommand — show current config
  console.log(`\n  ${BOLD}Configuration${RESET}\n`)
  console.log(`  ${DIM}Use "config get <key>" or "config set <key> <value>"${RESET}`)
  console.log('')
  console.log(`  ${YELLOW}agent${RESET}`)
  console.log(`    autonomyLevel        ${BOLD}${getConfigValue('agent.autonomyLevel') ?? 'L1 (default)'}${RESET}`)
  console.log(`    maxStepsPerTask      ${BOLD}${getConfigValue('agent.maxStepsPerTask') ?? '20 (default)'}${RESET}`)
  console.log(`    confirmIrreversible  ${BOLD}${getConfigValue('agent.confirmIrreversible') ?? 'true (default)'}${RESET}`)
  console.log(`  ${YELLOW}inference${RESET}`)
  console.log(`    preferLocal          ${BOLD}${getConfigValue('inference.preferLocal') ?? 'true (default)'}${RESET}`)
  console.log(`    cloudProvider        ${BOLD}${getConfigValue('inference.cloudProvider') ?? 'anthropic (default)'}${RESET}`)
  console.log(`  ${YELLOW}privacy${RESET}`)
  console.log(`    telemetryEnabled     ${BOLD}${getConfigValue('privacy.telemetryEnabled') ?? 'true (default)'}${RESET}`)
  console.log(`    localInference       ${BOLD}${getConfigValue('privacy.localInference') ?? 'true (default)'}${RESET}`)
  console.log(`  ${YELLOW}memory${RESET}`)
  console.log(`    syncEnabled          ${BOLD}${getConfigValue('memory.syncEnabled') ?? 'false (default)'}${RESET}`)
  console.log(`\n  ${DIM}Data directory: ${getNeuraDir()}${RESET}`)
}

// ── Task Execution ──────────────────────────────────────────

async function runTask(instruction: string, agent: AgentInstance): Promise<void> {
  console.log(`\n  ${DIM}Creating task...${RESET}`)
  console.log(`  ${BOLD}${instruction}${RESET}\n`)

  const task = agent.scheduler.createTask({ instruction })

  try {
    const result = await agent.scheduler.executeTask(task.id)

    // Save to history
    const completedTask = agent.scheduler.getTask(task.id)
    if (completedTask) saveTaskToHistory(completedTask)

    console.log('')
    console.log(`  ${DIM}${'─'.repeat(50)}${RESET}`)

    if (result.success) {
      console.log(`  ${GREEN}${BOLD}Task complete${RESET}  ${formatConfidence(result.confidence)} confidence  ${DIM}${formatDuration(result.durationMs)}${RESET}`)
    } else {
      console.log(`  ${RED}${BOLD}Task failed${RESET}  ${DIM}${formatDuration(result.durationMs)}${RESET}`)
    }

    console.log('')
    const lines = result.summary.split('\n')
    for (const line of lines) {
      console.log(`  ${line}`)
    }
  } catch (err) {
    const failedTask = agent.scheduler.getTask(task.id)
    if (failedTask) saveTaskToHistory(failedTask)

    console.error(`\n  ${RED}Task failed: ${err instanceof Error ? err.message : 'Unknown error'}${RESET}`)
  }
}

// ── Entry Point ─────────────────────────────────────────────

main().catch((err) => {
  log.error('Fatal error', { error: err instanceof Error ? err.message : 'Unknown' })
  process.exit(1)
})
