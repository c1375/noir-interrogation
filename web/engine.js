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
  // Suspects are PRE-PAIRED so a name like "Dr. Eliza Vance" never gets assigned
  // to "longshoreman". Each game samples N of these pairs.
  suspects: [
    { name: "Vivian Cross",            occupation: "nightclub singer" },
    { name: "Dr. Eliza Vance",         occupation: "society doctor" },
    { name: "Tony 'the Pen' Russo",    occupation: "accountant for the mob" },
    { name: "Captain Nico Bellamy",    occupation: "war veteran turned PI" },
    { name: "Sister Agnes Holloway",   occupation: "fortune teller" },
    { name: "Solomon Drake",           occupation: "lawyer" },
    { name: "Margot Sinclair",         occupation: "investigative journalist" },
    { name: "Honoria Quinn",           occupation: "society heiress" },
    { name: "Reggie 'Lucky' Park",     occupation: "professional gambler" },
    { name: "Jack 'Knuckles' Malone",  occupation: "longshoreman" },
    { name: "Delia Whitlock",          occupation: "former silent film actress" },
    { name: "Felix Crane",             occupation: "pawn shop owner" },
    { name: "Eddie 'the Mick' Donovan",occupation: "speakeasy bartender" },
    { name: "Hank 'Iron Jaw' Brennan", occupation: "retired prizefighter" },
    { name: "Trudy Beck",              occupation: "night-shift cab driver" },
    { name: "The Great Mortimer",      occupation: "stage magician" },
    { name: "Ezra Pendleton",          occupation: "mortician" },
    { name: "Lila 'Diamond' Vega",     occupation: "fence" },
    { name: "Kit Granger",             occupation: "society photographer" },
    { name: "Henry Quill",             occupation: "insurance investigator" },
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
    "speakeasy bartender":      "polishes a glass while watching, knows everyone's drink and everyone's secret",
    "retired prizefighter":     "low rumble, slow words, knuckles speak louder than vowels",
    "night-shift cab driver":   "fast-talker, sees the city after midnight, every fare a story",
    "stage magician":           "theatrical flourish, every sentence is misdirection",
    "mortician":                "soft-spoken, comfortable with silence, treats questions like measurements",
    "fence":                    "low, careful, name-drops nothing, prices everything",
    "society photographer":     "flashbulb-bright cheer hiding cynic eyes",
    "insurance investigator":   "skeptical pencil-pusher with a nose for fraud",
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
  // 名字与职业绑定，避免「李白驹医生 → 茶楼算命先生」这样的笑话配对
  suspects: [
    { name: "红玫",       occupation: "百乐门舞女" },
    { name: "李白驹医生", occupation: "济世名医" },
    { name: "韩三爷",     occupation: "帮派账房" },
    { name: "钱师爷",     occupation: "法租界律师" },
    { name: "静安姑姑",   occupation: "茶楼算命先生" },
    { name: "关云鹤",     occupation: "退伍宪兵转私家侦探" },
    { name: "唐慧君",     occupation: "上海名媛" },
    { name: "杜小六",     occupation: "跑马场赌客" },
    { name: "阿九",       occupation: "码头脚行" },
    { name: "严雪松",     occupation: "申报记者" },
    { name: "陶宜君",     occupation: "默片影后" },
    { name: "姚月笙",     occupation: "当铺老板" },
    { name: "石阿全",     occupation: "百乐门吧台师傅" },
    { name: "齐铁拳",     occupation: "拳馆教头" },
    { name: "拐子贵",     occupation: "黄包车夫" },
    { name: "鬼手刘",     occupation: "大世界戏法师" },
    { name: "孙阴先生",   occupation: "义庄先生" },
    { name: "雪花姐",     occupation: "黑市掮客" },
    { name: "苏美君",     occupation: "画报摄影师" },
    { name: "卢敬安",     occupation: "古董行掌柜" },
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
    "百乐门吧台师傅":     "话锋不慢，擦着杯子看人，谁来过他都记得",
    "拳馆教头":           "嗓门低沉，话短，拳头说话",
    "黄包车夫":           "口音掺杂，跑遍十里洋场，深夜里见过太多事",
    "大世界戏法师":       "戏剧腔，每句话都像在卖关子",
    "义庄先生":           "话不多，习惯沉默，对任何问题都冷静像在量尺寸",
    "黑市掮客":           "言语圆滑，从不留名，什么都能买什么都能卖",
    "画报摄影师":         "嘴上爽快，眼里冷，闪光灯下嗅得到丑闻",
    "古董行掌柜":         "每件物事都讲得出渊源，话里有话",
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
  "speakeasy bartender": {
    open:  ["[wiping a glass]  ", "Look, friend, ", ""],
    close: ["", " That's the long and short of it.", " Pour you another?"],
    deflect: [
      "I don't repeat what I hear at the bar. Bad for tips.",
      "[keeps polishing the glass]  Couldn't say.",
      "Folks come in, folks go out. I don't keep a ledger.",
    ],
    leave: "We're closing the bar, detective. On your way.",
  },
  "retired prizefighter": {
    open:  ["", "[a slow rumble]  ", "Look, "],
    close: ["", " That's it.", " Final round."],
    deflect: [
      "Took too many to the head to remember small things.",
      "Some questions, you swing and you miss, see?",
      "[cracks knuckles]  Pass.",
    ],
    leave: "Bell rang, detective. We're done.",
  },
  "night-shift cab driver": {
    open:  ["Look, mac, ", "I'll tell ya, ", "[lighting a smoke]  "],
    close: ["", " That's how I remember it.", " Meter's running, by the way."],
    deflect: [
      "I drive, I don't snitch. Bad business.",
      "Buddy, I see a hundred faces a night.",
      "[scratches chin]  Couldn't tell ya.",
    ],
    leave: "Got a fare waiting, detective. So long.",
  },
  "stage magician": {
    open:  ["[a small flourish]  ", "Aha, detective! ", "Allow me to clarify -- "],
    close: ["", " ... and that's the trick of it.", " A magician keeps his secrets."],
    deflect: [
      "Misdirection, detective -- a magician's first lesson.",
      "[produces a coin from behind your ear]  Some things shouldn't be revealed.",
      "Now you see it, now you don't.",
    ],
    leave: "[bows]  And with that... I vanish.",
  },
  "mortician": {
    open:  ["", "Quietly: ", "If you'll permit me -- "],
    close: ["", " That is all.", " Make of it what you will."],
    deflect: [
      "Discretion is the better part of my profession.",
      "[soft]  I would rather not say.",
      "Some details belong only to the deceased.",
    ],
    leave: "There is work waiting downstairs, detective. Good evening.",
  },
  "fence": {
    open:  ["[low, careful]  ", "Look here, ", "I'll tell you what -- "],
    close: ["", " That's the price.", " No questions, no answers."],
    deflect: [
      "I don't know names, detective. I never know names.",
      "What you're asking after, I never saw it.",
      "[shrug]  Couldn't tell you.",
    ],
    leave: "Place is closed, detective. Out.",
  },
  "society photographer": {
    open:  ["[behind the camera]  ", "Sweetheart, ", "Detective, darling, "],
    close: ["", " Snap snap, story over.", " Gimme a smile, would you?"],
    deflect: [
      "I shoot the picture, I don't write the caption.",
      "[winks]  My film is private property.",
      "Negatives are filed, detective. I don't show them.",
    ],
    leave: "Last shot, detective. *click* -- you're out.",
  },
  "insurance investigator": {
    open:  ["For the record: ", "By my files, ", "Strictly speaking, "],
    close: ["", " As noted in my report.", " I've cross-referenced this twice."],
    deflect: [
      "That's marked confidential in my files.",
      "I'd need to consult the case folder before commenting.",
      "Procedure forbids me from saying.",
    ],
    leave: "I have a deposition in the morning. Good day, detective.",
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
  "百乐门吧台师傅": {
    open:  ["[擦着酒杯]  ", "我跟侬讲，", ""],
    close: ["", " 大致是这样。", " 来一杯吗？"],
    deflect: [
      "吧台后头听到的，我不外传，砸饭碗。",
      "[继续擦杯子]  说不清。",
      "客人来来去去，我不记账，记不住。",
    ],
    leave: "我们打烊了，警官。请便。",
  },
  "拳馆教头": {
    open:  ["", "[低嗓]  ", "听着，"],
    close: ["", " 完。", " 收工。"],
    deflect: [
      "脑子挨多了不记小事。",
      "有些事一拳挥过去打空，懂？",
      "[捏了捏指节]  跳过。",
    ],
    leave: "钟响了，警官。别再问。",
  },
  "黄包车夫": {
    open:  ["阿哥啊，", "我跟侬讲，", "[抽了口烟]  "],
    close: ["", " 大致就这样，先生。", " 一脚一脚跑出来的，记不全。"],
    deflect: [
      "我拉车的，不打小报告，断生意。",
      "先生，一晚上多少张脸过去，谁记得清？",
      "[摸了摸下巴]  说不上。",
    ],
    leave: "客人在等了，警官，先走一步。",
  },
  "大世界戏法师": {
    open:  ["[手腕一翻]  ", "啊呀，警官！", "请允许我解释——"],
    close: ["", " ……就是这么个戏法。", " 戏法人不漏底。"],
    deflect: [
      "障眼法，警官——戏法的第一课。",
      "[从您耳朵后变出一枚铜钱]  有些事不可揭破。",
      "您看见过，您又没看见过。",
    ],
    leave: "[一鞠躬]  那么……戏法人也得退场。",
  },
  "义庄先生": {
    open:  ["", "轻声说：", "若蒙允许——"],
    close: ["", " 仅此而已。", " 您自己揣度。"],
    deflect: [
      "我这一行，第一讲规矩。",
      "[低声]  恕难奉告。",
      "有些事只属于亡者。",
    ],
    leave: "下面还有事候着，警官，告辞。",
  },
  "黑市掮客": {
    open:  ["[压低声音]  ", "我同侬讲，", "话搁这儿——"],
    close: ["", " 价钱就这样。", " 有问无答，规矩。"],
    deflect: [
      "我不记名字，警官，从来不记。",
      "您问的那个，我没见过。",
      "[耸肩]  说不上。",
    ],
    leave: "店要打烊了，警官，请。",
  },
  "画报摄影师": {
    open:  ["[相机后头]  ", "亲爱的警官，", "哎，警官，"],
    close: ["", " 咔嚓一声，故事就完。", " 给我笑一个？"],
    deflect: [
      "我拍照片，配文不是我的事。",
      "[眨眼]  底片是我私家财产。",
      "胶卷归档了，警官，不外示。",
    ],
    leave: "最后一张，警官——咔嚓，您出画了。",
  },
  "古董行掌柜": {
    open:  ["要说这个嘛——", "我老实跟您讲，", "古董行有古董行的规矩，"],
    close: ["", " 每件物事都有它的故事。", " 您问到这儿便算到底。"],
    deflect: [
      "我经手的物事多，名字一概不留。",
      "古玩这行，谁多嘴谁吃亏。",
      "[摩挲着印章]  此事难言。",
    ],
    leave: "店里还有客在等掌眼，警官，告辞。",
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
  "speakeasy bartender":       (v) => `${v.name}? Came in once a week. Drank rye, neat. Big tipper, bigger silences.`,
  "retired prizefighter":      (v) => `${v.name}? Saw him at a fight or two. Decent man at ringside. Bad bettor.`,
  "night-shift cab driver":    (v) => `Drove ${v.name} home a couple times. Quiet rider, generous tipper. That's all I know.`,
  "stage magician":            (v) => `${v.name} caught my act once or twice. Always wanted to know how it was done. Never told him.`,
  "mortician":                 (v) => `${v.name} arranged services for someone in his household last spring. We spoke briefly. Professional.`,
  "fence":                     (v) => `${v.name}? Heard the name. Don't recall doing business with him. Don't recall NOT doing business.`,
  "society photographer":      (v) => `${v.name}? Photographed him at three or four galas. Always asked to see the proofs first.`,
  "insurance investigator":    (v) => `${v.name} held two policies through my company. Standard, until recently. Recently, less so.`,
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
  "百乐门吧台师傅":     (v) => `${v.name}? 这位先生是我们这儿的常客，喝威士忌纯的，打赏大方，话却少。`,
  "拳馆教头":           (v) => `${v.name}? 在拳馆边上看过几场比赛。台下挺客气，下注却讲究。`,
  "黄包车夫":           (v) => `送过 ${v.name} 几趟夜归。坐车不爱讲话，赏钱给得不少，仅此而已。`,
  "大世界戏法师":       (v) => `${v.name} 来看过我两三场戏法，老问我怎么变的。我没告诉他。`,
  "义庄先生":           (v) => `${v.name} 春上为府里某位办过一桩事，跟我打过交道，礼数周全。`,
  "黑市掮客":           (v) => `${v.name}? 名字耳熟，但我不记得做过他生意，也不记得没做过。`,
  "画报摄影师":         (v) => `${v.name}? 在三四场酒会上拍过他，每次都先要看小样才让登。`,
  "古董行掌柜":         (v) => `${v.name} 在我柜上买过两三件东西，眼力毒辣，砍价的手也毒辣。`,
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

/* ============== Motive pools ============== */
/* The motive is a narrative layer: one non-killer suspect (the "leaker")
   knows what the victim was going through. The leak does NOT name the
   killer -- it just adds context. The killer's card meanwhile gets a
   second deflection topic tied to the motive. */

const MOTIVES_EN = {
  blackmail: {
    label: "blackmail",
    leak: (v) => `${v.name} had been quietly blackmailed for months. He never said by whom -- it was eating at him, though. You could see it.`,
    killerHide: () => "the nature of any private arrangement I had with the deceased",
  },
  jealousy: {
    label: "jealousy",
    leak: (v) => `Bad blood between ${v.name} and someone close to the household. Heard a row a week ago, ugly stuff. Personal.`,
    killerHide: () => "my personal feelings about anyone in the victim's household",
  },
  inheritance: {
    label: "inheritance",
    leak: (v) => `${v.name} changed his will recently. Lawyers in and out for two solid weeks. Somebody stood to gain.`,
    killerHide: () => "any financial connection I had to the deceased's estate",
  },
  debt: {
    label: "debt",
    leak: (v) => `${v.name} was calling in old debts hard the last few months. People who owed him were spooked.`,
    killerHide: () => "any money I might have owed the deceased",
  },
  coverup: {
    label: "cover-up",
    leak: (v) => `${v.name} had been digging into something dark. Someone's past, I think. He wouldn't say whose.`,
    killerHide: () => "what the victim may have been investigating about me",
  },
  revenge: {
    label: "old grudge",
    leak: (v) => `${v.name} ruined someone, years back. The kind of wound people don't forget.`,
    killerHide: () => "any old grudge I might have had with the deceased",
  },
  exposure: {
    label: "public exposure",
    leak: (v) => `${v.name} was about to print something. A society piece. Career-ender, by the sound of it.`,
    killerHide: () => "anything the victim might have known about my private life",
  },
};

const MOTIVES_ZH = {
  blackmail: {
    label: "敲诈",
    leak: (v) => `${v.name} 这阵子一直被人暗里敲诈，他没说是谁，可脸色一天比一天差，看得出是憋着事。`,
    killerHide: () => "我和死者之间某种私下的安排",
  },
  jealousy: {
    label: "情感纠葛",
    leak: (v) => `${v.name} 和他家里某个人之间有点不清不楚，上礼拜还吵过一架，难听话都出来了。`,
    killerHide: () => "我对死者家中某人的私人感情",
  },
  inheritance: {
    label: "遗产之争",
    leak: (v) => `${v.name} 最近改过遗嘱，律师两个礼拜进进出出，明摆着有人能从他那儿分到一大笔。`,
    killerHide: () => "我和死者那笔遗产之间有什么牵连",
  },
  debt: {
    label: "讨债",
    leak: (v) => `${v.name} 这几个月在死命追讨旧账，欠他钱的人个个都不安生。`,
    killerHide: () => "我有没有欠过死者钱",
  },
  coverup: {
    label: "掩盖旧案",
    leak: (v) => `${v.name} 这阵在挖某件陈年烂事，挖谁的不知道，他自己讳莫如深。`,
    killerHide: () => "死者也许正在查我什么",
  },
  revenge: {
    label: "宿怨",
    leak: (v) => `${v.name} 当年毁过一个人，那种事，能记一辈子。`,
    killerHide: () => "我和死者之间有没有什么陈年恩怨",
  },
  exposure: {
    label: "公开揭发",
    leak: (v) => `${v.name} 这两天准备在《申报》上抖出谁的丑事，登出来够要谁的命。`,
    killerHide: () => "死者也许知道我什么不能见光的事",
  },
};

const MOTIVES_BY_LANG = { en: MOTIVES_EN, zh: MOTIVES_ZH };

/* ============== Difficulty levels ============== */

const DIFFICULTY = {
  easy:   { suspects: 3, addWitness: true, addMotive: false, addFalseWitness: false },
  normal: { suspects: 5, addWitness: true, addMotive: true,  addFalseWitness: false },
  hard:   { suspects: 5, addWitness: true, addMotive: true,  addFalseWitness: true  },
};

/* ============== Avatars (per-occupation simple SVG silhouettes) ============== */
/* Inline SVG parts. Each accessory is layered over a shared head+shoulders
   silhouette. fill/stroke uses currentColor so the avatar inherits the
   suspect card's text color. */

const AVATAR_BASE = '<ellipse cx="30" cy="55" rx="22" ry="14"/><circle cx="30" cy="26" r="11"/>';

const AVATAR_ACC = {
  // === EN ===
  "nightclub singer":         '<rect x="29" y="35" width="2" height="10"/><circle cx="30" cy="46" r="3" fill="none" stroke="currentColor" stroke-width="1"/><path d="M40,15 a3,3 0 0,1 6,0" fill="none" stroke="currentColor" stroke-width="1"/>',
  "pawn shop owner":          '<rect x="18" y="13" width="24" height="3"/><path d="M21,40 L21,55 M39,40 L39,55" stroke="currentColor" stroke-width="0.8" fill="none"/>',
  "society doctor":           '<path d="M22,38 Q22,46 30,46 Q38,46 38,38" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="30" cy="48" r="2"/>',
  "accountant for the mob":   '<rect x="22" y="22" width="6" height="3" fill="none" stroke="currentColor" stroke-width="0.8"/><rect x="32" y="22" width="6" height="3" fill="none" stroke="currentColor" stroke-width="0.8"/><line x1="28" y1="23.5" x2="32" y2="23.5" stroke="currentColor" stroke-width="0.8"/>',
  "investigative journalist": '<rect x="18" y="13" width="24" height="6"/><rect x="34" y="14" width="6" height="3" fill="none" stroke="var(--paper)" stroke-width="0.5"/>',
  "lawyer":                   '<path d="M27,40 L30,44 L33,40" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M22,42 L25,46 L28,42 M32,42 L35,46 L38,42" fill="none" stroke="currentColor" stroke-width="0.8"/>',
  "professional gambler":     '<rect x="40" y="20" width="9" height="12" fill="none" stroke="currentColor" stroke-width="1" rx="1"/><text x="44.5" y="28" font-size="6" text-anchor="middle" fill="currentColor">A</text>',
  "society heiress":          '<path d="M14,12 Q30,2 46,12 L46,15 L14,15 Z"/><circle cx="22" cy="42" r="1"/><circle cx="26" cy="44" r="1"/><circle cx="30" cy="44.5" r="1"/><circle cx="34" cy="44" r="1"/><circle cx="38" cy="42" r="1"/>',
  "war veteran turned PI":    '<path d="M14,16 Q30,7 46,16 L48,20 L12,20 Z"/><rect x="14" y="18" width="32" height="2"/>',
  "fortune teller":           '<path d="M18,20 Q30,8 42,20 L42,24 L18,24 Z"/><circle cx="30" cy="22" r="1.4"/><path d="M27,33 L30,36 L33,33" fill="none" stroke="currentColor" stroke-width="0.8"/>',
  "longshoreman":             '<path d="M16,15 Q30,9 44,15 L44,19 L16,19 Z"/><rect x="22" y="42" width="16" height="3"/>',
  "former silent film actress":'<path d="M14,17 L46,17 L42,11 L18,11 Z"/><path d="M44,17 Q50,8 54,11" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  "speakeasy bartender":      '<path d="M27,38 L33,38 L31,42 L29,42 Z"/><rect x="22" y="42" width="16" height="9" fill="none" stroke="currentColor" stroke-width="0.8"/>',
  "retired prizefighter":     '<rect x="20" y="18" width="20" height="3" rx="1"/><path d="M14,40 Q14,55 30,55 Q46,55 46,40" fill="none"/><circle cx="22" cy="50" r="5"/><circle cx="38" cy="50" r="5"/>',
  "night-shift cab driver":   '<rect x="18" y="14" width="24" height="6"/><rect x="22" y="11" width="16" height="4"/>',
  "stage magician":           '<rect x="20" y="3" width="20" height="13"/><rect x="17" y="14" width="26" height="3"/>',
  "mortician":                '<rect x="22" y="38" width="16" height="14" fill="none" stroke="currentColor" stroke-width="1"/><path d="M30,38 L30,46" stroke="currentColor" stroke-width="0.8"/>',
  "fence":                    '<circle cx="25" cy="25" r="2.5" fill="none" stroke="currentColor" stroke-width="0.8"/><circle cx="35" cy="25" r="2.5" fill="none" stroke="currentColor" stroke-width="0.8"/><line x1="27.5" y1="25" x2="32.5" y2="25" stroke="currentColor" stroke-width="0.6"/>',
  "society photographer":     '<rect x="20" y="20" width="20" height="14" rx="2"/><circle cx="30" cy="27" r="4" fill="none" stroke="var(--paper)" stroke-width="1"/><rect x="34" y="17" width="4" height="3"/>',
  "insurance investigator":   '<line x1="22" y1="23" x2="26" y2="25" stroke="currentColor" stroke-width="0.8"/><line x1="34" y1="25" x2="38" y2="23" stroke="currentColor" stroke-width="0.8"/><circle cx="24" cy="25" r="2.5" fill="none" stroke="currentColor" stroke-width="0.8"/><circle cx="36" cy="25" r="2.5" fill="none" stroke="currentColor" stroke-width="0.8"/>',
  // === ZH (most reuse the EN concepts; differentiate where culturally distinct) ===
  "百乐门舞女":         '<rect x="29" y="35" width="2" height="10"/><circle cx="30" cy="46" r="3" fill="none" stroke="currentColor" stroke-width="1"/><path d="M40,15 a3,3 0 0,1 6,0" fill="none" stroke="currentColor" stroke-width="1"/>',
  "当铺老板":           '<rect x="18" y="13" width="24" height="3"/><path d="M21,40 L21,55 M39,40 L39,55" stroke="currentColor" stroke-width="0.8" fill="none"/>',
  "济世名医":           '<path d="M22,38 Q22,46 30,46 Q38,46 38,38" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="30" cy="48" r="2"/>',
  "帮派账房":           '<rect x="22" y="22" width="6" height="3" fill="none" stroke="currentColor" stroke-width="0.8"/><rect x="32" y="22" width="6" height="3" fill="none" stroke="currentColor" stroke-width="0.8"/><line x1="28" y1="23.5" x2="32" y2="23.5" stroke="currentColor" stroke-width="0.8"/>',
  "申报记者":           '<rect x="18" y="13" width="24" height="6"/><rect x="34" y="14" width="6" height="3" fill="none" stroke="var(--paper)" stroke-width="0.5"/>',
  "法租界律师":         '<path d="M27,40 L30,44 L33,40" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M22,42 L25,46 L28,42 M32,42 L35,46 L38,42" fill="none" stroke="currentColor" stroke-width="0.8"/>',
  "跑马场赌客":         '<rect x="40" y="20" width="9" height="12" fill="none" stroke="currentColor" stroke-width="1" rx="1"/><text x="44.5" y="28" font-size="6" text-anchor="middle" fill="currentColor">A</text>',
  "上海名媛":           '<path d="M14,12 Q30,2 46,12 L46,15 L14,15 Z"/><circle cx="22" cy="42" r="1"/><circle cx="26" cy="44" r="1"/><circle cx="30" cy="44.5" r="1"/><circle cx="34" cy="44" r="1"/><circle cx="38" cy="42" r="1"/>',
  "退伍宪兵转私家侦探": '<path d="M14,16 Q30,7 46,16 L48,20 L12,20 Z"/><rect x="14" y="18" width="32" height="2"/>',
  "茶楼算命先生":       '<path d="M18,20 Q30,8 42,20 L42,24 L18,24 Z"/><circle cx="30" cy="22" r="1.4"/><path d="M27,33 L30,36 L33,33" fill="none" stroke="currentColor" stroke-width="0.8"/>',
  "码头脚行":           '<path d="M16,15 Q30,9 44,15 L44,19 L16,19 Z"/><rect x="22" y="42" width="16" height="3"/>',
  "默片影后":           '<path d="M14,17 L46,17 L42,11 L18,11 Z"/><path d="M44,17 Q50,8 54,11" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  "百乐门吧台师傅":     '<path d="M27,38 L33,38 L31,42 L29,42 Z"/><rect x="22" y="42" width="16" height="9" fill="none" stroke="currentColor" stroke-width="0.8"/>',
  "拳馆教头":           '<rect x="20" y="18" width="20" height="3" rx="1"/><circle cx="22" cy="50" r="5"/><circle cx="38" cy="50" r="5"/>',
  // 黄包车夫 -- coolie/sun hat (wide brim conical) instead of chauffeur cap
  "黄包车夫":           '<path d="M10,20 L30,8 L50,20 L50,22 L10,22 Z"/>',
  "大世界戏法师":       '<rect x="20" y="3" width="20" height="13"/><rect x="17" y="14" width="26" height="3"/>',
  "义庄先生":           '<rect x="22" y="38" width="16" height="14" fill="none" stroke="currentColor" stroke-width="1"/><path d="M30,38 L30,46" stroke="currentColor" stroke-width="0.8"/>',
  "黑市掮客":           '<circle cx="25" cy="25" r="2.5" fill="none" stroke="currentColor" stroke-width="0.8"/><circle cx="35" cy="25" r="2.5" fill="none" stroke="currentColor" stroke-width="0.8"/><line x1="27.5" y1="25" x2="32.5" y2="25" stroke="currentColor" stroke-width="0.6"/>',
  "画报摄影师":         '<rect x="20" y="20" width="20" height="14" rx="2"/><circle cx="30" cy="27" r="4" fill="none" stroke="var(--paper)" stroke-width="1"/><rect x="34" y="17" width="4" height="3"/>',
  // 古董行掌柜 -- magnifying glass instead of insurance pince-nez
  "古董行掌柜":         '<circle cx="38" cy="22" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="42" y1="26" x2="48" y2="32" stroke="currentColor" stroke-width="1.4"/>',
};

function avatarSvg(occupation) {
  const acc = AVATAR_ACC[occupation] || "";
  return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" fill="currentColor">${AVATAR_BASE}${acc}</svg>`;
}

/* ============== Helpers ============== */

// Deterministic PRNG (mulberry32). Same seed -> same sequence -> same case.
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a free-form seed string into a 32-bit int (so users can share readable seeds).
function seedToInt(input) {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input | 0;
  const s = String(input);
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
  let h = 2166136261;  // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function pick(arr, rng = Math.random) { return arr[Math.floor(rng() * arr.length)]; }

function sample(arr, n, rng = Math.random) {
  const copy = arr.slice();
  const out = [];
  while (n-- > 0 && copy.length) {
    const i = Math.floor(rng() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function rngHex(len, rng) {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * 16)];
  return s;
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

async function generateCase(lang = "en", seedInput = null, difficulty = "normal") {
  const POOLS = POOLS_BY_LANG[lang] || POOLS_EN;
  const G = GENERIC[lang] || GENERIC.en;
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const N = cfg.suspects;

  // Resolve to a numeric seed. If none given, pick a random one so this
  // case still has a stable seed we can put in the share URL.
  const seedInt = (seedInput != null)
    ? seedToInt(seedInput)
    : (Math.floor(Math.random() * 0xffffffff) | 0);
  const rng = makeRng(seedInt);

  const caseId = rngHex(8, rng);
  const salt = rngHex(32, rng);

  const victim = pick(POOLS.victims, rng);
  const weapon = pick(POOLS.weapons, rng);
  const location = pick(POOLS.locations, rng);
  const hour = 20 + Math.floor(rng() * 4);
  const minute = pick([0, 15, 30, 45], rng);
  const timeOfDeath = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  // Pre-paired (name, occupation) sampling -- same pair always, never a
  // doctor doubling as a fortune teller.
  const sampledSuspects = sample(POOLS.suspects, N, rng);
  const suspectNames = sampledSuspects.map(s => s.name);
  const occupations  = sampledSuspects.map(s => s.occupation);
  const secretsPool  = sample(POOLS.redHerringSecrets, N, rng);
  // Need N-1 true alibis (one for each non-killer)
  const trueAlibis   = sample(POOLS.trueAlibis, N - 1, rng);
  const falseAlibi   = pick(POOLS.falseAlibis, rng);

  const allIdx = Array.from({ length: N }, (_, i) => i);
  const killerIdx = Math.floor(rng() * N);

  // Witness: a non-killer who saw the killer.
  let witnessIdx = null;
  if (cfg.addWitness) {
    const pool = allIdx.filter(i => i !== killerIdx);
    witnessIdx = pick(pool, rng);
  }

  // Motive leaker: a non-killer, non-witness who knows about the victim's
  // troubles. (The leak does not name the killer.)
  let motiveType = null, motiveLeakerIdx = null;
  if (cfg.addMotive) {
    const MOTIVES = MOTIVES_BY_LANG[lang] || MOTIVES_EN;
    motiveType = pick(Object.keys(MOTIVES), rng);
    const pool = allIdx.filter(i => i !== killerIdx && i !== witnessIdx);
    if (pool.length > 0) motiveLeakerIdx = pick(pool, rng);
  }

  // False witness (Hard mode): a non-killer, non-true-witness who claims
  // to have seen a DIFFERENT non-killer at the scene -- a red herring
  // accusation. Solved by cross-checking the wrongly-named suspect's alibi
  // (which is corroborated, unlike the killer's).
  let falseWitnessIdx = null, falselyAccusedIdx = null;
  if (cfg.addFalseWitness) {
    const fwPool = allIdx.filter(i =>
      i !== killerIdx && i !== witnessIdx && i !== motiveLeakerIdx);
    if (fwPool.length > 0) {
      falseWitnessIdx = pick(fwPool, rng);
      const fwTargetPool = allIdx.filter(i =>
        i !== killerIdx && i !== falseWitnessIdx && i !== witnessIdx);
      if (fwTargetPool.length > 0) {
        falselyAccusedIdx = pick(fwTargetPool, rng);
      }
    }
  }

  const killerName = suspectNames[killerIdx];
  const witnessObservation = (witnessIdx != null)
    ? G.witnessFact(killerName, location, timeOfDeath)
    : null;
  const motiveLeak = (motiveLeakerIdx != null)
    ? MOTIVES_BY_LANG[lang][motiveType].leak(victim)
    : null;
  const falseObservation = (falseWitnessIdx != null && falselyAccusedIdx != null)
    ? G.witnessFact(suspectNames[falselyAccusedIdx], location, timeOfDeath)
    : null;

  const suspects = [];
  let nonkillerIdx = 0;
  for (let i = 0; i < N; i++) {
    const isKiller = i === killerIdx;
    let claimedAlibi, thingsToHide;
    if (isKiller) {
      claimedAlibi = falseAlibi;
      thingsToHide = [G.killerHide(timeOfDeath)];
      if (motiveType) thingsToHide.push(MOTIVES_BY_LANG[lang][motiveType].killerHide());
    } else {
      claimedAlibi = trueAlibis[nonkillerIdx++];
      thingsToHide = [secretsPool[i]];
    }
    const knowsFacts = [];
    if (i === witnessIdx) knowsFacts.push({
      type: "witness", text: witnessObservation, _namedSuspect: killerName,
    });
    if (i === motiveLeakerIdx) knowsFacts.push({ type: "motive", text: motiveLeak });
    if (i === falseWitnessIdx) knowsFacts.push({
      type: "witness", text: falseObservation, _namedSuspect: suspectNames[falselyAccusedIdx], _false: true,
    });
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
    seed: seedInt,
    difficulty,
    createdAt: new Date().toISOString(),
    answerHash,
    _salt: salt,
    _killer: killerName,
    _motiveType: motiveType,
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

function knewVictimResponse(lang, suspect, victim, askCount) {
  const fn = (KNEW_VICTIM_BY_LANG[lang] || KNEW_VICTIM_EN)[suspect.occupation];
  const fallback = lang === "zh"
    ? `认识 ${victim.name}。算不上熟。`
    : `I knew ${victim.name}, yes. Not well.`;
  const body = fn ? fn(victim) : fallback;
  let response = flavor(lang, suspect, body);
  // If this suspect carries a motive leak, append it after a couple of
  // questions in -- they "warm up" and let the gossip slip.
  const motive = suspect.knowsFacts.find(f => f.type === "motive");
  if (motive && askCount >= 1) {
    const transition = lang === "zh" ? "  ……" : "  ";
    response += transition + motive.text;
  }
  return response;
}

function generateOfflineResponse(caseObj, suspect, questionId) {
  const lang = caseObj.lang || "en";
  const G = GENERIC[lang] || GENERIC.en;
  const askCount = (caseObj.questionCounts[suspect.name] || 0);
  caseObj.questionCounts[suspect.name] = askCount + 1;

  // Per-question repeat tracking
  if (!caseObj.perQuestionCounts) caseObj.perQuestionCounts = {};
  if (!caseObj.perQuestionCounts[suspect.name]) caseObj.perQuestionCounts[suspect.name] = {};
  const qCounts = caseObj.perQuestionCounts[suspect.name];
  const priorRepeats = qCounts[questionId] || 0;
  qCounts[questionId] = priorRepeats + 1;

  const witnessFact = suspect.knowsFacts.find(f => f.type === "witness");
  const motiveFact  = suspect.knowsFacts.find(f => f.type === "motive");

  // Compute base response, then prepend annoyance if this is a repeat ask
  // (skip for "leave" -- no point being annoyed about goodbye).
  let response;
  switch (questionId) {
    case "alibi":
      response = flavor(lang, suspect, suspect.claimedAlibi);
      break;

    case "tod": {
      const tells = suspect._isKiller
        ? G.todTellsKiller(suspect.claimedAlibi)
        : G.todTellsNonKiller(suspect.claimedAlibi);
      response = flavor(lang, suspect, pick(tells));
      break;
    }

    case "knew_victim":
      response = knewVictimResponse(lang, suspect, caseObj.victim, askCount);
      break;

    case "saw_anyone":
      if (witnessFact) {
        if (askCount < 2) {
          response = flavor(lang, suspect, pick(G.sawAnyoneHedge));
        } else {
          const v = voiceFor(lang, suspect.occupation);
          response = pick(G.sawAnyoneIntros) + witnessFact.text + pick(v.close);
        }
      } else {
        response = flavor(lang, suspect, pick(G.sawAnyoneNothing));
      }
      break;

    case "suspicious": {
      // Suspects carrying a motive leak will, on the second pass, share what
      // they know about the victim's troubles.
      if (motiveFact && askCount >= 1) {
        const v = voiceFor(lang, suspect.occupation);
        response = pick(G.sawAnyoneIntros) + motiveFact.text + pick(v.close);
      } else {
        response = flavor(lang, suspect, pick(G.suspicious));
      }
      break;
    }

    case "hiding":
      response = pick(voiceFor(lang, suspect.occupation).deflect);
      break;

    case "weapon":
      response = flavor(lang, suspect, pick(G.weapon(caseObj.weaponAtScene)));
      break;

    case "leave":
      return voiceFor(lang, suspect.occupation).leave;

    default:
      response = flavor(lang, suspect, G.fallback);
  }

  // Repeat-question annoyance (skip for revelations so witness/motive reveals
  // come through cleanly even on a 2nd ask).
  const isReveal = (questionId === "saw_anyone" && witnessFact && askCount >= 2)
                || (questionId === "suspicious" && motiveFact && askCount >= 1);
  if (priorRepeats >= 1 && !isReveal) {
    const annoy = REPEAT_ANNOY[lang] || REPEAT_ANNOY.en;
    const pool = priorRepeats >= 2 ? annoy.third : annoy.second;
    return pick(pool) + response;
  }
  return response;
}

function getSceneOpener(caseObj, suspect) {
  const G = GENERIC[caseObj.lang] || GENERIC.en;
  return G.sceneOpener(suspect);
}

/* ============== Confront (B) ============== */

const CONFRONT_LINES = {
  en: {
    killerCrack: [
      "[looks away, then back, harder]  Whoever told you that is mistaken. I was at the cinema. End of story.",
      "[a pause, longer than necessary]  ... Their word against mine, detective. And mine doesn't budge.",
      "That's a lie. Simple as that. They're trying to put it on me.",
      "[a thin smile that doesn't reach the eyes]  People see what they want to see at that hour, detective.",
    ],
    innocentDefend: [
      "Whoever said that is mistaken. I told you where I was -- check the witnesses, check the records.",
      "I was nowhere near there. My alibi has corroboration. Theirs is one person's word.",
      "Then prove it. They can't, because I wasn't there.",
    ],
    notMeShrug: [
      "That has nothing to do with my night, detective.",
      "Interesting. Doesn't change my answer to anything.",
      "Are you implying something, or just thinking out loud?",
      "If they say so. Wasn't there myself.",
    ],
    framingPrefix: (source, text) => `Detective produces a statement from ${source}: "${text}"  How do you answer that?`,
  },
  zh: {
    killerCrack: [
      "[眼神闪开了一下又转回来]  谁说的——是看错了。我那晚在大光明，故事讲完。",
      "[停顿过久]  ……他一面之词，警官。我的不动摇。",
      "胡说，简简单单。他们想把这事赖给我。",
      "[嘴角动了动，眼里没笑]  那个时候的事，谁眼花谁清醒，您自个儿掂量。",
    ],
    innocentDefend: [
      "他说错了。我前面讲过我在哪里——证人和记录都查得到。",
      "我当时根本不在那边。我的不在场证明是几个人作证的，他只一个人。",
      "那您让他证。他证不了，因为我根本没在那儿。",
    ],
    notMeShrug: [
      "这跟我那晚毫无关系，警官。",
      "唔。不影响我的答案。",
      "您是在暗示什么呢，还是顺嘴一说？",
      "他这么说就这么说吧，反正我没在那儿。",
    ],
    framingPrefix: (source, text) => `警官出示一份来自 ${source} 的陈述：「${text}」  您对此作何解释？`,
  },
};

function generateConfrontResponse(caseObj, suspect, evidence) {
  const lang = caseObj.lang || "en";
  const C = CONFRONT_LINES[lang] || CONFRONT_LINES.en;
  let pool;
  if (evidence.namedSuspect === suspect.name && suspect._isKiller) {
    pool = C.killerCrack;
  } else if (evidence.namedSuspect === suspect.name) {
    pool = C.innocentDefend;
  } else {
    pool = C.notMeShrug;
  }
  return flavor(lang, suspect, pick(pool));
}

function buildConfrontFraming(caseObj, evidence) {
  const lang = caseObj.lang || "en";
  const C = CONFRONT_LINES[lang] || CONFRONT_LINES.en;
  return C.framingPrefix(evidence.source, evidence.text);
}

/* ============== Repeat-question annoyance (E) ============== */

const REPEAT_ANNOY = {
  en: {
    second: [
      "I already told you, detective. ",
      "Asked and answered. ",
      "Like I said: ",
      "[a small sigh]  ",
    ],
    third: [
      "Look, asking won't change my answer. ",
      "I'm starting to lose my patience, detective. ",
      "This is the third time you've asked. ",
      "[same answer]  ",
    ],
  },
  zh: {
    second: [
      "我刚才不是说过了吗，警官——",
      "这话我已经回答过了。",
      "我说过了：",
      "[轻轻叹了口气]  ",
    ],
    third: [
      "您再问几次我也不会改答案的，警官。",
      "我快没耐心了。",
      "警官，这是您第三遍问了。",
      "[同样的话]  ",
    ],
  },
};

/* ============== AI mode system prompts ============== */

function buildSystemPromptForSuspect(caseObj, suspect) {
  if (caseObj.lang === "zh") return _buildSystemPromptZh(caseObj, suspect);
  return _buildSystemPromptEn(caseObj, suspect);
}

function _buildSystemPromptEn(caseObj, suspect) {
  const noticed = suspect.knowsFacts.length
    ? suspect.knowsFacts.map(f => {
        const tag = f.type === "witness"
          ? "[WITNESS — you saw this; share if asked who else was around / what you noticed]"
          : "[GOSSIP — you've heard this about the victim; share if asked about your relationship to the victim or anyone you'd suspect, after a couple of questions]";
        return `  - ${f.text}\n    ${tag}`;
      }).join("\n")
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
    ? suspect.knowsFacts.map(f => {
        const tag = f.type === "witness"
          ? "[目击 — 这是你亲眼看到的；如果警官问你「那附近还有什么人」「你看见什么」，就在适当时透露]"
          : "[传闻 — 你听说的关于死者的事；当警官问起你和死者关系、或问你怀疑谁时，问到第二三句再说出来]";
        return `  - ${f.text}\n    ${tag}`;
      }).join("\n")
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
