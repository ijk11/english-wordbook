#!/usr/bin/env python3
"""Obsidian 영어공부 노트(.md) -> 단어장 앱 데이터(data/cards.json) 변환기.

기본 소스는 repo 안의 source/ 폴더이고, --src 로 Obsidian 볼트 경로를 직접 줄 수도 있다.

    python tools/build_data.py
    python tools/build_data.py --src "D:/iCloud Drive/.../영어공부"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 파일명 -> 덱 정의. 여기 없는 파일은 무시한다(일본어 노트 등).
DECKS = [
    {
        "id": "toeic",
        "name": "TOEIC 단어",
        "short": "TOEIC",
        "desc": "토익 LC/RC 에서 모은 필수 단어와 표현",
        "color": "#5b8cff",
        "files": ["Toeic 영어단어(1).md", "Toeic 영어단어(4).md"],
    },
    {
        "id": "conversation",
        "name": "일상 회화",
        "short": "회화",
        "desc": "원어민이 실제로 쓰는 구어체 표현과 관용구",
        "color": "#f2994a",
        "files": ["회화표현.md"],
    },
    {
        "id": "opic",
        "name": "OPIc 표현",
        "short": "OPIc",
        "desc": "오픽 답변에 바로 얹어 쓰는 자연스러운 표현",
        "color": "#27ae60",
        "files": ["OPIC 영어.md"],
    },
    {
        "id": "speaking",
        "name": "TOEIC Speaking",
        "short": "Speaking",
        "desc": "사진 묘사·동작 표현 (한국어 → 영어 방향 연습용)",
        "color": "#bb6bd9",
        "files": ["Toeic speaking(1).md"],
    },
    {
        "id": "business",
        "name": "실무 영어",
        "short": "실무",
        "desc": "하도급·계약·발표 등 업무 현장에서 쓰는 전문 용어",
        "color": "#eb5757",
        "files": ["전문 실무 영어.md"],
    },
]

HANGUL = re.compile(r"[\uac00-\ud7a3\u3131-\u318e]")
DATE_HEADING = re.compile(r"^#{1,6}\s*(\d{4})[-.](\d{1,2})[-.](\d{1,2})\s*$")
ANY_HEADING = re.compile(r"^(#{1,6})\s*(.+?)\s*$")
HTML_TAG = re.compile(r"<[^>]+>")
BOLD_LEAD = re.compile(r"^\*\*(.+?)\*\*\s*(.*)$", re.S)
BULLET = re.compile(r"^(\s*)[-*+]\s+(.*)$")
TABLE_SEP = re.compile(r"^\|?[\s:\-|]+\|[\s:\-|]*$")


ASCII_WORD = re.compile(r"[A-Za-z]")
KO_PAREN = re.compile(r"\s*[（(]([^()（）]*)[)）]")


def has_hangul(s: str) -> bool:
    return bool(HANGUL.search(s))


def has_english(s: str) -> bool:
    return bool(ASCII_WORD.search(s))


def pull_korean_parens(term: str, meaning: str):
    """표제어에 붙은 한글 괄호 주석(예: 'a wagon(바퀴 4개)')을 뜻 쪽으로 옮긴다."""
    notes = []

    def take(m):
        inner = m.group(1).strip()
        if inner and has_hangul(inner) and not has_english(inner):
            notes.append(inner)
            return ""
        return m.group(0)

    stripped = KO_PAREN.sub(take, term).strip(" ,;/")
    if not notes or not has_english(stripped):
        return term, meaning
    joined = ", ".join(notes)
    meaning = f"{meaning} ({joined})".strip() if meaning else f"({joined})"
    return re.sub(r"\s+", " ", stripped).strip(), meaning


def clean(s: str) -> str:
    """HTML 하이라이트 태그와 옵시디언 문법을 걷어내고 공백을 정리한다."""
    s = HTML_TAG.sub("", s)
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&gt;", ">").replace("&lt;", "<")
    s = s.replace("==", "")
    s = re.sub(r"!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", s)   # [[위키링크]]
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)              # [텍스트](링크)
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[ \t\u00a0]+", " ", s)
    return s.strip()


def strip_emphasis(s: str) -> str:
    return re.sub(r"[*_`]", "", s).strip()


def tidy_term(s: str) -> str:
    s = strip_emphasis(s)
    s = s.strip(" \t:;,-\u2013\u2014")
    return re.sub(r"\s+", " ", s).strip()


def tidy_meaning(s: str) -> str:
    s = strip_emphasis(s)
    s = s.lstrip(" :;-\u2013\u2014")
    return re.sub(r"\s+", " ", s).strip()


def split_entry(line: str):
    """본문 한 줄에서 (영어 표제어, 한국어 뜻)을 뽑아낸다."""
    line = clean(line)
    if not line:
        return None

    m = BOLD_LEAD.match(line)
    if m:
        term, meaning = tidy_term(m.group(1)), tidy_meaning(m.group(2))
        # 원문 강조가 어긋나 "**A vs **B**" 처럼 잘린 경우 다시 붙인다.
        if re.search(r"\bvs$", term, re.I) and meaning:
            term, meaning = f"{term} {meaning}", ""
        if term:
            return pull_korean_parens(term, meaning)

    if ":" in line:
        left, right = line.split(":", 1)
        left, right = tidy_term(left), tidy_meaning(right)
        if left and right:
            # "한국어: English" (Speaking 노트) 는 좌우가 뒤집혀 있다.
            if has_hangul(left) and has_english(right):
                return pull_korean_parens(right, left)
            if not has_hangul(left):
                return pull_korean_parens(left, right)

    stripped = strip_emphasis(line)
    if re.search(r"\bvs\b", stripped, re.I):
        # "Hardly(거의~않다) vs Barely(간신히)" 같은 비교 항목은 쪼개지 않는다.
        return pull_korean_parens(tidy_term(stripped), "")
    if has_hangul(stripped):
        idx = HANGUL.search(stripped).start()
        if idx > 0:
            # "expressway 고속도로" — 첫 한글 앞까지가 표제어.
            return pull_korean_parens(tidy_term(stripped[:idx]), tidy_meaning(stripped[idx:]))
        m = ASCII_WORD.search(stripped)
        if m:
            # "다가가다 approach (전치사 없음)" — 뒤쪽이 순수 영어일 때만 뒤집는다.
            rest = stripped[m.start():]
            if not has_hangul(KO_PAREN.sub("", rest)):
                return pull_korean_parens(tidy_term(rest), tidy_meaning(stripped[:m.start()]))
        return tidy_term(stripped), ""

    term = tidy_term(stripped)
    return (term, "") if term else None


def classify(term: str) -> str:
    words = [w for w in re.split(r"\s+", term) if re.search(r"[A-Za-z]", w)]
    if term.endswith(("?", ".", "!")) or len(words) >= 8:
        return "sentence"
    if len(words) >= 5 and term[:1].isupper():
        return "sentence"
    if len(words) >= 2:
        return "phrase"
    return "word"


def card_id(deck: str, term: str) -> str:
    h = hashlib.sha1(f"{deck}:{term.lower()}".encode("utf-8")).hexdigest()[:10]
    return f"{deck}-{h}"


class Collector:
    def __init__(self) -> None:
        self.cards = {}
        self.order = []
        self.skipped = []

    def add(self, deck: str, term: str, meaning: str, *, date, topic):
        term = term.strip()
        if not term or len(term) > 120:
            self.skipped.append(term)
            return None
        cid = card_id(deck, term)
        card = self.cards.get(cid)
        if card is None:
            card = {
                "id": cid,
                "deck": deck,
                "term": term,
                "meaning": meaning,
                "examples": [],
                "notes": [],
                "type": classify(term),
                "date": date,
                "topic": topic,
            }
            self.cards[cid] = card
            self.order.append(cid)
        else:
            if meaning and meaning not in card["meaning"]:
                if card["meaning"] and card["meaning"] in meaning:
                    card["meaning"] = meaning          # 더 자세한 쪽으로 교체
                elif card["meaning"]:
                    card["meaning"] = f"{card['meaning']}; {meaning}"
                else:
                    card["meaning"] = meaning
            if date and (card["date"] is None or date < card["date"]):
                card["date"] = date
        return card


class Node:
    __slots__ = ("body", "children")

    def __init__(self, body: str):
        self.body = body
        self.children = []


def build_tree(lines):
    """들여쓰기 기준으로 불릿을 트리로 묶는다. (헤딩은 (None, 원문) 으로 흘려보냄)"""
    roots = []
    stack = []   # (indent, node)
    for raw in lines:
        if not raw.strip():
            continue
        expanded = raw.replace("\t", "    ")
        bm = BULLET.match(expanded)
        if not bm:
            if ANY_HEADING.match(raw.strip()):
                roots.append(raw.strip())
                stack = []
            continue
        indent, body = len(bm.group(1)), bm.group(2)
        node = Node(body)
        while stack and stack[-1][0] >= indent:
            stack.pop()
        if stack:
            stack[-1][1].children.append(node)
        else:
            roots.append(node)
        stack.append((indent, node))
    return roots


def attach_children(card, node: Node) -> None:
    """하위 불릿을 예문/보충설명으로 카드에 붙인다 (손자까지 평평하게)."""
    if card is None:
        return
    stack = list(node.children)
    while stack:
        child = stack.pop(0)
        stack = child.children + stack
        text = strip_emphasis(clean(child.body))
        if not text:
            continue
        bucket = "notes" if has_hangul(text) else "examples"
        if text not in card[bucket]:
            card[bucket].append(text)


def parse_bullet_note(text: str, deck: str, col: Collector, default_topic=None) -> None:
    date = None
    topic = default_topic
    pending_group = None   # 직전 한글 그룹 헤더 (뜻 없는 후속 카드의 분류로 재사용)

    for item in build_tree(text.splitlines()):
        if isinstance(item, str):
            dm = DATE_HEADING.match(item)
            if dm:
                date = f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}"
            else:
                topic = strip_emphasis(clean(ANY_HEADING.match(item).group(2))) or None
            pending_group = None
            continue

        parsed = split_entry(item.body)
        if not parsed:
            continue
        term, meaning = parsed

        # "가리키다" 처럼 영어가 없는 한글 줄 + 하위 항목 = 그룹 헤더.
        if not has_english(term) and item.children:
            group = tidy_meaning(clean(item.body)) or term
            pending_group = group
            for child in item.children:
                sub = split_entry(child.body)
                if not sub or not has_english(sub[0]):
                    continue
                card = col.add(deck, sub[0], sub[1] or group, date=date, topic=group)
                attach_children(card, child)
            continue

        if not has_english(term):
            continue

        card = col.add(deck, term, meaning, date=date, topic=topic or pending_group)
        attach_children(card, item)
        if meaning:
            pending_group = None
        elif card and pending_group and not card["meaning"]:
            card["meaning"] = pending_group


def parse_table_note(text: str, deck: str, col: Collector) -> None:
    """마크다운 표(2~3열)와 일반 불릿이 섞인 노트를 처리한다."""
    lines = text.splitlines()
    topic = None
    i = 0
    bullet_runs = []   # (topic, [raw lines])

    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()

        if stripped.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = lines[i].strip()
                if not TABLE_SEP.match(row):
                    rows.append([clean(c) for c in row.strip("|").split("|")])
                i += 1
            if len(rows) >= 2:
                _emit_table(rows, deck, topic, col)
            continue

        head = ANY_HEADING.match(stripped)
        if head and not BULLET.match(raw):
            title = strip_emphasis(clean(head.group(2)))
            title = title.lstrip("\u2705 ").strip()
            # "##### 주요 단어" 같은 하위 제목 말고 큰 주제만 분류에 쓴다.
            if title and len(head.group(1)) <= 4 and not re.match(r"^(예시|예문)", title):
                topic = title
            i += 1
            continue

        if BULLET.match(raw):
            if bullet_runs and bullet_runs[-1][0] == topic:
                bullet_runs[-1][1].append(raw)
            else:
                bullet_runs.append((topic, [raw]))
        i += 1

    for tp, raws in bullet_runs:
        parse_bullet_note("\n".join(raws), deck, col, default_topic=tp)


def _emit_table(rows, deck: str, topic, col: Collector) -> None:
    header = [h.lower() for h in rows[0]]
    body = rows[1:]
    if not body:
        return
    width = max(len(r) for r in body)

    if width >= 3:
        for r in body:
            if len(r) < 3:
                continue
            term, meaning, example = tidy_term(r[0]), tidy_meaning(r[1]), strip_emphasis(r[2])
            if not term:
                continue
            card = col.add(deck, term, meaning, date=None, topic=topic)
            if card and example and example not in card["examples"]:
                card["examples"].append(example)
        return

    # 2열 표: 영어 쪽을 표제어로 잡는다.
    ko_hits = [sum(1 for r in body if len(r) > c and has_hangul(r[c])) for c in range(2)]
    en_col = 1 if ko_hits[0] > ko_hits[1] else 0
    for c, h in enumerate(header[:2]):
        if "영어" in h or "english" in h:
            en_col = c

    for r in body:
        if len(r) < 2:
            continue
        term = tidy_term(r[en_col])
        meaning = tidy_meaning(r[1 - en_col])
        # 대화 표의 "Main Contractor:" 같은 화자 라벨을 떼어낸다.
        term = re.sub(r"^[A-Z][A-Za-z ]{0,24}:\s*", "", term).strip()
        if ":" in meaning[:16]:
            meaning = meaning.split(":", 1)[1].strip()
        if term:
            col.add(deck, term, meaning, date=None, topic=topic)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "source"), help="마크다운 노트가 있는 폴더")
    ap.add_argument("--out", default=str(ROOT / "data" / "cards.json"))
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_dir():
        print(f"소스 폴더를 찾을 수 없습니다: {src}", file=sys.stderr)
        return 1

    col = Collector()
    deck_meta = []
    seen_hashes = set()

    for deck in DECKS:
        found = False
        for name in deck["files"]:
            path = src / name
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")
            digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
            if digest in seen_hashes:
                print(f"  · {name}: 내용이 동일한 파일이라 건너뜀")
                continue
            seen_hashes.add(digest)
            before = len(col.order)
            if text.count("|") > 20:
                parse_table_note(text, deck["id"], col)
            else:
                parse_bullet_note(text, deck["id"], col)
            print(f"  · {name}: +{len(col.order) - before}장")
            found = True
        if found:
            deck_meta.append({k: deck[k] for k in ("id", "name", "short", "desc", "color")})

    cards = [col.cards[cid] for cid in col.order]
    for c in cards:
        # 뜻이 비었으면 한글 보충설명 첫 줄을 뜻으로 끌어올린다.
        if not c["meaning"]:
            for i, note in enumerate(c["notes"]):
                if has_hangul(note):
                    c["meaning"] = c["notes"].pop(i)
                    break
        for key in ("notes", "examples", "topic", "date"):
            if not c.get(key):
                c.pop(key, None)

    for d in deck_meta:
        d["count"] = sum(1 for c in cards if c["deck"] == d["id"])

    payload = {
        "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M"),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "decks": deck_meta,
        "cards": cards,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n총 {len(cards)}장 -> {out}")
    for d in deck_meta:
        print(f"  {d['name']:<16} {d['count']:>4}장")
    no_meaning = [c["term"] for c in cards if not c["meaning"]]
    if no_meaning:
        print(f"\n뜻이 비어 있는 카드 {len(no_meaning)}장: {', '.join(no_meaning[:15])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
