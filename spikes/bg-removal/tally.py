"""Turn exported ratings into Markdown tables for RESULTS.md.

    python tally.py out/ratings.json [out/ratings-clean.json ...]

Prints a photo x model table and a summary: photos rated 4-5 (the plan's
"take it into the card as is" bar is >= 7 of 10), mean and median.
"""
import json
import statistics
import sys
from pathlib import Path

PASS_BAR = 7  # photos out of 10 rated 4-5


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    merged, order = {}, []
    for path in sys.argv[1:]:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        for key, value in data["ratings"].items():
            photo, letter = key.rsplit("|", 1)
            model = data["key"][letter]
            if model not in order:
                order.append(model)
            merged.setdefault(photo, {})[model] = value
    photos = sorted(merged)

    print("| № | Фото | " + " | ".join(order) + " |")
    print("|---|---|" + "---|" * len(order))
    for i, photo in enumerate(photos, 1):
        cells = [str(merged[photo].get(m, "—")) for m in order]
        print(f"| {i} | {photo[:28]} | " + " | ".join(cells) + " |")

    print()
    print("| Модель | Фото на 4–5 | Порог ≥ 7/10 | Средняя | Медиана | Оценок |")
    print("|---|---|---|---|---|---|")
    for m in order:
        vals = [merged[p][m] for p in photos if m in merged[p]]
        good = sum(v >= 4 for v in vals)
        verdict = "да" if good >= PASS_BAR else "нет"
        print(f"| {m} | {good} из {len(vals)} | {verdict} | {statistics.mean(vals):.1f} | "
              f"{statistics.median(vals):g} | {len(vals)} |")


if __name__ == "__main__":
    main()
