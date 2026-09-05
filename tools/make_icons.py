#!/usr/bin/env python3
"""PWA 아이콘 생성 — 남색 그라데이션 위에 겹친 카드 두 장.

    python tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"

TOP = (24, 32, 68)
BOTTOM = (58, 74, 200)
CARD_BACK = (255, 255, 255, 70)
CARD_FRONT = (255, 255, 255, 240)
ACCENT = (61, 90, 254)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        row = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = row
    return img


def draw_cards(img: Image.Image, inset: float) -> None:
    """겹쳐 놓은 플래시카드 두 장 + 앞장에 밑줄 두 개."""
    size = img.width
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    w, h = size * 0.50, size * 0.36
    cx, cy = size / 2, size / 2
    r = size * 0.055

    # 뒷장: 살짝 위로 밀고 좁게
    d.rounded_rectangle(
        [cx - w / 2 + size * 0.045, cy - h / 2 - size * 0.075,
         cx + w / 2 + size * 0.045, cy + h / 2 - size * 0.075],
        radius=r, fill=CARD_BACK,
    )
    # 앞장
    box = [cx - w / 2 - size * 0.02, cy - h / 2 + size * 0.045,
           cx + w / 2 - size * 0.02, cy + h / 2 + size * 0.045]
    d.rounded_rectangle(box, radius=r, fill=CARD_FRONT)

    # 앞장 안의 글줄 두 개
    x0, y0, x1, y1 = box
    bar_h = size * 0.030
    pad = size * 0.052
    d.rounded_rectangle(
        [x0 + pad, y0 + pad * 1.15, x1 - pad, y0 + pad * 1.15 + bar_h],
        radius=bar_h / 2, fill=ACCENT,
    )
    d.rounded_rectangle(
        [x0 + pad, y0 + pad * 1.15 + bar_h * 2.0, x1 - pad * 2.6, y0 + pad * 1.15 + bar_h * 3.0],
        radius=bar_h / 2, fill=(ACCENT[0], ACCENT[1], ACCENT[2], 110),
    )

    if inset:
        scaled = round(size * (1 - inset))
        layer = layer.resize((scaled, scaled), Image.LANCZOS)
        pad_px = (size - scaled) // 2
        shifted = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shifted.paste(layer, (pad_px, pad_px))
        layer = shifted

    img.paste(layer, (0, 0), layer)


def rounded(img: Image.Image, radius_ratio: float) -> Image.Image:
    size = img.width
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1],
                                           radius=round(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def build(size: int, name: str, *, radius: float, inset: float = 0.0) -> None:
    img = gradient(size)
    draw_cards(img, inset)
    rounded(img, radius).save(OUT / name)
    print(" ·", name)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    build(192, "icon-192.png", radius=0.22)
    build(512, "icon-512.png", radius=0.22)
    build(512, "icon-maskable-512.png", radius=0.5, inset=0.20)   # 안전영역 확보
    build(180, "apple-touch-icon.png", radius=0.0)                # iOS가 알아서 깎는다
    print("아이콘 생성 완료 ->", OUT)


if __name__ == "__main__":
    main()
