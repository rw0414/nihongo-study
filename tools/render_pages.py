"""교재 PDF 페이지를 읽기용 PNG로 렌더링 (Claude Code가 원문을 판독할 때 사용).

사용법:
    python tools/render_pages.py <교재.pdf> <첫 쪽> <끝 쪽> <출력 폴더> [--width 1500] [--top 0.5]

쪽 번호는 PDF 기준 1부터. --top 0.4 를 주면 각 페이지의 위쪽 40%만 렌더링 (부록 정답처럼 일부만 필요할 때).
"""
import argparse, os

import pymupdf

ap = argparse.ArgumentParser()
ap.add_argument("pdf")
ap.add_argument("first", type=int)
ap.add_argument("last", type=int)
ap.add_argument("out")
ap.add_argument("--width", type=int, default=1500)
ap.add_argument("--top", type=float, default=1.0)
a = ap.parse_args()

os.makedirs(a.out, exist_ok=True)
doc = pymupdf.open(a.pdf)
for p in range(a.first, a.last + 1):
    pg = doc[p - 1]
    r = pg.rect
    z = a.width / r.width
    clip = pymupdf.Rect(0, 0, r.width, r.height * a.top)
    path = os.path.join(a.out, f"p{p:03d}{'top' if a.top < 1 else ''}.png")
    pg.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=clip).save(path)
    print(path)
