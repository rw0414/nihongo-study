"""단원 JSON의 예문·정답에 가나 읽기(kana)를 채운다.

사용법:
    python tools/add_kana.py books/<bookId>/content/<chapterId>.json

- 단원 vocab의 표기→읽기를 긴 단어부터 치환해서 만든다. 이미 kana가 있는 항목은 건드리지 않는다.
- 치환 후 한자가 남으면 실패하고 남은 문장을 보여 준다 → 그 단어를 vocab에 추가하거나 kana를 직접 적는다.
- 같은 한자가 문맥에 따라 다르게 읽히는 경우(人 ひと/にん/じん 등)는 반드시 결과를 눈으로 확인한다.
  결과는 <파일>.kana.txt 로 저장된다.
"""
import json, re, sys

KANJI = re.compile(r"[一-鿿々]")
path = sys.argv[1]
d = json.load(open(path, encoding="utf-8"))
words = sorted({v["ja"]: v["reading"] for v in d["vocab"] if KANJI.search(v["ja"])}.items(), key=lambda x: -len(x[0]))
words += [(k, v) for k, v in d.get("kanaHints", {}).items()]  # 문맥상 다르게 읽는 표현 (예: "一人": "ひとり")
words.sort(key=lambda x: -len(x[0]))


def kana(s):
    for ja, r in words:
        s = s.replace(ja, r)
    return s


bad, out = [], []
for s in d["sentences"]:
    if not s.get("kana"):
        s["kana"] = [kana(a) for a in s["answers"] + s.get("alts", [])]
    out += [f"{s['id']}\t{a}\t{k}" for a, k in zip(s["answers"] + s.get("alts", []), s["kana"])]
    bad += [k for k in s["kana"] if KANJI.search(k)]
for c in d["cards"]:
    for b in c["blocks"]:
        if b["t"] == "ex" and KANJI.search(b["ja"]) and not b.get("kana"):
            b["kana"] = kana(b["ja"])
            out.append(f"{c['id']}\t{b['ja']}\t{b['kana']}")
            if KANJI.search(b["kana"]):
                bad.append(b["kana"])

open(path + ".kana.txt", "w", encoding="utf-8").write("\n".join(out))
if bad:
    open(path + ".kana.txt", "a", encoding="utf-8").write("\n\n[한자가 남은 읽기]\n" + "\n".join(bad))
    sys.exit(f"한자가 남은 읽기 {len(bad)}개 → {path}.kana.txt 확인 (vocab 또는 kanaHints에 추가)")
json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"ok: 읽기 {len(out)}개 → {path}.kana.txt")
