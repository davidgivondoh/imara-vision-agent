const WEB_RESEARCH_PATTERNS: RegExp[] = [
  /\bsearch\b.*\b(web|online|internet|google)\b/i,
  /\bgoogle\b/i,
  /\blook\s*up\b.*\b(web|online|internet)\b/i,
  /\bfind\b.*\b(online|on the web|on the internet|website|web site|links?)\b/i,
  /\bnews\b|\bheadlines\b/i,
  /\b(latest|today|recent|up[-\s]?to[-\s]?date|this week)\b/i,
  /\bprice\b|\bcost\b|\bavailability\b|\bin stock\b|\brelease date\b|\bschedule\b|\bscore\b|\bweather\b|\bexchange rate\b/i,
  /\bcitation\b|\bcitations\b|\bcite\b/i,
]

export function requiresWebResearch(text: string): boolean {
  if (!text) return false
  return WEB_RESEARCH_PATTERNS.some((re) => re.test(text))
}
