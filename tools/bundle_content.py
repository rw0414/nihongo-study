"""변환된 단원 콘텐츠를 폰으로 옮기기 쉽게 파일 하나로 묶는다.

사용법:
    python tools/bundle_content.py <bookId> [--until <chapterId>]

결과: books/<bookId>.content.json  → 앱의 교재 목차 화면 '단원 콘텐츠 가져오기'에서 선택
--until 을 주면 목차 순서로 그 단원까지만 넣는다 (예: --until c-5-4-1 → 33과까지).
"""
import argparse, json, os, zipfile

ap = argparse.ArgumentParser()
ap.add_argument("book")
ap.add_argument("--until")
a = ap.parse_args()

order = [c["id"] for c in json.loads(zipfile.ZipFile(f"books/{a.book}.zip").read("manifest.json"))["chapters"]]
last = order.index(a.until) if a.until else len(order)
units = []
for cid in order[: last + 1]:
    path = f"books/{a.book}/content/{cid}.json"
    if os.path.exists(path):
        units.append(json.load(open(path, encoding="utf-8")))

out = f"books/{a.book}.content.json"
json.dump({"format": "nihongo-study-content", "bookId": a.book, "units": units}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print(f"ok: units {len(units)} -> {out} ({os.path.getsize(out) >> 10} KB)")
