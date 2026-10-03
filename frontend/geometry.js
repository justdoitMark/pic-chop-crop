// Геометрия поворота и наклона: чистые функции без DOM. Страница берёт их из
// window.PccGeometry, тесты — через require (module.exports).
// Все прямоугольники — в px #stage. Картинка: rect = {cx, cy, w, h, deg} —
// прямоугольник w×h с центром (cx, cy), повёрнутый на deg по часовой.
// Рамка: box = {x, y, w, h}, всегда без поворота.
(function(root){
  "use strict";

  var EPS = 1e-6;

  function clampNum(v, min, max){ return Math.min(Math.max(v, min), max); }

  // Для кратных 90° — точные значения: иначе cos(90°) = 6e-17, и поворот на
  // четверть при экспорте размывал бы пиксели.
  function cosSin(deg){
    var d = ((deg % 360) + 360) % 360;
    if (d === 0) return { c: 1, s: 0 };
    if (d === 90) return { c: 0, s: 1 };
    if (d === 180) return { c: -1, s: 0 };
    if (d === 270) return { c: 0, s: -1 };
    var r = deg * Math.PI / 180;
    return { c: Math.cos(r), s: Math.sin(r) };
  }

  function orientedSize(w, h, quarterTurns){
    return Math.abs(quarterTurns) % 2 ? { w: h, h: w } : { w: w, h: h };
  }

  function boundingSize(w, h, deg){
    var t = cosSin(deg), c = Math.abs(t.c), s = Math.abs(t.s);
    return { w: w * c + h * s, h: w * s + h * c };
  }

  // Точка экрана → смещения вдоль собственных осей картинки от её центра.
  function toImage(px, py, rect){
    var t = cosSin(rect.deg), dx = px - rect.cx, dy = py - rect.cy;
    return { u: dx * t.c + dy * t.s, v: -dx * t.s + dy * t.c };
  }

  function isBoxInside(box, rect){
    var xs = [box.x, box.x + box.w], ys = [box.y, box.y + box.h];
    for (var i = 0; i < 2; i++){
      for (var j = 0; j < 2; j++){
        var p = toImage(xs[i], ys[j], rect);
        if (Math.abs(p.u) > rect.w / 2 + EPS || Math.abs(p.v) > rect.h / 2 + EPS) return false;
      }
    }
    return true;
  }

  // Ближайшее положение рамки того же размера, при котором она вся на картинке.
  // Допустимые центры — тот же наклонённый прямоугольник, уменьшенный на
  // полуразмах рамки вдоль осей картинки, поэтому зажимаем центр по каждой оси
  // в системе координат картинки. Рамку, которая не помещается вовсе, сначала
  // уменьшает fitInside.
  function clampBoxCenter(box, rect){
    var t = cosSin(rect.deg), c = Math.abs(t.c), s = Math.abs(t.s);
    var mu = Math.max(0, rect.w / 2 - (box.w * c + box.h * s) / 2);
    var mv = Math.max(0, rect.h / 2 - (box.w * s + box.h * c) / 2);
    var p = toImage(box.x + box.w / 2, box.y + box.h / 2, rect);
    var u = clampNum(p.u, -mu, mu), v = clampNum(p.v, -mv, mv);
    var cx = rect.cx + u * t.c - v * t.s, cy = rect.cy + u * t.s + v * t.c;
    return { x: cx - box.w / 2, y: cy - box.h / 2, w: box.w, h: box.h };
  }

  // Наибольшая рамка с соотношением aspect (w/h), которая помещается в картинку.
  function maxBoxSize(aspect, rect){
    var t = cosSin(rect.deg), c = Math.abs(t.c), s = Math.abs(t.s);
    var h = Math.min(rect.w / (aspect * c + s), rect.h / (aspect * s + c));
    return { w: h * aspect, h: h };
  }

  // Наибольшая ширина рамки, растягиваемой из неподвижного угла (ax, ay) в
  // сторону growX/growY (±1). Бинарный поиск: при наклоне край картинки не
  // параллелен рамке, и формула зависит от того, какой угол упрётся первым.
  function maxWidthFromAnchor(ax, ay, growX, growY, aspect, rect){
    function boxOf(w){
      var h = w / aspect;
      return { x: growX > 0 ? ax : ax - w, y: growY > 0 ? ay : ay - h, w: w, h: h };
    }
    if (!isBoxInside(boxOf(0), rect)) return 0;
    var lo = 0, hi = rect.w + rect.h;
    for (var i = 0; i < 60; i++){
      var mid = (lo + hi) / 2;
      if (isBoxInside(boxOf(mid), rect)) lo = mid; else hi = mid;
    }
    // Eliminate floating-point noise if very close to an integer
    var nearestInt = Math.round(lo);
    if (Math.abs(lo - nearestInt) < 2e-6) return nearestInt;
    return lo;
  }

  function fitInside(box, rect){
    var m = maxBoxSize(box.w / box.h, rect);
    if (box.w > m.w){
      var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      box = { x: cx - m.w / 2, y: cy - m.h / 2, w: m.w, h: m.h };
    }
    return clampBoxCenter(box, rect);
  }

  var api = {
    cosSin: cosSin, orientedSize: orientedSize, boundingSize: boundingSize,
    isBoxInside: isBoxInside, clampBoxCenter: clampBoxCenter, maxBoxSize: maxBoxSize,
    maxWidthFromAnchor: maxWidthFromAnchor, fitInside: fitInside
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PccGeometry = api;
})(this);
