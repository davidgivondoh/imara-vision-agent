# Accessibility Architecture

> Every design decision in Neura starts with the question: "Can a person with a disability use this independently?"

---

## Design Principles

1. **Nothing About Us Without Us** -- Accessibility is not an afterthought or a compliance checkbox. It is the primary design constraint.
2. **Multiple Modalities** -- Every interaction must be available through at least two modalities (visual + auditory, or keyboard + voice, etc.)
3. **Progressive Autonomy** -- Start with suggestions (L1), let users gradually grant more autonomy as trust builds.
4. **Cognitive Load Awareness** -- Minimise choices, use plain language, provide context, avoid overwhelming users.
5. **Fail Safe** -- When the agent is uncertain, it asks rather than acts. When it fails, it explains why in simple terms.

---

## Disability Profiles and Adaptations

Neura adapts its behaviour based on the user's disability profile. Users configure this during onboarding or through settings.

### Visual Impairments

| Adaptation | Implementation |
|---|---|
| Full screen reader compatibility | All UI elements have ARIA roles, labels, and live regions |
| High contrast mode | CSS custom properties switch to WCAG AAA contrast ratios |
| Large text mode | Base font size scales to 20px+, UI elements resize proportionally |
| Voice-first interaction | Agent reads all outputs aloud via TTS, accepts voice commands |
| Image descriptions | Computer vision generates alt-text for screenshots and images |
| Browser automation narration | Agent describes what it sees and does during web browsing |
| No colour-only indicators | All status uses icons + text + colour, never colour alone |

### Motor Impairments

| Adaptation | Implementation |
|---|---|
| Voice control | Full agent control via speech commands |
| Switch access | Single-switch and dual-switch scanning support |
| Eye tracking integration | Tobii/eye tracker input mapped to agent actions |
| Keyboard-only navigation | Complete keyboard accessibility, no mouse required |
| Enlarged click targets | Minimum 44x44px touch/click targets (WCAG 2.5.8) |
| Reduced precision requirements | No drag-and-drop as sole interaction method |
| Dwell clicking | Configurable dwell time for click activation |
| Voice-to-desktop | Voice commands mapped to desktop automation actions |

### Cognitive Disabilities

| Adaptation | Implementation |
|---|---|
| Plain language | All agent responses use simple, clear language (reading age 12) |
| Step-by-step guidance | Complex tasks broken into numbered steps with progress indicator |
| Visual cues | Icons, colours, and illustrations support text explanations |
| Reduced choices | Maximum 3-4 options presented at once |
| Consistent layout | Fixed UI structure, no layout shifts |
| Task memory | Agent remembers where user left off, offers to resume |
| Error recovery | Clear, non-blaming error messages with suggested fix |
| Routine support | Agent learns daily routines and prompts at the right time |
| Social stories | Generate visual narratives for unfamiliar situations |

### Hearing Impairments

| Adaptation | Implementation |
|---|---|
| Visual notifications | All alerts use visual indicators, never sound alone |
| Caption support | Real-time captions for any audio content |
| Text-first communication | Default to text chat, voice is optional |
| Visual feedback | Animations and visual indicators for agent status |
| BSL/ASL support | Future: sign language avatar for agent responses |

### Learning Disabilities (Dyslexia, Dyscalculia, ADHD)

| Adaptation | Implementation |
|---|---|
| Dyslexia-friendly font | OpenDyslexic or similar font option |
| Increased line spacing | 1.8x line height, wider letter spacing |
| Reading ruler | Highlight line being read, dim surrounding text |
| Text-to-speech sync | Highlight words as they are read aloud |
| Colour overlays | Configurable background colour tints |
| Reduced motion | Disable animations for ADHD focus |
| Timer and break reminders | Pomodoro-style study session management |
| Simplified number display | Visual representations for dyscalculia |
| Focus mode | Hide non-essential UI during tasks |

---

## Accessibility Settings Schema

```typescript
interface AccessibilityProfile {
  // Vision
  vision: {
    screenReader: boolean           // enable screen reader optimisations
    highContrast: boolean           // WCAG AAA contrast mode
    largeText: boolean              // 20px+ base font
    fontSize: number                // custom font size (14-32)
    reduceTransparency: boolean     // solid backgrounds
    invertColors: boolean           // colour inversion
    colorBlindMode: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
  }

  // Motor
  motor: {
    voiceControl: boolean           // voice commands enabled
    switchAccess: boolean           // switch device support
    eyeTracking: boolean            // eye tracker integration
    dwellClick: boolean             // activate on hover/dwell
    dwellTimeMs: number             // dwell activation delay (500-3000)
    stickyKeys: boolean             // hold modifier keys
    slowKeys: boolean               // key repeat delay
    largeTargets: boolean           // 44px+ click targets
  }

  // Cognitive
  cognitive: {
    simplifiedLanguage: boolean     // plain language responses
    stepByStep: boolean             // break tasks into steps
    reducedChoices: boolean         // max 3-4 options
    consistentLayout: boolean       // fixed UI positions
    focusMode: boolean              // hide non-essential elements
    routineReminders: boolean       // prompt for daily routines
    readingLevel: 'simple' | 'standard' | 'advanced'
  }

  // Hearing
  hearing: {
    visualNotifications: boolean    // no sound-only alerts
    captions: boolean               // caption all audio
    captionFontSize: number         // caption text size
    flashAlerts: boolean            // screen flash for alerts
  }

  // Learning
  learning: {
    dyslexiaFont: boolean           // OpenDyslexic font
    lineSpacing: 'normal' | 'wide' | 'extra-wide'
    readingRuler: boolean           // highlight current line
    wordHighlight: boolean          // highlight words during TTS
    colorOverlay: 'none' | 'yellow' | 'blue' | 'green' | 'pink'
    reduceMotion: boolean           // no animations
    breakReminders: boolean         // study break alerts
    breakIntervalMin: number        // minutes between breaks
  }

  // Communication
  communication: {
    preferredModality: 'text' | 'voice' | 'both'
    speechRate: number              // TTS speed (0.5-2.0)
    speechVoice: string             // preferred TTS voice ID
    autoReadResponses: boolean      // read all responses aloud
    confirmBeforeSending: boolean   // confirm before agent sends messages on behalf
    aacEnabled: boolean             // augmentative communication mode
    predictiveText: boolean         // word/phrase prediction
  }
}
```

---

## Voice Interaction Architecture

Voice is the primary interaction modality for many PWD users. The voice system must be reliable, low-latency, and work offline.

### Voice Pipeline

```
User speaks
     |
     v
+------------------+     +------------------+     +------------------+
| Wake Word        | --> | Speech-to-Text   | --> | Intent           |
| Detection        |     | (STT)            |     | Classification   |
| (local, always   |     |                  |     |                  |
|  listening)      |     | Local: whisper    |     | Map to agent     |
|                  |     | Fallback: cloud   |     | commands/tasks   |
+------------------+     +------------------+     +------------------+
                                                          |
                                                          v
+------------------+     +------------------+     +------------------+
| Audio Output     | <-- | Text-to-Speech   | <-- | Agent Response   |
| (speakers)       |     | (TTS)            |     | Generation       |
|                  |     |                  |     |                  |
|                  |     | Local: Piper     |     |                  |
|                  |     | Fallback: cloud   |     |                  |
+------------------+     +------------------+     +------------------+
```

### Voice Commands

| Command Pattern | Action | Example |
|---|---|---|
| "Hey Neura, [task]" | Execute task | "Hey Neura, read my emails" |
| "Stop" / "Cancel" | Cancel current action | "Stop reading" |
| "Go back" | Undo last action | "Go back" after wrong click |
| "Click [element]" | Desktop/browser click | "Click the submit button" |
| "Type [text]" | Enter text | "Type hello world" |
| "Open [app/site]" | Launch application or website | "Open Google Chrome" |
| "Scroll [direction]" | Scroll page | "Scroll down" |
| "Read this" | Read selected text or screen | "Read this page" |
| "What's on screen?" | Describe current screen | "What's on screen?" |
| "Remember [fact]" | Store in memory | "Remember my doctor is Dr Smith" |
| "Help me with [task]" | Start guided workflow | "Help me pay my electric bill" |

### Wake Word Options

| Technology | Type | GitHub |
|---|---|---|
| **Porcupine** | Local wake word detection | [Picovoice/porcupine](https://github.com/Picovoice/porcupine) |
| **Snowboy** | Open-source wake word | [seasalt-ai/snowboy](https://github.com/seasalt-ai/snowboy) |
| **OpenWakeWord** | Open-source, customisable | [dscripka/openWakeWord](https://github.com/dscripka/openWakeWord) |

---

## Screen Reader Integration

Neura must coexist with and complement existing screen readers (NVDA, JAWS, VoiceOver, Orca).

### Coexistence Strategy

```
+-------------------------------------------+
|  User's Desktop                           |
|                                           |
|  +------------------+  +---------------+  |
|  | Screen Reader    |  | Neura Agent   |  |
|  | (NVDA/JAWS/VO)   |  |               |  |
|  |                  |  |               |  |
|  | Reads UI to      |  | Acts on       |  |
|  | user             |  | behalf of     |  |
|  |                  |  | user          |  |
|  +--------+---------+  +-------+-------+  |
|           |                     |          |
|           v                     v          |
|  +------------------------------------+   |
|  |  OS Accessibility API              |   |
|  |  (UIA / AX API / AT-SPI)          |   |
|  +------------------------------------+   |
|                     |                      |
|                     v                      |
|  +------------------------------------+   |
|  |  Applications                      |   |
|  +------------------------------------+   |
+-------------------------------------------+
```

### Integration Points

| Platform | API | Use |
|---|---|---|
| Windows | UI Automation (UIA) | Read app state, find elements, trigger actions |
| macOS | Accessibility API (AX) | Same as UIA for macOS apps |
| Linux | AT-SPI | Same as UIA for Linux/GNOME apps |
| Web | ARIA + DOM | Browser automation reads accessibility tree |

### Screen Reader Announcements

Neura announces its actions to the screen reader so the user always knows what's happening:

```typescript
function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite') {
  const liveRegion = document.getElementById('neura-announcer')
  liveRegion.setAttribute('aria-live', priority)
  liveRegion.textContent = message
}

// Usage during browser automation:
announceToScreenReader('Opening your bank website')
announceToScreenReader('Filling in your account number')
announceToScreenReader('Your balance is two hundred and forty-three pounds. Shall I pay the electricity bill?', 'assertive')
```

---

## Onboarding Flow for PWD Users

The onboarding experience adapts based on detected or self-reported needs:

```
Step 1: Welcome
  "Welcome to Neura. I'm your AI assistant for independent living and learning."
  "Would you like me to read everything aloud?" [Yes / No]
     |
     v
Step 2: How would you like to interact?
  [ Voice (speak to me) ]
  [ Keyboard (type to me) ]
  [ Both ]
  [ Switch device ]
     |
     v
Step 3: Tell me about your needs (optional, skip-able)
  [ ] I have a visual impairment
  [ ] I have a motor/physical disability
  [ ] I have a learning difference (dyslexia, ADHD, etc.)
  [ ] I have a hearing impairment
  [ ] I have a cognitive disability
  [ ] I'd rather not say (use default settings)
     |
     v
Step 4: Auto-configure accessibility settings
  Based on selections, enable relevant adaptations.
  Show preview. "Does this look/sound right?"
     |
     v
Step 5: Set autonomy level
  "How much should I do on my own?"
  [ Just suggest things ]          -> L1
  [ Do simple tasks for me ]       -> L2
  [ Handle multi-step tasks ]      -> L3
  [ Full assistant (with safety checks) ] -> L4
     |
     v
Step 6: Ready
  "I'm ready to help. Say 'Hey Neura' or click the Neura icon to start."
```

---

## WCAG 2.2 Compliance Targets

| Criterion | Level | Status | Implementation |
|---|---|---|---|
| 1.1.1 Non-text Content | A | Planned | All images have alt text, generated via vision model |
| 1.3.1 Info and Relationships | A | Partial | Semantic HTML, ARIA roles |
| 1.4.1 Use of Color | A | Done | No colour-only indicators |
| 1.4.3 Contrast (Minimum) | AA | Done | 4.5:1 ratio in default theme |
| 1.4.6 Contrast (Enhanced) | AAA | Done | 7:1 ratio in high-contrast mode |
| 1.4.10 Reflow | AA | Planned | Responsive layout, no horizontal scroll at 320px |
| 1.4.12 Text Spacing | AA | Done | Dyslexia mode increases spacing |
| 2.1.1 Keyboard | A | Partial | All interactive elements keyboard-accessible |
| 2.1.2 No Keyboard Trap | A | Done | Tab order flows naturally |
| 2.4.3 Focus Order | A | Done | Logical focus sequence |
| 2.4.7 Focus Visible | AA | Done | Enhanced focus indicators option |
| 2.5.5 Target Size | AAA | Planned | 44x44px minimum in large target mode |
| 2.5.8 Target Size (Minimum) | AA | Planned | 24x24px minimum always |
| 3.1.5 Reading Level | AAA | Planned | Plain language mode targets reading age 12 |
| 3.2.1 On Focus | A | Done | No unexpected changes on focus |
| 3.3.2 Labels or Instructions | A | Done | All inputs have visible labels |
| 4.1.2 Name, Role, Value | A | Partial | ARIA attributes on custom components |
| 4.1.3 Status Messages | AA | Planned | Live regions for agent status updates |

---

## Testing Accessibility

### Automated Testing

| Tool | Purpose | GitHub |
|---|---|---|
| **axe-core** | Automated WCAG rule checking | [dequelabs/axe-core](https://github.com/dequelabs/axe-core) |
| **pa11y** | CLI accessibility testing | [pa11y/pa11y](https://github.com/pa11y/pa11y) |
| **Lighthouse** | Chrome accessibility audit | Built into Chrome DevTools |
| **jest-axe** | Accessibility assertions in tests | [nickcolley/jest-axe](https://github.com/nickcolley/jest-axe) |

### Manual Testing Checklist

- [ ] Navigate entire UI using keyboard only
- [ ] Navigate entire UI using screen reader (NVDA on Windows, VoiceOver on macOS)
- [ ] Complete a task using voice commands only
- [ ] Complete a task with high contrast mode enabled
- [ ] Complete a task with dyslexia font enabled
- [ ] Complete a task with large text mode (200% zoom)
- [ ] Verify all images have meaningful alt text
- [ ] Verify all form fields have associated labels
- [ ] Verify no information is conveyed by colour alone
- [ ] Verify all error messages are announced to screen readers
- [ ] Verify agent status updates are announced via ARIA live regions
- [ ] Test with reduced motion preference enabled
- [ ] Test with a switch device or switch emulator

### User Testing

- Conduct usability testing with PWD users before every major release
- Maintain a panel of users representing different disability categories
- Record and address all accessibility barriers found during testing
- Publish accessibility statement with known issues and contact information

---

## Data: User Profile Storage

The accessibility profile is stored locally and never sent to cloud without explicit consent:

```
~/.neura/
  config.json           # General configuration
  memory.json           # Agent memory
  history.json          # Task history
  accessibility.json    # Accessibility profile (separate for privacy)
  routines.json         # Learned daily routines
  workflows.json        # Saved automation workflows
```

All files are user-readable JSON. Users can export, modify, or delete any file. The agent works with default settings if any file is missing.
