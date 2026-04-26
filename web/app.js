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
  provider: "anthropic",      // "anthropic" | "google"
  apiKeys:   { anthropic: null, google: null },
  apiModels: { anthropic: "claude-haiku-4-5-20251001", google: "gemini-2.5-flash" },
  mode: "offline",            // "offline" | "ai"
  lang: "en",                 // "en" | "zh"
  difficulty: "normal",       // "easy" | "normal" | "hard"
};

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
  lang:             "noir.lang",
  difficulty:       "noir.difficulty",
  muted:            "noir.muted",
};

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
};

/* ============================== Audio (Web Audio API) ============================== */
/* All SFX are synthesized in-browser -- no external asset files. The
   AudioContext is lazily created on first user interaction (browser
   autoplay rules). */

const AUDIO = {
  ctx: null,
  muted: false,
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
  localStorage.setItem(LS.muted, AUDIO.muted ? "1" : "0");
  refreshAudioToggle();
  if (!AUDIO.muted) audioInit();
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
    "title.difficulty":    "DIFFICULTY",
    "btn.newCase":         "NEW CASE",
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
    "interrog.modeLabel":    "Mode:",
    "interrog.aiNoKey":      "Set your Claude API key in Settings to enable AI mode.",
    "interrog.aiActive":     (model) => `AI mode active. Model: ${model}.`,
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
    "settings.apiKey":       "API key",
    "settings.model":        "Model",
    "btn.save":              "SAVE",
    "btn.clear":             "CLEAR",
    "settings.noKey":        "No key saved. AI mode disabled; OFFLINE mode still works.",
    "settings.keySet":       (masked, justSaved) => (justSaved ? "Saved. " : "") +
                              `Key set (${masked}). AI mode is now available in interrogation.`,
    "settings.aboutSection": "About",
    "settings.aboutDesc":    "Noir Interrogation is a one-shot detective game built primarily as a Claude Code skill at .claude/skills/noir-interrogation/. The script in that skill keeps the killer's identity hidden (committed via SHA-256), generates suspect cards, and verifies your accusation. This web port mirrors the same engine in JavaScript.",

    "lang.toggleEn":         "EN",
    "lang.toggleZh":         "中",
    "audio.mute":            "Mute sound",
    "audio.unmute":          "Unmute sound",
  },

  zh: {
    "title.confidential":  "机密",
    "title.h1":            "夜雾<br>审讯",
    "title.tagline":       "一局制侦探游戏。<br>五个嫌疑人，一个真凶。答案藏在脚本里。",
    "title.credit":        "原是 Claude Code 上的一个 skill，移植到了浏览器。",
    "title.difficulty":    "难度",
    "btn.newCase":         "新案件",
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
    "interrog.modeLabel":    "模式：",
    "interrog.aiNoKey":      "请在「设置」里填入 Claude API 密钥以启用 AI 模式。",
    "interrog.aiActive":     (model) => `AI 模式已启用。模型：${model}。`,
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
    "settings.apiKey":       "API 密钥",
    "settings.model":        "模型",
    "btn.save":              "保存",
    "btn.clear":             "清除",
    "settings.noKey":        "未保存密钥。AI 模式不可用；离线模式仍可正常游玩。",
    "settings.keySet":       (masked, justSaved) => (justSaved ? "已保存。" : "") +
                              `密钥已设置（${masked}）。审讯时即可启用 AI 模式。`,
    "settings.aboutSection": "关于",
    "settings.aboutDesc":    "「夜雾审讯」主要是 Claude Code 的一个 skill（位于 .claude/skills/noir-interrogation/）。该 skill 中的脚本掌控凶手身份（通过 SHA-256 锁定）、生成嫌疑人卡片、并校验您的指控。本网页版用 JavaScript 重现了同一引擎。",

    "lang.toggleEn":         "EN",
    "lang.toggleZh":         "中",
    "audio.mute":            "静音",
    "audio.unmute":          "开启声音",
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
  localStorage.setItem(LS.lang, lang);
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
      setMode(STATE.mode);
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
  STATE.case.suspects.forEach(suspect => {
    const questioned = (STATE.case.questionCounts[suspect.name] || 0) > 0;
    const card = el("div",
      { class: `suspect-card${questioned ? " questioned" : ""}`,
        onclick: () => onPick(suspect) },
      el("div", { class: "silhouette" }),
      el("div", { class: "name" }, suspect.name),
      el("div", { class: "occ" }, suspect.occupation),
      el("div", { class: "status" },
        questioned ? t("lineup.questioned") : t("lineup.notQuestioned")),
    );
    grid.appendChild(card);
  });
}

function renderInterrogation(suspect) {
  STATE.currentSuspect = suspect;
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
  setMode(STATE.mode);
  refreshConfrontButton();
  closeEvidencePicker();
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

  if (STATE.mode === "ai" && activeKey()) {
    callLLM(suspect, framing).then(reply => {
      thinking.remove();
      addBubble("suspect", reply, suspect.name);
      pushTurn("suspect", reply);
      addNote(suspect.name, "confront", framing, reply);
    }).catch(err => {
      thinking.remove();
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
  const offline = $("#ask-offline");
  offline.innerHTML = "";
  const menu = getQuestionMenu(STATE.case ? STATE.case.lang : STATE.lang);
  menu.forEach(q => {
    const b = el("button", { onclick: () => askOffline(q.id) }, q.label);
    offline.appendChild(b);
  });
}

function setMode(mode) {
  STATE.mode = mode;
  $$(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  $("#ask-offline").hidden = (mode !== "offline");
  $("#ask-ai").hidden       = (mode !== "ai");
  if (mode === "ai") {
    const hint = $("#ai-hint");
    const key = activeKey();
    if (!key) {
      hint.textContent = t("interrog.aiNoKey");
      hint.style.color = "var(--blood)";
      $("#ai-input").disabled = true;
    } else {
      const provLabel = PROVIDERS[STATE.provider].label;
      hint.textContent = t("interrog.aiActive", `${provLabel} · ${activeModel()}`);
      hint.style.color = "var(--paper-warm)";
      $("#ai-input").disabled = false;
    }
  }
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
  if (!STATE.notes[suspectName]) STATE.notes[suspectName] = {};
  if (!STATE.notes[suspectName][category]) STATE.notes[suspectName][category] = [];
  STATE.notes[suspectName][category].push({ q: question, a: answer });
  if (!STATE.notesActiveTab) STATE.notesActiveTab = suspectName;
  if (STATE.notesOpen) renderNotes();
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
  const tabsEl = $("#notes-tabs");
  const bodyEl = $("#notes-body");
  const names = Object.keys(STATE.notes);
  if (names.length === 0) {
    tabsEl.innerHTML = "";
    bodyEl.innerHTML = `<p class="notes-empty">${t("notes.empty")}</p>`;
    return;
  }
  if (!names.includes(STATE.notesActiveTab)) STATE.notesActiveTab = names[0];

  tabsEl.innerHTML = "";
  names.forEach(n => {
    const b = el("button", {
      class: "notes-tab" + (n === STATE.notesActiveTab ? " active" : ""),
      onclick: () => { STATE.notesActiveTab = n; renderNotes(); },
    }, n);
    tabsEl.appendChild(b);
  });

  const suspectNotes = STATE.notes[STATE.notesActiveTab] || {};
  bodyEl.innerHTML = "";
  // Display in canonical question order (then anything else)
  const canonical = ["alibi", "tod", "knew_victim", "saw_anyone",
                     "suspicious", "hiding", "weapon", "confront",
                     "free_form", "leave"];
  const orderedCats = canonical
    .filter(c => suspectNotes[c])
    .concat(Object.keys(suspectNotes).filter(c => !canonical.includes(c)));

  orderedCats.forEach(cat => {
    const sec = el("section", { class: "notes-section" });
    sec.appendChild(el("h4", {}, t("notes.cat." + cat)));
    suspectNotes[cat].forEach(({ q, a }) => {
      const entry = el("div", { class: "notes-entry" });
      entry.appendChild(el("div", { class: "notes-q" }, q));
      entry.appendChild(el("div", { class: "notes-a" }, a));
      sec.appendChild(entry);
    });
    bodyEl.appendChild(sec);
  });
}

/* ============================== offline mode ============================== */

function askOffline(questionId) {
  const suspect = STATE.currentSuspect;
  const menu = getQuestionMenu(STATE.case.lang);
  const qLabel = menu.find(q => q.id === questionId).label;

  addBubble("detective", qLabel, suspect.name);
  pushTurn("detective", qLabel);

  const response = generateOfflineResponse(STATE.case, suspect, questionId);

  const thinking = addBubble("thinking", "", suspect.name);
  setTimeout(() => {
    thinking.remove();
    addBubble("suspect", response, suspect.name);
    pushTurn("suspect", response);
    addNote(suspect.name, questionId, qLabel, response);
    maybeCollectEvidence(suspect);
  }, 450 + Math.random() * 350);

  if (questionId === "leave") {
    setTimeout(() => show("screen-lineup"), 1200);
  }
}

/* ============================== AI mode ============================== */

async function askAI() {
  const input = $("#ai-input");
  const question = input.value.trim();
  if (!question) return;
  if (!activeKey()) {
    alert(t("interrog.aiSetKeyFirst"));
    return;
  }
  input.value = "";
  input.disabled = true;

  const suspect = STATE.currentSuspect;
  addBubble("detective", question, suspect.name);
  pushTurn("detective", question);

  const thinking = addBubble("thinking", "", suspect.name);

  try {
    const reply = await callLLM(suspect, question);
    thinking.remove();
    addBubble("suspect", reply, suspect.name);
    pushTurn("suspect", reply);
    addNote(suspect.name, "free_form", question, reply);
    // Track question count for AI mode too (mirrors offline tracking)
    STATE.case.questionCounts[suspect.name] = (STATE.case.questionCounts[suspect.name] || 0) + 1;
    maybeCollectEvidence(suspect);
  } catch (err) {
    thinking.remove();
    addBubble("system",
      `${t("interrog.errorPrefix")}${err.message}${t("interrog.errorSuffix")}`,
      suspect.name);
    console.error(err);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function callLLM(suspect, userQuestion) {
  if (STATE.provider === "google") return callGemini(suspect, userQuestion);
  return callClaude(suspect, userQuestion);
}

async function callClaude(suspect, userQuestion) {
  const system = buildSystemPromptForSuspect(STATE.case, suspect);
  const history = (STATE.conversations[suspect.name] || []).filter(
    t => t.role === "detective" || t.role === "suspect"
  );
  const messages = [];
  for (const turn of history) {
    if (turn.role === "detective") messages.push({ role: "user", content: turn.content });
    else if (turn.role === "suspect") messages.push({ role: "assistant", content: turn.content });
  }

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
      max_tokens: 400,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || text;
    } catch (_) {}
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const blocks = data.content || [];
  const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
  return text.trim() || "[silence]";
}

async function callGemini(suspect, userQuestion) {
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
  const url = "https://generativelanguage.googleapis.com/v1beta/models/"
            + encodeURIComponent(model) + ":generateContent?key="
            + encodeURIComponent(STATE.apiKeys.google);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 400, temperature: 0.9 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || text;
    } catch (_) {}
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
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
  $("#verdict-accused").textContent = v.accused;
  $("#verdict-killer").textContent  = v.actualKiller;

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

function openSettings() {
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
  localStorage.setItem(LS.provider, provider);
  setProviderUI(provider);
  updateApiStatus();
  setMode(STATE.mode);  // refresh AI hint
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
  if (provider === "anthropic") {
    localStorage.setItem(LS.anthropicKey, key);
    localStorage.setItem(LS.anthropicModel, model);
  } else {
    localStorage.setItem(LS.googleKey, key);
    localStorage.setItem(LS.googleModel, model);
  }
  updateApiStatus(true);
  setMode(STATE.mode);  // refresh AI hint
}

function clearApiKey() {
  const provider = STATE.provider;
  STATE.apiKeys[provider] = null;
  if (provider === "anthropic") localStorage.removeItem(LS.anthropicKey);
  else                          localStorage.removeItem(LS.googleKey);
  const keyEl = $(`#${provider}-key`);
  if (keyEl) keyEl.value = "";
  updateApiStatus();
  setMode(STATE.mode);
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

async function newCase(seed = null) {
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
  STATE.provider = localStorage.getItem(LS.provider) || "anthropic";
  if (!PROVIDERS[STATE.provider]) STATE.provider = "anthropic";

  STATE.apiKeys.anthropic = localStorage.getItem(LS.anthropicKey);
  STATE.apiKeys.google    = localStorage.getItem(LS.googleKey);
  STATE.apiModels.anthropic = localStorage.getItem(LS.anthropicModel) || "claude-haiku-4-5-20251001";
  STATE.apiModels.google    = localStorage.getItem(LS.googleModel)    || "gemini-2.5-flash";

  // One-time migration: legacy single-key noir.apiKey was Anthropic.
  const legacyKey = localStorage.getItem(LS.legacyApiKey);
  const legacyModel = localStorage.getItem(LS.legacyApiModel);
  if (legacyKey && !STATE.apiKeys.anthropic) {
    STATE.apiKeys.anthropic = legacyKey;
    localStorage.setItem(LS.anthropicKey, legacyKey);
  }
  if (legacyModel && !localStorage.getItem(LS.anthropicModel)) {
    STATE.apiModels.anthropic = legacyModel;
    localStorage.setItem(LS.anthropicModel, legacyModel);
  }
  if (legacyKey || legacyModel) {
    localStorage.removeItem(LS.legacyApiKey);
    localStorage.removeItem(LS.legacyApiModel);
  }

  AUDIO.muted    = localStorage.getItem(LS.muted) === "1";

  // URL params take precedence on first load (so shared links work).
  const params = new URLSearchParams(window.location.search);
  const langFromUrl = params.get("lang");
  STATE.lang = (langFromUrl === "en" || langFromUrl === "zh")
    ? langFromUrl
    : (localStorage.getItem(LS.lang) || detectLang());

  const diffFromUrl = params.get("difficulty");
  const validDiffs = ["easy", "normal", "hard"];
  STATE.difficulty = validDiffs.includes(diffFromUrl)
    ? diffFromUrl
    : (validDiffs.includes(localStorage.getItem(LS.difficulty))
        ? localStorage.getItem(LS.difficulty)
        : "normal");
}

function setDifficulty(d) {
  if (!["easy", "normal", "hard"].includes(d)) return;
  STATE.difficulty = d;
  localStorage.setItem(LS.difficulty, d);
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
      }
      return;
    }
    const langBtn = e.target.closest(".lang-toggle button");
    if (langBtn) { setLang(langBtn.dataset.lang); return; }

    const diffBtn = e.target.closest(".difficulty-toggle button");
    if (diffBtn) { setDifficulty(diffBtn.dataset.difficulty); return; }

    const modeBtn = e.target.closest(".mode-btn");
    if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
  });

  $("#settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });

  $("#ai-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askAI();
    }
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  loadSettings();
  bind();
  applyI18n();
  refreshAudioToggle();
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
  // If the URL has ?seed=, auto-load that case and skip the title screen.
  await maybeAutoStartFromUrl();
});
