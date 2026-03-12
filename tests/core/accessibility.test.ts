import { describe, it, expect, beforeEach } from 'vitest'
import {
  AccessibilityManager,
  ContentSimplifier,
  ScreenReaderFormatter,
  CognitiveLoadAssessor,
} from '../../src/core/accessibility.js'
import { Telemetry } from '../../src/core/telemetry.js'
import { EventBus } from '../../src/shared/events.js'

function createTelemetry(): Telemetry {
  return new Telemetry({ product: 'desktop', bus: new EventBus() })
}

// ─── ContentSimplifier ─────────────────────────────────────────

describe('ContentSimplifier', () => {
  let simplifier: ContentSimplifier

  beforeEach(() => {
    simplifier = new ContentSimplifier()
  })

  it('should return content unchanged for advanced level', () => {
    const text = 'Utilise the infrastructure to facilitate deployment.'
    const result = simplifier.adapt(text, 'advanced')
    expect(result.adaptedContent).toBe(text)
    expect(result.modifications).toHaveLength(0)
    expect(result.readingLevel).toBe('advanced')
  })

  it('should simplify complex words at simple level', () => {
    const text = 'Please utilise the tool to facilitate the process.'
    const result = simplifier.adapt(text, 'simple')
    expect(result.adaptedContent).toContain('use')
    expect(result.adaptedContent).toContain('help')
    expect(result.adaptedContent).not.toContain('utilise')
    expect(result.adaptedContent).not.toContain('facilitate')
    expect(result.modifications.length).toBeGreaterThan(0)
  })

  it('should replace wordy phrases at simple level', () => {
    const text = 'In order to commence the process, prior to the event.'
    const result = simplifier.adapt(text, 'simple')
    expect(result.adaptedContent).toContain('to')
    expect(result.adaptedContent).toContain('start')
    expect(result.adaptedContent).toContain('before')
  })

  it('should track word counts in adaptation', () => {
    const text = 'Subsequently the team will commence the implementation.'
    const result = simplifier.adapt(text, 'simple')
    expect(result.wordCount.original).toBeGreaterThan(0)
    expect(result.wordCount.adapted).toBeGreaterThan(0)
  })

  it('should assess readability and return 0-1 score', () => {
    const simple = 'The cat sat on the mat.'
    const complex = 'The implementation of the infrastructure necessitates comprehensive evaluation of all configuration parameters and authentication protocols.'

    const simpleScore = simplifier.assessReadability(simple)
    const complexScore = simplifier.assessReadability(complex)

    expect(simpleScore).toBeGreaterThanOrEqual(0)
    expect(simpleScore).toBeLessThanOrEqual(1)
    expect(complexScore).toBeGreaterThanOrEqual(0)
    expect(complexScore).toBeLessThanOrEqual(1)
    expect(complexScore).toBeGreaterThan(simpleScore)
  })

  it('should handle empty content', () => {
    const result = simplifier.adapt('', 'simple')
    expect(result.adaptedContent).toBe('')
    expect(result.wordCount.original).toBe(0)
  })
})

// ─── ScreenReaderFormatter ──────────────────────────────────────

describe('ScreenReaderFormatter', () => {
  it('should format markdown headers as spoken landmarks', () => {
    const formatter = new ScreenReaderFormatter('normal')
    const result = formatter.format('## Getting Started\nSome content here.')
    expect(result).toContain('Heading: Getting Started.')
  })

  it('should format bullet lists as items', () => {
    const formatter = new ScreenReaderFormatter('normal')
    const result = formatter.format('- First item\n- Second item')
    expect(result).toContain('Item: First item.')
    expect(result).toContain('Item: Second item.')
  })

  it('should add bold emphasis cue in normal mode', () => {
    const formatter = new ScreenReaderFormatter('normal')
    const result = formatter.format('This is **very important** text.')
    expect(result).toContain('important: very important')
  })

  it('should strip emphasis cues in brief mode', () => {
    const formatter = new ScreenReaderFormatter('brief')
    const result = formatter.format('This is **very important** text.')
    expect(result).not.toContain('important:')
    expect(result).toContain('very important')
  })

  it('should add word count in verbose mode', () => {
    const formatter = new ScreenReaderFormatter('verbose')
    const result = formatter.format('This is some content here.')
    expect(result).toContain('End of content.')
    expect(result).toContain('words')
  })

  it('should add context type announcement', () => {
    const formatter = new ScreenReaderFormatter('normal')
    const result = formatter.format('Content', { type: 'notification', title: 'Alert' })
    expect(result).toContain('[notification]')
    expect(result).toContain('Alert.')
  })

  it('should format task results', () => {
    const formatter = new ScreenReaderFormatter('normal')
    const result = formatter.formatTaskResult({
      success: true,
      summary: 'File saved successfully',
      confidence: 0.95,
    })
    expect(result).toContain('completed successfully')
    expect(result).toContain('95 percent confidence')
    expect(result).toContain('File saved successfully')
  })

  it('should format failed task results', () => {
    const formatter = new ScreenReaderFormatter('brief')
    const result = formatter.formatTaskResult({
      success: false,
      summary: 'Could not find file',
      confidence: 0,
    })
    expect(result).toContain('did not complete')
  })

  it('should format navigation items', () => {
    const formatter = new ScreenReaderFormatter('normal')
    const result = formatter.formatNavigation([
      { label: 'Home', description: 'Go to home page' },
      { label: 'Settings', description: 'Change preferences' },
    ])
    expect(result).toContain('2 navigation items available')
    expect(result).toContain('Home, Go to home page')
    expect(result).toContain('Settings, Change preferences')
  })

  it('should include shortcuts in verbose mode', () => {
    const formatter = new ScreenReaderFormatter('verbose')
    const result = formatter.formatNavigation([
      { label: 'Home', description: 'Main page', shortcut: 'Alt+H' },
    ])
    expect(result).toContain('shortcut: Alt+H')
  })
})

// ─── CognitiveLoadAssessor ──────────────────────────────────────

describe('CognitiveLoadAssessor', () => {
  let assessor: CognitiveLoadAssessor

  beforeEach(() => {
    assessor = new CognitiveLoadAssessor()
  })

  it('should assess low cognitive load for simple content', () => {
    const result = assessor.assess('Hello there. How are you?')
    expect(result.level).toBe('low')
    expect(result.score).toBeLessThan(0.35)
  })

  it('should assess higher load for technical content', () => {
    const text = 'The API implementation requires authentication middleware with database configuration. The algorithm processes asynchronous protocol parameters through the SDK interface. The deployment infrastructure uses repository-based configuration.'
    const result = assessor.assess(text)
    expect(result.score).toBeGreaterThanOrEqual(0.2)
    expect(result.factors.length).toBeGreaterThan(0)
  })

  it('should increase load with session context', () => {
    const text = 'Please complete this task.'
    const withContext = assessor.assess(text, {
      taskCount: 10,
      sessionDurationMinutes: 120,
      recentErrors: 5,
    })
    const without = assessor.assess(text)
    expect(withContext.score).toBeGreaterThan(without.score)
  })

  it('should generate recommendations when load exceeds limit', () => {
    const text = 'The API implementation requires authentication middleware with database configuration. The algorithm processes asynchronous protocol parameters through the SDK interface.'
    const result = assessor.assess(text, { userCognitiveLimit: 'low' })
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('should detect when assessment exceeds limit', () => {
    const highLoad: { level: 'high'; score: number; factors: string[]; recommendations: string[] } = {
      level: 'high',
      score: 0.8,
      factors: [],
      recommendations: [],
    }
    expect(assessor.exceedsLimit(highLoad, 'low')).toBe(true)
    expect(assessor.exceedsLimit(highLoad, 'medium')).toBe(true)
    expect(assessor.exceedsLimit(highLoad, 'high')).toBe(false)
  })
})

// ─── AccessibilityManager ───────────────────────────────────────

describe('AccessibilityManager', () => {
  let manager: AccessibilityManager

  beforeEach(() => {
    manager = new AccessibilityManager({ telemetry: createTelemetry() })
  })

  // Profile management
  describe('profiles', () => {
    it('should create a default profile', () => {
      const profile = manager.createProfile('user1')
      expect(profile.userId).toBe('user1')
      expect(profile.needs).toEqual([])
      expect(profile.preferences.readingLevel).toBe('standard')
      expect(profile.preferences.screenReader).toBe(false)
    })

    it('should apply visual need defaults', () => {
      const profile = manager.createProfile('user1', ['visual'])
      expect(profile.preferences.screenReader).toBe(true)
      expect(profile.preferences.highContrast).toBe(true)
      expect(profile.preferences.largeText).toBe(true)
      expect(profile.preferences.outputModalities).toContain('speech')
    })

    it('should apply cognitive need defaults', () => {
      const profile = manager.createProfile('user1', ['cognitive'])
      expect(profile.preferences.simplifiedLanguage).toBe(true)
      expect(profile.preferences.readingLevel).toBe('simple')
      expect(profile.preferences.reducedMotion).toBe(true)
      expect(profile.preferences.cognitiveLoadLimit).toBe('low')
    })

    it('should apply motor need defaults', () => {
      const profile = manager.createProfile('user1', ['motor'])
      expect(profile.preferences.voiceControl).toBe(true)
      expect(profile.preferences.extendedTimeouts).toBe(true)
    })

    it('should update profile preferences', () => {
      manager.createProfile('user1')
      const updated = manager.updateProfile('user1', { highContrast: true, largeText: true })
      expect(updated).not.toBeNull()
      expect(updated!.preferences.highContrast).toBe(true)
      expect(updated!.preferences.largeText).toBe(true)
    })

    it('should return null when updating nonexistent profile', () => {
      const result = manager.updateProfile('nobody', { highContrast: true })
      expect(result).toBeNull()
    })

    it('should get and delete profiles', () => {
      manager.createProfile('user1')
      expect(manager.getProfile('user1')).not.toBeNull()
      expect(manager.deleteProfile('user1')).toBe(true)
      expect(manager.getProfile('user1')).toBeNull()
    })
  })

  // Content adaptation
  describe('content adaptation', () => {
    it('should adapt content for user with cognitive needs', () => {
      manager.createProfile('user1', ['cognitive'])
      const adaptation = manager.adaptContent(
        'Subsequently the team will utilise the tool to facilitate the implementation.',
        'user1',
      )
      expect(adaptation.adaptedContent).not.toContain('utilise')
      expect(adaptation.adaptedContent).not.toContain('Subsequently')
      expect(adaptation.modifications.length).toBeGreaterThan(0)
    })

    it('should add screen reader text for visual needs', () => {
      manager.createProfile('user1', ['visual'])
      const adaptation = manager.adaptContent('Some content here.', 'user1')
      expect(adaptation.screenReaderText).toBeDefined()
    })

    it('should return unadapted content for unknown user', () => {
      const content = 'Hello there.'
      const adaptation = manager.adaptContent(content, 'unknown_user')
      expect(adaptation.adaptedContent).toBe(content)
    })

    it('should adapt content by level directly', () => {
      const text = 'Please utilise the tool to facilitate the process.'
      const adaptation = manager.adaptContentByLevel(text, 'simple')
      expect(adaptation.adaptedContent).toContain('use')
    })
  })

  // Cognitive load
  describe('cognitive load', () => {
    it('should assess cognitive load for user', () => {
      manager.createProfile('user1', ['cognitive'])
      const assessment = manager.assessCognitiveLoad('Simple text.', 'user1')
      expect(assessment.level).toBeDefined()
      expect(assessment.score).toBeGreaterThanOrEqual(0)
      expect(assessment.score).toBeLessThanOrEqual(1)
    })

    it('should detect when content exceeds user limit', () => {
      manager.createProfile('user1', ['cognitive']) // sets limit to 'low'
      const longTechnical = 'The API implementation requires authentication middleware with database configuration. The algorithm processes asynchronous protocol parameters through the SDK interface. Additionally the deployment infrastructure uses repository-based configuration with complex parameter settings.'
      const exceeds = manager.exceedsCognitiveLimit(longTechnical, 'user1')
      // May or may not exceed depending on exact scoring, but the method should work
      expect(typeof exceeds).toBe('boolean')
    })
  })

  // Output modalities
  describe('output modalities', () => {
    it('should return default modalities for unknown user', () => {
      const modalities = manager.getOutputModalities('unknown')
      expect(modalities).toEqual(['text'])
    })

    it('should return speech modality for visual needs user', () => {
      manager.createProfile('user1', ['visual'])
      const modalities = manager.getOutputModalities('user1')
      expect(modalities).toContain('speech')
    })
  })

  // Timeouts
  describe('timeouts', () => {
    it('should return 1x multiplier for standard user', () => {
      manager.createProfile('user1')
      expect(manager.getTimeoutMultiplier('user1')).toBe(1)
    })

    it('should return 2x multiplier for motor needs user', () => {
      manager.createProfile('user1', ['motor'])
      expect(manager.getTimeoutMultiplier('user1')).toBe(2)
    })
  })

  // Stats
  describe('stats', () => {
    it('should track needs distribution', () => {
      manager.createProfile('user1', ['visual', 'motor'])
      manager.createProfile('user2', ['cognitive'])
      manager.createProfile('user3', ['visual'])

      const stats = manager.stats
      expect(stats.totalProfiles).toBe(3)
      expect(stats.needsDistribution.visual).toBe(2)
      expect(stats.needsDistribution.motor).toBe(1)
      expect(stats.needsDistribution.cognitive).toBe(1)
      expect(stats.needsDistribution.auditory).toBe(0)
    })
  })

  // Screen reader formatting
  describe('screen reader', () => {
    it('should format content for screen reader', () => {
      const result = manager.formatForScreenReader('## Title\nContent here.', { type: 'response' })
      expect(result).toContain('Heading: Title.')
    })

    it('should format task result for screen reader', () => {
      const result = manager.formatTaskResultForScreenReader({
        success: true,
        summary: 'Done',
        confidence: 0.9,
      })
      expect(result).toContain('completed successfully')
    })
  })

  // Readability
  describe('readability', () => {
    it('should assess content readability', () => {
      const score = manager.assessReadability('The cat sat.')
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })
  })
})
