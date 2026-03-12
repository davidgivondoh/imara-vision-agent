import { v4 as uuid } from 'uuid'
import { createLogger } from '../shared/logger.js'
import type {
  AccessibilityProfile,
  AccessibilityNeed,
  ReadingLevel,
  CognitiveLoadLevel,
  CognitiveLoadAssessment,
  ContentAdaptation,
  OutputModality,
} from '../shared/types.js'
import type { Telemetry } from './telemetry.js'

const log = createLogger('accessibility')

// ─── Configuration ──────────────────────────────────────────────

export interface AccessibilityConfig {
  defaultReadingLevel: ReadingLevel
  defaultCognitiveLoadLimit: CognitiveLoadLevel
  defaultOutputModalities: OutputModality[]
  contentMaxSentenceLength: number
  contentMaxParagraphSentences: number
  screenReaderVerbosity: 'brief' | 'normal' | 'verbose'
}

const DEFAULT_A11Y_CONFIG: AccessibilityConfig = {
  defaultReadingLevel: 'standard',
  defaultCognitiveLoadLimit: 'medium',
  defaultOutputModalities: ['text'],
  contentMaxSentenceLength: 20,
  contentMaxParagraphSentences: 4,
  screenReaderVerbosity: 'normal',
}

// ─── Default profile factory ────────────────────────────────────

function createDefaultProfile(userId: string): AccessibilityProfile {
  const now = new Date().toISOString()
  return {
    id: `a11y_${uuid().slice(0, 12)}`,
    userId,
    needs: [],
    preferences: {
      readingLevel: 'standard',
      outputModalities: ['text'],
      highContrast: false,
      largeText: false,
      reducedMotion: false,
      screenReader: false,
      voiceControl: false,
      simplifiedLanguage: false,
      extendedTimeouts: false,
      cognitiveLoadLimit: 'medium',
    },
    createdAt: now,
    updatedAt: now,
  }
}

// ─── Content Simplifier ─────────────────────────────────────────

/**
 * Rule-based content simplification engine.
 * Adapts text complexity based on reading level without inference calls.
 */
export class ContentSimplifier {
  private config: AccessibilityConfig

  constructor(config?: Partial<AccessibilityConfig>) {
    this.config = { ...DEFAULT_A11Y_CONFIG, ...config }
  }

  /**
   * Adapt content to match the target reading level.
   */
  adapt(content: string, readingLevel: ReadingLevel): ContentAdaptation {
    const originalWords = content.split(/\s+/).filter(Boolean).length
    let adapted = content
    const modifications: string[] = []

    switch (readingLevel) {
      case 'simple':
        ({ text: adapted, changes: modifications.length } = this.simplifyToSimple(adapted, modifications))
        break
      case 'standard':
        ({ text: adapted, changes: modifications.length } = this.simplifyToStandard(adapted, modifications))
        break
      case 'advanced':
        // No simplification needed for advanced readers
        break
    }

    const adaptedWords = adapted.split(/\s+/).filter(Boolean).length

    return {
      originalContent: content,
      adaptedContent: adapted,
      readingLevel,
      modifications,
      wordCount: { original: originalWords, adapted: adaptedWords },
    }
  }

  private simplifyToSimple(text: string, mods: string[]): { text: string; changes: number } {
    let result = text

    // Replace complex words with simpler alternatives
    const replacements: Array<[RegExp, string, string]> = [
      [/\butilise\b/gi, 'use', 'Replaced "utilise" with "use"'],
      [/\butilize\b/gi, 'use', 'Replaced "utilize" with "use"'],
      [/\bfacilitate\b/gi, 'help', 'Replaced "facilitate" with "help"'],
      [/\bsubsequently\b/gi, 'then', 'Replaced "subsequently" with "then"'],
      [/\bnevertheless\b/gi, 'but', 'Replaced "nevertheless" with "but"'],
      [/\bfurthermore\b/gi, 'also', 'Replaced "furthermore" with "also"'],
      [/\bconsequently\b/gi, 'so', 'Replaced "consequently" with "so"'],
      [/\bapproximate(ly)?\b/gi, 'about', 'Replaced "approximately" with "about"'],
      [/\bdemonstrate\b/gi, 'show', 'Replaced "demonstrate" with "show"'],
      [/\bcommence\b/gi, 'start', 'Replaced "commence" with "start"'],
      [/\bterminate\b/gi, 'end', 'Replaced "terminate" with "end"'],
      [/\bimplement\b/gi, 'do', 'Replaced "implement" with "do"'],
      [/\bascertain\b/gi, 'find out', 'Replaced "ascertain" with "find out"'],
      [/\bin order to\b/gi, 'to', 'Replaced "in order to" with "to"'],
      [/\bwith regard to\b/gi, 'about', 'Replaced "with regard to" with "about"'],
      [/\bin the event that\b/gi, 'if', 'Replaced "in the event that" with "if"'],
      [/\bprior to\b/gi, 'before', 'Replaced "prior to" with "before"'],
      [/\bsubsequent to\b/gi, 'after', 'Replaced "subsequent to" with "after"'],
      [/\bat the present time\b/gi, 'now', 'Replaced "at the present time" with "now"'],
      [/\bin addition to\b/gi, 'and', 'Replaced "in addition to" with "and"'],
      [/\bnotwithstanding\b/gi, 'despite', 'Replaced "notwithstanding" with "despite"'],
      [/\binasmuch as\b/gi, 'since', 'Replaced "inasmuch as" with "since"'],
      [/\baccordingly\b/gi, 'so', 'Replaced "accordingly" with "so"'],
      [/\badditionally\b/gi, 'also', 'Replaced "additionally" with "also"'],
      [/\bpurchase\b/gi, 'buy', 'Replaced "purchase" with "buy"'],
      [/\brequire\b/gi, 'need', 'Replaced "require" with "need"'],
      [/\battempt\b/gi, 'try', 'Replaced "attempt" with "try"'],
      [/\bassist\b/gi, 'help', 'Replaced "assist" with "help"'],
      [/\bsufficient\b/gi, 'enough', 'Replaced "sufficient" with "enough"'],
      [/\bmodify\b/gi, 'change', 'Replaced "modify" with "change"'],
      [/\binquire\b/gi, 'ask', 'Replaced "inquire" with "ask"'],
      [/\bcomprehend\b/gi, 'understand', 'Replaced "comprehend" with "understand"'],
    ]

    for (const [pattern, replacement, description] of replacements) {
      if (pattern.test(result)) {
        result = result.replace(pattern, replacement)
        mods.push(description)
      }
    }

    // Break long sentences
    result = this.breakLongSentences(result, this.config.contentMaxSentenceLength, mods)

    // Remove parenthetical asides
    const parenPattern = /\s*\([^)]{20,}\)/g
    if (parenPattern.test(result)) {
      result = result.replace(parenPattern, '')
      mods.push('Removed long parenthetical asides')
    }

    return { text: result.trim(), changes: mods.length }
  }

  private simplifyToStandard(text: string, mods: string[]): { text: string; changes: number } {
    let result = text

    // Only break very long sentences at standard level
    result = this.breakLongSentences(result, this.config.contentMaxSentenceLength * 2, mods)

    return { text: result.trim(), changes: mods.length }
  }

  /**
   * Break sentences that exceed the word limit into shorter ones.
   */
  private breakLongSentences(text: string, maxWords: number, mods: string[]): string {
    const sentences = text.match(/[^.!?]+[.!?]+/g)
    if (!sentences) return text

    let didBreak = false
    const result = sentences.map((sentence) => {
      const words = sentence.trim().split(/\s+/)
      if (words.length <= maxWords) return sentence

      // Find a break point near conjunctions or commas
      const breakPoints = [', and ', ', but ', ', or ', '; ', ', which ', ', that ', ', ']
      for (const bp of breakPoints) {
        const idx = sentence.indexOf(bp)
        if (idx > 0 && idx < sentence.length - 10) {
          didBreak = true
          const first = sentence.slice(0, idx).trim()
          const second = sentence.slice(idx + bp.length).trim()
          // Capitalise the start of the second sentence
          const secondCapitalised = second.charAt(0).toUpperCase() + second.slice(1)
          // Ensure first part ends with period
          const firstWithPeriod = first.endsWith('.') || first.endsWith('!') || first.endsWith('?')
            ? first
            : first + '.'
          return `${firstWithPeriod} ${secondCapitalised}`
        }
      }

      return sentence
    })

    if (didBreak) {
      mods.push('Split long sentences into shorter ones')
    }

    return result.join(' ')
  }

  /**
   * Calculate the Flesch-Kincaid-inspired readability score (simplified).
   * Lower score = easier to read. Returns 0-1.
   */
  assessReadability(text: string): number {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
    const words = text.split(/\s+/).filter(Boolean)
    const syllables = words.reduce((sum, w) => sum + this.countSyllables(w), 0)

    if (words.length === 0 || sentences.length === 0) return 0

    const avgWordsPerSentence = words.length / sentences.length
    const avgSyllablesPerWord = syllables / words.length

    // Normalised complexity score (0-1)
    const sentenceComplexity = Math.min(avgWordsPerSentence / 30, 1)
    const wordComplexity = Math.min((avgSyllablesPerWord - 1) / 2, 1)

    return Math.min((sentenceComplexity * 0.6 + wordComplexity * 0.4), 1)
  }

  private countSyllables(word: string): number {
    const w = word.toLowerCase().replace(/[^a-z]/g, '')
    if (w.length <= 3) return 1

    let count = 0
    const vowels = 'aeiouy'
    let prevVowel = false

    for (const ch of w) {
      const isVowel = vowels.includes(ch)
      if (isVowel && !prevVowel) count++
      prevVowel = isVowel
    }

    // Adjust for silent e
    if (w.endsWith('e') && count > 1) count--
    // Minimum 1 syllable
    return Math.max(count, 1)
  }
}

// ─── Screen Reader Formatter ────────────────────────────────────

export class ScreenReaderFormatter {
  private verbosity: 'brief' | 'normal' | 'verbose'

  constructor(verbosity: 'brief' | 'normal' | 'verbose' = 'normal') {
    this.verbosity = verbosity
  }

  /**
   * Format content for screen reader output.
   * Adds structural cues, aria-like annotations, and navigation landmarks.
   */
  format(content: string, context?: { type?: string; title?: string }): string {
    const parts: string[] = []

    // Add context announcement
    if (context?.type && this.verbosity !== 'brief') {
      parts.push(`[${context.type}]`)
    }
    if (context?.title) {
      parts.push(`${context.title}.`)
    }

    // Clean and structure the content
    let processed = content
      // Replace markdown headers with spoken landmarks
      .replace(/^#{1,6}\s+(.+)$/gm, (_match, heading: string) => `Heading: ${heading}.`)
      // Replace bullet lists with spoken items
      .replace(/^[-*]\s+(.+)$/gm, (_match, item: string) => `Item: ${item}.`)
      // Replace numbered lists
      .replace(/^\d+[.)]\s+(.+)$/gm, (_match, item: string) => `Item: ${item}.`)
      // Replace bold/italic emphasis with verbal cue
      .replace(/\*\*(.+?)\*\*/g, (_match, text: string) => this.verbosity === 'brief' ? text : `important: ${text}`)
      .replace(/\*(.+?)\*/g, (_match, text: string) => this.verbosity === 'brief' ? text : `emphasis: ${text}`)
      // Replace links
      .replace(/\[(.+?)\]\((.+?)\)/g, (_match, text: string, url: string) =>
        this.verbosity === 'verbose' ? `link: ${text}, URL: ${url}` : `link: ${text}`)
      // Replace code blocks
      .replace(/```[\s\S]*?```/g, (match) => {
        if (this.verbosity === 'brief') return 'Code block.'
        return `Code block: ${match.replace(/```\w*\n?/g, '').trim()}`
      })
      // Replace inline code
      .replace(/`(.+?)`/g, (_match, code: string) => `code: ${code}`)

    parts.push(processed)

    // Add content summary for verbose mode
    if (this.verbosity === 'verbose') {
      const wordCount = content.split(/\s+/).filter(Boolean).length
      const sentenceCount = (content.match(/[.!?]+/g) ?? []).length
      parts.push(`End of content. ${wordCount} words, ${sentenceCount} sentences.`)
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }

  /**
   * Format a task result for screen reader announcement.
   */
  formatTaskResult(result: { success: boolean; summary: string; confidence: number }): string {
    const status = result.success ? 'completed successfully' : 'did not complete'
    const confidence = Math.round(result.confidence * 100)

    if (this.verbosity === 'brief') {
      return `Task ${status}. ${result.summary}`
    }

    return `Task ${status} with ${confidence} percent confidence. ${result.summary}`
  }

  /**
   * Format navigation instructions for screen reader.
   */
  formatNavigation(items: Array<{ label: string; description?: string; shortcut?: string }>): string {
    const parts = [`${items.length} navigation items available.`]

    for (const item of items) {
      if (this.verbosity === 'brief') {
        parts.push(`${item.label}.`)
      } else {
        let entry = item.label
        if (item.description) entry += `, ${item.description}`
        if (item.shortcut && this.verbosity === 'verbose') entry += `, shortcut: ${item.shortcut}`
        parts.push(`${entry}.`)
      }
    }

    return parts.join(' ')
  }

  setVerbosity(level: 'brief' | 'normal' | 'verbose'): void {
    this.verbosity = level
  }
}

// ─── Cognitive Load Assessor ────────────────────────────────────

export class CognitiveLoadAssessor {
  /**
   * Assess cognitive load of content/task for a user.
   */
  assess(content: string, context?: {
    taskCount?: number
    sessionDurationMinutes?: number
    recentErrors?: number
    userCognitiveLimit?: CognitiveLoadLevel
  }): CognitiveLoadAssessment {
    const factors: string[] = []
    let score = 0

    // Text complexity
    const words = content.split(/\s+/).filter(Boolean)
    const wordCount = words.length
    if (wordCount > 200) {
      score += 0.2
      factors.push('Long content')
    } else if (wordCount > 100) {
      score += 0.1
      factors.push('Moderate content length')
    }

    // Technical jargon density
    const technicalTerms = content.match(
      /\b(algorithm|configuration|implementation|parameter|authentication|infrastructure|API|SDK|database|asynchronous|synchronous|middleware|interface|protocol|repository|deployment|refactor)\b/gi,
    )
    const jargonDensity = (technicalTerms?.length ?? 0) / Math.max(wordCount, 1)
    if (jargonDensity > 0.05) {
      score += 0.2
      factors.push('High technical jargon density')
    } else if (jargonDensity > 0.02) {
      score += 0.1
      factors.push('Some technical jargon')
    }

    // Sentence complexity
    const sentences = content.match(/[^.!?]+[.!?]+/g) ?? [content]
    const avgSentenceLength = wordCount / Math.max(sentences.length, 1)
    if (avgSentenceLength > 25) {
      score += 0.15
      factors.push('Complex sentences')
    }

    // Multiple instructions / steps
    const stepIndicators = content.match(/\b(step|first|then|next|finally|also|additionally)\b/gi)
    if (stepIndicators && stepIndicators.length > 3) {
      score += 0.15
      factors.push('Multiple steps or instructions')
    }

    // Context factors
    if (context?.taskCount && context.taskCount > 5) {
      score += 0.1
      factors.push('Many concurrent tasks')
    }
    if (context?.sessionDurationMinutes && context.sessionDurationMinutes > 60) {
      score += 0.1
      factors.push('Extended session duration')
    }
    if (context?.recentErrors && context.recentErrors > 2) {
      score += 0.1
      factors.push('Recent errors may indicate fatigue')
    }

    // Clamp score
    score = Math.min(score, 1)

    // Determine level
    let level: CognitiveLoadLevel
    if (score < 0.35) level = 'low'
    else if (score < 0.65) level = 'medium'
    else level = 'high'

    // Generate recommendations
    const recommendations: string[] = []
    const userLimit = context?.userCognitiveLimit ?? 'high'

    if (level === 'high' && userLimit !== 'high') {
      recommendations.push('Consider breaking this into smaller steps')
      recommendations.push('Use simplified language mode')
    }
    if (level === 'medium' && userLimit === 'low') {
      recommendations.push('Content may need simplification')
      recommendations.push('Consider voice-guided walk-through')
    }
    if (factors.includes('High technical jargon density')) {
      recommendations.push('Replace technical terms with plain language')
    }
    if (factors.includes('Extended session duration')) {
      recommendations.push('Suggest a break to the user')
    }
    if (factors.includes('Recent errors may indicate fatigue')) {
      recommendations.push('Offer to slow down or simplify')
    }

    return { level, score, factors, recommendations }
  }

  /**
   * Check if content exceeds the user's cognitive load limit.
   */
  exceedsLimit(assessment: CognitiveLoadAssessment, limit: CognitiveLoadLevel): boolean {
    const order: Record<CognitiveLoadLevel, number> = { low: 0, medium: 1, high: 2 }
    return order[assessment.level] > order[limit]
  }
}

// ─── Accessibility Manager ──────────────────────────────────────

export class AccessibilityManager {
  private profiles = new Map<string, AccessibilityProfile>()
  private config: AccessibilityConfig
  private telemetry: Telemetry
  private simplifier: ContentSimplifier
  private screenReader: ScreenReaderFormatter
  private cognitiveAssessor: CognitiveLoadAssessor

  constructor(options: {
    telemetry: Telemetry
    config?: Partial<AccessibilityConfig>
  }) {
    this.telemetry = options.telemetry
    this.config = { ...DEFAULT_A11Y_CONFIG, ...options.config }
    this.simplifier = new ContentSimplifier(this.config)
    this.screenReader = new ScreenReaderFormatter(this.config.screenReaderVerbosity)
    this.cognitiveAssessor = new CognitiveLoadAssessor()
  }

  // ── Profile management ────────────────────────────────────────

  createProfile(userId: string, needs?: AccessibilityNeed[]): AccessibilityProfile {
    const profile = createDefaultProfile(userId)
    if (needs) {
      profile.needs = needs
      this.applyNeedDefaults(profile)
    }

    this.profiles.set(userId, profile)

    this.telemetry.emit('accessibility.profile.created', {
      userId,
      needs: profile.needs,
    })
    log.info('Accessibility profile created', { userId, needs: profile.needs })

    return profile
  }

  updateProfile(
    userId: string,
    updates: Partial<AccessibilityProfile['preferences']>,
  ): AccessibilityProfile | null {
    const profile = this.profiles.get(userId)
    if (!profile) return null

    profile.preferences = { ...profile.preferences, ...updates }
    profile.updatedAt = new Date().toISOString()

    // Update screen reader verbosity if screenReader pref changed
    if (profile.preferences.screenReader) {
      this.screenReader.setVerbosity(this.config.screenReaderVerbosity)
    }

    this.telemetry.emit('accessibility.profile.updated', {
      userId,
      updatedFields: Object.keys(updates),
    })
    log.info('Accessibility profile updated', { userId })

    return profile
  }

  getProfile(userId: string): AccessibilityProfile | null {
    return this.profiles.get(userId) ?? null
  }

  deleteProfile(userId: string): boolean {
    return this.profiles.delete(userId)
  }

  /**
   * Apply sensible defaults based on declared accessibility needs.
   */
  private applyNeedDefaults(profile: AccessibilityProfile): void {
    for (const need of profile.needs) {
      switch (need) {
        case 'visual':
          profile.preferences.screenReader = true
          profile.preferences.highContrast = true
          profile.preferences.largeText = true
          if (!profile.preferences.outputModalities.includes('speech')) {
            profile.preferences.outputModalities.push('speech')
          }
          break
        case 'auditory':
          // Ensure text output is available, add visual modality
          if (!profile.preferences.outputModalities.includes('visual')) {
            profile.preferences.outputModalities.push('visual')
          }
          break
        case 'motor':
          profile.preferences.voiceControl = true
          profile.preferences.extendedTimeouts = true
          break
        case 'cognitive':
          profile.preferences.simplifiedLanguage = true
          profile.preferences.readingLevel = 'simple'
          profile.preferences.reducedMotion = true
          profile.preferences.cognitiveLoadLimit = 'low'
          break
        case 'speech':
          // Ensure text input is primary
          break
      }
    }
  }

  // ── Content adaptation ────────────────────────────────────────

  /**
   * Adapt content for a specific user based on their accessibility profile.
   * If no profile exists, returns content unchanged.
   */
  adaptContent(content: string, userId: string): ContentAdaptation {
    const profile = this.profiles.get(userId)
    const readingLevel = profile?.preferences.readingLevel ?? this.config.defaultReadingLevel

    const adaptation = this.simplifier.adapt(content, readingLevel)

    // Add screen reader text if needed
    if (profile?.preferences.screenReader) {
      adaptation.screenReaderText = this.screenReader.format(adaptation.adaptedContent)
    }

    this.telemetry.emit('accessibility.content.adapted', {
      userId,
      readingLevel,
      modificationsCount: adaptation.modifications.length,
      originalWords: adaptation.wordCount.original,
      adaptedWords: adaptation.wordCount.adapted,
    })

    return adaptation
  }

  /**
   * Adapt content directly by reading level (no profile needed).
   */
  adaptContentByLevel(content: string, readingLevel: ReadingLevel): ContentAdaptation {
    return this.simplifier.adapt(content, readingLevel)
  }

  /**
   * Get the readability score of content (0-1, lower = easier).
   */
  assessReadability(content: string): number {
    return this.simplifier.assessReadability(content)
  }

  // ── Cognitive load ────────────────────────────────────────────

  /**
   * Assess cognitive load of content for a specific user.
   */
  assessCognitiveLoad(content: string, userId?: string, context?: {
    taskCount?: number
    sessionDurationMinutes?: number
    recentErrors?: number
  }): CognitiveLoadAssessment {
    const profile = userId ? this.profiles.get(userId) : undefined

    const assessment = this.cognitiveAssessor.assess(content, {
      ...context,
      userCognitiveLimit: profile?.preferences.cognitiveLoadLimit ?? this.config.defaultCognitiveLoadLimit,
    })

    this.telemetry.emit('accessibility.cognitive.assessed', {
      userId,
      level: assessment.level,
      score: assessment.score,
      factorsCount: assessment.factors.length,
    })

    return assessment
  }

  /**
   * Check if content exceeds a user's cognitive load limit.
   */
  exceedsCognitiveLimit(content: string, userId: string): boolean {
    const profile = this.profiles.get(userId)
    const limit = profile?.preferences.cognitiveLoadLimit ?? this.config.defaultCognitiveLoadLimit
    const assessment = this.cognitiveAssessor.assess(content, {
      userCognitiveLimit: limit,
    })
    return this.cognitiveAssessor.exceedsLimit(assessment, limit)
  }

  // ── Screen reader ─────────────────────────────────────────────

  /**
   * Format content for screen reader output.
   */
  formatForScreenReader(content: string, context?: { type?: string; title?: string }): string {
    return this.screenReader.format(content, context)
  }

  /**
   * Format a task result for screen reader announcement.
   */
  formatTaskResultForScreenReader(result: { success: boolean; summary: string; confidence: number }): string {
    return this.screenReader.formatTaskResult(result)
  }

  // ── Output modality selection ─────────────────────────────────

  /**
   * Determine the appropriate output modalities for a user.
   */
  getOutputModalities(userId: string): OutputModality[] {
    const profile = this.profiles.get(userId)
    return profile?.preferences.outputModalities ?? this.config.defaultOutputModalities
  }

  /**
   * Check whether extended timeouts should be used for a user.
   */
  needsExtendedTimeouts(userId: string): boolean {
    const profile = this.profiles.get(userId)
    return profile?.preferences.extendedTimeouts ?? false
  }

  /**
   * Get timeout multiplier for a user (1x for standard, 2x for extended).
   */
  getTimeoutMultiplier(userId: string): number {
    return this.needsExtendedTimeouts(userId) ? 2 : 1
  }

  // ── Stats ─────────────────────────────────────────────────────

  get stats(): {
    totalProfiles: number
    needsDistribution: Record<AccessibilityNeed, number>
  } {
    const distribution: Record<AccessibilityNeed, number> = {
      visual: 0,
      auditory: 0,
      motor: 0,
      cognitive: 0,
      speech: 0,
    }

    for (const profile of this.profiles.values()) {
      for (const need of profile.needs) {
        distribution[need]++
      }
    }

    return {
      totalProfiles: this.profiles.size,
      needsDistribution: distribution,
    }
  }
}
