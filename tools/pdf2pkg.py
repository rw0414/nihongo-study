"""PDF 교재 → 앱용 교재 패키지(.zip) 변환기.

사용법:
    python tools/pdf2pkg.py <교재.pdf> <목차.toc.json> [--width 1200] [--quality 70]

결과:
    books/<bookId>/pages/0001.webp ...   (페이지 이미지 캐시, 중단돼도 이어서 진행)
    books/<bookId>.zip                    (앱의 라이브러리에서 '교재 추가'로 불러올 파일)

bookId 는 PDF 파일 내용의 SHA-256 앞 16자리. 같은 PDF는 항상 같은 ID → 앱에서 중복 등록 방지.
"""
import argparse, hashlib, io, json, os, sys, zipfile

import pymupdf
from PIL import Image

FORMAT = 1


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def flatten(nodes, offset, parent=None, level=0, prefix="c", out=None):
    """중첩 목차 → 평면 목록. 부모의 시작 쪽은 첫 자식의 시작 쪽."""
    out = [] if out is None else out
    for i, n in enumerate(nodes, 1):
        cid = f"{prefix}-{i}"
        item = {"id": cid, "parentId": parent, "level": level, "title": n["title"]}
        out.append(item)
        first_child = len(out)
        if n.get("children"):
            flatten(n["children"], offset, cid, level + 1, cid, out)
        item["startPage"] = n["page"] + offset if "page" in n else out[first_child]["startPage"]
    return out


def add_end_pages(chapters, page_count):
    """끝 쪽 = 다음 형제/상위 항목 시작 쪽 - 1 (자손은 건너뜀)."""
    for i, c in enumerate(chapters):
        nxt = next((d for d in chapters[i + 1:] if d["level"] <= c["level"]), None)
        c["endPage"] = (nxt["startPage"] - 1) if nxt else page_count
        assert c["startPage"] <= c["endPage"], f"목차 쪽 번호 오류: {c}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("toc")
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--quality", type=int, default=70)
    ap.add_argument("--out", default="books")
    a = ap.parse_args()

    meta = json.load(open(a.toc, encoding="utf-8"))
    book_id = sha256(a.pdf)[:16]
    doc = pymupdf.open(a.pdf)
    n = doc.page_count
    offset = meta.get("printedPageOffset", 0)

    chapters = flatten(meta["toc"], offset)
    add_end_pages(chapters, n)

    page_dir = os.path.join(a.out, book_id, "pages")
    os.makedirs(page_dir, exist_ok=True)
    text_chars = 0
    for i in range(n):
        path = os.path.join(page_dir, f"{i + 1:04d}.webp")
        text_chars += len(doc[i].get_text().strip()) if i < 20 else 0
        if os.path.exists(path):
            continue  # 이미 변환된 페이지는 건너뜀 (이어하기)
        pg = doc[i]
        z = a.width / pg.rect.width
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(z, z))
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        tmp = path + ".tmp"
        im.save(tmp, "WEBP", quality=a.quality)
        os.replace(tmp, path)  # 원자적 저장: 중간에 끊겨도 깨진 파일이 남지 않음
        print(f"\r페이지 {i + 1}/{n}", end="", flush=True)
    print()

    manifest = {
        "format": FORMAT,
        "id": book_id,
        "title": meta["title"],
        "pageCount": n,
        "printedPageOffset": offset,
        "sourceFile": os.path.basename(a.pdf),
        "sourceType": "text" if text_chars > 200 else "scanned",
        "tocPages": [p + offset for p in meta.get("tocPages", [])],
        "chapters": chapters,
    }
    zpath = os.path.join(a.out, f"{book_id}.zip")
    with zipfile.ZipFile(zpath + ".tmp", "w", zipfile.ZIP_STORED) as z:  # webp는 이미 압축됨
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        for i in range(n):
            z.write(os.path.join(page_dir, f"{i + 1:04d}.webp"), f"pages/{i + 1:04d}.webp")
    os.replace(zpath + ".tmp", zpath)
    print(f"완료: {zpath} ({os.path.getsize(zpath) >> 20} MB, {n}쪽, 목차 {len(chapters)}개, {manifest['sourceType']})")


if __name__ == "__main__":
    sys.exit(main())
