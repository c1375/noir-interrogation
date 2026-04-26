/* ====================================================================
   NOIR INTERROGATION — app.js
   UI state machine, screen wiring, AI mode (BYOK Claude API), i18n.
   ==================================================================== */

const STATE = {
  case: null,                 // current case object
  currentSuspect: null,       // suspect being interrogated
  conversations: {},          // suspect.name -> [{role, content}]
  apiKey: null,
  apiModel: "claude-haiku-4-5-20251001",
  mode: "offline",            // "offline" | "ai"
  lang: "en",                 // "en" | "zh"
};

const LS = {
  apiKey:   "noir.apiKey",
  apiModel: "noir.apiModel",
  lang:     "noir.lang",
};

/* ============================== i18n strings ============================== */

const STRINGS = {
  en: {
    "title.confidential":  "CONFIDENTIAL",
    "title.h1":            "Noir<br>Interrogation",
    "title.tagline":       "A one-shot detective game.<br>Five suspects. One killer. The script holds the answer.",
    "title.credit":        "Built as a Claude Code skill, ported to the browser.",
    "btn.newCase":         "NEW CASE",
    "btn.settings":        "SETTINGS",

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
    "settings.aiSection":    "AI Mode (Claude API)",
    "settings.aiDesc":       "Bring your own Anthropic API key. The key is stored only in this browser's localStorage and is sent directly to the Anthropic API — never to any other server. AI mode lets you free-text any question to a suspect; the model receives only that suspect's card and stays in character.",
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
  },

  zh: {
    "title.confidential":  "机密",
    "title.h1":            "夜雾<br>审讯",
    "title.tagline":       "一局制侦探游戏。<br>五个嫌疑人，一个真凶。答案藏在脚本里。",
    "title.credit":        "原是 Claude Code 上的一个 skill，移植到了浏览器。",
    "btn.newCase":         "新案件",
    "btn.settings":        "设置",

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
    "settings.aiSection":    "AI 模式（Claude API）",
    "settings.aiDesc":       "自带您的 Anthropic API 密钥。密钥只保存在本浏览器的 localStorage 中，且仅会直接发送至 Anthropic API，不经任何其他服务器。开启 AI 模式后您可对嫌疑人自由提问；模型只看到该嫌疑人的卡片，并坚持角色不出戏。",
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
    if (!STATE.apiKey) {
      hint.textContent = t("interrog.aiNoKey");
      hint.style.color = "var(--blood)";
      $("#ai-input").disabled = true;
    } else {
      hint.textContent = t("interrog.aiActive", STATE.apiModel);
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
  } else if (role === "suspect") {
    bubble = el("div",
      { class: "bubble suspect", "data-name": suspectName },
      content);
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
  if (!STATE.apiKey) {
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
    const reply = await callClaude(suspect, question);
    thinking.remove();
    addBubble("suspect", reply, suspect.name);
    pushTurn("suspect", reply);
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
      "x-api-key": STATE.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: STATE.apiModel,
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
    throw new Error(`API ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const blocks = data.content || [];
  const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
  return text.trim() || "[silence]";
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

function openSettings() {
  $("#api-key").value = STATE.apiKey || "";
  $("#api-model").value = STATE.apiModel;
  updateApiStatus();
  $("#settings-modal").classList.add("active");
}

function closeSettings() {
  $("#settings-modal").classList.remove("active");
}

function saveApiKey() {
  const key = $("#api-key").value.trim();
  const model = $("#api-model").value;
  if (!key) {
    alert(t("interrog.aiSetKeyFirst"));
    return;
  }
  STATE.apiKey = key;
  STATE.apiModel = model;
  localStorage.setItem(LS.apiKey, key);
  localStorage.setItem(LS.apiModel, model);
  updateApiStatus(true);
}

function clearApiKey() {
  STATE.apiKey = null;
  localStorage.removeItem(LS.apiKey);
  $("#api-key").value = "";
  updateApiStatus();
}

function updateApiStatus(justSaved = false) {
  const s = $("#api-status");
  if (!s) return;
  if (STATE.apiKey) {
    const masked = STATE.apiKey.slice(0, 10) + "..." + STATE.apiKey.slice(-4);
    s.textContent = t("settings.keySet", masked, justSaved);
    s.className = "setting-status ok";
  } else {
    s.textContent = t("settings.noKey");
    s.className = "setting-status";
  }
}

/* ============================== bootstrap ============================== */

async function newCase() {
  STATE.case = await generateCase(STATE.lang);
  STATE.conversations = {};
  STATE.currentSuspect = null;
  renderBriefing();
  show("screen-briefing");
}

function gotoLineup() {
  if (!STATE.case) return;
  renderLineupGrid("lineup-grid", suspect => {
    renderInterrogation(suspect);
    show("screen-interrogation");
  });
  show("screen-lineup");
}

function gotoBriefing()    { show("screen-briefing"); }
function gotoTitle()       { show("screen-title"); }
function gotoAccusation()  { renderAccusationGrid(); show("screen-accusation"); }

function loadSettings() {
  STATE.apiKey   = localStorage.getItem(LS.apiKey);
  STATE.apiModel = localStorage.getItem(LS.apiModel) || "claude-haiku-4-5-20251001";
  STATE.lang     = localStorage.getItem(LS.lang) || detectLang();
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
      }
      return;
    }
    const langBtn = e.target.closest(".lang-toggle button");
    if (langBtn) { setLang(langBtn.dataset.lang); return; }

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

window.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  bind();
  applyI18n();
  show("screen-title");
});
