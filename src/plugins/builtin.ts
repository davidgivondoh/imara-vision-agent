import type { PluginDefinition } from './host.js'

export const noteSummariser: PluginDefinition = {
  name: 'note-summariser',
  version: '1.0.0',
  capabilities: ['summarise-notes', 'extract-topics'],

  async onInit(ctx) {
    ctx.log.info('Note summariser plugin ready')
  },

  async onTask(ctx, task) {
    if (task.intent !== 'summarise-notes' && task.intent !== 'extract-topics') {
      return null
    }

    if (task.intent === 'summarise-notes') {
      return {
        summary: `Summary of notes:\n${task.input.slice(0, 200)}...`,
        topics: ['Key topic 1', 'Key topic 2'],
        wordCount: task.input.split(/\s+/).length,
      }
    }

    if (task.intent === 'extract-topics') {
      const words = task.input.toLowerCase().split(/\s+/)
      const freq = new Map<string, number>()
      for (const word of words) {
        if (word.length > 4) {
          freq.set(word, (freq.get(word) ?? 0) + 1)
        }
      }
      const topics = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word)

      return { topics }
    }

    return null
  },
}

export const revisionPlanner: PluginDefinition = {
  name: 'revision-planner',
  version: '1.0.0',
  capabilities: ['create-plan', 'track-progress'],

  async onInit(ctx) {
    ctx.log.info('Revision planner plugin ready')
  },

  async onTask(ctx, task) {
    if (task.intent !== 'create-plan') return null

    const examDate = task.context.examDate as string | undefined
    const topics = (task.context.topics as string[]) ?? ['General']
    const daysUntilExam = examDate
      ? Math.ceil((new Date(examDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 14

    const plan = topics.map((topic, i) => ({
      day: i + 1,
      topic,
      activities: ['Review notes', 'Practice questions', 'Self-test'],
      duration: `${Math.max(30, Math.floor(120 / topics.length))} minutes`,
    }))

    return {
      plan,
      totalDays: daysUntilExam,
      dailyTarget: `${Math.ceil(topics.length / daysUntilExam)} topics per day`,
    }
  },
}

export const accessibilityAssist: PluginDefinition = {
  name: 'accessibility-assist',
  version: '1.0.0',
  capabilities: ['adapt-ui', 'voice-control'],

  async onInit(ctx) {
    await ctx.memory.set('adaptations', {
      highContrast: false,
      largeText: false,
      voiceOutput: false,
      reducedMotion: false,
    })
    ctx.log.info('Accessibility assist plugin ready')
  },

  async onTask(ctx, task) {
    if (task.intent !== 'adapt-ui') return null

    const current = (await ctx.memory.get('adaptations')) as Record<string, boolean> | null ?? {}
    const profile = task.context.profile as Record<string, boolean> | undefined ?? {}

    const updated = { ...current, ...profile }
    await ctx.memory.set('adaptations', updated)

    return { adaptations: updated, applied: true }
  },
}

export const builtinPlugins: PluginDefinition[] = [
  noteSummariser,
  revisionPlanner,
  accessibilityAssist,
]
