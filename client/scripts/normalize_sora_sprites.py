#!/usr/bin/env python3
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SPRITES_DIR = ROOT / "public" / "sprites"


def find_components(alpha_mask: np.ndarray, min_pixels: int) -> list[tuple[int, int, int, int, int]]:
    h, w = alpha_mask.shape
    visited = np.zeros((h, w), dtype=np.uint8)
    components: list[tuple[int, int, int, int, int]] = []

    for y in range(h):
        for x in range(w):
            if not alpha_mask[y, x] or visited[y, x]:
                continue

            q = deque([(y, x)])
            visited[y, x] = 1
            pixels = 0
            min_x = max_x = x
            min_y = max_y = y

            while q:
                cy, cx = q.popleft()
                pixels += 1
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)

                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and alpha_mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = 1
                        q.append((ny, nx))

            if pixels >= min_pixels:
                components.append((min_x, min_y, max_x, max_y, pixels))

    return components


def sort_row_major(
    components: list[tuple[int, int, int, int, int]],
    row_gap: int = 40
) -> list[tuple[int, int, int, int, int]]:
    rows: list[dict[str, object]] = []

    for comp in sorted(components, key=lambda c: ((c[1] + c[3]) / 2, c[0])):
        center_y = (comp[1] + comp[3]) / 2
        placed = False
        for row in rows:
            if abs(center_y - row["center_y"]) <= row_gap:
                row["items"].append(comp)
                items = row["items"]
                row["center_y"] = sum((it[1] + it[3]) / 2 for it in items) / len(items)
                placed = True
                break
        if not placed:
            rows.append({"center_y": center_y, "items": [comp]})

    rows.sort(key=lambda r: r["center_y"])
    ordered: list[tuple[int, int, int, int, int]] = []
    for row in rows:
        row_items = sorted(row["items"], key=lambda c: c[0])
        ordered.extend(row_items)
    return ordered


def to_cell_sprite(
    image: Image.Image,
    bbox: tuple[int, int, int, int],
    cell_w: int,
    cell_h: int,
    pad: int,
    alpha_cleanup: int
) -> Image.Image:
    min_x, min_y, max_x, max_y = bbox
    crop = image.crop((min_x, min_y, max_x + 1, max_y + 1)).convert("RGBA")
    arr = np.array(crop)
    arr[:, :, 3] = np.where(arr[:, :, 3] >= alpha_cleanup, arr[:, :, 3], 0)

    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if xs.size == 0 or ys.size == 0:
        return Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))

    trim = Image.fromarray(
        arr[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1, :],
        mode="RGBA"
    )

    usable_w = max(1, cell_w - pad * 2)
    usable_h = max(1, cell_h - pad * 2)
    scale = min(usable_w / trim.width, usable_h / trim.height)
    target_w = max(1, int(round(trim.width * scale)))
    target_h = max(1, int(round(trim.height * scale)))
    resized = trim.resize((target_w, target_h), Image.Resampling.NEAREST)

    cell = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
    paste_x = (cell_w - target_w) // 2
    paste_y = (cell_h - target_h) // 2
    cell.paste(resized, (paste_x, paste_y), resized)
    return cell


def build_sheet(
    src_name: str,
    dst_name: str,
    expected_count: int,
    cols: int,
    rows: int,
    cell_w: int,
    cell_h: int,
    alpha_threshold: int,
    min_pixels: int,
    alpha_cleanup: int,
    pad: int
) -> None:
    src_path = SPRITES_DIR / src_name
    dst_path = SPRITES_DIR / dst_name
    image = Image.open(src_path).convert("RGBA")
    alpha = np.array(image)[:, :, 3]
    components = find_components(alpha >= alpha_threshold, min_pixels=min_pixels)
    components = sort_row_major(components)

    if len(components) != expected_count:
        raise RuntimeError(
            f"{src_name}: expected {expected_count} components, found {len(components)}."
        )

    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))
    for idx, comp in enumerate(components):
        frame = to_cell_sprite(
            image=image,
            bbox=(comp[0], comp[1], comp[2], comp[3]),
            cell_w=cell_w,
            cell_h=cell_h,
            pad=pad,
            alpha_cleanup=alpha_cleanup
        )
        col = idx % cols
        row = idx // cols
        sheet.paste(frame, (col * cell_w, row * cell_h), frame)

    sheet.save(dst_path)
    print(f"Wrote {dst_path} ({sheet.width}x{sheet.height})")


def main() -> None:
    build_sheet(
        src_name="characters_sheet.png",
        dst_name="characters_sheet_compact.png",
        expected_count=30,
        cols=10,
        rows=3,
        cell_w=16,
        cell_h=16,
        alpha_threshold=128,
        min_pixels=500,
        alpha_cleanup=96,
        pad=1
    )
    build_sheet(
        src_name="items_sheet.png",
        dst_name="items_sheet_compact.png",
        expected_count=5,
        cols=5,
        rows=1,
        cell_w=16,
        cell_h=16,
        alpha_threshold=128,
        min_pixels=1000,
        alpha_cleanup=96,
        pad=1
    )
    build_sheet(
        src_name="hazards_sheet.png",
        dst_name="hazards_sheet_compact.png",
        expected_count=8,
        cols=8,
        rows=1,
        cell_w=32,
        cell_h=32,
        alpha_threshold=128,
        min_pixels=500,
        alpha_cleanup=96,
        pad=1
    )


if __name__ == "__main__":
    main()
