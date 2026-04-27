/* ====================================================================
   NOIR INTERROGATION — app.js
   UI state machine, screen wiring, AI mode (BYOK Claude API), i18n.
   ==================================================================== */

const STATE = {
  case: null,                 // current case object
  currentSuspect: null,       // suspect being interrogated
  conversations: {},          // suspect.name -> [{role, content}]
  notes: {},                  // suspect.name -> {category: [{q, a}, ...]}
  notesOpen: false,
  notesActiveTab: null,       // suspect name shown in panel
  evidence: [],               // [{source, text, namedSuspect, isFalse}]
  evidencePickerOpen: false,
  provider: "anthropic",      // "anthropic" | "google" | "qwen"
  apiKeys:   { anthropic: null, google: null, qwen: null },
  apiModels: { anthropic: "claude-haiku-4-5-20251001", google: "gemini-2.5-flash", qwen: "qwen-plus" },
  lang: "en",                 // "en" | "zh"
  difficulty: "normal",       // "easy" | "normal" | "hard"
  narrativeOn: true,          // LLM-generated opener + reveal monologue
  activeAbort: null,          // AbortController for in-flight interrogation call
  narrativeAbort: null,       // AbortController for in-flight opener/reveal call
  askInFlight: false,         // double-send guard for askAI / askPreset
};

function isAbortError(err) {
  return err && (err.name === "AbortError" || err.code === 20);
}
function abortInterrogation() {
  if (STATE.activeAbort) { STATE.activeAbort.abort(); STATE.activeAbort = null; }
}
function abortNarrative() {
  if (STATE.narrativeAbort) { STATE.narrativeAbort.abort(); STATE.narrativeAbort = null; }
}

const LS = {
  // legacy single-key (migrated to anthropic)
  legacyApiKey:     "noir.apiKey",
  legacyApiModel:   "noir.apiModel",
  // current
  provider:         "noir.provider",
  anthropicKey:     "noir.anthropic.key",
  anthropicModel:   "noir.anthropic.model",
  googleKey:        "noir.google.key",
  googleModel:      "noir.google.model",
  qwenKey:          "noir.qwen.key",
  qwenModel:        "noir.qwen.model",
  lang:             "noir.lang",
  difficulty:       "noir.difficulty",
  muted:            "noir.muted",
  ambient:          "noir.ambient",
  narrative:        "noir.narrative",
  tutorialSeen:     "noir.tutorialSeen",
  stats:            "noir.stats",
  session:          "noir.session",
};

// ---- Session snapshot (refresh-resume) ----
// We persist the in-progress case + conversations on each committed turn so a
// refresh / tab close doesn't kill the player's progress. Killer identity is
// in the case object in plaintext — same honor-system caveat the README calls
// out for the disk-based skill version. Cleared on verdict / new case / discard.
function saveSession() {
  if (!STATE.case || STATE.case.status !== "open") return;
  const snap = {
    v: 1,
    case: STATE.case,
    conversations: STATE.conversations,
    notes: STATE.notes,
    evidence: STATE.evidence,
    currentSuspectName: STATE.currentSuspect ? STATE.currentSuspect.name : null,
    savedAt: Date.now(),
  };
  try {
    lsSet(LS.session, JSON.stringify(snap));
  } catch (_) { /* lsSet already warned */ }
}

function loadSession() {
  const raw = lsGet(LS.session);
  if (!raw) return null;
  try {
    const snap = JSON.parse(raw);
    if (!snap || !snap.case || snap.v !== 1) return null;
    return snap;
  } catch (_) {
    lsRemove(LS.session);
    return null;
  }
}

function clearSession() { lsRemove(LS.session); }

function maybeShowResumeBanner() {
  const snap = loadSession();
  const banner = $("#resume-banner");
  if (!banner) return;
  if (!snap || !snap.case || snap.case.status !== "open") {
    banner.hidden = true;
    return;
  }
  const idEl = $("#resume-case-id");
  if (idEl) idEl.textContent = "#" + snap.case.caseId;
  banner.hidden = false;
}

function hideResumeBanner() {
  const b = $("#resume-banner");
  if (b) b.hidden = true;
}

function resumeSession() {
  const snap = loadSession();
  if (!snap || !snap.case) {
    hideResumeBanner();
    return;
  }
  STATE.case = snap.case;
  STATE.conversations = snap.conversations || {};
  STATE.notes = snap.notes || {};
  STATE.notesActiveTab = null;
  STATE.evidence = snap.evidence || [];
  STATE.evidencePickerOpen = false;
  STATE.currentSuspect = snap.currentSuspectName
    ? (STATE.case.suspects.find(s => s.name === snap.currentSuspectName) || null)
    : null;
  hideResumeBanner();
  if (STATE.currentSuspect) {
    renderInterrogation(STATE.currentSuspect);
    show("screen-interrogation");
  } else {
    gotoLineup();
  }
}

function discardSession() {
  if (!confirm(t("resume.discardConfirm"))) return;
  clearSession();
  hideResumeBanner();
}

// Safe localStorage wrappers. Private mode / quota-full / disabled storage
// throw on access; without these we'd silently lose API keys and settings,
// or crash on first read. _lsWarned guards against spamming the console.
let _lsWarned = false;
function _lsWarn(op, err) {
  if (_lsWarned) return;
  _lsWarned = true;
  console.warn(`[noir] localStorage ${op} failed (private mode or quota?). Settings won't persist.`, err && err.message);
}
function lsGet(key) {
  try { return localStorage.getItem(key); }
  catch (err) { _lsWarn("read", err); return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (err) { _lsWarn("write", err); return false; }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); return true; }
  catch (err) { _lsWarn("remove", err); return false; }
}

const DEFAULT_STATS = {
  played:    0,
  solved:    0,
  failed:    0,
  byDifficulty: { easy: { played: 0, solved: 0 }, normal: { played: 0, solved: 0 }, hard: { played: 0, solved: 0 } },
  fastestQuestions: null,    // best (lowest) total questions in a solved case
  currentStreak: 0,           // consecutive solves in a row
  bestStreak: 0,
  achievements: {},          // {key: timestamp}
};

function loadStats() {
  const raw = lsGet(LS.stats);
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_STATS));
  try {
    const s = JSON.parse(raw);
    // Defensive merge with defaults so older stored shapes don't break
    return Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_STATS)), s);
  } catch (_) {
    return JSON.parse(JSON.stringify(DEFAULT_STATS));
  }
}

function saveStats(s) {
  lsSet(LS.stats, JSON.stringify(s));
}

function recordVerdict(verdict) {
  const s = loadStats();
  const c = STATE.case;
  s.played += 1;
  const diff = c.difficulty || "normal";
  if (!s.byDifficulty[diff]) s.byDifficulty[diff] = { played: 0, solved: 0 };
  s.byDifficulty[diff].played += 1;
  if (verdict.correct) {
    s.solved += 1;
    s.byDifficulty[diff].solved += 1;
    s.currentStreak += 1;
    if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
    // Total questions asked = sum across all suspects
    const totalQs = Object.values(c.questionCounts || {}).reduce((a, b) => a + b, 0);
    if (s.fastestQuestions == null || totalQs < s.fastestQuestions) {
      s.fastestQuestions = totalQs;
    }
    // Achievements
    const ach = s.achievements;
    const now = new Date().toISOString();
    if (!ach.firstSolve)               ach.firstSolve = now;
    if (totalQs <= 5 && !ach.fiveQ)    ach.fiveQ = now;
    if (diff === "hard" && !ach.hardSolve) ach.hardSolve = now;
    if (STATE.evidence.length === 0 && !ach.noConfront) ach.noConfront = now;
    if (s.currentStreak >= 3 && !ach.streak3) ach.streak3 = now;
    if (s.solved >= 10 && !ach.tenSolves) ach.tenSolves = now;
  } else {
    s.failed += 1;
    s.currentStreak = 0;
  }
  saveStats(s);
}

const PROVIDERS = {
  anthropic: {
    label: "Anthropic Claude",
    placeholder: "sk-ant-...",
    docUrl: "https://console.anthropic.com/",
    free: false,
    models: [
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast, cheap)" },
      { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 (richer)" },
    ],
  },
  google: {
    label: "Google Gemini",
    placeholder: "AIza...",
    docUrl: "https://aistudio.google.com/apikey",
    free: true,
    models: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (free tier)" },
      { value: "gemini-2.5-pro",   label: "Gemini 2.5 Pro (free tier, slower)" },
    ],
  },
  qwen: {
    label: "Alibaba Qwen 通义千问",
    placeholder: "sk-...",
    docUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    free: true,
    models: [
      { value: "qwen-turbo", label: "Qwen Turbo (free tier, fastest)" },
      { value: "qwen-plus",  label: "Qwen Plus (cheap, balanced)" },
      { value: "qwen-max",   label: "Qwen Max (most capable)" },
      { value: "qwen3-max",  label: "Qwen3 Max (latest)" },
    ],
  },
};

/* ============================== Audio (Web Audio API) ============================== */
/* All SFX are synthesized in-browser -- no external asset files. The
   AudioContext is lazily created on first user interaction (browser
   autoplay rules). */

const AUDIO = {
  ctx: null,
  muted: false,
  ambientOn: false,
};

function audioInit() {
  if (AUDIO.ctx) return AUDIO.ctx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    AUDIO.ctx = new Ctx();
  } catch (_) { return null; }
  return AUDIO.ctx;
}

function audioMuted() { return AUDIO.muted; }

function audioToggle() {
  AUDIO.muted = !AUDIO.muted;
  lsSet(LS.muted, AUDIO.muted ? "1" : "0");
  refreshAudioToggle();
  if (AUDIO.muted) {
    stopAmbient();
  } else {
    audioInit();
    if (AUDIO.ambientOn) startAmbient();
  }
}

function ambientToggle() {
  AUDIO.ambientOn = !AUDIO.ambientOn;
  lsSet(LS.ambient, AUDIO.ambientOn ? "1" : "0");
  $$("[data-action=toggle-ambient]").forEach(b => b.classList.toggle("active", AUDIO.ambientOn));
  if (AUDIO.ambientOn && !AUDIO.muted) startAmbient();
  else stopAmbient();
}

function narrativeToggle() {
  STATE.narrativeOn = !STATE.narrativeOn;
  lsSet(LS.narrative, STATE.narrativeOn ? "1" : "0");
  $$("[data-action=toggle-narrative]").forEach(b => b.classList.toggle("active", STATE.narrativeOn));
}

function refreshAudioToggle() {
  $$(".audio-toggle button").forEach(b => {
    b.textContent = AUDIO.muted ? "♪̸" : "♪";
    b.title = AUDIO.muted ? t("audio.unmute") : t("audio.mute");
  });
}

// Short noise burst -- typewriter / click feel
function sfxClick() {
  if (AUDIO.muted) return;
  const ctx = audioInit(); if (!ctx) return;
  const dur = 0.04;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1500;
  const gain = ctx.createGain();
  gain.gain.value = 0.18;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}

// Door creak -- filtered noise sweep, dying out
function sfxCreak() {
  if (AUDIO.muted) return;
  const ctx = audioInit(); if (!ctx) return;
  const dur = 0.55;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * (1 - t) * 0.35;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(220, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.22, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}

// Stamp / thud -- low-freq sine burst with snappy attack
function sfxStamp() {
  if (AUDIO.muted) return;
  const ctx = audioInit(); if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(35, t0 + 0.18);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0, t0);
  gain.gain.linearRampToValueAtTime(0.5, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.3);
  // Add a paper "snap" via short noise burst layered on top
  setTimeout(sfxClick, 0);
}

// ===== Ambient: continuous rain + sparse low piano =====

let _ambient = null;

function startAmbient() {
  if (AUDIO.muted || _ambient) return;
  const ctx = audioInit();
  if (!ctx) return;

  // Rain: looping filtered white noise
  const dur = 4;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1200;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5500;

  const rainGain = ctx.createGain();
  rainGain.gain.setValueAtTime(0, ctx.currentTime);
  rainGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);

  src.connect(hp).connect(lp).connect(rainGain).connect(ctx.destination);
  src.start();

  // Piano: schedule occasional low notes
  // Pentatonic minor in C (low) -- C2/D#2/F2/G2/A#2 -- moody, never out-of-key
  const notes = [65.4, 77.8, 87.3, 98.0, 116.5];
  const pianoInterval = setInterval(() => {
    if (!_ambient || AUDIO.muted) return;
    pianoNote(ctx, ctx.currentTime + 0.05, pick(notes));
  }, 9000 + Math.random() * 6000);

  _ambient = { src, rainGain, pianoInterval };
}

function pianoNote(ctx, when, freq) {
  const dur = 2.4;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = freq * 2;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(0.04, when + 0.04);
  env.gain.exponentialRampToValueAtTime(0.001, when + dur);
  const env2 = ctx.createGain();
  env2.gain.setValueAtTime(0, when);
  env2.gain.linearRampToValueAtTime(0.012, when + 0.04);
  env2.gain.exponentialRampToValueAtTime(0.001, when + dur * 0.6);
  osc.connect(env).connect(ctx.destination);
  osc2.connect(env2).connect(ctx.destination);
  osc.start(when);
  osc2.start(when);
  osc.stop(when + dur);
  osc2.stop(when + dur);
}

function stopAmbient() {
  if (!_ambient) return;
  const ctx = AUDIO.ctx;
  const { src, rainGain, pianoInterval } = _ambient;
  clearInterval(pianoInterval);
  if (ctx) {
    rainGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    setTimeout(() => { try { src.stop(); } catch (_) {} }, 600);
  }
  _ambient = null;
}

// Vinyl crackle -- a short ambient burst we can tile
function sfxCrackleBurst() {
  if (AUDIO.muted) return;
  const ctx = audioInit(); if (!ctx) return;
  const dur = 0.6;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // Mostly silence with rare loud pops — vinyl-like
    data[i] = (Math.random() < 0.005) ? (Math.random() * 2 - 1) * 0.6 : 0;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 2000;
  const gain = ctx.createGain();
  gain.gain.value = 0.22;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}

/* ============================== i18n strings ============================== */

const STRINGS = {
  en: {
    "title.confidential":  "CONFIDENTIAL",
    "title.h1":            "Noir<br>Interrogation",
    "title.tagline":       "A one-shot detective game.<br>Five suspects. One killer. The script holds the answer.",
    "title.credit":        "Built as a Claude Code skill, ported to the browser.",
    "title.keyMissing":    "⚠ No LLM API key — open Settings to add one before playing.",
    "error.needKey":       "An LLM API key is required to play. Opening Settings…",
    "title.difficulty":    "DIFFICULTY",
    "btn.newCase":         "NEW CASE",
    "btn.dailyCase":       "DAILY CASE",
    "btn.settings":        "SETTINGS",

    "diff.easy":           "EASY",
    "diff.normal":         "NORMAL",
    "diff.hard":           "HARD",
    "diff.descEasy":       "3 suspects • 1 witness clue • no motive layer",
    "diff.descNormal":     "5 suspects • 1 witness clue • 1 motive leaker",
    "diff.descHard":       "5 suspects • 1 true witness + 1 misleading witness • cross-check alibis",

    "briefing.caseFile":     "CASE FILE",
    "briefing.statusOpen":   "OPEN",
    "briefing.title":        "Homicide Report",
    "briefing.victim":       "VICTIM",
    "briefing.scene":        "SCENE",
    "briefing.tod":          "TIME OF DEATH",
    "briefing.weapon":       "WEAPON FOUND",
    "briefing.poi":          "Persons of Interest",
    "briefing.commitLabel":  "ANSWER COMMITMENT — SHA-256",
    "briefing.commitNote":   "The killer's identity was decided at case creation. This hash locks it in. It will be re-verified when you accuse — proof the script can't change the answer based on your questions.",
    "btn.beginInterrog":     "BEGIN INTERROGATION",
    "briefing.seedLabel":    "SEED:",
    "briefing.shareButton":  "SHARE THIS CASE",
    "briefing.shareCopied":  "✓ link copied to clipboard",
    "briefing.shareManual":  "Copy this link to share the same case:",
    "btn.notes":             "NOTES",
    "btn.confront":          "CONFRONT",
    "confront.noneCollected":"Question witness suspects until you've heard their statements; then confront other suspects with what you've heard.",
    "confront.pickerTitle":  "Pick a statement to present:",
    "confront.fromLabel":    (source) => `From ${source}:`,
    "confront.cancel":       "CANCEL",
    "notes.title":           "Case Notes",
    "notes.empty":           "No statements collected yet. Question a suspect to fill the file.",
    "notes.cat.alibi":       "Alibi",
    "notes.cat.tod":         "Time-of-death whereabouts",
    "notes.cat.knew_victim": "Relationship to victim",
    "notes.cat.saw_anyone":  "Eyewitness account",
    "notes.cat.suspicious":  "Their suspicions",
    "notes.cat.hiding":      "Deflection on hidden topic",
    "notes.cat.weapon":      "On the weapon",
    "notes.cat.leave":       "Scene exit",
    "notes.cat.free_form":   "Free-form questioning",
    "notes.cat.confront":    "Confronted with evidence",

    "lineup.title":          "The Lineup",
    "lineup.sub":            "Pick one to bring into the interrogation room.",
    "btn.caseFile":          "CASE FILE",
    "btn.makeAccusation":    "MAKE ACCUSATION",
    "lineup.notQuestioned":  "Not yet questioned",
    "lineup.questioned":     "Questioned",

    "btn.backToLineup":      "← LINEUP",
    "interrog.detective":    "DETECTIVE",
    "interrog.aiNoKey":      "Set an LLM API key in Settings to ask questions.",
    "interrog.aiActive":     (model) => `AI mode active. Preset clicks and free text both go through ${model}.`,
    "interrog.aiPlaceholder":"Ask anything... (Shift+Enter for newline)",
    "btn.send":              "SEND",
    "interrog.aiSetKeyFirst":"Set your Claude API key in Settings first.",
    "interrog.errorPrefix":  "[error: ",
    "interrog.errorSuffix":  "]",

    "accusation.title":      "The Accusation",
    "accusation.sub":        "Choose carefully. The killer's hash will be verified.",
    "btn.backToInterrog":    "BACK TO INTERROGATION",
    "accusation.confirm":    (name) => `Accuse ${name}? This ends the case.`,

    "verdict.title":         "Verdict",
    "verdict.solved":        "SOLVED",
    "verdict.failed":        "FAILED",
    "verdict.youAccused":    "You accused:",
    "verdict.actualKiller":  "Actual killer:",
    "verdict.win":           "Case closed. The killer's going down.",
    "verdict.loss":          "Wrong call. The killer walks free.",
    "verdict.hashLabel":     "HASH VERIFICATION",
    "verdict.committed":     "committed:",
    "verdict.computed":      "computed:",
    "verdict.hashOk":        "✓ HASH MATCH — answer was committed at case creation",
    "verdict.hashFail":      "✗ HASH MISMATCH — case file appears tampered",
    "btn.mainMenu":          "MAIN MENU",
    "btn.revealAll":         "REVEAL ALL CARDS",
    "btn.hideReveal":        "HIDE REVEAL",
    "reveal.title":          "Full Case Reveal",
    "reveal.alibiTrue":      "Alibi (true — corroborated):",
    "reveal.alibiFalse":     "Alibi (FALSE — fabricated cover story):",
    "reveal.hiding":         "Was deflecting about:",
    "reveal.facts":          "Facts they held:",
    "reveal.witnessTrue":    "[TRUE WITNESS]",
    "reveal.witnessFalse":   "[FALSE WITNESS]",
    "reveal.gossip":         "[GOSSIP / MOTIVE LEAK]",
    "reveal.tag.killer":     "KILLER",
    "reveal.tag.witness":    "WITNESS",
    "reveal.tag.falseWitness":"MISLED",
    "reveal.tag.gossip":     "GOSSIP",
    "reveal.tag.redHerring": "RED HERRING",

    "settings.title":        "Settings",
    "settings.langSection":  "Language / 语言",
    "settings.langDesc":     "Switch between English (1940s American noir) and Chinese (1930s Republican Shanghai noir). The same mechanics; two completely different worlds.",
    "settings.aiSection":    "AI Mode",
    "settings.aiDesc":       "Bring your own LLM API key. The key is stored only in this browser's localStorage and is sent directly to the provider — never to any other server. AI mode lets you free-text any question to a suspect; the model receives only that suspect's card and stays in character.",
    "settings.provider":     "Provider",
    "settings.paid":         "paid",
    "settings.freeTier":     "free tier",
    "settings.getKeyAnthropic": "Get an Anthropic API key →",
    "settings.getKeyGoogle":    "Get a free Google AI Studio key →",
    "settings.getKeyQwen":      "Get a Qwen API key from 阿里云百炼 →",
    "settings.apiKey":       "API key",
    "settings.model":        "Model",
    "btn.save":              "SAVE",
    "btn.clear":             "CLEAR",
    "settings.noKey":        "No key saved. An API key is required to start a case.",
    "settings.keySet":       (masked, justSaved) => (justSaved ? "Saved. " : "") +
                              `Key set (${masked}). AI mode is now available in interrogation.`,
    "settings.statsSection": "Statistics & Achievements",
    "settings.resetStats":   "RESET STATS",
    "stats.played":          "PLAYED",
    "stats.winRate":         "WIN RATE",
    "stats.bestStreak":      "BEST STREAK",
    "stats.fewestQs":        "FEWEST Qs (SOLVE)",
    "stats.achievements":    "ACHIEVEMENTS",
    "stats.resetConfirm":    "Reset all statistics and achievements? This can't be undone.",
    "ach.firstSolve":        "First Case Closed",
    "ach.firstSolve.desc":   "Solve your first case.",
    "ach.fiveQ":             "Lightning Detective",
    "ach.fiveQ.desc":        "Solve a case in 5 questions or fewer.",
    "ach.hardSolve":         "Cross-Examiner",
    "ach.hardSolve.desc":    "Solve a Hard case (with the misleading 2nd witness).",
    "ach.noConfront":        "No Confrontation Needed",
    "ach.noConfront.desc":   "Solve without ever using CONFRONT.",
    "ach.streak3":           "On a Roll",
    "ach.streak3.desc":      "Solve 3 cases in a row.",
    "ach.tenSolves":         "Veteran of the Beat",
    "ach.tenSolves.desc":    "Solve 10 cases total.",
    "settings.aboutSection": "About",
    "settings.aboutDesc":    "Noir Interrogation is a one-shot detective game built primarily as a Claude Code skill at .claude/skills/noir-interrogation/. The script in that skill keeps the killer's identity hidden (committed via SHA-256), generates suspect cards, and verifies your accusation. This web port mirrors the same engine in JavaScript.",

    "lang.toggleEn":         "EN",
    "lang.toggleZh":         "中",
    "audio.mute":            "Mute sound",
    "audio.unmute":          "Unmute sound",
    "tutorial.tag":          "FIRST CASE — A QUICK TIP",
    "tutorial.body":         "Question each suspect about who else they saw that night. One of them is a witness — their statement will contradict the killer's alibi. That contradiction is your case.",
    "tutorial.ok":           "GOT IT",
    "shortcuts.title":       "Keyboard Shortcuts",
    "shortcuts.title-screen":"Title screen",
    "shortcuts.newCase":     "New case",
    "shortcuts.daily":       "Daily case",
    "shortcuts.settings":    "Settings",
    "shortcuts.lineup":      "Lineup",
    "shortcuts.pickSuspect": "Question suspect by number",
    "shortcuts.accuse":      "Make accusation",
    "shortcuts.caseFile":    "Case file modal",
    "shortcuts.interrog":    "Interrogation",
    "shortcuts.notes":       "Toggle notes",
    "shortcuts.timeline":    "Timeline modal",
    "shortcuts.backLineup":  "Back to lineup",
    "shortcuts.global":      "Anywhere",
    "shortcuts.toggleHelp":  "Toggle this help",
    "shortcuts.close":       "Close any open overlay",
    "convo.scrollLatest":    "↓ LATEST",
    "settings.audioSection": "Audio",
    "settings.audioDesc":    "The audio toggle in the top-right corner mutes / unmutes sound effects. Ambient background (rain + faint piano) is opt-in below.",
    "settings.ambientLabel": "Ambient (rain + piano)",
    "settings.narrativeLabel":"LLM narrative (opener + reveal monologue)",
    "settings.narrativeDesc": "When enabled, the briefing gains an atmospheric scene-setter and the verdict reveals a noir-style closing monologue tying motive, witness, and red herrings together. Adds 2 small API calls per case.",
    "narrative.openerLoading":"…(narrator clearing his throat)…",
    "narrative.revealLoading":"…(detective lighting a final cigarette)…",
    "btn.timeline":          "TIMELINE",
    "resume.label":          "Case in progress",
    "resume.resume":         "RESUME",
    "resume.discard":        "discard",
    "resume.discardConfirm": "Discard the saved case? This can't be undone.",
    "timeline.stamp":        "TIMELINE",
    "timeline.intro":        "Compare each suspect's claimed alibi against any witness statement that names them. A contradiction is your case.",
    "timeline.alibisHeader": "Claimed alibis",
    "timeline.witnessHeader":"Witness statements collected",
    "timeline.notYetQuestioned": "(not yet questioned — pull them in)",
    "timeline.noWitness":    "No witness statements collected yet. Question more suspects to draw them out.",
    "timeline.namesPill":    (name) => `names ${name}`,
  },

  zh: {
    "title.confidential":  "机密",
    "title.h1":            "夜雾<br>审讯",
    "title.tagline":       "一局制侦探游戏。<br>五个嫌疑人，一个真凶。答案藏在脚本里。",
    "title.credit":        "原是 Claude Code 上的一个 skill，移植到了浏览器。",
    "title.keyMissing":    "⚠ 尚未配置 LLM API 密钥 — 请先在「设置」里添加再开始游戏。",
    "error.needKey":       "本游戏需要 LLM API 密钥才能开始。即将打开「设置」……",
    "title.difficulty":    "难度",
    "btn.newCase":         "新案件",
    "btn.dailyCase":       "每日案件",
    "btn.settings":        "设置",

    "diff.easy":           "简单",
    "diff.normal":         "标准",
    "diff.hard":           "困难",
    "diff.descEasy":       "3 个嫌疑人 · 1 条目击证词 · 无动机层",
    "diff.descNormal":     "5 个嫌疑人 · 1 条目击证词 · 1 个动机泄露者",
    "diff.descHard":       "5 个嫌疑人 · 1 条真证词 + 1 条误导证词 · 需交叉核对 alibi",

    "briefing.caseFile":     "案件档案",
    "briefing.statusOpen":   "受理中",
    "briefing.title":        "凶案报告",
    "briefing.victim":       "受害人",
    "briefing.scene":        "案发现场",
    "briefing.tod":          "死亡时间",
    "briefing.weapon":       "现场凶器",
    "briefing.poi":          "嫌疑人名单",
    "briefing.commitLabel":  "答案承诺 — SHA-256",
    "briefing.commitNote":   "凶手身份在案件生成时即已确定。这串哈希将其锁定。提出指控时会重新校验，证明脚本无法根据您的提问偷改答案。",
    "btn.beginInterrog":     "开始审讯",
    "briefing.seedLabel":    "种子：",
    "briefing.shareButton":  "分享此案件",
    "briefing.shareCopied":  "✓ 链接已复制",
    "briefing.shareManual":  "复制此链接，朋友打开即获得同一案件：",
    "btn.notes":             "笔记",
    "btn.confront":          "对质",
    "confront.noneCollected":"先多审几次目击证人，听到他们的陈述后再来对质其他嫌疑人。",
    "confront.pickerTitle":  "选择一份陈述来出示：",
    "confront.fromLabel":    (source) => `${source} 的陈述：`,
    "confront.cancel":       "取消",
    "notes.title":           "办案笔记",
    "notes.empty":           "尚未收集到任何陈述。审讯嫌疑人会自动填入此处。",
    "notes.cat.alibi":       "不在场证明",
    "notes.cat.tod":         "案发时间的去向",
    "notes.cat.knew_victim": "与死者的关系",
    "notes.cat.saw_anyone":  "目击陈述",
    "notes.cat.suspicious":  "对其他人的怀疑",
    "notes.cat.hiding":      "对私事的回避",
    "notes.cat.weapon":      "关于凶器",
    "notes.cat.leave":       "退场",
    "notes.cat.free_form":   "自由提问",
    "notes.cat.confront":    "证据对质",

    "lineup.title":          "嫌疑人名单",
    "lineup.sub":            "挑一个进审讯室。",
    "btn.caseFile":          "案件档案",
    "btn.makeAccusation":    "提出指控",
    "lineup.notQuestioned":  "尚未审讯",
    "lineup.questioned":     "已审讯过",

    "btn.backToLineup":      "← 名单",
    "interrog.detective":    "警官",
    "interrog.aiNoKey":      "请先在「设置」里填入 LLM API 密钥才能审讯。",
    "interrog.aiActive":     (model) => `AI 已启用。预设按钮和自由文本都走 ${model}。`,
    "interrog.aiPlaceholder":"随便问（Shift+Enter 换行）……",
    "btn.send":              "发送",
    "interrog.aiSetKeyFirst":"请先在「设置」里填入 Claude API 密钥。",
    "interrog.errorPrefix":  "[错误：",
    "interrog.errorSuffix":  "]",

    "accusation.title":      "提出指控",
    "accusation.sub":        "请慎重。凶手身份将通过哈希校验。",
    "btn.backToInterrog":    "返回审讯",
    "accusation.confirm":    (name) => `您要指控 ${name} 吗？这将结束本案。`,

    "verdict.title":         "裁决",
    "verdict.solved":        "破案",
    "verdict.failed":        "失手",
    "verdict.youAccused":    "您指控的是：",
    "verdict.actualKiller":  "真凶：",
    "verdict.win":           "案子破了。凶手插翅难飞。",
    "verdict.loss":          "猜错了。凶手逍遥法外。",
    "verdict.hashLabel":     "哈希校验",
    "verdict.committed":     "承诺值：",
    "verdict.computed":      "计算值：",
    "verdict.hashOk":        "✓ 哈希一致 — 答案在案件生成时即已锁定",
    "verdict.hashFail":      "✗ 哈希不符 — 案件文件可能被篡改",
    "btn.mainMenu":          "返回主菜单",
    "btn.revealAll":         "揭开所有底牌",
    "btn.hideReveal":        "收起底牌",
    "reveal.title":          "案件全揭",
    "reveal.alibiTrue":      "不在场证明（属实，有人证）：",
    "reveal.alibiFalse":     "不在场证明（撒谎，编造的掩护）：",
    "reveal.hiding":         "他/她其实在回避：",
    "reveal.facts":          "他/她持有的线索：",
    "reveal.witnessTrue":    "[真目击]",
    "reveal.witnessFalse":   "[假目击]",
    "reveal.gossip":         "[传闻 / 动机]",
    "reveal.tag.killer":     "凶手",
    "reveal.tag.witness":    "目击者",
    "reveal.tag.falseWitness":"看错人了",
    "reveal.tag.gossip":     "知情者",
    "reveal.tag.redHerring": "红鲱鱼",

    "settings.title":        "设置",
    "settings.langSection":  "Language / 语言",
    "settings.langDesc":     "在「英文（1940 年代美国 noir）」和「中文（1930 年代民国上海 noir）」之间切换。机制完全相同，两个完全不同的世界。",
    "settings.aiSection":    "AI 模式",
    "settings.aiDesc":       "自带您的 LLM API 密钥。密钥仅保存在本浏览器的 localStorage，且仅直接发送至所选提供商，不经任何其他服务器。开启 AI 模式后您可自由提问；模型只看到当前嫌疑人的卡片，并坚持角色不出戏。",
    "settings.provider":     "提供商",
    "settings.paid":         "付费",
    "settings.freeTier":     "有免费额度",
    "settings.getKeyAnthropic": "获取 Anthropic API key →",
    "settings.getKeyGoogle":    "免费获取 Google AI Studio key →",
    "settings.getKeyQwen":      "在阿里云百炼获取 Qwen API key →",
    "settings.apiKey":       "API 密钥",
    "settings.model":        "模型",
    "btn.save":              "保存",
    "btn.clear":             "清除",
    "settings.noKey":        "未保存密钥。需要填入 API 密钥才能开始新案。",
    "settings.keySet":       (masked, justSaved) => (justSaved ? "已保存。" : "") +
                              `密钥已设置（${masked}）。审讯时即可启用 AI 模式。`,
    "settings.statsSection": "统计与成就",
    "settings.resetStats":   "清空统计",
    "stats.played":          "总局数",
    "stats.winRate":         "胜率",
    "stats.bestStreak":      "最长连胜",
    "stats.fewestQs":        "最少问题破案",
    "stats.achievements":    "成就",
    "stats.resetConfirm":    "确定要清空所有统计与成就吗？此操作不可撤销。",
    "ach.firstSolve":        "首案告破",
    "ach.firstSolve.desc":   "破第一桩案子。",
    "ach.fiveQ":             "雷霆神探",
    "ach.fiveQ.desc":        "在 5 个问题以内破案。",
    "ach.hardSolve":         "交叉盘问者",
    "ach.hardSolve.desc":    "破一桩 Hard 难度（带误导证人）的案子。",
    "ach.noConfront":        "未对质而胜",
    "ach.noConfront.desc":   "全程未使用「对质」按钮即破案。",
    "ach.streak3":           "连战连捷",
    "ach.streak3.desc":      "连续破三桩案子。",
    "ach.tenSolves":         "老牌警官",
    "ach.tenSolves.desc":    "累计破案 10 次。",
    "settings.aboutSection": "关于",
    "settings.aboutDesc":    "「夜雾审讯」主要是 Claude Code 的一个 skill（位于 .claude/skills/noir-interrogation/）。该 skill 中的脚本掌控凶手身份（通过 SHA-256 锁定）、生成嫌疑人卡片、并校验您的指控。本网页版用 JavaScript 重现了同一引擎。",

    "lang.toggleEn":         "EN",
    "lang.toggleZh":         "中",
    "audio.mute":            "静音",
    "audio.unmute":          "开启声音",
    "tutorial.tag":          "首次开局 — 一句提示",
    "tutorial.body":         "每个嫌疑人都问一句「那晚你看见还有什么人」。五人之中有一个目击者——他的陈述会与凶手的不在场证明矛盾。那个矛盾就是你破案的关键。",
    "tutorial.ok":           "知道了",
    "shortcuts.title":       "键盘快捷键",
    "shortcuts.title-screen":"标题屏",
    "shortcuts.newCase":     "新案件",
    "shortcuts.daily":       "每日案件",
    "shortcuts.settings":    "设置",
    "shortcuts.lineup":      "嫌疑人名单",
    "shortcuts.pickSuspect": "按编号审讯嫌疑人",
    "shortcuts.accuse":      "提出指控",
    "shortcuts.caseFile":    "案件档案",
    "shortcuts.interrog":    "审讯室",
    "shortcuts.notes":       "切换笔记",
    "shortcuts.timeline":    "时间线对比",
    "shortcuts.backLineup":  "返回名单",
    "shortcuts.global":      "全局",
    "shortcuts.toggleHelp":  "显示/隐藏此帮助",
    "shortcuts.close":       "关闭任意覆盖层",
    "convo.scrollLatest":    "↓ 最新",
    "settings.audioSection": "音频",
    "settings.audioDesc":    "右上角的音频按钮控制音效的开关。下面的背景环境音（雨声 + 远处钢琴）需要单独打开。",
    "settings.ambientLabel": "背景环境音（雨声 + 钢琴）",
    "settings.narrativeLabel":"LLM 叙事（开场段 + 揭幕独白）",
    "settings.narrativeDesc": "开启后，案情简报上方增加一段氛围开场，揭幕时多一段 noir 风格的侦探独白，把动机/目击/红鲱鱼串成完整真相。每局多 2 次小型 API 调用。",
    "narrative.openerLoading":"……（旁白正在清嗓子）……",
    "narrative.revealLoading":"……（侦探正点上最后一支烟）……",
    "btn.timeline":          "时间线",
    "resume.label":          "未结案件",
    "resume.resume":         "继续",
    "resume.discard":        "丢弃",
    "resume.discardConfirm": "确定丢弃存档案件吗？此操作无法撤销。",
    "timeline.stamp":        "时间线对比",
    "timeline.intro":        "把每个嫌犯的不在场证明跟「点了名的」目击证词放在一起看。矛盾点就是破案点。",
    "timeline.alibisHeader": "声称的不在场证明",
    "timeline.witnessHeader":"已收集的目击证词",
    "timeline.notYetQuestioned": "（还没审过 — 把人叫进来）",
    "timeline.noWitness":    "还没收集到目击证词。多审几个嫌疑人，让他们开口。",
    "timeline.namesPill":    (name) => `点名 ${name}`,
  },
};

function t(key, ...args) {
  const bundle = STRINGS[STATE.lang] || STRINGS.en;
  const v = bundle[key];
  if (v == null) return key;
  return typeof v === "function" ? v(...args) : v;
}

function applyI18n() {
  // Set <html lang>
  document.documentElement.lang = STATE.lang === "zh" ? "zh-CN" : "en";
  document.documentElement.dataset.lang = STATE.lang;

  // Walk all data-i18n elements and set innerHTML or textContent
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    const target = el.dataset.i18nMode || "html";  // default html (lets <br> work)
    const text = t(key);
    if (target === "text") el.textContent = text;
    else el.innerHTML = text;
  });

  // Placeholders
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  });

  // Update language toggle active state
  document.querySelectorAll(".lang-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.lang === STATE.lang);
  });
}

function setLang(lang) {
  if (lang !== "en" && lang !== "zh") return;
  STATE.lang = lang;
  lsSet(LS.lang, lang);
  applyI18n();
  // Refresh dynamic strings that data-i18n doesn't catch.
  setDifficulty(STATE.difficulty);
  if (STATE.case) {
    const diffEl = $("#briefing-difficulty");
    if (diffEl) diffEl.textContent = t("diff." + (STATE.case.difficulty || "normal"));
  }

  // Re-render dynamic content if a case is in progress.
  // Note: existing case content stays in its original language.
  // Switching mid-case re-renders the chrome but not generated text.
  if (STATE.case) {
    if ($("#screen-briefing").classList.contains("active")) renderBriefing();
    if ($("#screen-lineup").classList.contains("active")) gotoLineup();
    if ($("#screen-interrogation").classList.contains("active") && STATE.currentSuspect) {
      // refresh the question menu in current language
      renderQuestionMenu();
      refreshAskArea();
    }
  }
  updateApiStatus();
}

/* ============================== DOM helpers ============================== */

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function show(screenId) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $(`#${screenId}`).classList.add("active");
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class")           e.className = v;
    else if (k === "html")       e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset")    Object.assign(e.dataset, v);
    else                          e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

/* ============================== screen renderers ============================== */

function renderBriefing() {
  const c = STATE.case;
  // Kick off LLM-generated opening narrative if AI is enabled.
  const openerEl = $("#briefing-opener");
  if (openerEl) {
    if (narrativeEnabled()) {
      openerEl.hidden = false;
      if (c.narrativeOpener) {
        openerEl.innerHTML = `<p>${escapeHtml(c.narrativeOpener)}</p>`;
      } else {
        openerEl.innerHTML = `<p class="narrative-loading">${t("narrative.openerLoading")}</p>`;
        abortNarrative();
        const ctrl = new AbortController();
        STATE.narrativeAbort = ctrl;
        generateOpener(c, { signal: ctrl.signal }).then(text => {
          if (STATE.narrativeAbort === ctrl) STATE.narrativeAbort = null;
          if (STATE.case === c) {
            openerEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
          }
        }).catch(err => {
          if (STATE.narrativeAbort === ctrl) STATE.narrativeAbort = null;
          if (isAbortError(err)) return;
          console.warn("[noir] opener LLM failed:", err.message);
          openerEl.hidden = true;
        });
      }
    } else {
      openerEl.hidden = true;
      openerEl.innerHTML = "";
    }
  }
  $("#briefing-case-id").textContent = "#" + c.caseId;
  $("#briefing-victim").textContent  = `${c.victim.name}, ${c.victim.title}`;
  $("#briefing-scene").textContent   = c.scene;
  $("#briefing-tod").textContent     = c.timeOfDeath;
  $("#briefing-weapon").textContent  = c.weaponAtScene;
  $("#briefing-hash").textContent    = c.answerHash;
  if ($("#briefing-seed")) $("#briefing-seed").textContent = c.seed;
  const diffEl = $("#briefing-difficulty");
  if (diffEl) diffEl.textContent = t("diff." + (c.difficulty || "normal"));

  const sep = STATE.lang === "zh" ? "·" : "--";
  const roster = $("#briefing-roster");
  roster.innerHTML = "";
  c.suspects.forEach((s, i) => {
    roster.appendChild(el("li", {},
      el("span", { class: "roster-name" }, `${i + 1}. ${s.name}`),
      el("span", { class: "roster-occ" }, ` ${sep} ${s.occupation}`),
    ));
  });
}

function renderLineupGrid(containerId, onPick) {
  const grid = $(`#${containerId}`);
  grid.innerHTML = "";
  STATE.case.suspects.forEach((suspect, i) => {
    const questioned = (STATE.case.questionCounts[suspect.name] || 0) > 0;
    const card = el("div",
      { class: `suspect-card${questioned ? " questioned" : ""}`,
        onclick: () => onPick(suspect) },
    );
    const avatar = el("div", { class: "avatar" });
    avatar.innerHTML = avatarSvg(suspect.occupation);
    card.appendChild(avatar);
    card.appendChild(el("div", { class: "name" }, suspect.name));
    card.appendChild(el("div", { class: "occ" }, suspect.occupation));
    card.appendChild(el("div", { class: "status" },
      questioned ? t("lineup.questioned") : t("lineup.notQuestioned")));
    // Show ordinal hint for keyboard nav
    if (i < 9) {
      card.appendChild(el("div", { class: "card-hotkey" }, String(i + 1)));
    }
    grid.appendChild(card);
  });
}

function renderInterrogation(suspect) {
  // Cancel any in-flight reply for the previous suspect so it can't land
  // in this conversation thread (or burn API quota after a switch).
  abortInterrogation();
  STATE.currentSuspect = suspect;
  saveSession();
  $("#interrog-name").textContent  = suspect.name;
  $("#interrog-occ").textContent   = suspect.occupation;
  $("#interrog-voice").textContent = suspect.personalityHint;

  const log = $("#conversation");
  log.innerHTML = "";
  const history = STATE.conversations[suspect.name] || [];
  if (history.length === 0) {
    log.appendChild(el("div", { class: "bubble system" },
      getSceneOpener(STATE.case, suspect)));
  }
  history.forEach(turn => addBubble(turn.role, turn.content, suspect.name, false));

  renderQuestionMenu();
  refreshAskArea();
  refreshConfrontButton();
  closeEvidencePicker();
  setupScrollWatcher();
  hideScrollPill();
}

function refreshConfrontButton() {
  const btn = $("#confront-btn");
  if (!btn) return;
  if (STATE.evidence.length === 0) {
    btn.disabled = true;
    btn.title = t("confront.noneCollected");
  } else {
    btn.disabled = false;
    btn.title = "";
  }
}

function openEvidencePicker() {
  if (STATE.evidence.length === 0) return;
  STATE.evidencePickerOpen = true;
  const picker = $("#evidence-picker");
  picker.innerHTML = "";
  picker.appendChild(el("div", { class: "picker-header" }, t("confront.pickerTitle")));
  STATE.evidence.forEach(ev => {
    const item = el("button",
      { class: "evidence-item", onclick: () => confrontWith(ev) },
      el("div", { class: "evidence-source" }, t("confront.fromLabel", ev.source)),
      el("div", { class: "evidence-text" }, ev.text),
    );
    picker.appendChild(item);
  });
  picker.appendChild(el("button",
    { class: "btn-secondary picker-cancel", onclick: closeEvidencePicker },
    t("confront.cancel")));
  picker.classList.add("open");
}

function closeEvidencePicker() {
  STATE.evidencePickerOpen = false;
  const picker = $("#evidence-picker");
  if (picker) picker.classList.remove("open");
}

function confrontWith(evidence) {
  closeEvidencePicker();
  const suspect = STATE.currentSuspect;
  const framing = buildConfrontFraming(STATE.case, evidence);
  addBubble("detective", framing, suspect.name);
  pushTurn("detective", framing);

  const thinking = addBubble("thinking", "", suspect.name);

  if (activeKey()) {
    let stream = null;
    const onDelta = (chunk) => {
      if (STATE.currentSuspect !== suspect) return;
      if (!stream) {
        thinking.remove();
        stream = makeStreamingBubble(suspect.name);
      }
      stream.append(chunk);
    };
    callLLM(suspect, framing, { onDelta }).then(reply => {
      if (STATE.currentSuspect !== suspect) {
        if (stream) stream.cancel(); else thinking.remove();
        return;
      }
      if (stream) {
        stream.finalize(reply);
      } else {
        thinking.remove();
        addBubble("suspect", reply, suspect.name);
      }
      pushTurn("suspect", reply);
      addNote(suspect.name, "confront", framing, reply);
    }).catch(err => {
      if (stream) stream.cancel(); else thinking.remove();
      if (isAbortError(err)) return;
      addBubble("system",
        `${t("interrog.errorPrefix")}${err.message}${t("interrog.errorSuffix")}`,
        suspect.name);
    });
  } else {
    const response = generateConfrontResponse(STATE.case, suspect, evidence);
    setTimeout(() => {
      thinking.remove();
      addBubble("suspect", response, suspect.name);
      pushTurn("suspect", response);
      addNote(suspect.name, "confront", framing, response);
    }, 600 + Math.random() * 400);
  }
}

function renderQuestionMenu() {
  const presetRow = $("#ask-offline");
  presetRow.innerHTML = "";
  const menu = getQuestionMenu(STATE.case ? STATE.case.lang : STATE.lang);
  menu.forEach(q => {
    const b = el("button", { onclick: () => askPreset(q.id) }, q.label);
    presetRow.appendChild(b);
  });
}

// The game requires an API key to start, so the ask area always shows both
// preset buttons and the free-text input. This just refreshes the provider
// badge / hint text after a provider or key change.
function refreshAskArea() {
  $("#ask-offline").hidden = false;
  $("#ask-ai").hidden = false;
  const provLabel = PROVIDERS[STATE.provider].label;
  const hint = $("#ai-hint");
  if (activeKey()) {
    hint.textContent = t("interrog.aiActive", `${provLabel} · ${activeModel()}`);
    hint.style.color = "var(--paper-warm)";
    $("#ai-input").disabled = false;
  } else {
    hint.textContent = t("interrog.aiNoKey");
    hint.style.color = "";
    $("#ai-input").disabled = true;
  }
  const provBadge = $("#active-provider");
  if (provBadge) provBadge.textContent = activeKey() ? `${provLabel} · ${activeModel()}` : "";
}

function scrollConvoToBottom() {
  const log = $("#conversation");
  if (log) log.scrollTop = log.scrollHeight;
  hideScrollPill();
}

function showScrollPill() {
  const pill = $("#scroll-to-bottom");
  if (pill) pill.hidden = false;
}

function hideScrollPill() {
  const pill = $("#scroll-to-bottom");
  if (pill) pill.hidden = true;
}

function setupScrollWatcher() {
  const log = $("#conversation");
  if (!log || log.dataset.scrollWatcherInit) return;
  log.dataset.scrollWatcherInit = "1";
  log.addEventListener("scroll", () => {
    const distFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (distFromBottom > 60) showScrollPill();
    else hideScrollPill();
  });
}

function addBubble(role, content, suspectName, scroll = true) {
  const log = $("#conversation");
  let bubble;
  const detectiveLabel = t("interrog.detective");
  if (role === "detective") {
    bubble = el("div", { class: "bubble detective", "data-label": detectiveLabel }, content);
    sfxClick();
  } else if (role === "suspect") {
    bubble = el("div",
      { class: "bubble suspect", "data-name": suspectName },
      content);
    sfxClick();
  } else if (role === "thinking") {
    bubble = el("div",
      { class: "bubble suspect thinking", "data-name": suspectName,
        id: "thinking-bubble" },
      "");
  } else {
    bubble = el("div", { class: "bubble system" }, content);
  }
  log.appendChild(bubble);
  if (scroll) log.scrollTop = log.scrollHeight;
  return bubble;
}

// Streaming bubble: pre-create an empty suspect bubble we can append to as
// tokens arrive. Returns { bubble, append, finalize, cancel } where append(s)
// is constant-time text concatenation. The bubble has a `streaming` class
// so CSS can render a blinking caret while it grows.
function makeStreamingBubble(suspectName) {
  const log = $("#conversation");
  const textNode = document.createTextNode("");
  const bubble = el("div",
    { class: "bubble suspect streaming", "data-name": suspectName });
  bubble.appendChild(textNode);
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  let firstChunk = true;
  return {
    bubble,
    append(chunk) {
      if (firstChunk) { sfxClick(); firstChunk = false; }
      textNode.appendData(chunk);
      // Auto-scroll only if user is near the bottom; preserves their position
      // if they've scrolled up to read earlier in the thread.
      const dist = log.scrollHeight - log.scrollTop - log.clientHeight;
      if (dist < 120) log.scrollTop = log.scrollHeight;
    },
    finalize(finalText) {
      bubble.classList.remove("streaming");
      // If a leak scrub or other post-processing changed the text, reconcile.
      if (finalText != null && textNode.data !== finalText) {
        textNode.data = finalText;
      }
    },
    cancel() {
      bubble.remove();
    },
  };
}

function pushTurn(role, content) {
  const name = STATE.currentSuspect.name;
  if (!STATE.conversations[name]) STATE.conversations[name] = [];
  STATE.conversations[name].push({ role, content });
}

function maybeCollectEvidence(suspect) {
  // Once the player has questioned a witness suspect more than a couple
  // times, assume the statement has come up and add it to evidence.
  // Avoid duplicates.
  const witnessFact = suspect.knowsFacts.find(f => f.type === "witness");
  if (!witnessFact) return;
  const askCount = STATE.case.questionCounts[suspect.name] || 0;
  if (askCount < 2) return;
  if (STATE.evidence.some(e => e.source === suspect.name)) return;
  STATE.evidence.push({
    source: suspect.name,
    text: witnessFact.text,
    namedSuspect: witnessFact._namedSuspect,
    isFalse: witnessFact._false || false,
  });
  refreshConfrontButton();
}

/* ============== Case Notes ============== */

function addNote(suspectName, category, question, answer) {
  const isNewSuspect = !STATE.notes[suspectName];
  if (isNewSuspect) STATE.notes[suspectName] = {};
  if (!STATE.notes[suspectName][category]) STATE.notes[suspectName][category] = [];
  STATE.notes[suspectName][category].push({ q: question, a: answer });
  if (!STATE.notesActiveTab) STATE.notesActiveTab = suspectName;
  if (STATE.notesOpen) {
    // Tabs only change when a brand-new suspect gets their first note;
    // a note for a non-active suspect doesn't need any DOM work.
    if (isNewSuspect) renderNotesTabs();
    if (suspectName === STATE.notesActiveTab) renderNotesBody();
  }
}

function toggleNotes() {
  STATE.notesOpen = !STATE.notesOpen;
  $("#notes-panel").classList.toggle("open", STATE.notesOpen);
  if (STATE.notesOpen) {
    if (!STATE.notesActiveTab && STATE.currentSuspect) {
      STATE.notesActiveTab = STATE.currentSuspect.name;
    }
    renderNotes();
  }
}

function renderNotes() {
  renderNotesTabs();
  renderNotesBody();
}

function switchNotesTab(name) {
  STATE.notesActiveTab = name;
  $$("#notes-tabs .notes-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.name === name);
  });
  renderNotesBody();
}

function renderNotesTabs() {
  const tabsEl = $("#notes-tabs");
  tabsEl.innerHTML = "";
  const names = Object.keys(STATE.notes);
  if (names.length === 0) return;
  if (!names.includes(STATE.notesActiveTab)) STATE.notesActiveTab = names[0];
  const frag = document.createDocumentFragment();
  names.forEach(n => {
    const b = el("button", {
      class: "notes-tab" + (n === STATE.notesActiveTab ? " active" : ""),
      dataset: { name: n },
      onclick: () => switchNotesTab(n),
    }, n);
    frag.appendChild(b);
  });
  tabsEl.appendChild(frag);
}

function renderNotesBody() {
  const bodyEl = $("#notes-body");
  bodyEl.innerHTML = "";
  const names = Object.keys(STATE.notes);
  if (names.length === 0) {
    bodyEl.innerHTML = `<p class="notes-empty">${t("notes.empty")}</p>`;
    return;
  }
  const suspectNotes = STATE.notes[STATE.notesActiveTab] || {};
  // Display in canonical question order (then anything else)
  const canonical = ["alibi", "tod", "knew_victim", "saw_anyone",
                     "suspicious", "hiding", "weapon", "confront",
                     "free_form", "leave"];
  const orderedCats = canonical
    .filter(c => suspectNotes[c])
    .concat(Object.keys(suspectNotes).filter(c => !canonical.includes(c)));
  const frag = document.createDocumentFragment();
  orderedCats.forEach(cat => {
    const sec = el("section", { class: "notes-section" });
    sec.appendChild(el("h4", {}, t("notes.cat." + cat)));
    suspectNotes[cat].forEach(({ q, a }) => {
      const entry = el("div", { class: "notes-entry" });
      entry.appendChild(el("div", { class: "notes-q" }, q));
      entry.appendChild(el("div", { class: "notes-a" }, a));
      sec.appendChild(entry);
    });
    frag.appendChild(sec);
  });
  bodyEl.appendChild(frag);
}

/* ============================== preset questions ============================== */

function askPreset(questionId) {
  if (STATE.askInFlight) return;
  const suspect = STATE.currentSuspect;
  const menu = getQuestionMenu(STATE.case.lang);
  const qLabel = menu.find(q => q.id === questionId).label;

  addBubble("detective", qLabel, suspect.name);
  pushTurn("detective", qLabel);

  const thinking = addBubble("thinking", "", suspect.name);
  abortInterrogation();
  const ctrl = new AbortController();
  STATE.activeAbort = ctrl;
  STATE.askInFlight = true;

  let stream = null;
  const onDelta = (chunk) => {
    if (ctrl.signal.aborted || STATE.currentSuspect !== suspect) return;
    if (!stream) {
      thinking.remove();
      stream = makeStreamingBubble(suspect.name);
    }
    stream.append(chunk);
  };

  callLLM(suspect, qLabel, { signal: ctrl.signal, onDelta }).then(reply => {
    if (ctrl.signal.aborted || STATE.currentSuspect !== suspect) {
      if (stream) stream.cancel(); else thinking.remove();
      return;
    }
    if (stream) {
      stream.finalize(reply);
    } else {
      thinking.remove();
      addBubble("suspect", reply, suspect.name);
    }
    pushTurn("suspect", reply);
    addNote(suspect.name, questionId, qLabel, reply);
    STATE.case.questionCounts[suspect.name] =
      (STATE.case.questionCounts[suspect.name] || 0) + 1;
    maybeCollectEvidence(suspect);
    saveSession();
  }).catch(err => {
    if (stream) stream.cancel(); else thinking.remove();
    if (isAbortError(err)) return;
    if (STATE.currentSuspect !== suspect) return;
    // LLM call failed -- fall back to a templated response so the game
    // doesn't get stuck. Tell the player something went wrong.
    console.warn("[noir] LLM call failed, using template fallback:", err.message);
    addBubble("system",
      `${t("interrog.errorPrefix")}${err.message}${t("interrog.errorSuffix")}`,
      suspect.name);
    const response = generateOfflineResponse(STATE.case, suspect, questionId);
    addBubble("suspect", response, suspect.name);
    pushTurn("suspect", response);
    addNote(suspect.name, questionId, qLabel, response);
    maybeCollectEvidence(suspect);
    saveSession();
  }).finally(() => {
    if (STATE.activeAbort === ctrl) STATE.activeAbort = null;
    STATE.askInFlight = false;
  });

  if (questionId === "leave") {
    setTimeout(() => show("screen-lineup"), 1500);
  }
}

/* ============================== AI mode ============================== */

async function askAI() {
  if (STATE.askInFlight) return;
  const input = $("#ai-input");
  const question = input.value.trim();
  if (!question) return;
  if (!activeKey()) {
    alert(t("interrog.aiSetKeyFirst"));
    return;
  }
  STATE.askInFlight = true;
  input.value = "";
  input.disabled = true;

  const suspect = STATE.currentSuspect;
  addBubble("detective", question, suspect.name);
  pushTurn("detective", question);

  const thinking = addBubble("thinking", "", suspect.name);
  abortInterrogation();
  const ctrl = new AbortController();
  STATE.activeAbort = ctrl;

  let stream = null;
  const onDelta = (chunk) => {
    if (ctrl.signal.aborted || STATE.currentSuspect !== suspect) return;
    if (!stream) {
      thinking.remove();
      stream = makeStreamingBubble(suspect.name);
    }
    stream.append(chunk);
  };

  try {
    const reply = await callLLM(suspect, question, { signal: ctrl.signal, onDelta });
    if (ctrl.signal.aborted || STATE.currentSuspect !== suspect) {
      if (stream) stream.cancel(); else thinking.remove();
      return;
    }
    if (stream) {
      stream.finalize(reply);
    } else {
      thinking.remove();
      addBubble("suspect", reply, suspect.name);
    }
    pushTurn("suspect", reply);
    addNote(suspect.name, "free_form", question, reply);
    STATE.case.questionCounts[suspect.name] = (STATE.case.questionCounts[suspect.name] || 0) + 1;
    maybeCollectEvidence(suspect);
    saveSession();
  } catch (err) {
    if (stream) stream.cancel(); else thinking.remove();
    if (isAbortError(err)) return;
    if (STATE.currentSuspect !== suspect) return;
    addBubble("system",
      `${t("interrog.errorPrefix")}${err.message}${t("interrog.errorSuffix")}`,
      suspect.name);
    console.error(err);
  } finally {
    if (STATE.activeAbort === ctrl) STATE.activeAbort = null;
    STATE.askInFlight = false;
    input.disabled = false;
    if (STATE.currentSuspect === suspect) input.focus();
  }
}

async function callLLM(suspect, userQuestion, opts = {}) {
  let reply;
  if (STATE.provider === "google")     reply = await callGemini(suspect, userQuestion, opts);
  else if (STATE.provider === "qwen")  reply = await callQwen(suspect, userQuestion, opts);
  else                                  reply = await callClaude(suspect, userQuestion, opts);
  const scrubbed = scrubLeak(reply, suspect, STATE.case);
  // If scrubLeak rewrote the reply, the streamed bubble is showing the
  // unredacted text — surface the substitution so the caller can reconcile.
  return scrubbed;
}

// ---- Generic SSE line iterator (shared by all three providers) ----
async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE messages are separated by blank lines; data fields by single newlines
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trimStart();
        if (data === "[DONE]") return;
        try { yield JSON.parse(data); } catch (_) { /* skip malformed line */ }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

async function _failedRequestError(provider, res) {
  const text = await res.text();
  let detail = text;
  try { const j = JSON.parse(text); detail = j.error?.message || text; } catch (_) {}
  return new Error(`${provider} ${res.status}: ${detail.slice(0, 200)}`);
}

// ---- Qwen (Alibaba 通义千问) via DashScope OpenAI-compatible endpoint ----
const QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

// Non-streaming Qwen chat — used by narrative layer. Streaming for chat is
// handled inline in callQwen() below.
async function _callQwenChat(messages, maxTokens, temperature, opts = {}) {
  const res = await fetch(QWEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${STATE.apiKeys.qwen}`,
    },
    body: JSON.stringify({
      model: STATE.apiModels.qwen,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw await _failedRequestError("Qwen", res);
  const data = await res.json();
  const choice = data.choices?.[0];
  const reply = choice?.message?.content || "";
  if (choice?.finish_reason === "length") {
    console.warn("[noir] Qwen hit max_tokens; response may be truncated. Got " + reply.length + " chars.");
  }
  if (!reply.trim()) {
    throw new Error(`Qwen returned no text (finish: ${choice?.finish_reason || "unknown"}).`);
  }
  return reply.trim();
}

async function callQwen(suspect, userQuestion, opts = {}) {
  const system = buildSystemPromptForSuspect(STATE.case, suspect);
  const history = (STATE.conversations[suspect.name] || []).filter(
    t => t.role === "detective" || t.role === "suspect"
  );
  const messages = [{ role: "system", content: system }];
  for (const turn of history) {
    if (turn.role === "detective") messages.push({ role: "user", content: turn.content });
    else if (turn.role === "suspect") messages.push({ role: "assistant", content: turn.content });
  }
  if (!opts.onDelta) return _callQwenChat(messages, 800, 0.9, opts);

  const res = await fetch(QWEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${STATE.apiKeys.qwen}`,
    },
    body: JSON.stringify({
      model: STATE.apiModels.qwen,
      messages,
      max_tokens: 800,
      temperature: 0.9,
      stream: true,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw await _failedRequestError("Qwen", res);
  let acc = "";
  let finishReason = null;
  for await (const evt of sseEvents(res)) {
    const choice = evt.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta) { acc += delta; opts.onDelta(delta); }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }
  if (finishReason === "length") {
    console.warn("[noir] Qwen hit max_tokens; response may be truncated. Got " + acc.length + " chars.");
  }
  if (!acc.trim()) {
    throw new Error(`Qwen returned no text (finish: ${finishReason || "unknown"}).`);
  }
  return acc.trim();
}

async function _callQwenRaw(systemText, userText, maxTokens, opts = {}) {
  const messages = [
    { role: "system", content: systemText },
    { role: "user", content: userText },
  ];
  return _callQwenChat(messages, maxTokens, 0.85, opts);
}

// Raw single-shot LLM call (no per-suspect roleplay constraints) used for
// the narrative layer (case opener, reveal monologue).
async function callLLMRaw(system, user, maxTokens = 1000, opts = {}) {
  if (!activeKey()) throw new Error("no API key");
  if (STATE.provider === "google") return _callGeminiRaw(system, user, maxTokens, opts);
  if (STATE.provider === "qwen")   return _callQwenRaw(system, user, maxTokens, opts);
  return _callClaudeRaw(system, user, maxTokens, opts);
}

async function _callClaudeRaw(systemText, userText, maxTokens, opts = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": STATE.apiKeys.anthropic,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: STATE.apiModels.anthropic,
      max_tokens: maxTokens,
      system: systemText,
      messages: [{ role: "user", content: userText }],
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const blocks = data.content || [];
  const t = blocks.filter(b => b.type === "text").map(b => b.text).join("");
  return t.trim();
}

async function _callGeminiRaw(systemText, userText, maxTokens, opts = {}) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/"
            + encodeURIComponent(STATE.apiModels.google) + ":generateContent?key="
            + encodeURIComponent(STATE.apiKeys.google);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.85,
        // Disable thinking. Gemini 2.5 spends output budget on internal
        // reasoning by default; for creative narrative we'd rather all
        // tokens go to visible text.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const reason = cand?.finishReason;
  const parts = cand?.content?.parts || [];
  const text = parts.map(p => p.text || "").join("").trim();
  if (reason === "MAX_TOKENS") {
    console.warn("[noir] Gemini hit MAX_TOKENS; response may be truncated. Got " + text.length + " chars.");
  }
  if (reason === "SAFETY") {
    throw new Error("Gemini safety filter blocked the narrative output.");
  }
  if (!text) {
    throw new Error(`Gemini returned no text (finish reason: ${reason || "unknown"}).`);
  }
  return text;
}

// Anti-leak: post-process the LLM reply. If it contains a confession or
// directly names the killer, swap it for a voice-flavored deflection
// line. Catches the rare case where an LLM breaks the system-prompt
// rules under pressure.
// Only fire on phrases that are unambiguously a murder confession in any
// context. Earlier versions caught false positives ("I'm guilty of poor
// taste in suitors") and replaced legit responses with a short deflection,
// which looked like the suspect's reply was cut off.
const LEAK_PATTERNS = {
  confession: [
    // EN: explicit murder admissions only. "I did it" alone is too generic
    // (could be "I did it for love"); require a victim reference.
    /\bi killed (him|her|them|the victim|the (man|woman|deceased))\b/i,
    /\bi murdered (him|her|them|the victim|the (man|woman|deceased))\b/i,
    /\bit was me( who killed|, i killed)\b/i,
    /\bi (confess|admit)(?: that)? i (killed|murdered)\b/i,
    /\bi(?:'m| am) the (killer|murderer)\b/i,

    // ZH: explicit murder admissions only.
    /我杀(了|的)\s*(他|她|那个|被害|死者|受害)/,
    /(是|确实是|的确是)我(杀|害)(了|的)/,
    /我承认.*?(我|是)?(杀|害)了/,
    /我.{0,3}就是(凶手|杀人犯|凶杀)/,
  ],
};

function _escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function detectLeak(reply, caseObj) {
  for (const re of LEAK_PATTERNS.confession) {
    if (re.test(reply)) return "confession";
  }
  // Naming-the-killer detection: 'the killer is X' / '凶手是 X' where X = actual killer
  const k = _escapeRegex(caseObj._killer);
  const enAccuse = new RegExp(`(killer|murderer)\\s+(is|was)\\s+(?:[^.]*\\b)?${k}\\b`, "i");
  const zhAccuse = new RegExp(`(凶手|杀人.{0,2})(就)?是.{0,12}${k}`);
  if (enAccuse.test(reply) || zhAccuse.test(reply)) return "accusation";
  return null;
}

function scrubLeak(reply, suspect, caseObj) {
  const issue = detectLeak(reply, caseObj);
  if (!issue) return reply;
  console.warn(`[noir] AI ${issue} detected, substituting deflection`);
  // Use the suspect's voice-templated deflection. voiceFor returns
  // {open, close, deflect, leave}; pick a deflect line.
  const v = voiceFor(caseObj.lang, suspect.occupation);
  return pick(v.deflect);
}

async function callClaude(suspect, userQuestion, opts = {}) {
  const system = buildSystemPromptForSuspect(STATE.case, suspect);
  const history = (STATE.conversations[suspect.name] || []).filter(
    t => t.role === "detective" || t.role === "suspect"
  );
  const messages = [];
  for (const turn of history) {
    if (turn.role === "detective") messages.push({ role: "user", content: turn.content });
    else if (turn.role === "suspect") messages.push({ role: "assistant", content: turn.content });
  }

  const body = {
    model: STATE.apiModels.anthropic,
    max_tokens: 800,
    system,
    messages,
  };
  if (opts.onDelta) body.stream = true;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": STATE.apiKeys.anthropic,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) throw await _failedRequestError("Anthropic", res);

  if (!opts.onDelta) {
    const data = await res.json();
    const blocks = data.content || [];
    const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
    return text.trim() || "[silence]";
  }

  // Streaming: Anthropic uses one event per SSE message (content_block_delta
  // is the one that carries text); ignore the rest. error events surface as
  // {type: "error", error: {...}}.
  let acc = "";
  for await (const evt of sseEvents(res)) {
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
      const t = evt.delta.text;
      if (t) { acc += t; opts.onDelta(t); }
    } else if (evt.type === "error") {
      throw new Error(`Anthropic stream error: ${evt.error?.message || "unknown"}`);
    }
  }
  return acc.trim() || "[silence]";
}

async function callGemini(suspect, userQuestion, opts = {}) {
  const system = buildSystemPromptForSuspect(STATE.case, suspect);
  const history = (STATE.conversations[suspect.name] || []).filter(
    t => t.role === "detective" || t.role === "suspect"
  );
  // Gemini's chat format: contents alternates user/model messages.
  const contents = [];
  for (const turn of history) {
    contents.push({
      role: turn.role === "detective" ? "user" : "model",
      parts: [{ text: turn.content }],
    });
  }

  const model = STATE.apiModels.google;
  const action = opts.onDelta ? "streamGenerateContent" : "generateContent";
  const sseQ = opts.onDelta ? "&alt=sse" : "";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/"
            + encodeURIComponent(model) + ":" + action + "?key="
            + encodeURIComponent(STATE.apiKeys.google) + sseQ;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.9,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: opts.signal,
  });

  if (!res.ok) throw await _failedRequestError("Gemini", res);

  if (!opts.onDelta) {
    const data = await res.json();
    const reason = data.candidates?.[0]?.finishReason;
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("");
    if (!text.trim()) {
      if (reason === "SAFETY") throw new Error("Gemini blocked the response (safety filter).");
      return "[silence]";
    }
    return text.trim();
  }

  // Streaming: each SSE chunk carries a candidate with a partial parts array;
  // accumulate text and watch for SAFETY finishReason on any chunk.
  let acc = "";
  let lastReason = null;
  for await (const evt of sseEvents(res)) {
    const cand = evt.candidates?.[0];
    if (!cand) continue;
    const parts = cand.content?.parts || [];
    const t = parts.map(p => p.text || "").join("");
    if (t) { acc += t; opts.onDelta(t); }
    if (cand.finishReason) lastReason = cand.finishReason;
  }
  if (lastReason === "SAFETY") throw new Error("Gemini blocked the response (safety filter).");
  return acc.trim() || "[silence]";
}

/* ============================== Narrative layer (opener + reveal) ============================== */

function narrativeEnabled() {
  return !!activeKey() && STATE.narrativeOn;
}

async function generateOpener(caseObj, opts = {}) {
  if (caseObj.narrativeOpener) return caseObj.narrativeOpener;
  const lang = caseObj.lang;
  const system = (lang === "zh")
    ? "你是 1930 年代民国上海 noir 风格的旁白。用 3-4 句话 (约 80 字) 描写到案现场: 尸体怎么躺着, 房间里什么气氛, 雨/烟/灯光等。短句, 沉郁。不许提到任何嫌疑人, 不许暗示凶手, 不许提到动机或目击者。只渲染场景。直接输出散文, 不要引号或前后缀。"
    : "You are a 1940s American noir narrator opening a detective case file. Write a single atmospheric paragraph (3-4 sentences, ~80 words) describing how the body was found at the scene. Use noir voice: rain, cigarette smoke, dim light, terse declarative sentences. Do NOT name any suspect or hint at the killer. Do NOT mention motive or witnesses. Only the body, the room, the weapon, the hour. Output ONLY the paragraph, no quotation marks, no preface.";
  const user = (lang === "zh")
    ? `受害人: ${caseObj.victim.name}, ${caseObj.victim.title}\n现场: ${caseObj.scene}\n现场凶器: ${caseObj.weaponAtScene}\n死亡时间: ${caseObj.timeOfDeath}`
    : `Victim: ${caseObj.victim.name}, ${caseObj.victim.title}\nScene: ${caseObj.scene}\nWeapon at scene: ${caseObj.weaponAtScene}\nTime of death: ${caseObj.timeOfDeath}`;
  const reply = await callLLMRaw(system, user, 800, opts);
  caseObj.narrativeOpener = reply;
  return reply;
}

function _buildRevealUserPayload(caseObj) {
  const lang = caseObj.lang;
  const killer = caseObj.suspects.find(s => s._isKiller);
  const witness = caseObj.suspects.find(s =>
    s.knowsFacts.some(f => f.type === "witness" && !f._false));
  const motiveLeaker = caseObj.suspects.find(s =>
    s.knowsFacts.some(f => f.type === "motive"));
  const falseWitness = caseObj.suspects.find(s =>
    s.knowsFacts.some(f => f._false));
  const redHerrings = caseObj.suspects.filter(s =>
    !s._isKiller &&
    s.knowsFacts.length === 0 &&
    s.thingsToHide.length > 0);

  const lines = [];
  if (lang === "zh") {
    lines.push(`受害人: ${caseObj.victim.name}, ${caseObj.victim.title}`);
    lines.push(`现场: ${caseObj.scene}  /  凶器: ${caseObj.weaponAtScene}  /  死亡时间: ${caseObj.timeOfDeath}`);
    lines.push("");
    lines.push(`真凶: ${killer.name} (${killer.occupation})`);
    lines.push(`凶手对警官谎称的不在场证明: "${killer.claimedAlibi}"`);
    lines.push(`凶手的动机类型: ${caseObj._motiveType || "(无)"}`);
    if (witness) {
      lines.push(`关键目击者: ${witness.name} (${witness.occupation})`);
      lines.push(`目击词: ${witness.knowsFacts.find(f => f.type === "witness").text}`);
    }
    if (motiveLeaker) {
      lines.push(`动机泄露者: ${motiveLeaker.name} (${motiveLeaker.occupation})`);
      lines.push(`所知传闻: ${motiveLeaker.knowsFacts.find(f => f.type === "motive").text}`);
    }
    if (falseWitness) {
      lines.push(`误导证人 (Hard 模式): ${falseWitness.name} 错指了 ${falseWitness.knowsFacts.find(f => f._false)._namedSuspect}`);
    }
    if (redHerrings.length) {
      lines.push("");
      lines.push("其他嫌疑人 (无辜) 的红鲱鱼私事 (跟凶案无关):");
      redHerrings.forEach(s => {
        lines.push(`  - ${s.name} (${s.occupation}): ${s.thingsToHide[0]}`);
      });
    }
  } else {
    lines.push(`Victim: ${caseObj.victim.name}, ${caseObj.victim.title}`);
    lines.push(`Scene: ${caseObj.scene}  /  Weapon: ${caseObj.weaponAtScene}  /  Time of death: ${caseObj.timeOfDeath}`);
    lines.push("");
    lines.push(`KILLER: ${killer.name} (${killer.occupation})`);
    lines.push(`Killer's lie to the detective (false alibi): "${killer.claimedAlibi}"`);
    lines.push(`Killer's motive type: ${caseObj._motiveType || "(none)"}`);
    if (witness) {
      lines.push(`Key witness: ${witness.name} (${witness.occupation})`);
      lines.push(`Witness statement: ${witness.knowsFacts.find(f => f.type === "witness").text}`);
    }
    if (motiveLeaker) {
      lines.push(`Motive leaker: ${motiveLeaker.name} (${motiveLeaker.occupation})`);
      lines.push(`What they heard: ${motiveLeaker.knowsFacts.find(f => f.type === "motive").text}`);
    }
    if (falseWitness) {
      lines.push(`Misleading 2nd witness (hard mode): ${falseWitness.name} wrongly named ${falseWitness.knowsFacts.find(f => f._false)._namedSuspect}`);
    }
    if (redHerrings.length) {
      lines.push("");
      lines.push("Other suspects (innocent) and their unrelated red-herring secrets:");
      redHerrings.forEach(s => {
        lines.push(`  - ${s.name} (${s.occupation}): ${s.thingsToHide[0]}`);
      });
    }
  }
  return lines.join("\n");
}

async function generateRevealMonologue(caseObj, opts = {}) {
  if (caseObj.narrativeReveal) return caseObj.narrativeReveal;
  const lang = caseObj.lang;
  const system = (lang === "zh")
    ? "你扮演一桩 1930 年代民国上海 noir 凶案中的侦探, 案子刚破, 现在念结案独白。200-280 字, 用上海腔/民国调调。串起这些信息: 凶手 + 动机, 目击者那晚看到什么, 凶器为什么在现场, 每个无辜嫌疑人的红鲱鱼私事各是什么 (这些私事都跟凶案无关, 只是让他们看上去可疑)。用第一人称 (「我知道是 X 的时候……」)。不出戏, 不提脚本/游戏。直接输出独白, 不要引号或前后缀。"
    : "You are the detective in a 1940s noir film delivering a closing monologue, having just solved the case. Write 200-280 words in noir voice. Tie together: who the killer is + their motive, what the witness saw, why the weapon was at the scene, and (briefly) what each non-killer's red herring secret was actually about — make clear those secrets were unrelated to the murder, only making them LOOK suspicious. Speak in first person ('I knew it was X when...'). Do not break character. Do not mention the script or game. Output ONLY the monologue, no quotation marks, no preface.";
  const user = _buildRevealUserPayload(caseObj);
  const reply = await callLLMRaw(system, user, 2000, opts);
  caseObj.narrativeReveal = reply;
  return reply;
}

/* ============================== accusation + verdict ============================== */

function renderAccusationGrid() {
  renderLineupGrid("accusation-grid", async (suspect) => {
    if (!confirm(t("accusation.confirm", suspect.name))) return;
    const verdict = await verifyAccusation(STATE.case, suspect.name);
    STATE.case.status = verdict.correct ? "solved" : "failed";
    showVerdict(verdict);
  });
}

function showVerdict(v) {
  sfxStamp();
  recordVerdict(v);
  clearSession();
  $("#verdict-accused").textContent = v.accused;
  $("#verdict-killer").textContent  = v.actualKiller;
  // Reset the reveal panel for a fresh game-over screen
  const reveal = $("#reveal-all");
  if (reveal) {
    reveal.hidden = true;
    reveal.innerHTML = "";
  }
  const tog = $("#reveal-toggle");
  if (tog) tog.textContent = t("btn.revealAll");

  const stamp = $("#verdict-stamp");
  const result = $("#verdict-result");
  if (v.correct) {
    stamp.textContent = t("verdict.solved");
    stamp.className = "verdict-stamp solved";
    result.textContent = t("verdict.win");
    result.className = "verdict-result win";
  } else {
    stamp.textContent = t("verdict.failed");
    stamp.className = "verdict-stamp failed";
    result.textContent = t("verdict.loss");
    result.className = "verdict-result loss";
  }

  $("#verdict-committed").textContent = v.committedHash;
  $("#verdict-computed").textContent  = v.computedHash;
  const hashStatus = $("#verdict-hash-status");
  hashStatus.textContent = v.hashOk ? t("verdict.hashOk") : t("verdict.hashFail");
  hashStatus.className = "hash-status " + (v.hashOk ? "ok" : "fail");

  show("screen-verdict");
}

/* ============================== settings ============================== */

function activeKey()    { return STATE.apiKeys[STATE.provider] || null; }
function activeModel()  { return STATE.apiModels[STATE.provider]; }

function toggleReveal() {
  if (!STATE.case) return;
  const panel = $("#reveal-all");
  const tog = $("#reveal-toggle");
  if (!panel.hidden) {
    panel.hidden = true;
    panel.innerHTML = "";
    tog.textContent = t("btn.revealAll");
    return;
  }
  renderRevealAll(panel);
  panel.hidden = false;
  tog.textContent = t("btn.hideReveal");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

function renderRevealAll(panel) {
  const c = STATE.case;
  panel.innerHTML = "";
  const header = el("h3", { class: "reveal-header" }, t("reveal.title"));
  panel.appendChild(header);

  // Closing-monologue narrative block (LLM, if enabled)
  if (narrativeEnabled()) {
    const monologue = el("div", { class: "reveal-monologue" });
    if (c.narrativeReveal) {
      monologue.innerHTML = `<p>${escapeHtml(c.narrativeReveal).replace(/\n+/g, "</p><p>")}</p>`;
    } else {
      monologue.innerHTML = `<p class="narrative-loading">${t("narrative.revealLoading")}</p>`;
      abortNarrative();
      const ctrl = new AbortController();
      STATE.narrativeAbort = ctrl;
      generateRevealMonologue(c, { signal: ctrl.signal }).then(text => {
        if (STATE.narrativeAbort === ctrl) STATE.narrativeAbort = null;
        if (STATE.case === c) {
          monologue.innerHTML = `<p>${escapeHtml(text).replace(/\n+/g, "</p><p>")}</p>`;
        }
      }).catch(err => {
        if (STATE.narrativeAbort === ctrl) STATE.narrativeAbort = null;
        if (isAbortError(err)) return;
        console.warn("[noir] reveal LLM failed:", err.message);
        monologue.remove();
      });
    }
    panel.appendChild(monologue);
  }

  c.suspects.forEach(s => {
    const card = el("div", { class: "reveal-card" + (s._isKiller ? " killer" : "") });

    const head = el("div", { class: "reveal-card-head" });
    head.appendChild(el("div", { class: "reveal-name" }, s.name));
    head.appendChild(el("div", { class: "reveal-occ" }, s.occupation));
    const tags = roleTags(s);
    if (tags.length > 0) {
      const tagBox = el("div", { class: "reveal-tags" });
      tags.forEach(tg => tagBox.appendChild(el("span", { class: `reveal-tag ${tg.cls}` }, tg.label)));
      head.appendChild(tagBox);
    }
    card.appendChild(head);

    // Alibi block
    const alibi = el("div", { class: "reveal-block" });
    alibi.appendChild(el("div", { class: "reveal-label" },
      t(s._isKiller ? "reveal.alibiFalse" : "reveal.alibiTrue")));
    alibi.appendChild(el("div", { class: "reveal-text" }, '"' + s.claimedAlibi + '"'));
    card.appendChild(alibi);

    // What they were really hiding
    if (s.thingsToHide && s.thingsToHide.length) {
      const hide = el("div", { class: "reveal-block" });
      hide.appendChild(el("div", { class: "reveal-label" }, t("reveal.hiding")));
      const ul = el("ul", { class: "reveal-list" });
      s.thingsToHide.forEach(h => ul.appendChild(el("li", {}, h)));
      hide.appendChild(ul);
      card.appendChild(hide);
    }

    // Facts they held
    if (s.knowsFacts && s.knowsFacts.length) {
      const facts = el("div", { class: "reveal-block" });
      facts.appendChild(el("div", { class: "reveal-label" }, t("reveal.facts")));
      const ul = el("ul", { class: "reveal-list" });
      s.knowsFacts.forEach(f => {
        const tagText = f.type === "witness"
          ? (f._false ? t("reveal.witnessFalse") : t("reveal.witnessTrue"))
          : t("reveal.gossip");
        const li = el("li", {});
        li.appendChild(el("span", { class: "reveal-fact-tag " + (f._false ? "false" : f.type) }, tagText));
        li.appendChild(document.createTextNode(" " + f.text));
        ul.appendChild(li);
      });
      facts.appendChild(ul);
      card.appendChild(facts);
    }

    panel.appendChild(card);
  });
}

function roleTags(suspect) {
  const tags = [];
  if (suspect._isKiller) tags.push({ cls: "killer", label: t("reveal.tag.killer") });
  for (const f of (suspect.knowsFacts || [])) {
    if (f.type === "witness" && f._false) tags.push({ cls: "false", label: t("reveal.tag.falseWitness") });
    else if (f.type === "witness")        tags.push({ cls: "witness", label: t("reveal.tag.witness") });
    else if (f.type === "motive")         tags.push({ cls: "gossip", label: t("reveal.tag.gossip") });
  }
  if (tags.length === 0) tags.push({ cls: "redherring", label: t("reveal.tag.redHerring") });
  return tags;
}

function openCaseModal() {
  if (!STATE.case) return;
  const c = STATE.case;
  $("#case-modal-id").textContent = "#" + c.caseId;
  $("#case-modal-victim").textContent = `${c.victim.name}, ${c.victim.title}`;
  $("#case-modal-scene").textContent = c.scene;
  $("#case-modal-tod").textContent = c.timeOfDeath;
  $("#case-modal-weapon").textContent = c.weaponAtScene;
  $("#case-modal-hash").textContent = c.answerHash;
  const diffEl = $("#case-modal-difficulty");
  if (diffEl) diffEl.textContent = t("diff." + (c.difficulty || "normal"));

  const sep = STATE.lang === "zh" ? "·" : "--";
  const roster = $("#case-modal-roster");
  roster.innerHTML = "";
  c.suspects.forEach((s, i) => {
    roster.appendChild(el("li", {},
      el("span", { class: "roster-name" }, `${i + 1}. ${s.name}`),
      el("span", { class: "roster-occ" }, ` ${sep} ${s.occupation}`),
    ));
  });
  $("#case-modal").classList.add("active");
}

function closeCaseModal() {
  $("#case-modal").classList.remove("active");
}

/* ============================== timeline / compare-statements modal ============================== */

function openTimelineModal() {
  if (!STATE.case) return;
  renderTimeline();
  $("#timeline-modal").classList.add("active");
}

function closeTimelineModal() {
  $("#timeline-modal").classList.remove("active");
}

function renderTimeline() {
  const c = STATE.case;
  if (!c) return;
  $("#timeline-tod-banner").textContent = `${t("briefing.tod")}: ${c.timeOfDeath}`;

  // Alibis: shown only after the suspect has been questioned at least once.
  // This makes the timeline a real reward for working through the lineup,
  // not a free contradiction-finder.
  const alibisEl = $("#timeline-alibis");
  alibisEl.innerHTML = "";
  const alibiFrag = document.createDocumentFragment();
  c.suspects.forEach(s => {
    const questioned = (c.questionCounts[s.name] || 0) > 0;
    const row = el("div", { class: "tl-alibi-row" + (questioned ? "" : " unquestioned") });
    const head = el("div", { class: "tl-alibi-head" });
    head.appendChild(el("span", { class: "tl-alibi-name" }, s.name));
    head.appendChild(el("span", { class: "tl-alibi-occ" }, s.occupation));
    row.appendChild(head);
    const body = el("div", { class: "tl-alibi-body" });
    if (questioned) {
      body.textContent = `"${s.claimedAlibi}"`;
    } else {
      body.textContent = t("timeline.notYetQuestioned");
    }
    row.appendChild(body);
    alibiFrag.appendChild(row);
  });
  alibisEl.appendChild(alibiFrag);

  // Witness statements: drawn from STATE.evidence (already collected via the
  // CONFRONT pipeline). Each statement that names a suspect gets a chip the
  // player can visually align with that suspect's alibi above.
  const witEl = $("#timeline-witnesses");
  witEl.innerHTML = "";
  if (STATE.evidence.length === 0) {
    witEl.appendChild(el("p", { class: "timeline-empty" }, t("timeline.noWitness")));
    return;
  }
  const witFrag = document.createDocumentFragment();
  STATE.evidence.forEach(ev => {
    const card = el("div", { class: "tl-witness-card" });
    const head = el("div", { class: "tl-witness-head" });
    head.appendChild(el("span", { class: "tl-witness-source" },
      `${t("confront.fromLabel", ev.source)}`));
    if (ev.namedSuspect) {
      head.appendChild(el("span", { class: "tl-name-pill" },
        t("timeline.namesPill", ev.namedSuspect)));
    }
    card.appendChild(head);
    card.appendChild(el("div", { class: "tl-witness-text" }, `"${ev.text}"`));
    witFrag.appendChild(card);
  });
  witEl.appendChild(witFrag);
}

function renderStats() {
  const out = $("#stats-display");
  if (!out) return;
  const s = loadStats();
  const winRate = s.played > 0 ? Math.round((s.solved / s.played) * 100) : 0;
  out.innerHTML = "";

  const top = el("div", { class: "stats-grid" },
    el("div", { class: "stat-card" },
      el("div", { class: "stat-num" }, String(s.played)),
      el("div", { class: "stat-label" }, t("stats.played"))),
    el("div", { class: "stat-card" },
      el("div", { class: "stat-num" }, winRate + "%"),
      el("div", { class: "stat-label" }, t("stats.winRate"))),
    el("div", { class: "stat-card" },
      el("div", { class: "stat-num" }, String(s.bestStreak)),
      el("div", { class: "stat-label" }, t("stats.bestStreak"))),
    el("div", { class: "stat-card" },
      el("div", { class: "stat-num" }, s.fastestQuestions != null ? String(s.fastestQuestions) : "—"),
      el("div", { class: "stat-label" }, t("stats.fewestQs"))),
  );
  out.appendChild(top);

  // Per-difficulty breakdown
  const diffs = el("div", { class: "stats-diffs" });
  for (const d of ["easy", "normal", "hard"]) {
    const stat = s.byDifficulty[d] || { played: 0, solved: 0 };
    diffs.appendChild(el("div", { class: "stats-diff-row" },
      el("span", { class: "stats-diff-label" }, t("diff." + d)),
      el("span", { class: "stats-diff-val" }, `${stat.solved} / ${stat.played}`),
    ));
  }
  out.appendChild(diffs);

  // Achievements
  const allAch = ["firstSolve", "fiveQ", "hardSolve", "noConfront", "streak3", "tenSolves"];
  const earned = s.achievements || {};
  const ach = el("div", { class: "achievements" });
  ach.appendChild(el("div", { class: "achievements-header" }, t("stats.achievements")));
  allAch.forEach(key => {
    const got = !!earned[key];
    ach.appendChild(el("div", {
      class: "achievement" + (got ? " earned" : ""),
      title: got ? earned[key] : "",
    },
      el("span", { class: "achievement-icon" }, got ? "★" : "·"),
      el("div", { class: "achievement-text" },
        el("div", { class: "achievement-title" }, t("ach." + key)),
        el("div", { class: "achievement-desc" }, t("ach." + key + ".desc"))),
    ));
  });
  out.appendChild(ach);
}

function resetStats() {
  if (!confirm(t("stats.resetConfirm"))) return;
  lsRemove(LS.stats);
  renderStats();
}

function openSettings() {
  renderStats();
  // Reflect current ambient state in its toggle button
  $$("[data-action=toggle-ambient]").forEach(b => b.classList.toggle("active", AUDIO.ambientOn));
  $$("[data-action=toggle-narrative]").forEach(b => b.classList.toggle("active", STATE.narrativeOn));
  // Render the provider-specific model dropdown options first
  for (const provKey of Object.keys(PROVIDERS)) {
    const sel = $(`#${provKey}-model`);
    if (sel && sel.options.length === 0) {
      PROVIDERS[provKey].models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        sel.appendChild(opt);
      });
    }
    const keyEl = $(`#${provKey}-key`);
    if (keyEl) keyEl.value = STATE.apiKeys[provKey] || "";
    if (sel) sel.value = STATE.apiModels[provKey];
  }
  setProviderUI(STATE.provider);
  updateApiStatus();
  $("#settings-modal").classList.add("active");
}

function closeSettings() {
  $("#settings-modal").classList.remove("active");
}

function setProvider(provider) {
  if (!PROVIDERS[provider]) return;
  STATE.provider = provider;
  lsSet(LS.provider, provider);
  setProviderUI(provider);
  updateApiStatus();
  refreshAskArea();
}

function setProviderUI(provider) {
  $$(".provider-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.provider === provider);
  });
  $$(".provider-config").forEach(c => {
    c.hidden = c.dataset.provider !== provider;
  });
}

function saveApiKey() {
  const provider = STATE.provider;
  const keyEl = $(`#${provider}-key`);
  const modelEl = $(`#${provider}-model`);
  const key = keyEl.value.trim();
  const model = modelEl.value;
  if (!key) {
    alert(t("interrog.aiSetKeyFirst"));
    return;
  }
  STATE.apiKeys[provider] = key;
  STATE.apiModels[provider] = model;
  const lsKey = { anthropic: LS.anthropicKey, google: LS.googleKey, qwen: LS.qwenKey }[provider];
  const lsModel = { anthropic: LS.anthropicModel, google: LS.googleModel, qwen: LS.qwenModel }[provider];
  lsSet(lsKey, key);
  lsSet(lsModel, model);
  updateApiStatus(true);
  refreshAskArea();
  refreshKeyBanner();
}

function clearApiKey() {
  const provider = STATE.provider;
  STATE.apiKeys[provider] = null;
  const lsKey = { anthropic: LS.anthropicKey, google: LS.googleKey, qwen: LS.qwenKey }[provider];
  lsRemove(lsKey);
  const keyEl = $(`#${provider}-key`);
  if (keyEl) keyEl.value = "";
  updateApiStatus();
  refreshAskArea();
  refreshKeyBanner();
}

function updateApiStatus(justSaved = false) {
  const s = $("#api-status");
  if (!s) return;
  const key = activeKey();
  if (key) {
    const masked = key.slice(0, 6) + "..." + key.slice(-4);
    const provLabel = PROVIDERS[STATE.provider].label;
    s.textContent = t("settings.keySet", masked, justSaved) + " (" + provLabel + ")";
    s.className = "setting-status ok";
  } else {
    s.textContent = t("settings.noKey");
    s.className = "setting-status";
  }
}

/* ============================== bootstrap ============================== */

function showTutorial() {
  $("#tutorial-hint").hidden = false;
}

function dismissTutorial() {
  $("#tutorial-hint").hidden = true;
  lsSet(LS.tutorialSeen, "1");
}

function dailySeedString() {
  // Date in UTC so everyone playing the same calendar day gets the same case.
  const d = new Date();
  return `daily-${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

async function dailyCase() {
  if (!requireKey()) return;
  // Daily case is deterministic: same date + same lang + same difficulty
  // = same case for everyone. Force NORMAL difficulty so the daily target
  // is comparable across players.
  const prevDifficulty = STATE.difficulty;
  STATE.difficulty = "normal";
  await newCase(dailySeedString());
  STATE.difficulty = prevDifficulty;
}

function requireKey() {
  if (activeKey()) return true;
  alert(t("error.needKey"));
  openSettings();
  return false;
}

async function newCase(seed = null) {
  if (!requireKey()) return;
  abortInterrogation();
  abortNarrative();
  clearSession();
  hideResumeBanner();
  // First-time players: show a one-line tip about the deduction loop.
  if (!lsGet(LS.tutorialSeen)) {
    showTutorial();
  }
  STATE.case = await generateCase(STATE.lang, seed, STATE.difficulty);
  STATE.conversations = {};
  STATE.notes = {};
  STATE.notesActiveTab = null;
  STATE.evidence = [];
  STATE.evidencePickerOpen = false;
  STATE.currentSuspect = null;
  // Strip ?seed= from the URL on a fresh case so subsequent NEW CASE clicks
  // don't keep producing the same case. Sharing happens via the explicit button.
  if (window.location.search) {
    history.replaceState(null, "", window.location.pathname);
  }
  saveSession();
  renderBriefing();
  show("screen-briefing");
}

function shareCurrentCase() {
  if (!STATE.case) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("seed", String(STATE.case.seed));
  url.searchParams.set("lang", STATE.case.lang);
  const link = url.toString();
  // Try clipboard API; fall back to a prompt
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      flashShareStatus(t("briefing.shareCopied"));
    }, () => {
      window.prompt(t("briefing.shareManual"), link);
    });
  } else {
    window.prompt(t("briefing.shareManual"), link);
  }
}

function flashShareStatus(msg) {
  const el = $("#share-status");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 2200);
}

function gotoLineup() {
  if (!STATE.case) return;
  abortInterrogation();
  renderLineupGrid("lineup-grid", suspect => {
    sfxCreak();
    renderInterrogation(suspect);
    show("screen-interrogation");
  });
  show("screen-lineup");
}

function gotoBriefing()    { show("screen-briefing"); }
function gotoTitle()       { show("screen-title"); }
function gotoAccusation()  { renderAccusationGrid(); show("screen-accusation"); }

function loadSettings() {
  // Provider config + per-provider keys/models
  STATE.provider = lsGet(LS.provider) || "anthropic";
  if (!PROVIDERS[STATE.provider]) STATE.provider = "anthropic";

  STATE.apiKeys.anthropic = lsGet(LS.anthropicKey);
  STATE.apiKeys.google    = lsGet(LS.googleKey);
  STATE.apiKeys.qwen      = lsGet(LS.qwenKey);
  STATE.apiModels.anthropic = lsGet(LS.anthropicModel) || "claude-haiku-4-5-20251001";
  STATE.apiModels.google    = lsGet(LS.googleModel)    || "gemini-2.5-flash";
  STATE.apiModels.qwen      = lsGet(LS.qwenModel)      || "qwen-plus";

  // One-time migration: legacy single-key noir.apiKey was Anthropic.
  const legacyKey = lsGet(LS.legacyApiKey);
  const legacyModel = lsGet(LS.legacyApiModel);
  if (legacyKey && !STATE.apiKeys.anthropic) {
    STATE.apiKeys.anthropic = legacyKey;
    lsSet(LS.anthropicKey, legacyKey);
  }
  if (legacyModel && !lsGet(LS.anthropicModel)) {
    STATE.apiModels.anthropic = legacyModel;
    lsSet(LS.anthropicModel, legacyModel);
  }
  if (legacyKey || legacyModel) {
    lsRemove(LS.legacyApiKey);
    lsRemove(LS.legacyApiModel);
  }

  AUDIO.muted    = lsGet(LS.muted) === "1";
  AUDIO.ambientOn = lsGet(LS.ambient) === "1";
  // Narrative layer defaults ON when enabled (only effective if AI key present)
  STATE.narrativeOn = lsGet(LS.narrative) !== "0";

  // URL params take precedence on first load (so shared links work).
  const params = new URLSearchParams(window.location.search);
  const langFromUrl = params.get("lang");
  STATE.lang = (langFromUrl === "en" || langFromUrl === "zh")
    ? langFromUrl
    : (lsGet(LS.lang) || detectLang());

  const diffFromUrl = params.get("difficulty");
  const validDiffs = ["easy", "normal", "hard"];
  const storedDiff = lsGet(LS.difficulty);
  STATE.difficulty = validDiffs.includes(diffFromUrl)
    ? diffFromUrl
    : (validDiffs.includes(storedDiff) ? storedDiff : "normal");
}

function setDifficulty(d) {
  if (!["easy", "normal", "hard"].includes(d)) return;
  STATE.difficulty = d;
  lsSet(LS.difficulty, d);
  $$(".difficulty-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.difficulty === d);
  });
  const desc = $("#difficulty-desc");
  if (desc) {
    const key = "diff.desc" + d.charAt(0).toUpperCase() + d.slice(1);
    desc.textContent = t(key);
  }
}

async function maybeAutoStartFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const seedParam = params.get("seed");
  if (seedParam == null) return false;
  await newCase(seedParam);
  return true;
}

function detectLang() {
  const navLang = (navigator.language || "").toLowerCase();
  return navLang.startsWith("zh") ? "zh" : "en";
}

function bind() {
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) {
      const action = btn.dataset.action;
      switch (action) {
        case "new-case":      newCase();          break;
        case "daily-case":    dailyCase();        break;
        case "goto-lineup":   gotoLineup();       break;
        case "goto-briefing": gotoBriefing();     break;
        case "goto-title":    gotoTitle();        break;
        case "goto-accusation": gotoAccusation(); break;
        case "open-settings": openSettings();     break;
        case "close-settings":closeSettings();    break;
        case "save-api-key":  saveApiKey();       break;
        case "clear-api-key": clearApiKey();      break;
        case "ask-ai-send":   askAI();            break;
        case "share-case":    shareCurrentCase(); break;
        case "toggle-notes":  toggleNotes();      break;
        case "open-evidence-picker": openEvidencePicker(); break;
        case "toggle-audio":  audioToggle();      break;
        case "set-provider":  setProvider(btn.dataset.provider); break;
        case "open-case-modal":  openCaseModal();  break;
        case "close-case-modal": closeCaseModal(); break;
        case "open-timeline-modal":  openTimelineModal();  break;
        case "close-timeline-modal": closeTimelineModal(); break;
        case "resume-session":   resumeSession();   break;
        case "discard-session":  discardSession();  break;
        case "toggle-reveal":    toggleReveal();   break;
        case "dismiss-tutorial": dismissTutorial(); break;
        case "reset-stats":      resetStats();      break;
        case "scroll-to-bottom": scrollConvoToBottom(); break;
        case "toggle-ambient":   ambientToggle();   break;
        case "toggle-narrative": narrativeToggle(); break;
      }
      return;
    }
    const langBtn = e.target.closest(".lang-toggle button");
    if (langBtn) { setLang(langBtn.dataset.lang); return; }

    const diffBtn = e.target.closest(".difficulty-toggle button");
    if (diffBtn) { setDifficulty(diffBtn.dataset.difficulty); return; }
  });

  $("#settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") closeSettings();
  });
  $("#case-modal").addEventListener("click", (e) => {
    if (e.target.id === "case-modal") closeCaseModal();
  });
  $("#timeline-modal").addEventListener("click", (e) => {
    if (e.target.id === "timeline-modal") closeTimelineModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSettings();
      closeCaseModal();
      closeTimelineModal();
      closeShortcutsHelp();
      return;
    }
    // Ignore typing inside inputs / textareas
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const interrogActive = $("#screen-interrogation").classList.contains("active");
    const lineupActive   = $("#screen-lineup").classList.contains("active");
    const titleActive    = $("#screen-title").classList.contains("active");

    if (e.key === "?") {
      e.preventDefault();
      toggleShortcutsHelp();
      return;
    }

    if (interrogActive) {
      if (e.key === "n" || e.key === "N") { e.preventDefault(); toggleNotes(); return; }
      if (e.key === "c" || e.key === "C") { e.preventDefault(); openCaseModal(); return; }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); openTimelineModal(); return; }
      if (e.key === "l" || e.key === "L") { e.preventDefault(); gotoLineup(); return; }
    }

    if (lineupActive) {
      // 1-5: pick a suspect by ordinal
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= 9 && STATE.case && STATE.case.suspects[idx - 1]) {
        e.preventDefault();
        const suspect = STATE.case.suspects[idx - 1];
        sfxCreak();
        renderInterrogation(suspect);
        show("screen-interrogation");
        return;
      }
      if (e.key === "a" || e.key === "A") { e.preventDefault(); gotoAccusation(); return; }
      if (e.key === "c" || e.key === "C") { e.preventDefault(); openCaseModal(); return; }
    }

    if (titleActive) {
      if (e.key === "n" || e.key === "N") { e.preventDefault(); newCase();   return; }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); dailyCase(); return; }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); openSettings(); return; }
    }
  });

  function toggleShortcutsHelp() {
    const help = $("#shortcuts-help");
    if (!help) return;
    help.hidden = !help.hidden;
  }
  function closeShortcutsHelp() {
    const help = $("#shortcuts-help");
    if (help) help.hidden = true;
  }

  $("#ai-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askAI();
    }
  });
}

function refreshKeyBanner() {
  const banner = $("#key-banner");
  if (!banner) return;
  if (activeKey()) {
    const provLabel = PROVIDERS[STATE.provider].label;
    banner.innerHTML = `<span class="banner-ok">✓ ${escapeHtml(provLabel)} · ${escapeHtml(activeModel())}</span>`;
    banner.hidden = false;
  } else {
    banner.innerHTML = `<span class="banner-warn">${escapeHtml(t("title.keyMissing"))}</span>`;
    banner.hidden = false;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  loadSettings();
  bind();
  applyI18n();
  refreshAudioToggle();
  refreshKeyBanner();
  // Sync difficulty button active state on first paint.
  $$(".difficulty-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.difficulty === STATE.difficulty);
  });
  // First user click anywhere: warm up audio + play one vinyl crackle for atmosphere.
  document.addEventListener("click", function bootAudio() {
    document.removeEventListener("click", bootAudio);
    audioInit();
    sfxCrackleBurst();
  }, { once: true });
  show("screen-title");
  maybeShowResumeBanner();
  // If the URL has ?seed=, auto-load that case and skip the title screen.
  await maybeAutoStartFromUrl();
});
