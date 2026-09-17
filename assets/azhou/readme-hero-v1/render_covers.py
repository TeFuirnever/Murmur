# [20260908_Azhou_ReadmeHero] Deterministic renderer for the three Murmur README
# hero cover candidates (github-readme-image.v1 profile: 1280x720, cream paper,
# azhou four-colour palette, character pasted at native 485x560, transform none).
import hashlib
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CHOCOLATE = "#6F3810"
CREAM = "#FEF9EB"
ORANGE = "#FA9439"
PINK = "#FAA67C"
CANVAS = (1280, 720)
TITLE_REGION = (72, 86, 680, 272)  # L, T, R, B
RESULT_REGION = (72, 298, 672, 392)
EVIDENCE_REGION = (72, 414, 672, 594)  # 600x180
CHAR_POS = (715, 96)

HIRA = "/System/Library/Fonts/Hiragino Sans GB.ttc"
F_BOLD = lambda s: ImageFont.truetype(HIRA, s, index=2)  # noqa: E731
F_REG = lambda s: ImageFont.truetype(HIRA, s, index=0)  # noqa: E731

SHOT = Image.open(ROOT / "sources/screenshot-xhs-mode.jpg").convert("RGB")
RAW_CROP = SHOT.crop((75, 80, 835, 235))  # raw transcript card
POLISH_CROP = SHOT.crop((85, 985, 1015, 1175))  # AI-polished post card

CANONICAL = Image.open(
    "/Users/guanxueliang/.agents/skills/azhou-covers/authority/v1.9/character/canonical-front.png"
)
POSE_TWO_PAW = Image.open(
    "/Users/guanxueliang/Desktop/oh-my-ai/IP/azhou/azhou-core/authority/v1.9/renders/two-paw-interaction-v2.png"
)


def base_canvas():
    img = Image.new("RGB", CANVAS, CREAM)
    return img, ImageDraw.Draw(img)


def paste_character(img, pose):
    # Exact registered bytes, transform none: paste at native 485x560.
    img.paste(pose, CHAR_POS, pose)


def draw_headline(draw, lines, font_size, top=TITLE_REGION[1], left=TITLE_REGION[0]):
    y = top
    font = F_BOLD(font_size)
    for line in lines:
        draw.text((left, y), line, font=font, fill=CHOCOLATE)
        y += int(font_size * 1.3)
    # hand-drawn underline accent under the last line
    underline_y = y - int(font_size * 0.28)
    x0 = left + 4
    x1 = left + int(font.getlength(lines[-1])) - 6
    rng = random.Random(7)
    pts = [
        (x0 + i * 8, underline_y + rng.uniform(-1.6, 1.6))
        for i in range((x1 - x0) // 8 + 1)
    ]
    draw.line(pts, fill=ORANGE, width=5, joint="curve")


def draw_subtitle(draw, text):
    draw.text(
        (RESULT_REGION[0], RESULT_REGION[1] + 18),
        text,
        font=F_REG(32),
        fill=CHOCOLATE,
    )


def paste_crop(img, crop, box, border=CHOCOLATE):
    """Paste a real-evidence crop scaled to fit box (L,T,R,B), thin frame."""
    w, h = box[2] - box[0], box[3] - box[1]
    scale = min(w / crop.width, h / crop.height)
    resized = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    x = box[0] + (w - resized.width) // 2
    y = box[1] + (h - resized.height) // 2
    img.paste(resized, (x, y))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [x - 3, y - 3, x + resized.width + 3, y + resized.height + 3],
        radius=10,
        outline=border,
        width=3,
    )
    return (x, y, resized.width, resized.height)


def hand_wave(draw, x0, y0, length, amp, color, width=4, seed=3, morph_to_flat=False):
    rng = random.Random(seed)
    pts = []
    for i in range(length + 1):
        t = i / length
        if morph_to_flat:
            envelope = max(0.0, 1.0 - t * 1.15)  # wave dies out into the text line
        else:
            envelope = math.sin(t * math.pi) ** 0.7
        y = y0 + math.sin(i / 9.0) * amp * envelope + rng.uniform(-1.2, 1.2)
        pts.append((x0 + i, y))
    draw.line(pts, fill=color, width=width, joint="curve")
    return pts[-1]


def variant_a():
    img, d = base_canvas()
    draw_headline(d, ["说出口，", "就是能用的文字"], 64)
    draw_subtitle(d, "Local speech-to-text · AI polish · on-device")

    ex0, ey0, ex1, ey1 = EVIDENCE_REGION
    # visual anchor: hand-drawn waveform (upper half) morphing flat into a
    # clean text line with cursor (lower half)
    hand_wave(d, ex0 + 4, ey0 + 52, 300, 40, CHOCOLATE, morph_to_flat=True)
    line = "这句话说完就能用"
    font24 = F_REG(24)
    d.text((ex0 + 4, ey0 + 108), line, font=font24, fill=CHOCOLATE)
    cx = ex0 + 4 + font24.getlength(line) + 8
    d.rectangle([cx, ey0 + 110, cx + 13, ey0 + 134], fill=ORANGE)
    d.text((ex0 + 4, ey0 + 146), "声波停下的地方，文字已经能直接用", font=F_REG(22), fill=ORANGE)
    # proof: real polished-post screenshot crop
    box = (ex1 - 218, ey0, ex1, ey1)
    paste_crop(img, POLISH_CROP, box)
    d.text((box[0] + 4, ey1 + 6), "真实界面：AI 润色成稿", font=F_REG(22), fill=CHOCOLATE)
    paste_character(img, CANONICAL)
    return img


# [20260916_Azhou_ReadmeHeroEn] English-front-door variant of variant_a: same
# outcome concept, evidence crop, palette and layout; only the copy layers are
# translated so the EN README hero reads natively. Rendering stays
# deterministic (no new random seeds outside the existing draw helpers).
def variant_a_en():
    img, d = base_canvas()
    draw_headline(d, ["Speak.", "It's usable text."], 64)
    draw_subtitle(d, "Local speech-to-text · AI polish · on-device")

    ex0, ey0, ex1, ey1 = EVIDENCE_REGION
    hand_wave(d, ex0 + 4, ey0 + 52, 300, 40, CHOCOLATE, morph_to_flat=True)
    line = "Ready the moment you say it"
    font24 = F_REG(24)
    d.text((ex0 + 4, ey0 + 108), line, font=font24, fill=CHOCOLATE)
    cx = ex0 + 4 + font24.getlength(line) + 8
    d.rectangle([cx, ey0 + 110, cx + 13, ey0 + 134], fill=ORANGE)
    d.text((ex0 + 4, ey0 + 146), "Where the wave stops, ready text", font=F_REG(22), fill=ORANGE)
    box = (ex1 - 218, ey0, ex1, ey1)
    paste_crop(img, POLISH_CROP, box)
    d.text((box[0] + 4, ey1 + 6), "Real UI: AI-polished output", font=F_REG(22), fill=CHOCOLATE)
    paste_character(img, CANONICAL)
    return img


def variant_b():
    img, d = base_canvas()
    draw_headline(d, ["系统听写到", "「转出来」为止"], 64)
    draw_subtitle(d, "Murmur 多走一步：润色 · 纪要 · 成稿")

    ex0, ey0, ex1, ey1 = EVIDENCE_REGION
    # single-axis contrast: same voice, raw transcript vs polished post (real crops)
    left_box = (ex0, ey0 + 24, ex0 + 262, ey1 - 8)
    right_box = (ex1 - 300, ey0 + 24, ex1, ey1 - 8)
    la = paste_crop(img, RAW_CROP, left_box)
    ra = paste_crop(img, POLISH_CROP, right_box)
    d.text((la[0], ey0 - 2), "原始转写", font=F_BOLD(22), fill=CHOCOLATE)
    d.text((ra[0], ey0 - 2), "AI 润色成稿", font=F_BOLD(22), fill=ORANGE)
    # arrow between
    ax0 = la[0] + la[2] + 10
    ax1 = ra[0] - 10
    ay = (ey0 + ey1) // 2
    d.line([(ax0, ay), (ax1, ay)], fill=CHOCOLATE, width=4)
    d.polygon([(ax1, ay), (ax1 - 12, ay - 7), (ax1 - 12, ay + 7)], fill=CHOCOLATE)
    paste_character(img, CANONICAL)
    return img


def variant_c():
    img, d = base_canvas()
    # promise-first with object metaphor: one big judgement line + one
    # oversized hotkey keycap as the single story object; canonical fox stays
    # a brand anchor at native pixels on the right
    draw_headline(d, ["按一下，", "说完就完"], 88, top=110)
    key_box = [120, 434, 620, 594]
    d.rounded_rectangle(key_box, radius=26, fill=CREAM, outline=CHOCOLATE, width=7)
    d.rounded_rectangle(
        [key_box[0] + 12, key_box[1] + 12, key_box[2] - 12, key_box[3] - 18],
        radius=16,
        outline=ORANGE,
        width=4,
    )
    sym = ImageFont.truetype("/System/Library/Fonts/Apple Symbols.ttf", 52)
    combo = "⌘⇧"
    space = F_BOLD(52)
    total = sym.getlength(combo) + 12 + space.getlength("Space")
    x = (key_box[0] + key_box[2]) / 2 - total / 2
    d.text((x, key_box[1] + 38), combo, font=sym, fill=CHOCOLATE)
    d.text((x + sym.getlength(combo) + 12, key_box[1] + 38), "Space", font=space, fill=CHOCOLATE)
    # text flows out of the keycap toward the fox: pure visual wave, no added
    # copy (title-only density)
    hand_wave(d, key_box[2] + 18, (key_box[1] + key_box[3]) // 2, 90, 10, ORANGE, width=4)
    paste_character(img, CANONICAL)
    return img


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    out = ROOT / "candidates"
    out.mkdir(exist_ok=True)
    for name, fn in (
        ("cover-a", variant_a),
        ("cover-a-en", variant_a_en),
        ("cover-b", variant_b),
        ("cover-c", variant_c),
    ):
        path = out / f"{name}.png"
        fn().save(path, format="PNG", optimize=True)
        print(name, path.stat().st_size, sha256(path))


if __name__ == "__main__":
    main()
