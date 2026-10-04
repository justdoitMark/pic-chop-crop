"""Build out/sheet.html: a blind side-by-side sheet for rating cut-outs 1-5.

    python sheet.py                                   # one column per model (DML runs)
    python sheet.py --columns birefnet_lite-fp16-dml birefnet_lite-fp16-dml-clean ...

Columns are shown as letters (A, B, ...) in a fixed shuffled order, so the
model name does not sway the rating; the key is in out/sheet_key.json and in
the exported ratings. Thumbnails go to out/thumbs/; a click opens the full
image at 1:1, scrolled to an edge of the object.
"""
import argparse
import csv
import json
import os
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
THUMB_SIZE = 420
MODEL_ORDER = ["isnet", "birefnet_lite", "birefnet", "ben2"]
SHUFFLE_SEED = 7
VARIANTS = (("w", "white.jpg"), ("b", "black.jpg"), ("c", "cut.png"))


def default_columns(out):
    """One DML run per model: fp16 unless results.csv marks it suspect or failed."""
    with (out / "results.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    columns = []
    for model in MODEL_ORDER:
        for precision in ("fp16", "fp32"):
            mine = [r for r in rows if r["model"] == model and r["precision"] == precision
                    and r["provider"] == "dml"]
            if mine and not any(r["suspect"] == "True" or r["error"] for r in mine):
                columns.append(f"{model}-{precision}-dml")
                break
    return columns


def thumb(src, dest):
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((THUMB_SIZE, THUMB_SIZE))
        if dest.suffix == ".png":
            img.save(dest)
        else:
            img.convert("RGB").save(dest, quality=85)


def edge_point(mask_path):
    """A point on the object's outline (top of the mask), as fractions of w/h."""
    m = np.asarray(Image.open(mask_path)) > 127
    rows = np.flatnonzero(m.any(axis=1))
    if rows.size == 0:
        return 0.5, 0.5
    top = rows[0]
    cols = np.flatnonzero(m[top])
    return float(cols[cols.size // 2] / m.shape[1]), float(top / m.shape[0])


def build(columns, out, photos_dir):
    """Write <out>/sheet.html, <out>/sheet_key.json and thumbnails in <out>/thumbs/."""
    def rel(path):  # URL of a file relative to sheet.html
        return Path(os.path.relpath(path, out)).as_posix()

    thumbs = out / "thumbs"
    photos = sorted(p for p in photos_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    order = columns[:]
    random.Random(SHUFFLE_SEED).shuffle(order)
    letters = {col: chr(ord("A") + i) for i, col in enumerate(order)}
    key = {letters[c]: c for c in order}
    (out / "sheet_key.json").write_text(json.dumps(key, indent=2))

    data = {"columns": [letters[c] for c in order], "key": key, "photos": []}
    for photo in photos:
        orig_thumb = thumbs / "orig" / f"{photo.stem}.jpg"
        thumb(photo, orig_thumb)
        entry = {"name": photo.name, "orig": rel(photo), "origThumb": rel(orig_thumb), "cells": {}}
        for col in order:
            cell = {}
            for short, suffix in VARIANTS:
                full = out / col / f"{photo.stem}.{suffix}"
                if full.exists():
                    t = thumbs / col / f"{photo.stem}.{short}{full.suffix}"
                    thumb(full, t)
                    cell[short] = {"full": rel(full), "thumb": rel(t)}
            if cell:
                entry["cells"][letters[col]] = cell
        masks = [out / c / f"{photo.stem}.mask.png" for c in order]
        mask = next((m for m in masks if m.exists()), None)
        entry["edge"] = edge_point(mask) if mask else (0.5, 0.5)
        data["photos"].append(entry)

    # Inside <script> entities are not decoded; only "</" can end the block early.
    page = TEMPLATE.replace("__DATA__", json.dumps(data).replace("</", "<\\/"))
    (out / "sheet.html").write_text(page, encoding="utf-8")
    print(f"wrote {out / 'sheet.html'}: {len(photos)} photos x {len(order)} columns")


TEMPLATE = r"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Оценка вырезки фона</title>
<style>
  :root { --checker: repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
  body { font: 14px system-ui, sans-serif; margin: 16px; background: #f4f4f4; color: #222; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .help { color: #555; margin: 0 0 12px; max-width: 70em; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 6px; vertical-align: top; background: #fff; }
  th { position: sticky; top: 0; background: #eee; z-index: 1; }
  .name { font-size: 12px; color: #555; word-break: break-all; max-width: 140px; }
  .trio { display: flex; gap: 4px; }
  .trio img { width: 140px; height: 140px; object-fit: contain; cursor: zoom-in; display: block; }
  .v-w img { background: #fff; } .v-b img { background: #000; } .v-c img { background: var(--checker); }
  .orig img { width: 180px; height: 180px; object-fit: contain; cursor: zoom-in; }
  .rate { margin-top: 6px; display: flex; gap: 2px; }
  .rate button { width: 30px; height: 28px; border: 1px solid #aaa; background: #fafafa; cursor: pointer; border-radius: 4px; }
  .rate button.on { background: #1a73e8; color: #fff; border-color: #1a73e8; }
  .bar { position: sticky; bottom: 0; background: #fff; border-top: 1px solid #ccc; padding: 8px; margin-top: 12px; display: flex; gap: 12px; align-items: center; }
  .bar textarea { width: 32em; height: 3em; font: 11px monospace; }
  #zoom { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: none; flex-direction: column; z-index: 10; }
  #zoom.open { display: flex; }
  #zoom .head { color: #fff; padding: 8px 12px; display: flex; gap: 16px; align-items: center; }
  #zoom .head button { padding: 4px 10px; }
  #zoom .view { flex: 1; overflow: auto; cursor: grab; }
  #zoom .view img { display: block; max-width: none; image-orientation: from-image; }
  #zoom .view.v-w img { background: #fff; } #zoom .view.v-b img { background: #000; } #zoom .view.v-c img { background: var(--checker); }
</style></head><body>
<h1>Оценка вырезки фона</h1>
<p class="help">Колонки A, B, … — разные модели/варианты, названия скрыты. Для каждой ячейки поставьте 1–5:
<b>5 — беру в карточку как есть</b>, 4 — беру, мелочи не мешают, 3 — нужна ручная правка, 2 — плохо, 1 — не тот объект / мусор.
Клик по картинке — увеличение 1:1 на краю предмета; там ←/→ — соседняя колонка на том же месте, W/B/C — белый/чёрный/шахматка, Esc — закрыть.
Оценки сохраняются в этом браузере; в конце нажмите «Сохранить ratings.json» и положите файл в <code>spikes/bg-removal/out/</code> (или скопируйте текст из поля).</p>
<table id="t"></table>
<div class="bar"><span id="count"></span><button id="save">Сохранить ratings.json</button><textarea id="json" readonly></textarea></div>
<div id="zoom"><div class="head"><span id="ztitle"></span>
  <button data-v="w">W белый</button><button data-v="b">B чёрный</button><button data-v="c">C шахматка</button>
  <button id="zclose">Esc закрыть</button></div><div class="view" id="zview"><img id="zimg" alt=""></div></div>
<script id="data" type="application/json">__DATA__</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var STORE = 'pcc-bg-ratings';
  var ratings = {};
  try { ratings = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { ratings = {}; }
  var t = document.getElementById('t');
  var head = '<tr><th>Фото</th>' + DATA.columns.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
  var body = DATA.photos.map(function (p, pi) {
    var cells = DATA.columns.map(function (c) {
      var cell = p.cells[c];
      if (!cell) return '<td>—</td>';
      var trio = ['w', 'b', 'c'].filter(function (v) { return cell[v]; }).map(function (v) {
        return '<span class="v-' + v + '"><img loading="lazy" src="' + cell[v].thumb + '" data-p="' + pi + '" data-c="' + c + '" data-v="' + v + '" alt=""></span>';
      }).join('');
      var btns = [1, 2, 3, 4, 5].map(function (n) {
        return '<button data-p="' + pi + '" data-c="' + c + '" data-n="' + n + '">' + n + '</button>';
      }).join('');
      return '<td><div class="trio">' + trio + '</div><div class="rate">' + btns + '</div></td>';
    }).join('');
    return '<tr><td class="orig"><img loading="lazy" src="' + p.origThumb + '" data-p="' + pi + '" data-c="orig" alt=""><div class="name">' +
      (pi + 1) + '. ' + p.name + '</div></td>' + cells + '</tr>';
  }).join('');
  t.innerHTML = head + body;

  function keyOf(pi, c) { return DATA.photos[pi].name + '|' + c; }
  function refresh() {
    var n = 0, total = 0;
    t.querySelectorAll('.rate button').forEach(function (b) {
      var on = ratings[keyOf(+b.dataset.p, b.dataset.c)] === +b.dataset.n;
      b.classList.toggle('on', on);
    });
    DATA.photos.forEach(function (p, pi) { DATA.columns.forEach(function (c) {
      if (p.cells[c]) { total++; if (ratings[keyOf(pi, c)]) n++; } }); });
    document.getElementById('count').textContent = 'Оценено ' + n + ' из ' + total;
    var out = { key: DATA.key, ratings: ratings };
    document.getElementById('json').value = JSON.stringify(out);
    try { localStorage.setItem(STORE, JSON.stringify(ratings)); } catch (e) {}
  }
  t.addEventListener('click', function (e) {
    var b = e.target.closest('.rate button');
    if (b) { ratings[keyOf(+b.dataset.p, b.dataset.c)] = +b.dataset.n; refresh(); return; }
    var img = e.target.closest('img[data-p]');
    if (img) openZoom(+img.dataset.p, img.dataset.c, img.dataset.v || 'w');
  });
  document.getElementById('save').onclick = function () {
    var blob = new Blob([document.getElementById('json').value], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ratings.json'; a.click();
  };

  var zoom = document.getElementById('zoom'), zview = document.getElementById('zview'), zimg = document.getElementById('zimg');
  var cur = null;
  var cols = ['orig'].concat(DATA.columns);
  function openZoom(pi, c, v) {
    var keep = cur && cur.p === pi ? { x: zview.scrollLeft, y: zview.scrollTop } : null;
    cur = { p: pi, c: c, v: v };
    var p = DATA.photos[pi];
    var src = c === 'orig' ? p.orig : (p.cells[c] && p.cells[c][v] ? p.cells[c][v].full : null);
    if (!src) return;
    zview.className = 'view v-' + v;
    document.getElementById('ztitle').textContent = (pi + 1) + '. ' + p.name + ' — ' + (c === 'orig' ? 'оригинал' : 'колонка ' + c + ' (' + v.toUpperCase() + ')');
    zoom.classList.add('open');
    zimg.onload = function () {
      if (keep) { zview.scrollLeft = keep.x; zview.scrollTop = keep.y; return; }
      zview.scrollLeft = p.edge[0] * zimg.naturalWidth - zview.clientWidth / 2;
      zview.scrollTop = p.edge[1] * zimg.naturalHeight - zview.clientHeight / 2;
    };
    zimg.src = src;
  }
  function closeZoom() { zoom.classList.remove('open'); cur = null; zimg.removeAttribute('src'); }
  document.getElementById('zclose').onclick = closeZoom;
  zoom.querySelectorAll('.head button[data-v]').forEach(function (b) {
    b.onclick = function () { if (cur) openZoom(cur.p, cur.c, b.dataset.v); };
  });
  document.addEventListener('keydown', function (e) {
    if (!cur) return;
    if (e.key === 'Escape') closeZoom();
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      var i = cols.indexOf(cur.c) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i >= 0 && i < cols.length) { openZoom(cur.p, cols[i], cur.v); e.preventDefault(); }
    } else if ('wbc'.indexOf(e.key.toLowerCase()) >= 0) openZoom(cur.p, cur.c, e.key.toLowerCase());
  });
  var drag = null;
  zview.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, l: zview.scrollLeft, t: zview.scrollTop }; e.preventDefault(); });
  window.addEventListener('mousemove', function (e) { if (drag) { zview.scrollLeft = drag.l - (e.clientX - drag.x); zview.scrollTop = drag.t - (e.clientY - drag.y); } });
  window.addEventListener('mouseup', function () { drag = null; });
  refresh();
})();
</script>
</body></html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--columns", nargs="+", help="run folders under <out> to show")
    ap.add_argument("--out", default=str(ROOT / "out"))
    ap.add_argument("--photos", default=str(ROOT / "photos"))
    args = ap.parse_args()
    out = Path(args.out).resolve()
    build(args.columns or default_columns(out), out, Path(args.photos).resolve())


if __name__ == "__main__":
    main()
