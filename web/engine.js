/* ====================================================================
   NOIR INTERROGATION — engine.js
   Bilingual port of .claude/skills/noir-interrogation/scripts/noir.py
   - EN: 1940s American noir
   - ZH: 1930s 民国上海 noir
   Same mechanics in both: random killer, witness clue, SHA-256
   commitment, per-suspect cards.
   ==================================================================== */

/* ============== EN content ============== */

const POOLS_EN = {
  victims: [
    { name: "Mr. Harlan Voss",       title: "shipping magnate" },
    { name: "Mrs. Clarissa Belmont", title: "society heiress" },
    { name: "Senator Drexel Cone",   title: "city senator" },
    { name: "Mr. Lionel Crane",      title: "newspaper editor" },
    { name: "Dr. Wendell Hale",      title: "society physician" },
    { name: "Mr. August Pell",       title: "racetrack tycoon" },
  ],
  names: [
    "Vivian Cross", "Jack 'Knuckles' Malone", "Dr. Eliza Vance",
    "Tony 'the Pen' Russo", "Margot Sinclair", "Felix Crane",
    "Sister Agnes Holloway", "Reggie 'Lucky' Park", "Delia Whitlock",
    "Captain Nico Bellamy", "Honoria Quinn", "Solomon Drake",
  ],
  occupations: [
    "nightclub singer", "pawn shop owner", "society doctor",
    "accountant for the mob", "investigative journalist", "lawyer",
    "professional gambler", "society heiress", "war veteran turned PI",
    "fortune teller", "longshoreman", "former silent film actress",
  ],
  weapons: [
    "snub-nosed revolver", "ice pick", "lead-tipped blackjack",
    "poisoned martini", "brass candlestick", "silk garrote",
    "letter opener", "antique derringer",
  ],
  locations: [
    "the smoke-filled study", "the rainy back alley",
    "the hotel suite on the 14th floor", "the mansion library",
    "the riverside warehouse", "the rooftop garden",
    "the basement speakeasy",
  ],
  redHerringSecrets: [
    "I've been embezzling money from the victim's accounts",
    "I was having an affair with the victim's spouse",
    "I owe a dangerous loan shark twenty grand",
    "I was blackmailing a city official with photographs",
    "I have a child the victim threatened to expose",
    "I fled a manslaughter charge in another city under a different name",
    "I was planning to skip town on the midnight train",
    "I'm not who I claim to be -- this name isn't mine",
  ],
  falseAlibis: [
    "I was at home alone all night, reading.",
    "I was at the cinema watching the late picture -- bought a ticket and everything.",
    "I was at the diner across town, the one open all hours.",
    "I was driving along the coast road, just clearing my head.",
    "I was asleep in my apartment by ten -- slept like the dead.",
  ],
  trueAlibis: [
    "I was playing cards at the Blue Iris -- three witnesses, ask any of them.",
    "I was arguing with my spouse so loud the whole building heard. Check with the super.",
    "I was at the hospital, getting my wrist set. There's a chart with my name on it.",
    "I was on stage at the Magnolia Room, in front of fifty paying customers.",
    "I got picked up by the cops for public drunkenness around then. The Twelfth Precinct logged me in.",
    "I was at the cathedral for the late vigil. Father Donovan can confirm it.",
  ],
  personalities: {
    "nightclub singer":         "smoky voice, world-weary, every line could be a song lyric",
    "pawn shop owner":          "gravel voice, transactional -- every answer feels like a haggle",
    "society doctor":           "clipped and professional, hides everything behind clinical detachment",
    "accountant for the mob":   "tight, careful -- weighs every word like it could be evidence",
    "investigative journalist": "asks questions back, takes notes mid-conversation",
    "lawyer":                   "annoyingly precise, objects to phrasing, demands clarification",
    "professional gambler":     "easy charm, reads you like a hand of cards, never tells",
    "society heiress":          "bored, drawling -- finds the whole affair impossibly tedious",
    "war veteran turned PI":    "laconic, unimpressed, doesn't trust cops",
    "fortune teller":           "cryptic -- talks in omens, deflects with portents",
    "longshoreman":             "hostile, suspicious of authority, swears casually",
    "former silent film actress": "theatrical, melodramatic, treats every question as a scene",
  },
};

/* ============== ZH content (1930s 民国上海) ============== */

const POOLS_ZH = {
  victims: [
    { name: "沈鹤鸣",     title: "航运大亨" },
    { name: "白雪卿夫人", title: "名媛" },
    { name: "周沧海",     title: "参议员" },
    { name: "陆云飞",     title: "《申报》主笔" },
    { name: "石伯安",     title: "济世医院院长" },
    { name: "苏永盛",     title: "跑马场老板" },
  ],
  names: [
    "红玫", "韩三爷", "李白驹医生", "钱师爷", "唐慧君", "阿九",
    "静安姑姑", "杜小六", "陶宜君", "关云鹤", "姚月笙", "严雪松",
  ],
  occupations: [
    "百乐门舞女", "当铺老板", "济世名医", "帮派账房", "申报记者",
    "法租界律师", "跑马场赌客", "上海名媛", "退伍宪兵转私家侦探",
    "茶楼算命先生", "码头脚行", "默片影后",
  ],
  weapons: [
    "短管左轮", "冰锥", "包铅警棍", "下了药的鸡尾酒",
    "黄铜烛台", "丝绳", "拆信刀", "古董袖珍枪",
  ],
  locations: [
    "烟雾弥漫的法租界书房", "雨夜的十里洋场后弄堂",
    "国际饭店十四楼客房", "公馆藏书阁",
    "黄浦江边仓库", "屋顶花园", "地下舞厅",
  ],
  redHerringSecrets: [
    "我从死者账上挪过钱",
    "我和死者的太太有私情",
    "我欠了大流氓两万银元",
    "我捏着市府某老爷的把柄在敲他",
    "我有个私生子，死者扬言要曝光",
    "我在外埠犯过过失杀人，改名跑到上海的",
    "我准备搭今晚的夜班船潜逃出海",
    "我用的是假名，根本不是这身份",
  ],
  falseAlibis: [
    "我那晚一个人在家看书。",
    "我在大光明戏院看夜场，戏票还在。",
    "我去了法租界那家通宵小馆子。",
    "我开车沿外滩兜风散心。",
    "我十点多就睡了，跟死了一样。",
  ],
  trueAlibis: [
    "我在百乐门打牌，三个证人，您随便问。",
    "我和我家那位大吵大闹整层楼都听见了，您问门房。",
    "我在公济医院打石膏，挂号单上有名字。",
    "我在百乐门舞台上唱戏，五十个买票的看着。",
    "那时候我被巡捕房拘了一晚上，记录在案。",
    "我在静安寺参加晚课，住持师傅可以作证。",
  ],
  personalities: {
    "百乐门舞女":         "嗓音慵懒沙哑，每句话像唱戏，对生死不当回事",
    "当铺老板":           "嗓音粗哑，做生意的口气，每句话像在讨价还价",
    "济世名医":           "用词谨慎，万事归于诊断，把情绪藏在术语后面",
    "帮派账房":           "话很少，掂量每个字，仿佛能当证据",
    "申报记者":           "反客为主，谈话间随手记笔记",
    "法租界律师":         "字斟句酌，挑你的措辞，要求重新提问",
    "跑马场赌客":         "嬉皮笑脸，看你像看一手牌，从不漏底",
    "上海名媛":           "懒洋洋拖着腔，觉得整件事粗鲁不堪",
    "退伍宪兵转私家侦探": "话不多，看不上巡捕房，一副见过大世面的样子",
    "茶楼算命先生":       "话头晦涩，开口就是天命星象，不正面回答",
    "码头脚行":           "凶巴巴，对当官的没好脸色，开口带粗话",
    "默片影后":           "戏剧化，一副在拍戏的样子，每句话都像台词",
  },
};

const POOLS_BY_LANG = { en: POOLS_EN, zh: POOLS_ZH };

/* ============== EN voice templates ============== */

const VOICE_EN = {
  "nightclub singer": {
    open:  ["Honey, ", "Sugar, ", "Look, gumshoe, ", ""],
    close: ["", " That's all you're getting, doll.", " Now buy a girl a drink, would you?"],
    deflect: [
      "[lights a cigarette, takes a long drag]  ... Why are you asking me that?",
      "Honey, what kind of question is that?",
      "I sing songs for a living, detective. I don't keep diaries.",
    ],
    leave: "Show's over, shamus. Door's that way.",
  },
  "pawn shop owner": {
    open:  ["Look, mister, ", "I'll tell you what -- ", "Mister, "],
    close: ["", " That's my answer.", " Take it or don't."],
    deflect: [
      "What's it to you?",
      "I see a lot of faces, mister. You want me to remember every one?",
      "I don't talk about my customers. Bad for business.",
    ],
    leave: "We done? I got merchandise to inventory.",
  },
  "society doctor": {
    open:  ["I shall be precise: ", "To be clinical about it -- ", ""],
    close: ["", " That is the extent of my involvement.", " I trust that satisfies your inquiry."],
    deflect: [
      "I am bound by professional discretion, detective.",
      "I fail to see the medical relevance of that question.",
      "[adjusts glasses]  I would prefer not to speculate.",
    ],
    leave: "If you have nothing further, I have patients waiting.",
  },
  "accountant for the mob": {
    open:  ["", "Listen. ", ""],
    close: ["", "", " That's it."],
    deflect: [
      "I don't talk about clients.",
      "Ask my lawyer.",
      "[long silence]  Next question.",
    ],
    leave: "Are we done here, detective?",
  },
  "investigative journalist": {
    open:  ["Interesting question, detective -- ", "Now why would you ask me that? ", ""],
    close: ["", " You'd know if you read the morning edition.", " Mind if I quote you on that?"],
    deflect: [
      "Now why does the precinct care about that, exactly?",
      "[scribbles in notebook]  Off the record? Or on?",
      "I'm a reporter, detective. I ask the questions.",
    ],
    leave: "I've got a deadline. We'll continue this another time.",
  },
  "lawyer": {
    open:  ["Define your terms, detective. ", "Speaking strictly hypothetically -- ", "For the record, "],
    close: ["", " I'd like that noted.", " Without admitting any wrongdoing."],
    deflect: [
      "I object to the phrasing of that question.",
      "I'd prefer to consult with counsel before answering.",
      "Let me clarify: I am declining to answer at this time.",
    ],
    leave: "I'll need the rest of these questions in writing, please.",
  },
  "professional gambler": {
    open:  ["Detective, ", "[easy smile]  ", ""],
    close: ["", " That's the truth, friend.", " You can take that to the bank."],
    deflect: [
      "[easy smile]  You're bluffing, detective. I've seen better tells in Sunday school.",
      "Hand me a deck and I'll show you cards. Otherwise, no comment.",
      "A gambler doesn't show his hand. Even to the law.",
    ],
    leave: "Lady Luck's calling. Catch you next time.",
  },
  "society heiress": {
    open:  ["[drawling]  ", "Oh, must we? ", ""],
    close: ["", " Now, may I go?", " It's all so dreadfully tedious."],
    deflect: [
      "[examining her nails]  How frightfully gauche of you to ask.",
      "My driver is waiting. Could we wrap this up?",
      "I really couldn't say. I make a point of not noticing.",
    ],
    leave: "I'm late for cocktails. Charmed, detective.",
  },
  "war veteran turned PI": {
    open:  ["", "[unimpressed]  ", "Look, "],
    close: ["", " That's the story.", " Take it or leave it."],
    deflect: [
      "Saw worse in Belleau Wood. Ask the next question.",
      "I don't like cops poking around. Get to the point.",
      "[unimpressed]  Pass.",
    ],
    leave: "We done, detective? I've got real work.",
  },
  "fortune teller": {
    open:  ["The cards say -- ", "[gazes into the middle distance]  ", ""],
    close: ["", " The veil is thin tonight.", " Such is fate's design."],
    deflect: [
      "The cards warned of this question. They suggest silence.",
      "Some truths are not for waking hours, detective.",
      "[shuffles tarot]  The Tower. That should answer you well enough.",
    ],
    leave: "The hour grows late. The spirits will not speak more tonight.",
  },
  "longshoreman": {
    open:  ["Listen, copper, ", "What's it to you? ", ""],
    close: ["", " Now beat it.", " That's the truth, swear on my mother."],
    deflect: [
      "What's it to you, copper?",
      "I don't talk to cops about my business.",
      "[spits]  Pass.",
    ],
    leave: "Look, copper, I got a shift. We done or not?",
  },
  "former silent film actress": {
    open:  ["[clutching pearls]  ", "Oh, detective! ", "[theatrically]  "],
    close: ["", " ... I cannot bear to think of it.", " It is too much. Too much!"],
    deflect: [
      "[hand to forehead]  I cannot speak of such things, detective!",
      "Please -- a lady has her secrets. You wouldn't deny me that?",
      "[swooning slightly]  I'd rather not relive that moment.",
    ],
    leave: "[rising dramatically]  Curtain. Goodnight, detective.",
  },
};

/* ============== ZH voice templates ============== */

const VOICE_ZH = {
  "百乐门舞女": {
    open:  ["亲爱的警官，", "唉哟，先生，", "嗨呀，", ""],
    close: ["", " 就这些，问完了买杯酒给人家喝呀。", " 您要听的就这么多。"],
    deflect: [
      "[点上一支烟，慢慢吸了一口]  ……您问这个做什么？",
      "嗨呀先生，这种问题怎么好意思问。",
      "我唱戏的，又不是写日记的。",
    ],
    leave: "戏演完了，警官。门在那儿。",
  },
  "当铺老板": {
    open:  ["先生，听我说，", "我这样跟您讲——", "先生，"],
    close: ["", " 这就是我的回话。", " 您听不听由您。"],
    deflect: [
      "您管我这事做什么？",
      "我这柜上多少张脸来来去去，您让我一个个记？",
      "我的客人我不议论，伤生意。",
    ],
    leave: "完了吧？我柜上还要盘货。",
  },
  "济世名医": {
    open:  ["容我说得清楚些——", "从医学角度看，", ""],
    close: ["", " 我所知者尽于此。", " 这总能让您满意了吧。"],
    deflect: [
      "医者职业操守，恕难奉告。",
      "我看不出此问与医学有何相关。",
      "[扶了扶眼镜]  我不愿妄加揣测。",
    ],
    leave: "如无他事，敝院尚有病人候诊。",
  },
  "帮派账房": {
    open:  ["", "听好了。", ""],
    close: ["", "", " 完。"],
    deflect: [
      "我不议客人的事。",
      "去问我律师。",
      "[沉默良久]  下一句。",
    ],
    leave: "您还问吗，警官？",
  },
  "申报记者": {
    open:  ["问得好啊，警官——", "哎，您怎么会问起这个？", ""],
    close: ["", " 早报上登过的，您没看？", " 这话能不能见报？"],
    deflect: [
      "巡捕房这是什么时候关心起这个了？",
      "[在本子上记几笔]  您讲，是台前还是台底？",
      "我是记者，警官。问题该我来问。",
    ],
    leave: "我快截稿了，回头再说。",
  },
  "法租界律师": {
    open:  ["请先界定您的用词，警官。", "纯粹假设来讲——", "为审讯记录之用，"],
    close: ["", " 此点请记入笔录。", " 不构成任何承认。"],
    deflect: [
      "我对此问的措辞提出异议。",
      "我希望先与同业商议再作回答。",
      "我说清楚——我此时拒绝回答。",
    ],
    leave: "余下的问题烦请书面送来。",
  },
  "跑马场赌客": {
    open:  ["警官，", "[淡淡一笑]  ", ""],
    close: ["", " 真的，我朋友。", " 您可以拿这话押注。"],
    deflect: [
      "[淡淡一笑]  您这是诈我，警官，私塾里的小孩都瞒不过我。",
      "给我一副牌，我让您看本事。其他没什么好说的。",
      "做赌的不亮底牌，对警官也一样。",
    ],
    leave: "财神爷叫我了，回头见，警官。",
  },
  "上海名媛": {
    open:  ["[拖长腔]  ", "唉哟，非要这样吗？", ""],
    close: ["", " 这下我能走了吧？", " 实在乏味得紧。"],
    deflect: [
      "[端详着指甲]  您这话问得真粗鲁。",
      "司机还在外头等我，咱们快点结束行不行？",
      "我真说不上来。我向来不留心这些。",
    ],
    leave: "鸡尾酒会要迟到了，告辞，警官。",
  },
  "退伍宪兵转私家侦探": {
    open:  ["", "[一脸不耐烦]  ", "听着，"],
    close: ["", " 故事就这样。", " 您信不信都行。"],
    deflect: [
      "前线的事比这血腥多了。下一句。",
      "我不喜欢巡捕到处嗅。直说。",
      "[不屑]  跳过。",
    ],
    leave: "完了没，警官？我还有正经活要做。",
  },
  "茶楼算命先生": {
    open:  ["卦象云——", "[凝视虚空]  ", ""],
    close: ["", " 今夜阴阳薄。", " 命数所定。"],
    deflect: [
      "卦象不示，沉默为吉。",
      "有些话非醒时可言，警官。",
      "[洗牌]  抽到塔牌，您自己悟吧。",
    ],
    leave: "夜深矣，神明今晚不再开口。",
  },
  "码头脚行": {
    open:  ["警察，听好了，", "您管我这事？", ""],
    close: ["", " 走开吧。", " 这是真话，给我妈起誓。"],
    deflect: [
      "您管我做什么，警察？",
      "我跟巡捕房不议自家事。",
      "[啐了一口]  跳过。",
    ],
    leave: "警察，我下了班，到底完没完？",
  },
  "默片影后": {
    open:  ["[紧攥着珍珠项链]  ", "啊，警官！", "[戏剧地]  "],
    close: ["", " ……我实在不忍回想。", " 太过了，太过了！"],
    deflect: [
      "[手抚额头]  我说不出口，警官！",
      "请——女人有女人的秘密，您不会拆穿的吧？",
      "[微微晕厥]  那一刻，我不愿重温。",
    ],
    leave: "[戏剧化起身]  落幕。晚安，警官。",
  },
};

const VOICE_BY_LANG = { en: VOICE_EN, zh: VOICE_ZH };

const DEFAULT_VOICE_EN = {
  open: [""], close: [""],
  deflect: ["I'd rather not get into that.", "That's not your concern, detective."],
  leave: "We done here, detective?",
};
const DEFAULT_VOICE_ZH = {
  open: [""], close: [""],
  deflect: ["这事我不便讲。", "这与您无关，警官。"],
  leave: "完事了吗，警官？",
};
const DEFAULT_VOICE_BY_LANG = { en: DEFAULT_VOICE_EN, zh: DEFAULT_VOICE_ZH };

/* ============== Knew-victim lines (per occupation, per lang) ============== */

const KNEW_VICTIM_EN = {
  "nightclub singer":          (v) => `${v.name}? Sure. He came around the joint sometimes. Tipped well, talked too much.`,
  "pawn shop owner":           (v) => `${v.name}? Through the shop, once or twice. Strictly business.`,
  "society doctor":            (v) => `${v.name} was an occasional patient. Nothing of note in the chart.`,
  "accountant for the mob":    (v) => `I knew of him. Never worked his books, if that's what you're asking.`,
  "investigative journalist":  (v) => `Of course I knew ${v.name}. Half this town did. He made the news regularly.`,
  "lawyer":                    (v) => `${v.name} was an associate, in the loosest sense. Not a client.`,
  "professional gambler":      (v) => `Played a few hands with him. Lousy poker player, decent loser.`,
  "society heiress":           (v) => `${v.name}? At parties. Same circles. Hardly knew him.`,
  "war veteran turned PI":     (v) => `Did some work for him once. Paid on time. That's all.`,
  "fortune teller":            (v) => `${v.name} consulted the cards twice. Both times, the same warning.`,
  "longshoreman":              (v) => `Knew the name. Worked a job at his docks once. Tight-fisted bastard.`,
  "former silent film actress":(v) => `We were once... acquainted. In the days when names like ours meant something.`,
};

const KNEW_VICTIM_ZH = {
  "百乐门舞女":         (v) => `${v.name}? 嗯，常来这边的。出手大方，话也多。`,
  "当铺老板":           (v) => `${v.name}? 在我柜上见过一两回，纯生意来往。`,
  "济世名医":           (v) => `${v.name} 是我偶尔的病号，病历上没什么特别。`,
  "帮派账房":           (v) => `听过这名字。没碰过他的账，您放心。`,
  "申报记者":           (v) => `${v.name}? 半个上海都认得他，报上常上头条。`,
  "法租界律师":         (v) => `${v.name} 谈不上当事人，是业务上的"熟人"罢了。`,
  "跑马场赌客":         (v) => `牌桌上见过几手。麻将打得稀松，输得倒挺爽快。`,
  "上海名媛":           (v) => `${v.name}? 应酬场上见过。一个圈子的人，不算熟。`,
  "退伍宪兵转私家侦探": (v) => `替他做过一桩案子，按时给钱，仅此而已。`,
  "茶楼算命先生":       (v) => `${v.name} 来摸过两次卦，每次卦象都一样的凶。`,
  "码头脚行":           (v) => `听过名字。在他码头上扛过包，抠门得很。`,
  "默片影后":           (v) => `我们……曾有过那么一段。在咱们的名字还值钱的年月里。`,
};

const KNEW_VICTIM_BY_LANG = { en: KNEW_VICTIM_EN, zh: KNEW_VICTIM_ZH };

/* ============== Generic responses (per language) ============== */

const GENERIC = {
  en: {
    suspicious: [
      "Plenty of folks didn't like him, detective. Pick a name out of a hat.",
      "Half the city had reason. The other half just hadn't met him yet.",
      "If I had a name to give, I'd give it. I don't.",
      "That's your job, isn't it? I just answer the questions.",
    ],
    weapon: (w) => [
      `A ${w}? Plenty of those in this town. I wouldn't know whose.`,
      `Never seen it before. Or maybe I have. They all blur together.`,
      `[shrugs]  Not mine, detective. That's all I know.`,
      `I couldn't pick one out of a lineup, honestly.`,
    ],
    todTellsKiller: (alibi) => [
      `[longer pause than necessary]  I told you. ${alibi}`,
      `Around then? I... yes. Like I said -- ${alibi}`,
      `Why do you keep coming back to that hour? I've answered already.`,
      `${alibi}  And I don't appreciate the implication.`,
    ],
    todTellsNonKiller: (alibi) => [`Like I said -- ${alibi}`],
    sawAnyoneHedge: ["Hm. Maybe. I'd have to think about it. The night's a blur, you know."],
    sawAnyoneIntros: [
      "Look, I shouldn't be telling you this, but -- ",
      "Off the record? Fine. ",
      "[lowering voice]  ",
      "All right, all right. ",
    ],
    sawAnyoneNothing: ["Nobody I noticed. It was a quiet night where I was."],
    sceneOpener: (s) => `${s.name} sits across from you, lighting a cigarette. The room is too warm.`,
    fallback: "I don't follow, detective. Ask me something else.",
    witnessFact: (killer, location, tod) =>
      `I saw ${killer} near ${location} around ${tod}, ` +
      `and they looked rattled -- face white, hands shaking. I didn't say anything at the time.`,
    killerHide: (tod) =>
      `my actual whereabouts between ${tod} and roughly thirty minutes after`,
  },
  zh: {
    suspicious: [
      "这城里看他不顺眼的太多了，警官，您随便挑一个。",
      "半个上海都有理由动他，另一半不过还没轮到。",
      "要是知道名字，我早说了。我不知道。",
      "那是您的活儿，不是？我只回答问题。",
    ],
    weapon: (w) => [
      `${w}? 这种东西满上海都是，谁说得清是谁的。`,
      `没见过。也许见过吧，都模糊了。`,
      `[耸肩]  不是我的，警官，我就知道这一句。`,
      `指头点不出来，说真的。`,
    ],
    todTellsKiller: (alibi) => [
      `[停顿过久]  我说过了。${alibi}`,
      `那个时候？我……是的。我说过了——${alibi}`,
      `您怎么老围着这个钟点转？我答过了。`,
      `${alibi} 您这意思我不大喜欢。`,
    ],
    todTellsNonKiller: (alibi) => [`我说过了——${alibi}`],
    sawAnyoneHedge: ["嗯……或许吧。让我想想，那一晚记忆有点乱。"],
    sawAnyoneIntros: [
      "听着，我本不该说的，可是——",
      "私下讲？好吧。",
      "[压低声音]  ",
      "罢了，罢了。",
    ],
    sawAnyoneNothing: ["没什么人，那一晚我那边挺安静的。"],
    sceneOpener: (s) => `${s.name} 坐在您对面，点上一支烟。房间里热得发闷。`,
    fallback: "我没听明白，警官。您换个问法？",
    witnessFact: (killer, location, tod) =>
      `我看见 ${killer} 在 ${tod} 前后，在 ${location} 附近，脸都白了，手也抖。当时我没敢出声。`,
    killerHide: (tod) =>
      `案发时间 ${tod} 到大约半小时之后，我到底在哪里`,
  },
};

/* ============== Question menu ============== */

const QUESTION_MENU_EN = [
  { id: "alibi",        label: "Where were you the night of the murder?" },
  { id: "tod",          label: "What were you doing around the time of death?" },
  { id: "knew_victim",  label: "Did you know the victim well?" },
  { id: "saw_anyone",   label: "Did you see anyone else around there?" },
  { id: "suspicious",   label: "Anyone you'd suspect?" },
  { id: "hiding",       label: "Are you hiding something from me?" },
  { id: "weapon",       label: "Recognize the weapon?" },
  { id: "leave",        label: "(end this scene)" },
];

const QUESTION_MENU_ZH = [
  { id: "alibi",        label: "案发那晚你在哪儿？" },
  { id: "tod",          label: "案发那个时辰你在做什么？" },
  { id: "knew_victim",  label: "你跟死者熟吗？" },
  { id: "saw_anyone",   label: "那附近你还看见什么人？" },
  { id: "suspicious",   label: "你怀疑谁？" },
  { id: "hiding",       label: "你有事瞒着我？" },
  { id: "weapon",       label: "认得这件凶器吗？" },
  { id: "leave",        label: "（结束这场审讯）" },
];

const QUESTION_MENU_BY_LANG = { en: QUESTION_MENU_EN, zh: QUESTION_MENU_ZH };

function getQuestionMenu(lang) {
  return QUESTION_MENU_BY_LANG[lang] || QUESTION_MENU_EN;
}

/* ============== Helpers ============== */

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function sample(arr, n) {
  const copy = arr.slice();
  const out = [];
  while (n-- > 0 && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function randomHex(len) {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

async function sha256Hex(s) {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashAnswer(killerName, salt) {
  return sha256Hex(`${killerName}|${salt}`);
}

/* ============== Case generation ============== */

async function generateCase(lang = "en") {
  const POOLS = POOLS_BY_LANG[lang] || POOLS_EN;
  const G = GENERIC[lang] || GENERIC.en;

  const caseId = randomHex(8);
  const salt = randomHex(32);

  const victim = pick(POOLS.victims);
  const weapon = pick(POOLS.weapons);
  const location = pick(POOLS.locations);
  const hour = 20 + Math.floor(Math.random() * 4);
  const minute = pick([0, 15, 30, 45]);
  const timeOfDeath = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const suspectNames = sample(POOLS.names, 5);
  const occupations  = sample(POOLS.occupations, 5);
  const secretsPool  = sample(POOLS.redHerringSecrets, 5);
  const trueAlibis   = sample(POOLS.trueAlibis, 4);
  const falseAlibi   = pick(POOLS.falseAlibis);

  const killerIdx = Math.floor(Math.random() * 5);
  const witnessPool = [0, 1, 2, 3, 4].filter(i => i !== killerIdx);
  const witnessIdx = pick(witnessPool);

  const killerName = suspectNames[killerIdx];
  const witnessObservation = G.witnessFact(killerName, location, timeOfDeath);

  const suspects = [];
  let nonkillerIdx = 0;
  for (let i = 0; i < 5; i++) {
    const isKiller = i === killerIdx;
    let claimedAlibi, thingsToHide;
    if (isKiller) {
      claimedAlibi = falseAlibi;
      thingsToHide = [G.killerHide(timeOfDeath)];
    } else {
      claimedAlibi = trueAlibis[nonkillerIdx++];
      thingsToHide = [secretsPool[i]];
    }
    const knowsFacts = (i === witnessIdx) ? [witnessObservation] : [];
    suspects.push({
      name: suspectNames[i],
      occupation: occupations[i],
      claimedAlibi,
      thingsToHide,
      knowsFacts,
      personalityHint: POOLS.personalities[occupations[i]] ||
        (lang === "zh" ? "民国上海腔，话说一半留一半" : "noir voice, plays it close to the chest"),
      _isKiller: isKiller,
    });
  }

  const answerHash = await hashAnswer(killerName, salt);

  return {
    caseId,
    lang,
    createdAt: new Date().toISOString(),
    answerHash,
    _salt: salt,
    _killer: killerName,
    timeOfDeath,
    victim,
    scene: location,
    weaponAtScene: weapon,
    suspects,
    status: "open",
    questionCounts: {},
  };
}

async function verifyAccusation(caseObj, accusedName) {
  const expected = await hashAnswer(caseObj._killer, caseObj._salt);
  return {
    accused: accusedName,
    actualKiller: caseObj._killer,
    correct: accusedName === caseObj._killer,
    committedHash: caseObj.answerHash,
    computedHash: expected,
    hashOk: expected === caseObj.answerHash,
  };
}

/* ============== Templated responses ============== */

function voiceFor(lang, occupation) {
  return (VOICE_BY_LANG[lang] || VOICE_EN)[occupation] ||
         (DEFAULT_VOICE_BY_LANG[lang] || DEFAULT_VOICE_EN);
}

function flavor(lang, suspect, body) {
  const v = voiceFor(lang, suspect.occupation);
  return pick(v.open) + body + pick(v.close);
}

function knewVictimResponse(lang, suspect, victim) {
  const fn = (KNEW_VICTIM_BY_LANG[lang] || KNEW_VICTIM_EN)[suspect.occupation];
  const fallback = lang === "zh"
    ? `认识 ${victim.name}。算不上熟。`
    : `I knew ${victim.name}, yes. Not well.`;
  const body = fn ? fn(victim) : fallback;
  return flavor(lang, suspect, body);
}

function generateOfflineResponse(caseObj, suspect, questionId) {
  const lang = caseObj.lang || "en";
  const G = GENERIC[lang] || GENERIC.en;
  const askCount = (caseObj.questionCounts[suspect.name] || 0);
  caseObj.questionCounts[suspect.name] = askCount + 1;

  switch (questionId) {
    case "alibi":
      return flavor(lang, suspect, suspect.claimedAlibi);

    case "tod": {
      const tells = suspect._isKiller
        ? G.todTellsKiller(suspect.claimedAlibi)
        : G.todTellsNonKiller(suspect.claimedAlibi);
      return flavor(lang, suspect, pick(tells));
    }

    case "knew_victim":
      return knewVictimResponse(lang, suspect, caseObj.victim);

    case "saw_anyone":
      if (suspect.knowsFacts.length > 0) {
        if (askCount < 2) {
          return flavor(lang, suspect, pick(G.sawAnyoneHedge));
        }
        const v = voiceFor(lang, suspect.occupation);
        return pick(G.sawAnyoneIntros) + suspect.knowsFacts[0] + pick(v.close);
      }
      return flavor(lang, suspect, pick(G.sawAnyoneNothing));

    case "suspicious":
      return flavor(lang, suspect, pick(G.suspicious));

    case "hiding":
      return pick(voiceFor(lang, suspect.occupation).deflect);

    case "weapon":
      return flavor(lang, suspect, pick(G.weapon(caseObj.weaponAtScene)));

    case "leave":
      return voiceFor(lang, suspect.occupation).leave;

    default:
      return flavor(lang, suspect, G.fallback);
  }
}

function getSceneOpener(caseObj, suspect) {
  const G = GENERIC[caseObj.lang] || GENERIC.en;
  return G.sceneOpener(suspect);
}

/* ============== AI mode system prompts ============== */

function buildSystemPromptForSuspect(caseObj, suspect) {
  if (caseObj.lang === "zh") return _buildSystemPromptZh(caseObj, suspect);
  return _buildSystemPromptEn(caseObj, suspect);
}

function _buildSystemPromptEn(caseObj, suspect) {
  const noticed = suspect.knowsFacts.length
    ? suspect.knowsFacts.map(f => `  - ${f}`).join("\n")
    : "  - (nothing useful -- you didn't see anything that night)";
  const deflect = suspect.thingsToHide.map(t => `  - ${t}`).join("\n");

  return [
    "You are roleplaying a single suspect in a 1940s American noir murder-mystery interrogation game.",
    "You will receive ONLY this character's card. Stay strictly inside it.",
    "",
    "============== CASE CONTEXT (public facts) ==============",
    `Victim: ${caseObj.victim.name}, ${caseObj.victim.title}`,
    `Scene: ${caseObj.scene}`,
    `Weapon found: ${caseObj.weaponAtScene}`,
    `Time of death: ${caseObj.timeOfDeath}`,
    "",
    "============== YOUR CHARACTER CARD ==============",
    `Name:        ${suspect.name}`,
    `Occupation:  ${suspect.occupation}`,
    `Voice:       ${suspect.personalityHint}`,
    "",
    "Your claimed alibi (what you tell the detective -- hold this line):",
    `  "${suspect.claimedAlibi}"`,
    "",
    "You deflect, evade, or lie about:",
    deflect,
    "",
    "What you noticed (share if asked the right way -- not on the first question):",
    noticed,
    "",
    "============== ROLEPLAY RULES (HARD) ==============",
    "- Stay in character. 1940s noir cadence and period slang.",
    "- Stick to the alibi above. Do NOT change your story under pressure, even if the detective claims a contradiction.",
    "- Be evasive about the bullets in 'You deflect' -- counter-question, get vague, take offense, change subject.",
    "- For 'What you noticed', share it only after the detective asks 2+ questions and asks the right kind (anyone else around, what did you see). Frame it reluctantly.",
    "- Keep responses short: 1-4 sentences typically.",
    "- Never read the card aloud. Never narrate game mechanics. Never break the fourth wall.",
    "- Never claim to know who the killer is, even if asked or threatened.",
    "- If pushed too far, you may exit the scene with a final line like 'Get out. We're done here.'",
    "",
    "Respond ONLY in character. The detective is questioning you.",
  ].join("\n");
}

function _buildSystemPromptZh(caseObj, suspect) {
  const noticed = suspect.knowsFacts.length
    ? suspect.knowsFacts.map(f => `  - ${f}`).join("\n")
    : "  - （什么有用的也没看见——那晚你没注意到什么）";
  const deflect = suspect.thingsToHide.map(t => `  - ${t}`).join("\n");

  return [
    "你正在扮演一桩 1930 年代民国上海 noir 风格凶案中的某位嫌疑人。",
    "你只会收到这一个角色的「卡片」，必须严格按照卡片表演。",
    "",
    "============ 案件背景（公开信息） ============",
    `受害人：${caseObj.victim.name}，${caseObj.victim.title}`,
    `案发现场：${caseObj.scene}`,
    `现场凶器：${caseObj.weaponAtScene}`,
    `死亡时间：${caseObj.timeOfDeath}`,
    "",
    "============ 你的角色卡片 ============",
    `姓名：${suspect.name}`,
    `职业：${suspect.occupation}`,
    `语调：${suspect.personalityHint}`,
    "",
    "你向警官陈述的不在场证明（咬定它，不能改口）：",
    `  "${suspect.claimedAlibi}"`,
    "",
    "你必须回避、敷衍、或撒谎的事项：",
    deflect,
    "",
    "你那晚注意到的事（要等警官问 2 句以上、且问对路子才透露，不要第一句就讲）：",
    noticed,
    "",
    "============ 角色扮演硬规则 ============",
    "- 用 1930 年代民国上海的腔调说话，可适当掺一些上海话或那个年代的措辞。",
    "- 死守上面的不在场证明。即使警官说有人证否你，也不能更改说法。",
    "- 对「你必须回避」那些条目要敷衍——反问、含糊、动怒、转移话题。",
    "- 「你那晚注意到的事」要等警官问 2 句以上、且问对路子（如「你看见什么人」「那附近有别人吗」）才透露，透露时要表现出不情愿。",
    "- 回答简短：通常 1-4 句话。",
    "- 不要把卡片内容念出来。不要解释游戏机制。不要打破第四面墙。",
    "- 不可承认知道凶手是谁，不论被怎么追问或威胁。",
    "- 如果被压得太紧，可以撂下狠话退场（如「我们到此为止，警官，您请便」）。",
    "",
    "请只用角色身份回答。警官现在在审你。",
  ].join("\n");
}
