#!/usr/bin/env python3
"""
PFT Navigator — QR Code Generator
Reads anchor nodes from data/graph.json and generates 1080×1080 PNG QR codes.
Each QR code encodes the URL:
  https://<BASE_URL>/?floor=<floor>&anchor=<node_id>

Output: assets/<node_id>.png

Usage:
  python3 generate_qr.py
  python3 generate_qr.py --base-url https://yourname.github.io/pft-nav
  python3 generate_qr.py --graph data/graph.json --out assets
"""

import argparse
import json
import os

import qrcode
from PIL import Image, ImageDraw, ImageFont

# ── Config ────────────────────────────────────────────────────
DEFAULT_BASE_URL = "https://lunariancubed.github.io/PFT-Navi"
GRAPH_FILE       = "data/graph.json"
OUT_DIR          = "assets"
SIZE             = 1080   # output PNG size in pixels
QR_AREA          = 820    # QR code occupies this many pixels (centred)
MARGIN           = (SIZE - QR_AREA) // 2

BG_COLOR         = (255, 255, 255)
QR_COLOR         = (15,  10,  30)   # near-black (matches app dark theme)
LABEL_COLOR      = (70,  29, 124)   # LSU purple
SUBLABEL_COLOR   = (100, 90, 130)

# ── Argument parsing ──────────────────────────────────────────
parser = argparse.ArgumentParser(description="Generate PFT Navigator QR codes")
parser.add_argument("--base-url", default=DEFAULT_BASE_URL,
                    help="Base URL of the deployed app")
parser.add_argument("--graph",    default=GRAPH_FILE,
                    help="Path to graph.json")
parser.add_argument("--out",      default=OUT_DIR,
                    help="Output directory for PNG files")
args = parser.parse_args()

base_url = args.base_url.rstrip("/")
os.makedirs(args.out, exist_ok=True)

# ── Load graph ────────────────────────────────────────────────
with open(args.graph) as f:
    graph = json.load(f)

anchors = [n for n in graph if n.get("type") == "anchor"]

if not anchors:
    print("No anchor nodes found in graph.json")
    exit(0)

print(f"Found {len(anchors)} anchor node(s)\n")

# ── Generate QR codes ─────────────────────────────────────────
for node in anchors:
    node_id = node["id"]
    floor   = node.get("floor", 1)
    label   = node.get("label") or node_id

    url = f"{base_url}/?floor={floor}&anchor={node_id}"

    # Build QR code
    qr = qrcode.QRCode(
        version=None,           # auto-size
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    qr_img = qr.make_image(fill_color=QR_COLOR, back_color=BG_COLOR).convert("RGB")

    # Create 1080×1080 canvas
    canvas = Image.new("RGB", (SIZE, SIZE), BG_COLOR)

    # Resize QR to QR_AREA × QR_AREA and paste centred
    qr_resized = qr_img.resize((QR_AREA, QR_AREA), Image.NEAREST)
    canvas.paste(qr_resized, (MARGIN, MARGIN))

    draw = ImageDraw.Draw(canvas)

    # Top label: node label
    try:
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
    except OSError:
        font_large = ImageFont.load_default()
        font_small = font_large

    # Top: label centred above QR
    top_y = MARGIN // 2 - 20
    bbox = draw.textbbox((0, 0), label, font=font_large)
    tw = bbox[2] - bbox[0]
    draw.text(((SIZE - tw) // 2, top_y), label, fill=LABEL_COLOR, font=font_large)

    # Bottom: URL in small grey text
    bot_y = MARGIN + QR_AREA + 14
    bbox2 = draw.textbbox((0, 0), url, font=font_small)
    tw2 = bbox2[2] - bbox2[0]
    # Truncate URL if too wide
    display_url = url if tw2 < SIZE - 40 else url[:60] + "…"
    bbox2 = draw.textbbox((0, 0), display_url, font=font_small)
    tw2 = bbox2[2] - bbox2[0]
    draw.text(((SIZE - tw2) // 2, bot_y), display_url, fill=SUBLABEL_COLOR, font=font_small)

    # Floor badge bottom-right corner
    badge_text = f"Floor {floor}"
    badge_font = font_small
    bb = draw.textbbox((0, 0), badge_text, font=badge_font)
    bw, bh = bb[2]-bb[0], bb[3]-bb[1]
    pad = 12
    bx, by = SIZE - bw - pad*2 - 10, SIZE - bh - pad*2 - 10
    draw.rounded_rectangle([bx, by, bx+bw+pad*2, by+bh+pad*2], radius=10,
                            fill=(70, 29, 124))
    draw.text((bx+pad, by+pad), badge_text, fill=(253, 208, 35), font=badge_font)

    # Save
    out_path = os.path.join(args.out, f"{node_id}.png")
    canvas.save(out_path, "PNG")
    print(f"  ✓  {node_id:30s}  Floor {floor}  →  {out_path}")
    print(f"     {url}")

print(f"\nDone — {len(anchors)} QR code(s) saved to ./{args.out}/")
