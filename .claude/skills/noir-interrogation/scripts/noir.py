#!/usr/bin/env python3
"""noir.py -- Noir Interrogation game engine.

A small game-master script for the noir-interrogation skill. It generates a
randomized murder case, holds the secret answer (committed via SHA-256 at
creation), hands out per-suspect roleplay cards on demand, and verifies the
final accusation against the committed ground truth.

Two parallel content worlds:
  * EN  -- 1940s American noir
  * ZH  -- 1930s Republican-era Shanghai noir (民国上海)

Three difficulty levels:
  * easy   -- 3 suspects, witness clue only
  * normal -- 5 suspects, witness clue + a motive leaker
  * hard   -- 5 suspects, witness clue + motive leaker + a misleading
              second witness who names the wrong person (player must
              cross-check alibis)

Subcommands:
  new [--lang en|zh] [--difficulty easy|normal|hard] [--seed N]
                                     Generate a new case; print the briefing.
  briefing <case_id>                 Re-print an existing case briefing.
  card <case_id> <suspect_name>      Print one suspect's interrogation card.
  accuse <case_id> <suspect_name>    Submit accusation; reveal verdict.
  reveal <case_id>                   Forfeit and reveal the killer.
  list                               List existing cases.

State is written as JSON under ./cases/ (override with NOIR_CASES_DIR).
"""

import argparse
import hashlib
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

# On Windows the default console codepage (GBK on Chinese systems, cp1252 on
# Western) mangles our bilingual output. Force UTF-8 so Chinese suspect names
# and prompts display correctly when invoked from cmd or PowerShell.
if os.name == "nt":
    try:
        os.system("chcp 65001 > nul 2>&1")
    except Exception:
        pass
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


# =====================================================================
# Bilingual content
# =====================================================================

VICTIMS = {
    "en": [
        {"name": "Mr. Harlan Voss",       "title": "shipping magnate"},
        {"name": "Mrs. Clarissa Belmont", "title": "society heiress"},
        {"name": "Senator Drexel Cone",   "title": "city senator"},
        {"name": "Mr. Lionel Crane",      "title": "newspaper editor"},
        {"name": "Dr. Wendell Hale",      "title": "society physician"},
        {"name": "Mr. August Pell",       "title": "racetrack tycoon"},
    ],
    "zh": [
        {"name": "沈鹤鸣",     "title": "航运大亨"},
        {"name": "白雪卿夫人", "title": "名媛"},
        {"name": "周沧海",     "title": "参议员"},
        {"name": "陆云飞",     "title": "《申报》主笔"},
        {"name": "石伯安",     "title": "济世医院院长"},
        {"name": "苏永盛",     "title": "跑马场老板"},
    ],
}

# Paired (name, occupation) tuples -- a name like "Dr. Eliza Vance" is
# always a doctor, never a longshoreman.
SUSPECTS = {
    "en": [
        ("Vivian Cross",            "nightclub singer"),
        ("Dr. Eliza Vance",         "society doctor"),
        ("Tony 'the Pen' Russo",    "accountant for the mob"),
        ("Captain Nico Bellamy",    "war veteran turned PI"),
        ("Sister Agnes Holloway",   "fortune teller"),
        ("Solomon Drake",           "lawyer"),
        ("Margot Sinclair",         "investigative journalist"),
        ("Honoria Quinn",           "society heiress"),
        ("Reggie 'Lucky' Park",     "professional gambler"),
        ("Jack 'Knuckles' Malone",  "longshoreman"),
        ("Delia Whitlock",          "former silent film actress"),
        ("Felix Crane",             "pawn shop owner"),
        ("Eddie 'the Mick' Donovan","speakeasy bartender"),
        ("Hank 'Iron Jaw' Brennan", "retired prizefighter"),
        ("Trudy Beck",              "night-shift cab driver"),
        ("The Great Mortimer",      "stage magician"),
        ("Ezra Pendleton",          "mortician"),
        ("Lila 'Diamond' Vega",     "fence"),
        ("Kit Granger",             "society photographer"),
        ("Henry Quill",             "insurance investigator"),
    ],
    "zh": [
        ("红玫",       "百乐门舞女"),
        ("李白驹医生", "济世名医"),
        ("韩三爷",     "帮派账房"),
        ("钱师爷",     "法租界律师"),
        ("静安姑姑",   "茶楼算命先生"),
        ("关云鹤",     "退伍宪兵转私家侦探"),
        ("唐慧君",     "上海名媛"),
        ("杜小六",     "跑马场赌客"),
        ("阿九",       "码头脚行"),
        ("严雪松",     "申报记者"),
        ("陶宜君",     "默片影后"),
        ("姚月笙",     "当铺老板"),
        ("石阿全",     "百乐门吧台师傅"),
        ("齐铁拳",     "拳馆教头"),
        ("拐子贵",     "黄包车夫"),
        ("鬼手刘",     "大世界戏法师"),
        ("孙阴先生",   "义庄先生"),
        ("雪花姐",     "黑市掮客"),
        ("苏美君",     "画报摄影师"),
        ("卢敬安",     "古董行掌柜"),
    ],
}

WEAPONS = {
    "en": [
        "snub-nosed revolver", "ice pick", "lead-tipped blackjack",
        "poisoned martini", "brass candlestick", "silk garrote",
        "letter opener", "antique derringer",
    ],
    "zh": [
        "短管左轮", "冰锥", "包铅警棍", "下了药的鸡尾酒",
        "黄铜烛台", "丝绳", "拆信刀", "古董袖珍枪",
    ],
}

LOCATIONS = {
    "en": [
        "the smoke-filled study", "the rainy back alley",
        "the hotel suite on the 14th floor", "the mansion library",
        "the riverside warehouse", "the rooftop garden",
        "the basement speakeasy",
    ],
    "zh": [
        "烟雾弥漫的法租界书房", "雨夜的十里洋场后弄堂",
        "国际饭店十四楼客房", "公馆藏书阁",
        "黄浦江边仓库", "屋顶花园", "地下舞厅",
    ],
}

RED_HERRING_SECRETS = {
    "en": [
        "the victim had caught me out in something I'd rather no one knew, and I lived in dread he'd talk",
        "I was having an affair with the victim's spouse",
        "I owe a dangerous loan shark twenty grand",
        "I was blackmailing a city official with photographs",
        "I have a child the victim threatened to expose",
        "I fled a manslaughter charge in another city under a different name",
        "I was planning to skip town on the midnight train",
        "I'm not who I claim to be -- this name isn't mine",
    ],
    "zh": [
        "死者抓到了我做过的一件不光彩的事，我怕他抖出去",
        "我和死者的太太有私情",
        "我欠了大流氓两万银元",
        "我捏着市府某老爷的把柄在敲他",
        "我有个私生子，死者扬言要曝光",
        "我在外埠犯过过失杀人，改名跑到上海的",
        "我准备搭今晚的夜班船潜逃出海",
        "我用的是假名，根本不是这身份",
    ],
}

FALSE_ALIBIS = {
    "en": [
        "I was at home alone all night, reading.",
        "I was at the cinema watching the late picture -- bought a ticket and everything.",
        "I was at the diner across town, the one open all hours.",
        "I was walking the river road alone, just clearing my head.",
        "I was asleep in my apartment by ten -- slept like the dead.",
    ],
    "zh": [
        "我那晚一个人在家看书。",
        "我在大光明戏院看夜场，戏票还在。",
        "我去了法租界那家通宵小馆子。",
        "我一个人沿着霞飞路走到深夜，散心。",
        "我十点多就睡了，跟死了一样。",
    ],
}

# All true alibis must be plausible for ANY occupation. Avoid
# occupation-specific stories (e.g. "on stage at the club") which break
# immersion when assigned to a journalist or doctor.
TRUE_ALIBIS = {
    "en": [
        "I was playing cards at the Blue Iris -- three witnesses, ask any of them.",
        "I was arguing with my spouse so loud the whole building heard. Check with the super.",
        "I was at the hospital, getting my wrist set. There's a chart with my name on it.",
        "I was at a private supper at the Sterling estate -- six guests will vouch, and the butler signed me in.",
        "I got picked up by the cops for public drunkenness around then. The Twelfth Precinct logged me in.",
        "I was at the cathedral for the late vigil. Father Donovan can confirm it.",
    ],
    "zh": [
        "我在百乐门打牌，三个证人，您随便问。",
        "我和我家那位大吵大闹整层楼都听见了，您问门房。",
        "我在公济医院打石膏，挂号单上有名字。",
        "我在静安寺路一位夫人家里赴晚宴，宾客六七位都见过我，主家可以作证。",
        "那时候我被巡捕房拘了一晚上，记录在案。",
        "我在静安寺参加晚课，住持师傅可以作证。",
    ],
}

PERSONALITIES = {
    "en": {
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
    "zh": {
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
}

# Motive: a non-killer non-witness suspect leaks context about the
# victim's troubles. The leak does NOT name the killer; it adds narrative
# depth + a second flavor of clue. The killer's card meanwhile gains a
# second deflection topic tied to the motive.
MOTIVES = {
    "en": {
        "blackmail": {
            "leak": lambda v: f"{v['name']} had been quietly blackmailed for months. He never said by whom -- it was eating at him, though. You could see it.",
            "killer_hide": "the nature of any private arrangement I had with the deceased",
        },
        "jealousy": {
            "leak": lambda v: f"Bad blood between {v['name']} and someone close to the household. Heard a row a week ago, ugly stuff. Personal.",
            "killer_hide": "my personal feelings about anyone in the victim's household",
        },
        "inheritance": {
            "leak": lambda v: f"{v['name']} changed his will recently. Lawyers in and out for two solid weeks. Somebody stood to gain.",
            "killer_hide": "any financial connection I had to the deceased's estate",
        },
        "debt": {
            "leak": lambda v: f"{v['name']} was calling in old debts hard the last few months. People who owed him were spooked.",
            "killer_hide": "any money I might have owed the deceased",
        },
        "coverup": {
            "leak": lambda v: f"{v['name']} had been digging into something dark. Someone's past, I think. He wouldn't say whose.",
            "killer_hide": "what the victim may have been investigating about me",
        },
        "revenge": {
            "leak": lambda v: f"{v['name']} ruined someone, years back. The kind of wound people don't forget.",
            "killer_hide": "any old grudge I might have had with the deceased",
        },
        "exposure": {
            "leak": lambda v: f"{v['name']} was about to print something. A society piece. Career-ender, by the sound of it.",
            "killer_hide": "anything the victim might have known about my private life",
        },
    },
    "zh": {
        "blackmail": {
            "leak": lambda v: f"{v['name']} 这阵子一直被人暗里敲诈，他没说是谁，可脸色一天比一天差，看得出是憋着事。",
            "killer_hide": "我和死者之间某种私下的安排",
        },
        "jealousy": {
            "leak": lambda v: f"{v['name']} 和他家里某个人之间有点不清不楚，上礼拜还吵过一架，难听话都出来了。",
            "killer_hide": "我对死者家中某人的私人感情",
        },
        "inheritance": {
            "leak": lambda v: f"{v['name']} 最近改过遗嘱，律师两个礼拜进进出出，明摆着有人能从他那儿分到一大笔。",
            "killer_hide": "我和死者那笔遗产之间有什么牵连",
        },
        "debt": {
            "leak": lambda v: f"{v['name']} 这几个月在死命追讨旧账，欠他钱的人个个都不安生。",
            "killer_hide": "我有没有欠过死者钱",
        },
        "coverup": {
            "leak": lambda v: f"{v['name']} 这阵在挖某件陈年烂事，挖谁的不知道，他自己讳莫如深。",
            "killer_hide": "死者也许正在查我什么",
        },
        "revenge": {
            "leak": lambda v: f"{v['name']} 当年毁过一个人，那种事，能记一辈子。",
            "killer_hide": "我和死者之间有没有什么陈年恩怨",
        },
        "exposure": {
            "leak": lambda v: f"{v['name']} 这两天准备在《申报》上抖出谁的丑事，登出来够要谁的命。",
            "killer_hide": "死者也许知道我什么不能见光的事",
        },
    },
}


def witness_fact(lang, killer, location, tod):
    if lang == "zh":
        return (
            f"我看见 {killer} 在 {tod} 前后，在 {location} 附近，"
            "脸都白了，手也抖。当时我没敢出声。"
        )
    return (
        f"I saw {killer} near {location} around {tod}, "
        "and they looked rattled -- face white, hands shaking. "
        "I didn't say anything at the time."
    )


def killer_hide(lang, tod):
    if lang == "zh":
        return f"案发时间 {tod} 到大约半小时之后，我到底在哪里"
    return f"my actual whereabouts between {tod} and roughly thirty minutes after"


# =====================================================================
# Difficulty
# =====================================================================

DIFFICULTY = {
    "easy":   {"suspects": 3, "add_witness": True,  "add_motive": False, "add_false_witness": False},
    "normal": {"suspects": 5, "add_witness": True,  "add_motive": True,  "add_false_witness": False},
    "hard":   {"suspects": 5, "add_witness": True,  "add_motive": True,  "add_false_witness": True},
}


# =====================================================================
# Storage
# =====================================================================

def cases_dir() -> Path:
    p = Path(os.environ.get("NOIR_CASES_DIR", "cases"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def case_path(case_id: str) -> Path:
    return cases_dir() / f"case_{case_id}.json"


def save_case(case: dict) -> None:
    case_path(case["case_id"]).write_text(
        json.dumps(case, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def load_case(case_id: str) -> dict:
    p = case_path(case_id)
    if not p.exists():
        sys.exit(f"No such case: {case_id}. (List existing cases with `noir.py list`.)")
    return json.loads(p.read_text(encoding="utf-8"))


# =====================================================================
# Case generation
# =====================================================================

def hash_answer(killer: str, salt: str) -> str:
    return hashlib.sha256(f"{killer}|{salt}".encode("utf-8")).hexdigest()


def random_hex(n: int) -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(n))


def generate_case(lang: str = "en", difficulty: str = "normal") -> dict:
    if lang not in ("en", "zh"):
        lang = "en"
    if difficulty not in DIFFICULTY:
        difficulty = "normal"
    cfg = DIFFICULTY[difficulty]
    n = cfg["suspects"]

    case_id = random_hex(8)
    salt = random_hex(32)

    victim = random.choice(VICTIMS[lang])
    weapon = random.choice(WEAPONS[lang])
    location = random.choice(LOCATIONS[lang])
    hour = random.randint(20, 23)
    minute = random.choice([0, 15, 30, 45])
    time_of_death = f"{hour:02d}:{minute:02d}"

    sampled = random.sample(SUSPECTS[lang], n)
    suspect_names = [s[0] for s in sampled]
    occupations = [s[1] for s in sampled]
    secrets_pool = random.sample(RED_HERRING_SECRETS[lang], n)
    true_alibis = random.sample(TRUE_ALIBIS[lang], n - 1)
    false_alibi = random.choice(FALSE_ALIBIS[lang])

    all_idx = list(range(n))
    killer_idx = random.randrange(n)

    # Witness: a non-killer who saw the killer.
    witness_idx = None
    if cfg["add_witness"]:
        pool = [i for i in all_idx if i != killer_idx]
        witness_idx = random.choice(pool)

    # Motive leaker: a non-killer non-witness who knows about the
    # victim's troubles. (Leak doesn't name the killer.)
    motive_type = None
    motive_leaker_idx = None
    if cfg["add_motive"]:
        motive_type = random.choice(list(MOTIVES[lang].keys()))
        pool = [i for i in all_idx if i != killer_idx and i != witness_idx]
        if pool:
            motive_leaker_idx = random.choice(pool)

    # False witness (Hard mode): claims to have seen a DIFFERENT
    # non-killer at the scene -- a red-herring accusation. Solved by
    # cross-checking the wrongly-named suspect's alibi.
    false_witness_idx = None
    falsely_accused_idx = None
    if cfg["add_false_witness"]:
        fw_pool = [i for i in all_idx
                   if i != killer_idx and i != witness_idx and i != motive_leaker_idx]
        if fw_pool:
            false_witness_idx = random.choice(fw_pool)
            target_pool = [i for i in all_idx
                           if i != killer_idx and i != false_witness_idx and i != witness_idx]
            if target_pool:
                falsely_accused_idx = random.choice(target_pool)

    killer_name = suspect_names[killer_idx]
    suspects = []
    nonkiller_alibi_iter = iter(true_alibis)
    for i, name in enumerate(suspect_names):
        is_killer = (i == killer_idx)
        if is_killer:
            claimed_alibi = false_alibi
            things_to_hide = [killer_hide(lang, time_of_death)]
            if motive_type:
                things_to_hide.append(MOTIVES[lang][motive_type]["killer_hide"])
        else:
            claimed_alibi = next(nonkiller_alibi_iter)
            things_to_hide = [secrets_pool[i]]

        knows_facts = []
        if i == witness_idx:
            knows_facts.append({
                "type": "witness",
                "text": witness_fact(lang, killer_name, location, time_of_death),
                "_named_suspect": killer_name,
            })
        if i == motive_leaker_idx:
            knows_facts.append({
                "type": "motive",
                "text": MOTIVES[lang][motive_type]["leak"](victim),
            })
        if i == false_witness_idx and falsely_accused_idx is not None:
            knows_facts.append({
                "type": "witness",
                "text": witness_fact(lang, suspect_names[falsely_accused_idx], location, time_of_death),
                "_named_suspect": suspect_names[falsely_accused_idx],
                "_false": True,
            })

        suspects.append({
            "name": name,
            "occupation": occupations[i],
            "claimed_alibi": claimed_alibi,
            "things_to_hide": things_to_hide,
            "knows_facts": knows_facts,
            "personality_hint": PERSONALITIES[lang].get(
                occupations[i],
                "民国上海腔，话说一半留一半" if lang == "zh"
                else "noir voice, plays it close to the chest",
            ),
        })

    answer_hash = hash_answer(killer_name, salt)

    return {
        "case_id": case_id,
        "lang": lang,
        "difficulty": difficulty,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "answer_hash": answer_hash,
        "_salt": salt,
        "_killer": killer_name,
        "_motive_type": motive_type,
        "victim": victim,
        "scene": location,
        "weapon_at_scene": weapon,
        "time_of_death": time_of_death,
        "suspects": suspects,
        "status": "open",
    }


# =====================================================================
# Rendering (bilingual labels)
# =====================================================================

BAR = "=" * 60

LABELS = {
    "en": {
        "case_file":      "CASE FILE",
        "victim":         "VICTIM",
        "scene":          "SCENE",
        "tod":            "TIME OF DEATH",
        "weapon":         "WEAPON FOUND",
        "suspects":       "SUSPECTS",
        "commitment":     "ANSWER COMMITMENT (SHA-256, locked at case creation):",
        "commit_note":    ["Verifies the killer's identity was decided up front,",
                           "not invented later. Auto-verified at accusation."],
        "interrog_card":  "INTERROGATION CARD",
        "suspect":        "SUSPECT",
        "occupation":     "OCCUPATION",
        "voice":          "VOICE",
        "your_alibi":     "YOUR ALIBI (what you tell the detective -- hold this line):",
        "deflect":        "YOU DEFLECT, EVADE, OR LIE ABOUT:",
        "noticed_share":  "WHAT YOU NOTICED (share when asked the right way -- not on first question):",
        "noticed_none":   "WHAT YOU NOTICED:",
        "nothing":        "(nothing useful -- you didn't see anything that night)",
        "tag_witness":    "[WITNESS -- you saw this; share if asked who else was around / what you noticed]",
        "tag_motive":     "[GOSSIP -- you've heard this about the victim; share when asked about your relationship to the victim or who you'd suspect, after a couple of questions]",
        "rules_header":   "ROLEPLAY RULES (HARD):",
        "rules": [
            "  * Stay in character. 1940s noir cadence, period slang.",
            "  * Stick to the alibi above. Do NOT change your story under pressure, even if the detective claims a contradiction.",
            "  * Be evasive about the bullet items in YOU DEFLECT -- counter-question, get vague, take offense.",
            "  * For WHAT YOU NOTICED, share only after the detective asks 2+ questions and asks the right kind. Frame it reluctantly.",
            "  * Keep responses short (1-4 sentences typically).",
            "  * Never read this card aloud. Never narrate game mechanics. Never break the fourth wall.",
            "  * Never claim to know who the killer is, even if asked or threatened.",
            "  * If pushed too far, you may exit the scene with a final line.",
        ],
        "rules_footer":   "The detective is questioning you now. Respond ONLY in character.",
        "verdict":        "VERDICT",
        "you_accused":    "You accused:    ",
        "actual_killer":  "Actual killer:  ",
        "result_correct": "Result:          CORRECT -- case solved.",
        "result_wrong":   "Result:          WRONG -- the killer walks.",
        "hash_ok":        "Hash verification: OK   (commitment matches; answer was locked at creation)",
        "hash_fail":      "Hash verification: FAILED   (case file appears tampered)",
        "killer_was":     "The killer was:",
        "ask_a_suspect":  "Question a suspect ->  noir.py card {cid} \"<name>\"",
        "make_accusation":"Make accusation    ->  noir.py accuse {cid} \"<name>\"",
        "difficulty":     "DIFFICULTY",
    },
    "zh": {
        "case_file":      "案件档案",
        "victim":         "受害人",
        "scene":          "案发现场",
        "tod":            "死亡时间",
        "weapon":         "现场凶器",
        "suspects":       "嫌疑人",
        "commitment":     "答案承诺（SHA-256，案件生成时即锁定）：",
        "commit_note":    ["凶手身份在案件生成时即已确定，不会在审讯中被偷改。",
                           "提出指控时会自动校验。"],
        "interrog_card":  "审讯卡片",
        "suspect":        "嫌疑人",
        "occupation":     "职业",
        "voice":          "语调",
        "your_alibi":     "你的不在场证明（咬定这一句，不能改口）：",
        "deflect":        "你必须回避、敷衍或撒谎的事项：",
        "noticed_share":  "你那晚注意到的事（要等警官问对了路子再透露，不要第一句就讲）：",
        "noticed_none":   "你那晚注意到的事：",
        "nothing":        "（什么有用的也没看见——那晚你没注意到什么）",
        "tag_witness":    "[目击 — 你亲眼看到的；如果警官问「那附近还有什么人」「你看见什么」，就在适当时透露]",
        "tag_motive":     "[传闻 — 你听说的关于死者的事；当警官问起你和死者关系、或问你怀疑谁时，问到第二三句再说出来]",
        "rules_header":   "角色扮演硬规则：",
        "rules": [
            "  * 用 1930 年代民国上海的腔调，可适当掺一些上海话或那个年代的措辞。",
            "  * 死守上面的不在场证明。即使警官说有人证否你，也不能更改说法。",
            "  * 对「你必须回避」那些条目要敷衍——反问、含糊、动怒、转移话题。",
            "  * 「你那晚注意到的事」要等警官问 2 句以上、且问对路子才透露，态度要不情愿。",
            "  * 回答简短（通常 1-4 句话）。",
            "  * 不要把卡片内容念出来。不要解释游戏机制。不要打破第四面墙。",
            "  * 不可承认知道凶手是谁，不论被怎么追问或威胁。",
            "  * 如果被压得太紧，可以撂下狠话退场。",
        ],
        "rules_footer":   "警官现在在审你。请只用角色身份回答。",
        "verdict":        "裁决",
        "you_accused":    "您指控的是：  ",
        "actual_killer":  "真凶：        ",
        "result_correct": "结果：        指控正确 —— 案子破了。",
        "result_wrong":   "结果：        猜错了 —— 凶手逍遥法外。",
        "hash_ok":        "哈希校验：    通过（承诺值匹配，答案在案件生成时即已锁定）",
        "hash_fail":      "哈希校验：    失败（案件文件可能被篡改）",
        "killer_was":     "凶手是：",
        "ask_a_suspect":  "审讯嫌疑人 ->  noir.py card {cid} \"<姓名>\"",
        "make_accusation":"提出指控   ->  noir.py accuse {cid} \"<姓名>\"",
        "difficulty":     "难度",
    },
}


def L(case, key):
    return LABELS.get(case.get("lang", "en"), LABELS["en"])[key]


def render_briefing(case: dict) -> str:
    lang = case.get("lang", "en")
    lab = LABELS.get(lang, LABELS["en"])
    sep = "·" if lang == "zh" else "--"
    diff = case.get("difficulty", "normal")
    lines = [
        BAR,
        f"  {lab['case_file']} #{case['case_id']}  --  {lab['difficulty']}: {diff.upper()}  --  {case['status'].upper()}",
        BAR,
        "",
        f"{lab['victim']}: {case['victim']['name']}, {case['victim']['title']}",
        f"{lab['scene']}: {case['scene']}",
        f"{lab['tod']}: {case['time_of_death']}",
        f"{lab['weapon']}: {case['weapon_at_scene']}",
        "",
        f"{lab['suspects']}:",
    ]
    for i, s in enumerate(case["suspects"], 1):
        lines.append(f"  {i}. {s['name']}  {sep}  {s['occupation']}")
    lines += [
        "",
        lab["commitment"],
        f"  {case['answer_hash']}",
    ]
    for note in lab["commit_note"]:
        lines.append(f"  {note}")
    lines += [
        "",
        lab["ask_a_suspect"].format(cid=case["case_id"]),
        lab["make_accusation"].format(cid=case["case_id"]),
    ]
    return "\n".join(lines)


def render_card(case: dict, suspect: dict) -> str:
    lang = case.get("lang", "en")
    lab = LABELS.get(lang, LABELS["en"])
    lines = [
        BAR,
        f"  {lab['interrog_card']}  --  {lab['case_file']} #{case['case_id']}",
        BAR,
        "",
        f"{lab['suspect']}:    {suspect['name']}",
        f"{lab['occupation']}: {suspect['occupation']}",
        f"{lab['voice']}:      {suspect['personality_hint']}",
        "",
        lab["your_alibi"],
        f'  "{suspect["claimed_alibi"]}"',
        "",
        lab["deflect"],
    ]
    for h in suspect["things_to_hide"]:
        lines.append(f"  - {h}")
    lines.append("")
    if suspect["knows_facts"]:
        lines.append(lab["noticed_share"])
        for f in suspect["knows_facts"]:
            tag = lab["tag_witness"] if f["type"] == "witness" else lab["tag_motive"]
            lines.append(f"  - {f['text']}")
            lines.append(f"    {tag}")
    else:
        lines += [
            lab["noticed_none"],
            f"  - {lab['nothing']}",
        ]
    lines.append("")
    lines.append(lab["rules_header"])
    lines.extend(lab["rules"])
    lines.append("")
    lines.append(lab["rules_footer"])
    return "\n".join(lines)


# =====================================================================
# Suspect resolution
# =====================================================================

def resolve_suspect(case: dict, query: str):
    q = query.strip().lower()
    matches = [s for s in case["suspects"] if q in s["name"].lower()]
    if not matches:
        return None, "No suspect matches '{}'. Suspects: {}".format(
            query, ", ".join(s["name"] for s in case["suspects"])
        )
    if len(matches) > 1:
        return None, "'{}' is ambiguous. Matches: {}".format(
            query, ", ".join(s["name"] for s in matches)
        )
    return matches[0], None


# =====================================================================
# Subcommands
# =====================================================================

def cmd_new(args):
    if args.seed is not None:
        random.seed(args.seed)
    case = generate_case(lang=args.lang, difficulty=args.difficulty)
    save_case(case)
    print(render_briefing(case))


def cmd_briefing(args):
    case = load_case(args.case_id)
    print(render_briefing(case))


def cmd_card(args):
    case = load_case(args.case_id)
    if case["status"] != "open":
        sys.exit(f"Case {args.case_id} is closed ({case['status']}). Start a new case.")
    suspect, err = resolve_suspect(case, args.name)
    if err:
        sys.exit(err)
    print(render_card(case, suspect))


def cmd_accuse(args):
    case = load_case(args.case_id)
    if case["status"] != "open":
        sys.exit(f"Case {args.case_id} is already {case['status']}.")
    suspect, err = resolve_suspect(case, args.name)
    if err:
        sys.exit(err)

    actual_killer = case["_killer"]
    correct = (suspect["name"] == actual_killer)
    expected_hash = hash_answer(actual_killer, case["_salt"])
    hash_ok = (expected_hash == case["answer_hash"])

    case["status"] = "solved" if correct else "failed"
    case["accused"] = suspect["name"]
    case["closed_at"] = datetime.now(timezone.utc).isoformat()
    save_case(case)

    lang = case.get("lang", "en")
    lab = LABELS.get(lang, LABELS["en"])

    print(BAR)
    print(f"             {lab['verdict']}  --  {lab['case_file']} #{case['case_id']}")
    print(BAR)
    print()
    print(f"{lab['you_accused']}{suspect['name']}")
    print(f"{lab['actual_killer']}{actual_killer}")
    print(lab["result_correct"] if correct else lab["result_wrong"])
    print()
    print(lab["hash_ok"] if hash_ok else lab["hash_fail"])
    print(f"  committed: {case['answer_hash']}")
    print(f"  computed:  {expected_hash}")


def cmd_reveal(args):
    case = load_case(args.case_id)
    actual_killer = case["_killer"]
    expected_hash = hash_answer(actual_killer, case["_salt"])
    hash_ok = (expected_hash == case["answer_hash"])
    if case["status"] == "open":
        case["status"] = "forfeit"
        case["closed_at"] = datetime.now(timezone.utc).isoformat()
        save_case(case)
    lang = case.get("lang", "en")
    lab = LABELS.get(lang, LABELS["en"])
    print(f"{lab['killer_was']} {actual_killer}")
    print(lab["hash_ok"] if hash_ok else lab["hash_fail"])


def cmd_list(args):
    cs = sorted(cases_dir().glob("case_*.json"))
    if not cs:
        print("(no cases yet)")
        return
    for p in cs:
        try:
            c = json.loads(p.read_text(encoding="utf-8"))
            diff = c.get("difficulty", "?")
            lang = c.get("lang", "?")
            print(f"{c['case_id']}  [{lang}/{diff}]  {c['status']:<8}  {c['created_at']}  victim: {c['victim']['name']}")
        except Exception as e:
            print(f"{p.name}  [unreadable: {e}]")


def main():
    p = argparse.ArgumentParser(description="Noir Interrogation game engine.")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_new = sub.add_parser("new", help="Generate a new case.")
    p_new.add_argument("--lang", choices=["en", "zh"], default="en",
                       help="case language (en=1940s American noir, zh=1930s 民国上海)")
    p_new.add_argument("--difficulty", choices=["easy", "normal", "hard"], default="normal",
                       help="easy=3 suspects; normal=5+motive; hard=5+motive+misleading 2nd witness")
    p_new.add_argument("--seed", type=int, default=None,
                       help="(testing only) deterministic RNG seed")
    p_new.set_defaults(func=cmd_new)

    p_b = sub.add_parser("briefing", help="Show case briefing.")
    p_b.add_argument("case_id")
    p_b.set_defaults(func=cmd_briefing)

    p_c = sub.add_parser("card", help="Get a suspect's interrogation card.")
    p_c.add_argument("case_id")
    p_c.add_argument("name")
    p_c.set_defaults(func=cmd_card)

    p_a = sub.add_parser("accuse", help="Accuse a suspect; reveal the verdict.")
    p_a.add_argument("case_id")
    p_a.add_argument("name")
    p_a.set_defaults(func=cmd_accuse)

    p_r = sub.add_parser("reveal", help="Forfeit and reveal the killer.")
    p_r.add_argument("case_id")
    p_r.set_defaults(func=cmd_reveal)

    p_l = sub.add_parser("list", help="List existing cases.")
    p_l.set_defaults(func=cmd_list)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
