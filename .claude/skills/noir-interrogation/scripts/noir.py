#!/usr/bin/env python3
"""noir.py -- Noir Interrogation game engine.

A small game-master script for the noir-interrogation skill. It generates a
randomized murder case, holds the secret answer (committed via SHA-256 at
creation), hands out per-suspect roleplay cards on demand, and verifies the
final accusation against the committed ground truth.

Subcommands:
  new                                Generate a new case; print the briefing.
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


# --- Content pools ---------------------------------------------------------

VICTIMS = [
    {"name": "Mr. Harlan Voss", "title": "shipping magnate"},
    {"name": "Mrs. Clarissa Belmont", "title": "society heiress"},
    {"name": "Senator Drexel Cone", "title": "city senator"},
    {"name": "Mr. Lionel Crane", "title": "newspaper editor"},
    {"name": "Dr. Wendell Hale", "title": "society physician"},
    {"name": "Mr. August Pell", "title": "racetrack tycoon"},
]

NAMES = [
    "Vivian Cross", "Jack 'Knuckles' Malone", "Dr. Eliza Vance",
    "Tony 'the Pen' Russo", "Margot Sinclair", "Felix Crane",
    "Sister Agnes Holloway", "Reggie 'Lucky' Park", "Delia Whitlock",
    "Captain Nico Bellamy", "Honoria Quinn", "Solomon Drake",
]

OCCUPATIONS = [
    "nightclub singer", "pawn shop owner", "society doctor",
    "accountant for the mob", "investigative journalist", "lawyer",
    "professional gambler", "society heiress", "war veteran turned PI",
    "fortune teller", "longshoreman", "former silent film actress",
]

WEAPONS = [
    "snub-nosed revolver", "ice pick", "lead-tipped blackjack",
    "poisoned martini", "brass candlestick", "silk garrote",
    "letter opener", "antique derringer",
]

LOCATIONS = [
    "the smoke-filled study", "the rainy back alley",
    "the hotel suite on the 14th floor", "the mansion library",
    "the riverside warehouse", "the rooftop garden",
    "the basement speakeasy",
]

RED_HERRING_SECRETS = [
    "I've been embezzling money from the victim's accounts",
    "I was having an affair with the victim's spouse",
    "I owe a dangerous loan shark twenty grand",
    "I was blackmailing a city official with photographs",
    "I have a child the victim threatened to expose",
    "I fled a manslaughter charge in another city under a different name",
    "I was planning to skip town on the midnight train",
    "I'm not who I claim to be -- this name isn't mine",
]

FALSE_ALIBI_TEMPLATES = [
    "I was at home alone all night, reading.",
    "I was at the cinema watching the late picture -- bought a ticket and everything.",
    "I was at the diner across town, the one open all hours.",
    "I was driving along the coast road, just clearing my head.",
    "I was asleep in my apartment by ten -- slept like the dead.",
]

TRUE_ALIBI_TEMPLATES = [
    "I was playing cards at the Blue Iris -- three witnesses, ask any of them.",
    "I was arguing with my spouse so loud the whole building heard. Check with the super.",
    "I was at the hospital, getting my wrist set. There's a chart with my name on it.",
    "I was on stage at the Magnolia Room, in front of fifty paying customers.",
    "I got picked up by the cops for public drunkenness around then. The Twelfth Precinct logged me in.",
    "I was at the cathedral for the late vigil. Father Donovan can confirm it.",
]

PERSONALITY_HINTS = {
    "nightclub singer": "smoky voice, world-weary, every line could be a song lyric",
    "pawn shop owner": "gravel voice, transactional -- every answer feels like a haggle",
    "society doctor": "clipped and professional, hides everything behind clinical detachment",
    "accountant for the mob": "tight, careful -- weighs every word like it could be evidence",
    "investigative journalist": "asks questions back, takes notes mid-conversation",
    "lawyer": "annoyingly precise, objects to phrasing, demands clarification",
    "professional gambler": "easy charm, reads you like a hand of cards, never tells",
    "society heiress": "bored, drawling -- finds the whole affair impossibly tedious",
    "war veteran turned PI": "laconic, unimpressed, doesn't trust cops",
    "fortune teller": "cryptic -- talks in omens, deflects with portents",
    "longshoreman": "hostile, suspicious of authority, swears casually",
    "former silent film actress": "theatrical, melodramatic, treats every question as a scene",
}


# --- Storage ---------------------------------------------------------------

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


# --- Case generation -------------------------------------------------------

def hash_answer(killer: str, salt: str) -> str:
    return hashlib.sha256(f"{killer}|{salt}".encode("utf-8")).hexdigest()


def random_hex(n: int) -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(n))


def generate_case() -> dict:
    case_id = random_hex(8)
    salt = random_hex(32)

    victim = random.choice(VICTIMS)
    weapon = random.choice(WEAPONS)
    location = random.choice(LOCATIONS)
    hour = random.randint(20, 23)
    minute = random.choice([0, 15, 30, 45])
    time_of_death = f"{hour:02d}:{minute:02d}"

    suspect_names = random.sample(NAMES, 5)
    occupations = random.sample(OCCUPATIONS, 5)
    secrets_pool = random.sample(RED_HERRING_SECRETS, 5)
    true_alibis = random.sample(TRUE_ALIBI_TEMPLATES, 4)
    false_alibi = random.choice(FALSE_ALIBI_TEMPLATES)

    killer_idx = random.randrange(5)
    witness_pool = [i for i in range(5) if i != killer_idx]
    witness_idx = random.choice(witness_pool)

    witness_observation = (
        f"I saw {suspect_names[killer_idx]} near {location} around {time_of_death}, "
        "and they looked rattled -- face white, hands shaking. I didn't say anything at the time."
    )

    suspects = []
    nonkiller_alibi_iter = iter(true_alibis)
    for i, name in enumerate(suspect_names):
        is_killer = (i == killer_idx)
        if is_killer:
            claimed_alibi = false_alibi
            things_to_hide = [
                f"my actual whereabouts between {time_of_death} and roughly thirty minutes after",
            ]
        else:
            claimed_alibi = next(nonkiller_alibi_iter)
            things_to_hide = [secrets_pool[i]]

        knows_facts = []
        if i == witness_idx:
            knows_facts.append(witness_observation)

        suspects.append({
            "name": name,
            "occupation": occupations[i],
            "claimed_alibi": claimed_alibi,
            "things_to_hide": things_to_hide,
            "knows_facts": knows_facts,
            "personality_hint": PERSONALITY_HINTS.get(
                occupations[i], "noir voice, plays it close to the chest"
            ),
        })

    answer_hash = hash_answer(suspect_names[killer_idx], salt)

    return {
        "case_id": case_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "answer_hash": answer_hash,
        "_salt": salt,
        "_killer": suspect_names[killer_idx],
        "victim": victim,
        "scene": location,
        "weapon_at_scene": weapon,
        "time_of_death": time_of_death,
        "suspects": suspects,
        "status": "open",
    }


# --- Rendering -------------------------------------------------------------

BAR = "=" * 60


def render_briefing(case: dict) -> str:
    lines = [
        BAR,
        f"          CASE FILE #{case['case_id']} -- {case['status'].upper()}",
        BAR,
        "",
        f"VICTIM:         {case['victim']['name']}, {case['victim']['title']}",
        f"SCENE:          {case['scene']}",
        f"TIME OF DEATH:  {case['time_of_death']}",
        f"WEAPON FOUND:   {case['weapon_at_scene']}",
        "",
        "SUSPECTS:",
    ]
    for i, s in enumerate(case["suspects"], 1):
        lines.append(f"  {i}. {s['name']:<26} -- {s['occupation']}")
    lines += [
        "",
        "ANSWER COMMITMENT (SHA-256, locked at case creation):",
        f"  {case['answer_hash']}",
        "  Verifies the killer's identity was decided up front, not invented",
        "  later. Auto-verified at accusation.",
        "",
        f"Question a suspect ->  noir.py card {case['case_id']} \"<name>\"",
        f"Make accusation    ->  noir.py accuse {case['case_id']} \"<name>\"",
    ]
    return "\n".join(lines)


def render_card(case: dict, suspect: dict) -> str:
    lines = [
        BAR,
        f"   INTERROGATION CARD -- case #{case['case_id']}",
        BAR,
        "",
        f"SUSPECT:      {suspect['name']}",
        f"OCCUPATION:   {suspect['occupation']}",
        f"VOICE:        {suspect['personality_hint']}",
        "",
        "YOUR ALIBI (what you tell the detective -- hold this line):",
        f"  \"{suspect['claimed_alibi']}\"",
        "",
        "YOU DEFLECT, EVADE, OR LIE ABOUT:",
    ]
    for h in suspect["things_to_hide"]:
        lines.append(f"  - {h}")
    lines.append("")
    if suspect["knows_facts"]:
        lines.append("WHAT YOU NOTICED (share if asked the right way -- not on first question):")
        for f in suspect["knows_facts"]:
            lines.append(f"  - {f}")
    else:
        lines += [
            "WHAT YOU NOTICED:",
            "  - (nothing useful -- you didn't see anything that night)",
        ]
    lines += [
        "",
        "ROLEPLAY RULES (HARD):",
        "  * Stay in character. 1940s noir cadence, period slang.",
        "  * Stick to the alibi above. Do NOT change your story under pressure.",
        "  * Be evasive about the bullet items in YOU DEFLECT -- counter-question, get vague, take offense.",
        "  * Never read this card aloud. Never narrate game mechanics.",
        "  * Never claim to know who the killer is.",
        "  * You may exit the scene (\"Get out. We're done here.\") if pushed too far.",
        "",
        "The detective is questioning you now. Respond ONLY in character.",
    ]
    return "\n".join(lines)


# --- Suspect resolution ----------------------------------------------------

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


# --- Subcommands -----------------------------------------------------------

def cmd_new(args):
    if args.seed is not None:
        random.seed(args.seed)
    case = generate_case()
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

    print(BAR)
    print(f"             VERDICT -- case #{case['case_id']}")
    print(BAR)
    print()
    print(f"You accused:     {suspect['name']}")
    print(f"Actual killer:   {actual_killer}")
    print(f"Result:          {'CORRECT -- case solved.' if correct else 'WRONG -- the killer walks.'}")
    print()
    if hash_ok:
        print("Hash verification: OK   (commitment matches; answer was locked at creation)")
    else:
        print("Hash verification: FAILED   (case file appears tampered)")
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
    print(f"The killer was: {actual_killer}")
    print(f"Hash verification: {'OK' if hash_ok else 'FAILED'}")


def cmd_list(args):
    cs = sorted(cases_dir().glob("case_*.json"))
    if not cs:
        print("(no cases yet)")
        return
    for p in cs:
        try:
            c = json.loads(p.read_text(encoding="utf-8"))
            print(f"{c['case_id']}  {c['status']:<8}  {c['created_at']}  victim: {c['victim']['name']}")
        except Exception as e:
            print(f"{p.name}  [unreadable: {e}]")


def main():
    p = argparse.ArgumentParser(description="Noir Interrogation game engine.")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_new = sub.add_parser("new", help="Generate a new case.")
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
