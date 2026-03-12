// ── Imara Vision Agent — Chat UI ─────────────────────────────

const API = '';
let ws = null;

// State
let conversations = JSON.parse(localStorage.getItem('neura_conversations') || '[]');
let activeConversationId = null;
let isProcessing = false;

// Voice
let recognition = null;
const synthesis = window.speechSynthesis;
let ttsEnabled = localStorage.getItem('neura_tts') !== 'false';
let ttsRate = parseFloat(localStorage.getItem('neura_tts_rate') || '1');
let ttsPitch = parseFloat(localStorage.getItem('neura_tts_pitch') || '1.05');
let ttsVoiceName = localStorage.getItem('neura_tts_voice') || '';

// Preferred female voices (ordered by quality/naturalness)
const FEMALE_VOICE_PREFS = [
  'Microsoft Zira', 'Zira', 'Samantha', 'Karen', 'Victoria', 'Moira',
  'Tessa', 'Google UK English Female', 'Google US English',
  'Microsoft Jenny', 'Jenny', 'Aria', 'Sara', 'Sonia',
  'Female', 'woman'
];

function pickFemaleVoice() {
  if (!synthesis) return null;
  const voices = synthesis.getVoices().filter(v => v.lang.startsWith('en'));
  // Try each preferred name in order
  for (const pref of FEMALE_VOICE_PREFS) {
    const match = voices.find(v => v.name.toLowerCase().includes(pref.toLowerCase()));
    if (match) return match;
  }
  // Fallback: any voice whose name hints at female
  const femHint = voices.find(v => /female|woman|zira|samantha|jenny|aria|sara|karen|victoria/i.test(v.name));
  if (femHint) return femHint;
  return voices[0] || null;
}
let voiceLang = localStorage.getItem('neura_voice_lang') || 'en-US';
let currentUtterance = null;

// Accessibility
let a11yFontSize = parseInt(localStorage.getItem('neura_a11y_fontsize') || '14');
let a11yLineSpacing = parseFloat(localStorage.getItem('neura_a11y_linespacing') || '1.6');
let a11yContrast = localStorage.getItem('neura_a11y_contrast') === 'true';
let a11yDyslexia = localStorage.getItem('neura_a11y_dyslexia') === 'true';
let a11yMotion = localStorage.getItem('neura_a11y_motion') === 'true';
let a11yFocus = localStorage.getItem('neura_a11y_focus') === 'true';
let voiceAutosubmit = localStorage.getItem('neura_voice_autosubmit') !== 'false';
let confirmActions = localStorage.getItem('neura_confirm_actions') !== 'false';
let simpleResponses = localStorage.getItem('neura_simple_responses') === 'true';

// DOM
const sidebar = document.getElementById('sidebar');
const sidebarCollapse = document.getElementById('sidebar-collapse');
const sidebarOpen = document.getElementById('sidebar-open');
const newChatBtn = document.getElementById('new-chat-btn');
const convList = document.getElementById('conversation-list');
const welcome = document.getElementById('welcome');
const messages = document.getElementById('messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtnHero = document.getElementById('voice-btn-hero');
const voiceBtnInline = document.getElementById('voice-btn-inline');
const voiceBtnTopbar = document.getElementById('voice-btn-topbar');
const voiceOverlay = document.getElementById('voice-overlay');
const voiceStopBtn = document.getElementById('voice-stop-btn');
const voiceCancelBtn = document.getElementById('voice-cancel-btn');
const voiceTranscript = document.getElementById('voice-transcript');
const topbarTitle = document.getElementById('topbar-title');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');

// ── Sidebar ─────────────────────────────────────────────────
sidebarCollapse.addEventListener('click', () => {
  sidebar.classList.add('collapsed');
  sidebarOpen.style.display = 'flex';
});
sidebarOpen.addEventListener('click', () => {
  sidebar.classList.remove('collapsed');
  sidebarOpen.style.display = 'none';
});

// ── New chat ────────────────────────────────────────────────
newChatBtn.addEventListener('click', () => startNewChat());

function startNewChat() {
  stopSpeaking();
  activeConversationId = null;
  messages.innerHTML = '';
  messages.classList.remove('has-messages');
  welcome.style.display = 'flex';
  topbarTitle.textContent = 'New conversation';
  renderConvList();
}

// ── Attachments ─────────────────────────────────────────────
let attachedFiles = [];
const attachmentsEl = document.getElementById('input-attachments');
const fileInput = document.getElementById('file-input');

document.getElementById('attach-btn').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const hasImages = [...e.target.files].some(f => f.type.startsWith('image/'));
  addFiles(e.target.files, hasImages ? 'image' : 'file');
});

function addFiles(fileList, type) {
  if (!fileList || !fileList.length) return;
  for (const f of fileList) {
    if (attachedFiles.length >= 5) { toast('Maximum 5 files', 'error'); break; }
    if (f.size > 10 * 1024 * 1024) { toast(f.name + ' is too large (max 10 MB)', 'error'); continue; }
    attachedFiles.push({ file: f, type, id: uid() });
  }
  renderAttachments();
  updateSendState();
  fileInput.value = '';
}

function removeFile(id) {
  attachedFiles = attachedFiles.filter(f => f.id !== id);
  renderAttachments();
  updateSendState();
}

function renderAttachments() {
  if (!attachedFiles.length) { attachmentsEl.style.display = 'none'; return; }
  attachmentsEl.style.display = 'flex';
  attachmentsEl.innerHTML = attachedFiles.map(f => {
    if (f.type === 'image') {
      const url = URL.createObjectURL(f.file);
      return `<span class="attachment-chip is-image" data-id="${f.id}">
        <img src="${url}" alt="${esc(f.file.name)}" />
        <button class="attachment-remove" data-remove="${f.id}" aria-label="Remove ${esc(f.file.name)}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </span>`;
    }
    const ext = f.file.name.split('.').pop().toUpperCase();
    return `<span class="attachment-chip" data-id="${f.id}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="attachment-name">${esc(f.file.name)}</span>
      <span style="font-size:10px;color:var(--gray-400)">${ext}</span>
      <button class="attachment-remove" data-remove="${f.id}" aria-label="Remove ${esc(f.file.name)}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </span>`;
  }).join('');
  attachmentsEl.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removeFile(btn.dataset.remove); });
  });
}

function updateSendState() {
  sendBtn.disabled = (!chatInput.value.trim() && !attachedFiles.length) || isProcessing;
}

// ── Input ───────────────────────────────────────────────────
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  updateSendState();
});
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendMessage(); }
});
sendBtn.addEventListener('click', () => { if (!sendBtn.disabled) sendMessage(); });

// Drag and drop files
const inputBox = document.querySelector('.input-box');
inputBox.addEventListener('dragover', (e) => { e.preventDefault(); inputBox.classList.add('drag-over'); });
inputBox.addEventListener('dragleave', () => inputBox.classList.remove('drag-over'));
inputBox.addEventListener('drop', (e) => {
  e.preventDefault();
  inputBox.classList.remove('drag-over');
  if (e.dataTransfer.files.length) {
    const hasImages = [...e.dataTransfer.files].some(f => f.type.startsWith('image/'));
    addFiles(e.dataTransfer.files, hasImages ? 'image' : 'file');
  }
});

// ── Voice recognition ───────────────────────────────────────
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = voiceLang;
  let final = '';

  rec.onresult = (e) => {
    let interim = '';
    final = '';
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    voiceTranscript.textContent = final + interim || 'Listening...';
  };

  rec.onend = () => {
    voiceOverlay.style.display = 'none';
    voiceBtnInline.classList.remove('listening');
    if (final.trim()) {
      chatInput.value = final.trim();
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
      updateSendState();
      if (voiceAutosubmit) sendMessage();
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    voiceOverlay.style.display = 'none';
    voiceBtnInline.classList.remove('listening');
    toast('Mic error: ' + e.error, 'error');
  };
  return rec;
}

function startListening() {
  stopSpeaking();
  if (!recognition) recognition = initRecognition();
  if (!recognition) { toast('Voice not supported in this browser.', 'error'); return; }
  voiceTranscript.textContent = 'Listening...';
  voiceOverlay.style.display = 'flex';
  voiceBtnInline.classList.add('listening');
  try { recognition.start(); } catch {}
}

function stopListening(submit) {
  if (!recognition) return;
  if (!submit) {
    // Cancel — hide overlay immediately and discard transcript
    voiceOverlay.style.display = 'none';
    voiceBtnInline.classList.remove('listening');
    recognition.onend = () => {};
    recognition.stop();
    recognition = null;
  } else {
    // Submit — let onend handle hiding + sending (overlay stays visible until onend fires)
    recognition.stop();
  }
}

voiceBtnHero.addEventListener('click', startListening);
voiceBtnTopbar.addEventListener('click', () => {
  voiceBtnInline.classList.contains('listening') ? stopListening(true) : startListening();
});
voiceBtnInline.addEventListener('click', () => {
  voiceBtnInline.classList.contains('listening') ? stopListening(true) : startListening();
});
voiceStopBtn.addEventListener('click', () => stopListening(true));
voiceCancelBtn.addEventListener('click', () => stopListening(false));

// ── TTS ─────────────────────────────────────────────────────
function speak(text, el) {
  if (!ttsEnabled || !synthesis) return;
  stopSpeaking();

  const clean = text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#{1,3} /gm, '')
    .replace(/^[\-\*] /gm, '')
    .replace(/^\d+\. /gm, '')
    .replace(/^> /gm, '')
    .trim();
  if (!clean) return;

  currentUtterance = new SpeechSynthesisUtterance(clean);
  currentUtterance.rate = ttsRate;
  currentUtterance.pitch = ttsPitch;
  if (ttsVoiceName && synthesis) {
    const voice = synthesis.getVoices().find(v => v.name === ttsVoiceName);
    if (voice) currentUtterance.voice = voice;
  } else {
    const femVoice = pickFemaleVoice();
    if (femVoice) currentUtterance.voice = femVoice;
  }

  if (el) {
    const head = el.querySelector('.msg-head');
    if (head) {
      const old = head.querySelector('.msg-speaking, .msg-listen');
      if (old) old.remove();
      const ind = document.createElement('span');
      ind.className = 'msg-speaking';
      ind.innerHTML = '<span class="eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>Speaking';
      ind.addEventListener('click', () => stopSpeaking());
      head.appendChild(ind);
    }
  }

  const onDone = () => {
    currentUtterance = null;
    if (el) { const s = el.querySelector('.msg-speaking'); if (s) { s.remove(); addListenBtn(el); } }
  };
  currentUtterance.onend = onDone;
  currentUtterance.onerror = onDone;
  synthesis.speak(currentUtterance);
}

function stopSpeaking() {
  if (synthesis) synthesis.cancel();
  currentUtterance = null;
  document.querySelectorAll('.msg-speaking').forEach(s => {
    const m = s.closest('.message'); s.remove(); if (m) addListenBtn(m);
  });
}

function addListenBtn(el) {
  const head = el.querySelector('.msg-head');
  if (!head || head.querySelector('.msg-listen') || head.querySelector('.msg-speaking')) return;
  const btn = document.createElement('button');
  btn.className = 'msg-listen';
  btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>Listen';
  btn.addEventListener('click', () => {
    const t = el.querySelector('.msg-body')?.textContent || '';
    btn.remove();
    speak(t, el);
  });
  head.appendChild(btn);
}

// ── Inline thinking + streaming answer ────────────────────────
let activeTaskId = null;
let taskStartTime = null;
let thinkingTextEl = null;   // the <span> inside the collapsible thinking block
let thinkingMsgEl = null;    // the current streaming message element
let tokenStreamEl = null;    // the raw stream display during LLM generation
let tokenBuffer = '';        // accumulates tokens for the current answer
let mdRenderTimer = null;    // timer for progressive markdown rendering
const READING_SPEED_WPM = 350; // human-readable word reveal speed
const READING_DELAY = Math.round(60000 / READING_SPEED_WPM); // ~170ms per word
const MD_RENDER_INTERVAL = 120; // re-render markdown every 120ms during streaming

// Format tool names for display (e.g. "browser_read" → "Browser Read")
function formatToolName(name) {
  const labels = {
    web_search: 'Web Search',
    browser_navigate: 'Browser Navigate',
    browser_read: 'Reading Page',
    browser_screenshot: 'Screenshot',
    browser_click: 'Clicking Element',
    browser_fill: 'Filling Form',
    browser_select: 'Selecting Option',
    browser_scroll: 'Scrolling Page',
    browser_dom: 'Inspecting DOM',
    browser_extract: 'Extracting Data',
    browser_pdf: 'Saving PDF',
    browser_wait: 'Waiting',
    screen_capture: 'Screen Capture',
    mouse_click: 'Mouse Click',
    keyboard_type: 'Typing',
    get_active_window: 'Active Window',
    list_windows: 'Listing Windows',
    open_application: 'Opening App',
    clipboard_read: 'Reading Clipboard',
    clipboard_write: 'Writing Clipboard',
    read_file: 'Reading File',
    write_file: 'Writing File',
    list_directory: 'Listing Directory',
    search_files: 'Searching Files',
    file_info: 'File Info',
    run_command: 'Running Command',
    code_execute: 'Running Code',
    system_info: 'System Info',
    page_audit: 'Page Audit',
    page_snapshot: 'Page Snapshot',
    page_monitor: 'Page Monitor',
  };
  return labels[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Append a short status line to the thinking block
function appendThinkingLine(text) {
  if (!thinkingTextEl) return;
  // Clean text: strip markdown, JSON, emojis, and code fences
  let clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*_>`~\[\]{}|]/g, '')
    .replace(/\{[\s\S]*?\}/g, '')
    .replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length < 3) return;
  // Limit to reasonable length
  if (clean.length > 80) clean = clean.slice(0, 80) + '...';
  const line = document.createElement('div');
  line.className = 'thinking-line';
  line.textContent = clean;
  thinkingTextEl.appendChild(line);
  scrollDown();
}

// Build a single short status from stage completion
function statusForStep(stage, output) {
  if (stage === 'sense') {
    const n = output?.relevantMemories?.length ?? 0;
    return n > 0 ? `Found ${n} relevant memor${n === 1 ? 'y' : 'ies'}` : 'No prior context found';
  }
  if (stage === 'interpret') {
    const pct = Math.round((output?.confidence ?? 0) * 100);
    return pct > 0 ? `Understood with ${pct}% confidence` : 'Request analysed';
  }
  if (stage === 'plan') {
    const n = output?.actions?.length ?? 0;
    return n > 0 ? `Prepared ${n} action${n > 1 ? 's' : ''}` : 'Strategy ready';
  }
  if (stage === 'act') {
    const tools = output?.toolsUsed ?? [];
    if (output?.orchestrated) return `Completed ${output.subtaskCount ?? 0} sub-tasks`;
    if (tools.length > 0) {
      const names = tools.slice(0, 3).map(t => typeof t === 'string' ? t : t.name || 'tool');
      return `Used ${names.join(', ')}`;
    }
    return output?.executed === false ? (output?.reason || 'Skipped') : 'Response generated';
  }
  if (stage === 'verify') {
    const q = Math.round((output?.quality ?? 0) * 100);
    return q > 0 ? `Quality: ${q}%` : null;
  }
  if (stage === 'adapt') {
    if (output?.memoryUpdated) return 'Saved to memory';
    return null;
  }
  return null;
}

// Create the agent message with collapsible thinking + answer area
function createStreamingMessage() {
  const el = document.createElement('div');
  el.className = 'message agent';
  el.innerHTML = `<div class="msg-inner">
    <div class="msg-head">
      <span class="msg-avatar"><svg width="12" height="12" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="8" stroke="white" stroke-width="1.5"/><circle cx="14" cy="14" r="3" fill="white"/></svg></span>
      <span class="msg-name">Imara</span>
    </div>
    <div class="msg-thinking" id="msg-thinking">
      <button class="thinking-toggle" id="thinking-toggle">
        <svg class="thinking-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="thinking-status" id="thinking-status">Thinking...</span>
      </button>
      <div class="thinking-body" id="thinking-body">
        <div class="thinking-content" id="thinking-content"></div>
      </div>
    </div>
    <div class="msg-stream-raw" id="msg-stream-raw" style="display:none">
      <div class="stream-raw-content" id="stream-raw-content"></div>
    </div>
    <div class="msg-body msg-answer" id="msg-answer" style="display:none"></div>
    <div class="msg-meta" id="msg-meta" style="display:none"></div>
  </div>`;
  messages.appendChild(el);

  // Toggle thinking visibility
  const toggle = el.querySelector('#thinking-toggle');
  const body = el.querySelector('#thinking-body');
  toggle.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    toggle.classList.toggle('collapsed', open);
  });

  return el;
}

function startThinking(taskId, msgEl) {
  activeTaskId = taskId;
  taskStartTime = Date.now();
  thinkingMsgEl = msgEl;
  thinkingTextEl = msgEl.querySelector('#thinking-content');
  thinkingTextEl.innerHTML = '';

  // Subscribe via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'subscribe', taskId }));
  }
}

function updateStageRunning(stage) {
  const labels = {
    sense:     'Thinking...',
    interpret: 'Analysing your request...',
    plan:      'Planning approach...',
    act:       'Generating response...',
    verify:    'Summarising findings...',
    adapt:     'Learning...',
  };
  // Update the status label
  const statusEl = thinkingMsgEl?.querySelector('#thinking-status');
  if (statusEl) statusEl.textContent = labels[stage] || 'Processing...';
  // Also add to thinking content for visibility
  if (stage !== 'act') appendThinkingLine(labels[stage] || 'Processing...');
}

function updateStageDone(stage, durationMs, output) {
  const line = statusForStep(stage, output);
  if (line) appendThinkingLine(line);
}

// Render the final answer with a smooth fade-in (no word-by-word delay)
function streamAnswer(msgEl, text, opts) {
  return new Promise((resolve) => {
    // Collapse thinking, update status
    const body = msgEl.querySelector('#thinking-body');
    const toggle = msgEl.querySelector('#thinking-toggle');
    const statusEl = msgEl.querySelector('#thinking-status');
    const elapsed = taskStartTime ? fmtMs(Date.now() - taskStartTime) : '';
    if (statusEl) statusEl.textContent = `Thought for ${elapsed}`;
    if (body) body.style.display = 'none';
    if (toggle) toggle.classList.add('collapsed');

    const answerEl = msgEl.querySelector('#msg-answer');
    answerEl.style.display = '';

    // Strip emojis, render markdown
    const cleanText = text.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, '').trim();
    answerEl.innerHTML = md(cleanText);

    // Show meta
    if (opts.confidence != null) {
      const metaEl = msgEl.querySelector('#msg-meta');
      const p = Math.round(opts.confidence * 100);
      const lv = p >= 85 ? 'high' : p >= 65 ? 'med' : 'low';
      metaEl.innerHTML = `<span class="badge-conf ${lv}">${p}%</span><span>${fmtMs(opts.durationMs)}</span>`;
      metaEl.style.display = '';
    }
    scrollDown();
    resolve();
  });
}

function finishActivity() {
  activeTaskId = null;
  thinkingTextEl = null;
  thinkingMsgEl = null;
  tokenStreamEl = null;
  tokenBuffer = '';
  if (mdRenderTimer) { clearInterval(mdRenderTimer); mdRenderTimer = null; }
}

// ── Send ────────────────────────────────────────────────────
async function sendMessage() {
  const text = chatInput.value.trim();
  if ((!text && !attachedFiles.length) || isProcessing) return;
  stopSpeaking();
  isProcessing = true;
  sendBtn.disabled = true;

  // Build display text with attachment info
  const fileNames = attachedFiles.map(f => f.file.name);
  const displayText = text || 'Analyse attached file' + (fileNames.length > 1 ? 's' : '');
  const fullInstruction = fileNames.length
    ? (text ? text + '\n\n' : '') + '[Attached: ' + fileNames.join(', ') + ']'
    : text;

  // Clear input
  chatInput.value = '';
  chatInput.style.height = 'auto';
  attachedFiles = [];
  renderAttachments();

  if (!activeConversationId) {
    const c = createConv(displayText);
    activeConversationId = c.id;
    welcome.style.display = 'none';
    messages.classList.add('has-messages');
    topbarTitle.textContent = c.title;
    renderConvList();
  }

  addMsg(activeConversationId, 'user', displayText);
  renderUser(displayText);

  // Create the streaming message element with "Thinking..."
  const msgEl = createStreamingMessage();
  scrollDown();

  try {
    // Single API call: create + execute immediately
    const data = await api('/api/agent/stream', {
      method: 'POST',
      body: JSON.stringify({ instruction: fullInstruction }),
    });

    if (!data.success) {
      msgEl.remove();
      const e = data.error?.message || 'Failed to start task.';
      addMsg(activeConversationId, 'agent', e, { error: true });
      renderAgent(e, { error: true });
      isProcessing = false;
      updateSendState();
      return;
    }

    // Start thinking — tokens will arrive via WebSocket
    startThinking(data.taskId, msgEl);

    // Wait for completion (tokens stream via WS in real-time, answer finalizes on task.completed)
    const result = await waitForTaskDone(data.taskId, 120000);

    // Fallback: if no tokens were streamed (e.g. local provider), show result directly
    if (!msgEl._answerStreamed && !msgEl._tokenStreaming) {
      if (result && result.success) {
        const t = result.summary || 'Task completed.';
        const conf = result.confidence ?? 0;
        const dur = result.durationMs ?? 0;

        await streamAnswer(msgEl, t, { confidence: conf, durationMs: dur });

        addMsg(activeConversationId, 'agent', t, { confidence: conf, durationMs: dur, success: true });
        addListenBtn(msgEl);
        speak(t, msgEl);
      } else {
        const e = result?.summary || 'Something went wrong.';
        const answerEl = msgEl.querySelector('#msg-answer');
        answerEl.style.display = '';
        answerEl.innerHTML = `<div class="msg-error">${esc(e)}</div>`;
        addMsg(activeConversationId, 'agent', e, { error: true });
      }
    }

    finishActivity();
  } catch (err) {
    msgEl.remove();
    const e = 'Connection error: ' + err.message;
    addMsg(activeConversationId, 'agent', e, { error: true });
    renderAgent(e, { error: true });
    finishActivity();
  }

  isProcessing = false;
  updateSendState();
  scrollDown();
}

// Wait for task.completed WebSocket event, with HTTP polling fallback
function waitForTaskDone(taskId, timeoutMs) {
  return new Promise((resolve) => {
    let resolved = false;

    // Listen for WS completion
    const handler = (event) => {
      if (resolved) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'task.completed' && msg.taskId === taskId) {
          resolved = true;
          ws?.removeEventListener('message', handler);
          resolve(msg.result);
        }
      } catch {}
    };
    if (ws) ws.addEventListener('message', handler);

    // Fallback: poll the task status if WS doesn't deliver
    const pollInterval = setInterval(async () => {
      if (resolved) { clearInterval(pollInterval); return; }
      try {
        const d = await api(`/api/agent/tasks/${taskId}`);
        if (d.task?.status === 'completed' || d.task?.status === 'failed') {
          resolved = true;
          clearInterval(pollInterval);
          ws?.removeEventListener('message', handler);
          resolve(d.task.result);
        }
      } catch {}
    }, 500);

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(pollInterval);
        ws?.removeEventListener('message', handler);
        resolve({ success: false, summary: 'Task timed out' });
      }
    }, timeoutMs);
  });
}

// ── Render ──────────────────────────────────────────────────
function renderUser(text) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `<div class="msg-inner"><div class="msg-head"><span class="msg-avatar">U</span><span class="msg-name">You</span></div><div class="msg-body">${esc(text)}</div></div>`;
  messages.appendChild(el);
  return el;
}

function renderAgent(text, opts = {}) {
  const el = document.createElement('div');
  el.className = 'message agent';

  let meta = '';
  if (!opts.error && opts.confidence != null) {
    const p = Math.round(opts.confidence * 100);
    const lv = p >= 85 ? 'high' : p >= 65 ? 'med' : 'low';
    meta = `<div class="msg-meta"><span class="badge-conf ${lv}">${p}%</span><span>${fmtMs(opts.durationMs)}</span></div>`;
  }

  const body = opts.error
    ? `<div class="msg-error">${esc(text)}</div>`
    : `<div class="msg-body">${md(text)}</div>`;

  el.innerHTML = `<div class="msg-inner">
    <div class="msg-head">
      <span class="msg-avatar"><svg width="12" height="12" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="8" stroke="white" stroke-width="1.5"/><circle cx="14" cy="14" r="3" fill="white"/></svg></span>
      <span class="msg-name">Imara</span>
    </div>
    ${body}${meta}
  </div>`;
  messages.appendChild(el);
  if (!opts.error) addListenBtn(el);
  return el;
}

function renderTyping() {
  const el = document.createElement('div');
  el.className = 'message agent';
  el.innerHTML = `<div class="msg-inner">
    <div class="msg-head"><span class="msg-avatar"><svg width="12" height="12" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="8" stroke="white" stroke-width="1.5"/><circle cx="14" cy="14" r="3" fill="white"/></svg></span><span class="msg-name">Imara</span></div>
    <div class="typing"><span></span><span></span><span></span></div>
  </div>`;
  messages.appendChild(el);
  scrollDown();
  return el;
}

// ── Conversations ───────────────────────────────────────────
function createConv(first) {
  const c = { id: uid(), title: first.slice(0, 50) + (first.length > 50 ? '...' : ''), createdAt: Date.now(), messages: [] };
  conversations.unshift(c);
  saveConvs();
  return c;
}

function addMsg(cid, role, text, meta = {}) {
  const c = conversations.find(x => x.id === cid);
  if (c) { c.messages.push({ role, text, meta, ts: Date.now() }); saveConvs(); }
}

function deleteConv(id) {
  conversations = conversations.filter(c => c.id !== id);
  saveConvs();
  if (activeConversationId === id) startNewChat();
  renderConvList();
}

function loadConv(id) {
  const c = conversations.find(x => x.id === id);
  if (!c) return;
  stopSpeaking();
  activeConversationId = id;
  messages.innerHTML = '';
  welcome.style.display = 'none';
  messages.classList.add('has-messages');
  topbarTitle.textContent = c.title;
  c.messages.forEach(m => m.role === 'user' ? renderUser(m.text) : renderAgent(m.text, m.meta || {}));
  renderConvList();
  scrollDown();
}

function saveConvs() {
  // Keep only the 5 most recent conversations
  if (conversations.length > 5) conversations = conversations.slice(0, 5);
  localStorage.setItem('neura_conversations', JSON.stringify(conversations));
}

function renderConvList() {
  if (!conversations.length) {
    convList.innerHTML = '<div style="padding:20px 8px;text-align:center;font-size:12px;color:var(--gray-400)">No conversations</div>';
    return;
  }
  // Show only the 5 most recent conversations
  const MAX_RECENT = 5;
  const recent = conversations.slice(0, MAX_RECENT);
  const now = new Date();
  const g = { today: [], yesterday: [], week: [], older: [] };
  recent.forEach(c => {
    const d = Math.floor((now - new Date(c.createdAt)) / 864e5);
    (d === 0 ? g.today : d === 1 ? g.yesterday : d < 7 ? g.week : g.older).push(c);
  });

  let h = '';
  const rg = (label, items) => {
    if (!items.length) return '';
    let s = `<div class="conv-date-group">${label}</div>`;
    items.forEach(c => {
      s += `<div class="conv-item ${c.id === activeConversationId ? 'active' : ''}" data-id="${c.id}">
        <span class="conv-title">${esc(c.title)}</span>
        <button class="conv-delete" data-del="${c.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
      </div>`;
    });
    return s;
  };
  h += rg('Today', g.today) + rg('Yesterday', g.yesterday) + rg('Previous 7 days', g.week) + rg('Older', g.older);
  convList.innerHTML = h;

  convList.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', (e) => { if (!e.target.closest('.conv-delete')) loadConv(el.dataset.id); });
  });
  convList.querySelectorAll('.conv-delete').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteConv(b.dataset.del); });
  });
}

// ── Accessibility helpers ────────────────────────────────────
function applyA11y() {
  document.documentElement.style.fontSize = a11yFontSize + 'px';
  document.documentElement.style.lineHeight = String(a11yLineSpacing);
  document.body.classList.toggle('high-contrast', a11yContrast);
  document.body.classList.toggle('dyslexia-font', a11yDyslexia);
  document.body.classList.toggle('reduce-motion', a11yMotion);
  document.body.classList.toggle('enhanced-focus', a11yFocus);
}
applyA11y();

function isFemaleVoice(v) {
  return /female|woman|zira|samantha|jenny|aria|sara|karen|victoria|moira|tessa|sonia/i.test(v.name);
}

function populateVoices() {
  const sel = document.getElementById('tts-voice');
  if (!sel || !synthesis) return;
  const voices = synthesis.getVoices();
  const english = voices.filter(v => v.lang.startsWith('en'));
  const female = english.filter(isFemaleVoice);
  const other = english.filter(v => !isFemaleVoice(v));
  const nonEnglish = voices.filter(v => !v.lang.startsWith('en'));

  // Auto-select a female voice if user hasn't chosen one yet
  if (!ttsVoiceName && female.length) {
    const best = pickFemaleVoice();
    if (best) {
      ttsVoiceName = best.name;
      localStorage.setItem('neura_tts_voice', ttsVoiceName);
    }
  }

  sel.innerHTML = '';
  if (female.length) {
    const grp = document.createElement('optgroup');
    grp.label = 'Recommended voices';
    female.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
      if (v.name === ttsVoiceName) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }
  if (other.length) {
    const grp = document.createElement('optgroup');
    grp.label = 'Other English voices';
    other.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
      if (v.name === ttsVoiceName) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }
  if (nonEnglish.length) {
    const grp = document.createElement('optgroup');
    grp.label = 'Other languages';
    nonEnglish.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
      if (v.name === ttsVoiceName) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }
}
if (synthesis) {
  synthesis.addEventListener('voiceschanged', populateVoices);
  populateVoices();
}

// ── Settings ────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => { settingsModal.style.display = 'flex'; loadSettings(); populateVoices(); });
settingsClose.addEventListener('click', () => { settingsModal.style.display = 'none'; });
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none'; });

// Voice & Speech
document.getElementById('tts-toggle').checked = ttsEnabled;
document.getElementById('tts-toggle').addEventListener('change', (e) => { ttsEnabled = e.target.checked; localStorage.setItem('neura_tts', ttsEnabled); if (!ttsEnabled) stopSpeaking(); });
document.getElementById('tts-rate').value = String(ttsRate);
document.getElementById('tts-rate').addEventListener('change', (e) => { ttsRate = parseFloat(e.target.value); localStorage.setItem('neura_tts_rate', ttsRate); });
document.getElementById('tts-voice').addEventListener('change', (e) => { ttsVoiceName = e.target.value; localStorage.setItem('neura_tts_voice', ttsVoiceName); });
document.getElementById('voice-lang').value = voiceLang;
document.getElementById('voice-lang').addEventListener('change', (e) => { voiceLang = e.target.value; localStorage.setItem('neura_voice_lang', voiceLang); if (recognition) { recognition = null; } });

// Accessibility
document.getElementById('a11y-fontsize').value = String(a11yFontSize);
document.getElementById('a11y-fontsize').addEventListener('change', (e) => { a11yFontSize = parseInt(e.target.value); localStorage.setItem('neura_a11y_fontsize', a11yFontSize); applyA11y(); });
document.getElementById('a11y-linespacing').value = String(a11yLineSpacing);
document.getElementById('a11y-linespacing').addEventListener('change', (e) => { a11yLineSpacing = parseFloat(e.target.value); localStorage.setItem('neura_a11y_linespacing', a11yLineSpacing); applyA11y(); });
document.getElementById('a11y-contrast').checked = a11yContrast;
document.getElementById('a11y-contrast').addEventListener('change', (e) => { a11yContrast = e.target.checked; localStorage.setItem('neura_a11y_contrast', a11yContrast); applyA11y(); });
document.getElementById('a11y-dyslexia').checked = a11yDyslexia;
document.getElementById('a11y-dyslexia').addEventListener('change', (e) => { a11yDyslexia = e.target.checked; localStorage.setItem('neura_a11y_dyslexia', a11yDyslexia); applyA11y(); });
document.getElementById('a11y-motion').checked = a11yMotion;
document.getElementById('a11y-motion').addEventListener('change', (e) => { a11yMotion = e.target.checked; localStorage.setItem('neura_a11y_motion', a11yMotion); applyA11y(); });
document.getElementById('a11y-focus').checked = a11yFocus;
document.getElementById('a11y-focus').addEventListener('change', (e) => { a11yFocus = e.target.checked; localStorage.setItem('neura_a11y_focus', a11yFocus); applyA11y(); });

// Interaction
document.getElementById('voice-autosubmit').checked = voiceAutosubmit;
document.getElementById('voice-autosubmit').addEventListener('change', (e) => { voiceAutosubmit = e.target.checked; localStorage.setItem('neura_voice_autosubmit', voiceAutosubmit); });
document.getElementById('confirm-actions').checked = confirmActions;
document.getElementById('confirm-actions').addEventListener('change', (e) => { confirmActions = e.target.checked; localStorage.setItem('neura_confirm_actions', confirmActions); });
document.getElementById('simple-responses').checked = simpleResponses;
document.getElementById('simple-responses').addEventListener('change', (e) => { simpleResponses = e.target.checked; localStorage.setItem('neura_simple_responses', simpleResponses); });

// ── Capability toggles ──────────────────────────────────────
const capabilityIds = ['cap-web', 'cap-desktop', 'cap-files', 'cap-code', 'cap-vision', 'cap-summariser', 'cap-revision', 'cap-a11y'];
capabilityIds.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  // Restore saved state (default: on)
  const saved = localStorage.getItem('neura_' + id);
  el.checked = saved !== 'false';
  el.addEventListener('change', () => {
    localStorage.setItem('neura_' + id, el.checked);
  });
});

function friendlyInference(val) {
  if (!val) return 'Unknown';
  if (val === 'ollama') return 'Ollama (local LLM)';
  if (val === 'rule-based') return 'Basic (no LLM)';
  if (val === 'local') return 'On this device';
  if (val === 'cloud') return 'Cloud AI';
  if (val === 'hybrid') return 'Mixed';
  return val;
}

async function loadSettings() {
  try {
    const [h, pl, cf, mem] = await Promise.all([api('/api/agent/health'), api('/api/agent/plugins'), api('/api/agent/config'), api('/api/agent/memory/export')]);

    // Status banner
    const isHealthy = h.status === 'healthy';
    const hEl = document.getElementById('status-health');
    const dot = document.getElementById('settings-status-dot');
    const subLine = document.getElementById('status-summary-line');
    hEl.textContent = isHealthy ? 'Imara is ready' : 'Imara is offline';
    hEl.className = 's-status-headline ' + (isHealthy ? 'healthy' : 'offline');
    dot.className = 's-status-dot ' + (isHealthy ? 'green' : 'red');

    // Build a friendly summary line
    const parts = [];
    const uptime = fmtMs(h.uptime * 1000);
    if (uptime) parts.push(`Running for ${uptime}`);
    const infText = friendlyInference(h.inference);
    parts.push(`Using ${infText}`);
    const taskCount = h.tasks?.total ?? 0;
    if (taskCount > 0) parts.push(`${taskCount} task${taskCount > 1 ? 's' : ''} completed`);
    subLine.textContent = parts.join('  ·  ');

    // Memory count
    document.getElementById('settings-memory-count').textContent = mem.count ?? 0;

    // Sync capability toggles with actual server state
    if (pl.success && pl.plugins.length) {
      const pluginMap = { 'note-summariser': 'cap-summariser', 'revision-planner': 'cap-revision', 'accessibility-assist': 'cap-a11y' };
      pl.plugins.forEach(p => {
        const capId = pluginMap[p.name];
        if (capId) {
          const el = document.getElementById(capId);
          if (el && p.status !== 'active') el.checked = false;
        }
      });
    }

    // Config toggles — sync from server values
    if (cf.success) {
      const c = cf.config;
      if (c.privacy) {
        if (c.privacy.localInference != null) document.getElementById('cfg-local-inference').checked = c.privacy.localInference;
        if (c.privacy.piiDetection != null) document.getElementById('cfg-pii-detection').checked = c.privacy.piiDetection;
        if (c.privacy.telemetryEnabled != null) document.getElementById('cfg-telemetry').checked = c.privacy.telemetryEnabled;
      }
      if (c.agent) {
        if (c.agent.autonomyLevel) document.getElementById('cfg-autonomy').value = c.agent.autonomyLevel;
        if (c.agent.confirmIrreversible != null) document.getElementById('cfg-confirm-irreversible').checked = c.agent.confirmIrreversible;
      }
    }
  } catch {
    document.getElementById('status-health').textContent = 'Imara is offline';
    document.getElementById('status-health').className = 's-status-headline offline';
    document.getElementById('settings-status-dot').className = 's-status-dot red';
    document.getElementById('status-summary-line').textContent = 'Could not connect to the agent';
  }
}

document.getElementById('export-memory-btn').addEventListener('click', async () => {
  try { const d = await api('/api/agent/memory/export'); const b = new Blob([JSON.stringify(d.entries, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'neura-memory.json'; a.click(); URL.revokeObjectURL(u); toast('Exported', 'success'); } catch { toast('Export failed', 'error'); }
});
document.getElementById('clear-memory-btn').addEventListener('click', async () => {
  if (!confirm('Clear all agent memory?')) return;
  try { await api('/api/agent/memory', { method: 'DELETE' }); toast('Cleared', 'success'); loadSettings(); } catch { toast('Failed', 'error'); }
});

// ── WebSocket ───────────────────────────────────────────────
function connectWS() {
  const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${p}//${location.host}/ws/agent/stream`);
  ws.onopen = () => {
    document.getElementById('status-dot').className = 'status-dot online';
    document.getElementById('status-label').textContent = 'online';
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'stage' && msg.taskId === activeTaskId) {
        updateStageRunning(msg.stage);
      }

      if (msg.type === 'step' && msg.taskId === activeTaskId && msg.step) {
        updateStageDone(msg.step.type, msg.step.durationMs, msg.step.output);
      }

      // Show tool usage in thinking stream with descriptive status
      if (msg.type === 'tool') {
        const toolActions = {
          web_search: ['Searching the web...', 'Search completed', 'Search failed'],
          browser_navigate: ['Opening page...', 'Page loaded', 'Page failed to load'],
          browser_read: ['Reading page content...', 'Reading completed', 'Reading failed'],
          browser_screenshot: ['Taking screenshot...', 'Screenshot taken', 'Screenshot failed'],
          browser_click: ['Clicking element...', 'Click completed', 'Click failed'],
          browser_fill: ['Filling form...', 'Form filled', 'Fill failed'],
          browser_extract: ['Extracting data...', 'Data extracted', 'Extraction failed'],
          browser_scroll: ['Scrolling page...', 'Scrolled', 'Scroll failed'],
        };
        const actions = toolActions[msg.tool] || [`Using ${formatToolName(msg.tool)}...`, `${formatToolName(msg.tool)} completed`, `${formatToolName(msg.tool)} failed`];

        if (msg.status === 'running') {
          const statusEl = thinkingMsgEl?.querySelector('#thinking-status');
          if (statusEl) statusEl.textContent = actions[0];
          appendThinkingLine(actions[0]);
        } else if (msg.status === 'done') {
          appendThinkingLine(actions[1]);
        } else if (msg.status === 'failed') {
          appendThinkingLine(actions[2]);
        }
      }

      // ── Phase 1: Raw token stream — shows tokens arriving from the LLM ──
      if (msg.type === 'token' && msg.taskId === activeTaskId && thinkingMsgEl) {
        if (!thinkingMsgEl._tokenStreaming) {
          // First token — collapse thinking, show the raw stream area
          thinkingMsgEl._tokenStreaming = true;
          const body = thinkingMsgEl.querySelector('#thinking-body');
          const toggle = thinkingMsgEl.querySelector('#thinking-toggle');
          const statusEl = thinkingMsgEl.querySelector('#thinking-status');
          const elapsed = taskStartTime ? fmtMs(Date.now() - taskStartTime) : '';
          if (statusEl) statusEl.textContent = `Thought for ${elapsed}`;
          if (body) body.style.display = 'none';
          if (toggle) toggle.classList.add('collapsed');

          const rawEl = thinkingMsgEl.querySelector('#msg-stream-raw');
          rawEl.style.display = '';
          tokenStreamEl = thinkingMsgEl.querySelector('#stream-raw-content');
          tokenStreamEl.innerHTML = '';
          tokenBuffer = '';

          // Progressive render in the raw stream area
          mdRenderTimer = setInterval(() => {
            if (tokenStreamEl && tokenBuffer) {
              const clean = tokenBuffer.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, '').trim();
              tokenStreamEl.innerHTML = md(clean) + '<span class="streaming-cursor"></span>';
              scrollDown();
            }
          }, MD_RENDER_INTERVAL);
        }
        tokenBuffer += msg.token;
      }

      // ── Phase 2: Answer complete — hide raw stream, reveal final answer word-by-word ──
      if (msg.type === 'answer' && msg.taskId === activeTaskId && thinkingMsgEl) {
        const answerText = msg.answer || tokenBuffer || '';
        const conf = msg.confidence ?? 0;
        if (!thinkingMsgEl._answerStreamed) {
          thinkingMsgEl._answerStreamed = true;

          // Stop the raw stream rendering
          if (mdRenderTimer) { clearInterval(mdRenderTimer); mdRenderTimer = null; }

          if (thinkingMsgEl._tokenStreaming) {
            // Hide the raw stream area
            const rawEl = thinkingMsgEl.querySelector('#msg-stream-raw');
            rawEl.style.display = 'none';

            // Show the final answer with rendered markdown (instant, no word-by-word)
            const answerEl = thinkingMsgEl.querySelector('#msg-answer');
            const clean = answerText.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}]/gu, '').trim();
            answerEl.style.display = '';
            answerEl.innerHTML = md(clean);

            // Show meta
            const metaEl = thinkingMsgEl.querySelector('#msg-meta');
            const p = Math.round(conf * 100);
            const lv = p >= 85 ? 'high' : p >= 65 ? 'med' : 'low';
            const dur = taskStartTime ? Date.now() - taskStartTime : 0;
            metaEl.innerHTML = `<span class="badge-conf ${lv}">${p}%</span><span>${fmtMs(dur)}</span>`;
            metaEl.style.display = '';
            scrollDown();
          } else {
            // No tokens were streamed (non-cloud) — use streamAnswer fallback
            streamAnswer(thinkingMsgEl, answerText, { confidence: conf, durationMs: taskStartTime ? Date.now() - taskStartTime : 0 });
          }

          if (activeConversationId) {
            addMsg(activeConversationId, 'agent', answerText, { confidence: conf, success: true });
          }
          addListenBtn(thinkingMsgEl);
          speak(answerText, thinkingMsgEl);
        }
      }
    } catch {}
  };
  ws.onclose = () => {
    document.getElementById('status-dot').className = 'status-dot offline';
    document.getElementById('status-label').textContent = 'reconnecting';
    setTimeout(connectWS, 3000);
  };
  ws.onerror = () => ws.close();
}

async function checkHealth() {
  try { const d = await api('/api/agent/health'); if (d.status === 'healthy') { document.getElementById('status-dot').className = 'status-dot online'; document.getElementById('status-label').textContent = 'online'; } }
  catch { document.getElementById('status-dot').className = 'status-dot offline'; document.getElementById('status-label').textContent = 'offline'; }
}

// ── Helpers ─────────────────────────────────────────────────
async function api(path, opts = {}) { return (await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts })).json(); }

let toastBox = null;
function toast(msg, type = 'info') {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toast-container'; document.body.appendChild(toastBox); }
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg; toastBox.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

function md(text) {
  // Pre-process: extract code blocks to protect them
  const codeBlocks = [];
  let src = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code class="lang-${lang || 'text'}">${esc(code.trim())}</code></pre>`);
    return `\x00CB${idx}\x00`;
  });

  // Extract inline code
  const inlineCode = [];
  src = src.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCode.length;
    inlineCode.push(`<code>${esc(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // Tables: detect lines with | separators
  src = src.replace(/((?:^[^\n]*\|[^\n]*\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return block;
    // Check for separator row (---|---|---)
    const sepIdx = rows.findIndex(r => /^\|?\s*[-:]+[-|\s:]*$/.test(r));
    if (sepIdx < 1) return block;

    const parseRow = (r) => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parseRow(rows[sepIdx - 1]);
    const dataRows = rows.slice(sepIdx + 1);

    let table = '<div class="table-wrap"><table><thead><tr>';
    headers.forEach(h => { table += `<th>${h}</th>`; });
    table += '</tr></thead><tbody>';
    dataRows.forEach(r => {
      const cells = parseRow(r);
      table += '<tr>';
      cells.forEach(c => { table += `<td>${c}</td>`; });
      table += '</tr>';
    });
    table += '</tbody></table></div>';
    return table;
  });

  let h = src;
  // Bold, italic (on non-escaped text)
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links: [text](url)
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Headings
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Unordered lists
  h = h.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  // Ordered lists
  h = h.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  h = h.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (m) => '<ol>' + m.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li')) + '</ol>');
  // Blockquotes
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Horizontal rules
  h = h.replace(/^---$/gm, '<hr>');
  // Paragraphs
  h = h.replace(/\n\n/g, '</p><p>');
  h = '<p>' + h + '</p>';
  // Clean up
  h = h.replace(/<p>\s*<\/p>/g, '');
  h = h.replace(/<p>\s*(<(?:h[123]|pre|ul|ol|blockquote|hr|div))/g, '$1');
  h = h.replace(/(<\/(?:h[123]|pre|ul|ol|blockquote|div)>)\s*<\/p>/g, '$1');
  h = h.replace(/<p>\s*(<table)/g, '$1');
  h = h.replace(/(<\/table>)\s*<\/p>/g, '$1');
  // Single newlines → <br>
  h = h.replace(/([^>])\n([^<])/g, '$1<br>$2');

  // Restore code blocks and inline code
  h = h.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[i]);
  h = h.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCode[i]);
  return h;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtMs(ms) { if (ms == null) return ''; if (ms < 1000) return Math.round(ms) + 'ms'; if (ms < 6e4) return (ms / 1e3).toFixed(1) + 's'; return Math.floor(ms / 6e4) + 'm'; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function scrollDown() { requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; }); }

// ── Greeting ─────────────────────────────────────────────────
function setGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const el = document.getElementById('welcome-greeting');
  if (el) el.textContent = g;
}
setGreeting();

// ── Boot ────────────────────────────────────────────────────
renderConvList();
connectWS();
checkHealth();
setInterval(checkHealth, 10000);
