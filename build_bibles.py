#!/usr/bin/env python3
"""Consolidate hargarpay/bible-translations per-chapter JSON into one
compact JSON file per translation, suitable for an offline Bible app.

Output structure per translation (bibles/<ABBR>.json):
{
  "abbr": "KJV",
  "name": "King James Version",
  "copyright": "...",
  "books": [
    {"name": "Genesis", "chapters": [["verse 1", "verse 2", ...], ...]},
    ...
  ]
}
Verses are arrays; verse number = array index + 1. Canonical book order
(OT then NT) is taken from all_books.json; books absent from that list
are appended in sorted order.
"""

import json
import os
import sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bible-translations", "json")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bibles")

# Full names + copyright notes, from the repo README and known licensing.
NAMES = {
    "KJ21": "21st Century King James Version (KJ21)",
    "ASV": "American Standard Version (ASV)",
    "AMP": "Amplified Bible (AMP)",
    "AMPC": "Amplified Bible, Classic Edition (AMPC)",
    "BRG": "BRG Bible (BRG)",
    "CSB": "Christian Standard Bible (CSB)",
    "CEB": "Common English Bible (CEB)",
    "CJB": "Complete Jewish Bible (CJB)",
    "CEV": "Contemporary English Version (CEV)",
    "DARBY": "Darby Translation (DARBY)",
    "DLNT": "Disciples' Literal New Testament (DLNT)",
    "DRA": "Douay-Rheims 1899 American Edition (DRA)",
    "ERV": "Easy-to-Read Version (ERV)",
    "EHV": "Evangelical Heritage Version (EHV)",
    "ESV": "English Standard Version (ESV)",
    "ESVUK": "English Standard Version Anglicised (ESVUK)",
    "EXB": "Expanded Bible (EXB)",
    "GNV": "1599 Geneva Bible (GNV)",
    "GW": "GOD'S WORD Translation (GW)",
    "GNT": "Good News Translation (GNT)",
    "HCSB": "Holman Christian Standard Bible (HCSB)",
    "ICB": "International Children's Bible (ICB)",
    "ISV": "International Standard Version (ISV)",
    "PHILLIPS": "J.B. Phillips New Testament (PHILLIPS)",
    "JUB": "Jubilee Bible 2000 (JUB)",
    "KJV": "King James Version (KJV)",
    "AKJV": "Authorized (King James) Version (AKJV)",
    "LEB": "Lexham English Bible (LEB)",
    "TLB": "Living Bible (TLB)",
    "MSG": "The Message (MSG)",
    "MEV": "Modern English Version (MEV)",
    "MOUNCE": "Mounce Reverse-Interlinear New Testament (MOUNCE)",
    "NABRE": "New American Bible (Revised Edition) (NABRE)",
    "NASB": "New American Standard Bible (NASB)",
    "NCV": "New Century Version (NCV)",
    "NET": "New English Translation (NET Bible)",
    "NIRV": "New International Reader's Version (NIRV)",
    "NIV": "New International Version (NIV)",
    "NIVUK": "New International Version - UK (NIVUK)",
    "NKJV": "New King James Version (NKJV)",
    "NLV": "New Life Version (NLV)",
    "NLT": "New Living Translation (NLT)",
    "NMB": "New Matthew Bible (NMB)",
    "NRSV": "New Revised Standard Version (NRSV)",
    "NTE": "New Testament for Everyone (NTE)",
    "OJB": "Orthodox Jewish Bible (OJB)",
    "TPT": "The Passion Translation (TPT)",
    "RGT": "Revised Geneva Translation (RGT)",
    "RSV": "Revised Standard Version (RSV)",
    "RSVCE": "Revised Standard Version Catholic Edition (RSVCE)",
    "TLV": "Tree of Life Version (TLV)",
    "VOICE": "The Voice (VOICE)",
    "WEB": "World English Bible (WEB)",
    "WE": "Worldwide English (New Testament) (WE)",
    "WYC": "Wycliffe Bible (WYC)",
    "YLT": "Young's Literal Translation (YLT)",
}

COPYRIGHT = {
    "KJV": "Public domain (US); Crown copyright in the UK",
    "AKJV": "Public domain (US); Crown copyright in the UK",
    "ASV": "Public domain",
    "WEB": "Public domain",
    "DARBY": "Public domain",
    "DRA": "Public domain",
    "YLT": "Public domain",
    "GNV": "Public domain",
    "WYC": "Public domain",
    "BBE": "Public domain (Cambridge University Press waiver)",
    "JUB": "Public domain",
    "KJ21": "Copyright 1994 by 21st Century King James Version",
    "NLT": "Copyright 1996, 2004, 2015 Tyndale House Foundation",
    "NKJV": "Copyright 1982 Thomas Nelson",
    "GNT": "Copyright 1992 American Bible Society",
    "GW": "Copyright 1995, 2003 God's Word to the Nations Bible Society",
    "NIV": "Copyright 1973, 1978, 1984, 2011 Biblica, Inc.",
    "ESV": "Copyright 2001 Crossway",
    "NASB": "Copyright 1960, 1995 The Lockman Foundation",
    "AMP": "Copyright 2015 The Lockman Foundation",
    "AMPC": "Copyright 1954, 1987 The Lockman Foundation",
    "MSG": "Copyright 1993, 2002 Eugene H. Peterson",
    "RSV": "Copyright 1952 National Council of Churches",
    "NRSV": "Copyright 1989 National Council of Churches",
    "CEB": "Copyright 2011 Common English Bible",
    "HCSB": "Copyright 1999, 2009 Holman Bible Publishers",
    "CSB": "Copyright 2017 Holman Bible Publishers",
    "CEV": "Copyright 1995 American Bible Society",
    "ERV": "Copyright 2006 World Bible Translation Center",
    "ICB": "Copyright 1986, 1988 Word Publishing",
    "NCV": "Copyright 1987, 1988, 1991 Word Publishing",
    "NIRV": "Copyright 1995, 1996, 1998, 2014 Biblica, Inc.",
    "TLB": "Copyright 1971 Tyndale House Foundation",
    "NLV": "Copyright 1969, 2003 Barbour Publishing",
    "MEV": "Copyright 2014 by Larry D. Smith",
    "LEB": "Copyright 2012 Logos Bible Software",
    "NET": "Copyright 1996-2016 Biblical Studies Press",
    "VOICE": "Copyright 2012 Ecclesia Bible Society",
    "TPT": "Copyright 2017 BroadStreet Publishing",
    "OJB": "Copyright 2002 Artists for Israel International",
    "CJB": "Copyright 1998 Messianic Jewish Publishers",
    "TLV": "Copyright 2014 Messianic Jewish Family Bible Society",
    "NOG": "Copyright 2011 God's Word to the Nations Bible Society",
    "ISV": "Copyright 1995-2014 ISV Foundation",
    "PHILLIPS": "Copyright 1960 J.B. Phillips",
    "MOUNCE": "Copyright 2011 William D. Mounce",
    "NTE": "Copyright 2018 Tom Wright",
    "NMB": "Copyright 2015 David Norton",
    "RGT": "Copyright 2019 David H. Sorenson",
    "EHV": "Copyright 2019 Wartburg Project",
    "EXB": "Copyright 2011 Zondervan",
    "NIVUK": "Copyright 1973, 1978, 1984, 2011 Biblica, Inc.",
    "RSVCE": "Copyright 1952 National Council of Churches",
    "NABRE": "Copyright 2010 Confraternity of Christian Doctrine",
    "BRG": "Copyright 2012 Brian Russell",
    "NMB": "Copyright 2015 David Norton",
    "WE": "Copyright 1969 SIL International",
    "DLNT": "Copyright 2013 J. William Johnston",
    "NRSV": "Copyright 1989 National Council of Churches",
    "NTE": "Copyright 2018 Tom Wright",
}


def load_all_books():
    with open(os.path.join(SRC, "all_books.json"), encoding="utf-8") as f:
        data = json.load(f)
    order = []
    for part in ("old", "new"):
        for item in data.get(part, []):
            for name, chapters in item.items():
                order.append((name.replace("_", " "), int(chapters)))
    return order


def build_translation(abbr, book_order):
    base = os.path.join(SRC, abbr)
    if not os.path.isdir(base):
        return None
    book_dirs = set()
    for part in ("old", "new"):
        p = os.path.join(base, part)
        if os.path.isdir(p):
            book_dirs.update(os.listdir(p))
    if not book_dirs:
        return None

    # Canonical order first, then any extras (e.g. deuterocanon) sorted.
    ordered = []
    known = set()
    for name, _ in book_order:
        d = name.replace(" ", "_")
        if d in book_dirs:
            ordered.append(d)
            known.add(d)
    extras = sorted(book_dirs - known)
    ordered.extend(extras)

    books = []
    total_verses = 0
    for d in ordered:
        bpath = os.path.join(base, "old" if os.path.isdir(os.path.join(base, "old", d)) else "new", d)
        # Search both parts in case the book lives in the other one
        if not os.path.isdir(bpath):
            bpath = os.path.join(base, "new", d)
            if not os.path.isdir(bpath):
                bpath = os.path.join(base, "old", d)
        chapters = []
        for chap_file in sorted(os.listdir(bpath), key=lambda x: int(x.split(".")[0])):
            with open(os.path.join(bpath, chap_file), encoding="utf-8") as f:
                ch = json.load(f)
            try:
                keys = sorted(ch, key=int)
            except ValueError:
                keys = sorted(ch)
            verses = [ch[k] for k in keys]
            chapters.append(verses)
            total_verses += len(verses)
        books.append({"name": d.replace("_", " "), "chapters": chapters})

    return {
        "abbr": abbr,
        "name": NAMES.get(abbr, abbr),
        "copyright": COPYRIGHT.get(abbr, "Check publisher for terms"),
        "books": books,
        "_stats": {"books": len(books), "chapters": sum(len(b["chapters"]) for b in books), "verses": total_verses},
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    book_order = load_all_books()
    abbrs = [d for d in sorted(os.listdir(SRC)) if os.path.isdir(os.path.join(SRC, d))]

    index = []
    for abbr in abbrs:
        t = build_translation(abbr, book_order)
        if t is None:
            continue
        stats = t.pop("_stats")
        out_path = os.path.join(OUT, f"{abbr}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(t, f, ensure_ascii=False, separators=(",", ":"))
        size_mb = os.path.getsize(out_path) / 1e6
        flag = "" if stats["chapters"] == 1189 else "  <-- INCOMPLETE"
        print(f"{abbr:8s} books={stats['books']:3d} chapters={stats['chapters']:4d} "
              f"verses={stats['verses']:6d} {size_mb:6.2f} MB{flag}")
        index.append({"abbr": abbr, "name": t["name"], "copyright": t["copyright"],
                      "books": stats["books"], "chapters": stats["chapters"], "verses": stats["verses"]})

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\n{len(index)} translations written to {OUT}")


if __name__ == "__main__":
    main()
