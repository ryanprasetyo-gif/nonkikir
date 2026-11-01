'use strict';

// Canvas overlay: gambar sketsa di atas video webcam.
//  - Geser (1 jari / mouse) untuk memindah
//  - Cubit (2 jari) untuk mengubah ukuran + memutar, scroll mouse untuk ukuran, Shift + scroll untuk memutar
//  - Slider opasitas / ukuran / rotasi
//  - Tombol kunci: membekukan posisi, ukuran, dan rotasi (opasitas tetap bisa diatur)
(function () {
  var IMAGE_SRC = 'img/sketch.png';
  var MIN_ZOOM = 0.1;
  var MAX_ZOOM = 5;
  var FIT_RATIO = 0.8; // ukuran awal gambar = 80% dari area kamera

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('overlay');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');

  var lockBtn = document.getElementById('lockBtn');
  var resetBtn = document.getElementById('resetBtn');
  var opacityInput = document.getElementById('opacity');
  var zoomInput = document.getElementById('zoom');
  var rotationInput = document.getElementById('rotation');
  var opacityOut = document.getElementById('opacityOut');
  var zoomOut = document.getElementById('zoomOut');
  var rotationOut = document.getElementById('rotationOut');

  var img = new Image();
  var view = { w: 0, h: 0 }; // ukuran area kamera (CSS px)
  var baseScale = 1;         // skala "pas layar" -> zoom 100%
  var ready = false;         // true setelah gambar dan ukuran area siap

  // Putting state in global scope makes it inspectable from the browser console.
  var state = window.overlayState = {
    x: 0,            // pusat gambar di area kamera (CSS px)
    y: 0,
    zoom: 1,         // 1 = 100%
    rotation: 0,     // derajat, -180..180
    opacity: 0.5,    // 0..1
    locked: false
  };

  /* ---------- Menggambar ---------- */

  var drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(function () {
      drawQueued = false;
      draw();
    });
  }

  function draw() {
    var dpr = view.w ? canvas.width / view.w : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!ready) return;

    var s = baseScale * state.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = state.opacity;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(state.x, state.y);
    ctx.rotate(state.rotation * Math.PI / 180);
    ctx.scale(s, s);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  }

  /* ---------- Ukuran canvas ---------- */

  function resize() {
    var rect = stage.getBoundingClientRect();
    var w = Math.round(rect.width);
    var h = Math.round(rect.height);
    if (!w || !h) return;

    if (view.w) {
      // Pertahankan posisi relatif gambar saat area berubah (mis. layar diputar).
      state.x *= w / view.w;
      state.y *= h / view.h;
    }
    view.w = w;
    view.h = h;

    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    if (!ready && img.complete && img.naturalWidth) {
      ready = true;
      resetPlacement();
    }
    requestDraw();
  }

  function resetPlacement() {
    baseScale = Math.min(
      view.w * FIT_RATIO / img.naturalWidth,
      view.h * FIT_RATIO / img.naturalHeight
    );
    state.x = view.w / 2;
    state.y = view.h / 2;
    state.zoom = 1;
    state.rotation = 0;
    syncUI();
    requestDraw();
  }

  /* ---------- Sinkronisasi UI ---------- */

  function syncUI() {
    opacityInput.value = Math.round(state.opacity * 100);
    zoomInput.value = Math.round(state.zoom * 100);
    rotationInput.value = Math.round(state.rotation);
    opacityOut.textContent = opacityInput.value + '%';
    zoomOut.textContent = zoomInput.value + '%';
    rotationOut.textContent = rotationInput.value + '°';
  }

  function updateHint() {
    hint.classList.toggle('is-locked', state.locked);
    hint.textContent = state.locked
      ? 'Terkunci'
      : 'Seret untuk memindah · cubit atau scroll untuk ukuran';
  }

  function setLocked(locked) {
    state.locked = locked;
    pointers.clear();
    canvas.classList.remove('is-dragging');
    canvas.classList.toggle('is-locked', locked);
    lockBtn.setAttribute('aria-pressed', String(locked));
    zoomInput.disabled = locked;
    rotationInput.disabled = locked;
    resetBtn.disabled = locked;
    updateHint();
  }

  /* ---------- Matematika bantu ---------- */

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function normalizeDeg(d) {
    return ((d + 180) % 360 + 360) % 360 - 180;
  }

  // Titik pada layar (px) relatif terhadap area kamera.
  function localPoint(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Ubah ukuran/putar gambar sehingga titik gambar di bawah `from` berpindah ke `to`.
  function transformAround(from, to, scale, angleRad) {
    var vx = state.x - from.x;
    var vy = state.y - from.y;
    var cos = Math.cos(angleRad);
    var sin = Math.sin(angleRad);
    state.x = to.x + scale * (vx * cos - vy * sin);
    state.y = to.y + scale * (vx * sin + vy * cos);
    state.zoom *= scale;
    state.rotation = normalizeDeg(state.rotation + angleRad * 180 / Math.PI);
  }

  /* ---------- Input pointer: geser + cubit ---------- */

  var pointers = new Map(); // pointerId -> {x, y}

  canvas.addEventListener('pointerdown', function (e) {
    if (state.locked || pointers.size >= 2) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // hanya klik kiri
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, localPoint(e));
    canvas.classList.add('is-dragging');
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (state.locked || !pointers.has(e.pointerId)) return;
    var prev = pointers.get(e.pointerId);
    var cur = localPoint(e);

    if (pointers.size === 1) {
      state.x += cur.x - prev.x;
      state.y += cur.y - prev.y;
    } else {
      var other = null;
      pointers.forEach(function (p, id) {
        if (id !== e.pointerId) other = p;
      });
      var d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      var d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      if (d0 > 0) {
        var a0 = Math.atan2(prev.y - other.y, prev.x - other.x);
        var a1 = Math.atan2(cur.y - other.y, cur.x - other.x);
        var scale = clamp(state.zoom * d1 / d0, MIN_ZOOM, MAX_ZOOM) / state.zoom;
        var m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
        var m1 = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
        transformAround(m0, m1, scale, a1 - a0);
      }
    }

    pointers.set(e.pointerId, cur);
    syncUI();
    requestDraw();
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.classList.remove('is-dragging');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  /* ---------- Input scroll mouse ---------- */

  canvas.addEventListener('wheel', function (e) {
    if (state.locked) return;
    e.preventDefault();

    var delta = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 16 : 1);
    if (e.shiftKey) {
      // Shift + scroll: putar di sekitar pusat gambar.
      state.rotation = normalizeDeg(state.rotation - delta * 0.15);
    } else {
      var scale = clamp(state.zoom * Math.exp(-delta * 0.0015), MIN_ZOOM, MAX_ZOOM) / state.zoom;
      var p = localPoint(e);
      transformAround(p, p, scale, 0); // zoom ke arah kursor
    }
    syncUI();
    requestDraw();
  }, { passive: false });

  /* ---------- Kontrol panel ---------- */

  opacityInput.addEventListener('input', function () {
    state.opacity = opacityInput.value / 100;
    syncUI();
    requestDraw();
  });

  zoomInput.addEventListener('input', function () {
    if (state.locked) return;
    state.zoom = clamp(zoomInput.value / 100, MIN_ZOOM, MAX_ZOOM);
    syncUI();
    requestDraw();
  });

  rotationInput.addEventListener('input', function () {
    if (state.locked) return;
    state.rotation = Number(rotationInput.value);
    syncUI();
    requestDraw();
  });

  lockBtn.addEventListener('click', function () {
    setLocked(!state.locked);
  });

  resetBtn.addEventListener('click', function () {
    if (!state.locked) resetPlacement();
  });

  /* ---------- Mulai ---------- */

  img.onload = resize;
  img.onerror = function () {
    var el = document.getElementById('errorMsg');
    if (el) el.innerHTML += '<p>Gambar tidak bisa dimuat: ' + IMAGE_SRC + '</p>';
  };
  img.src = IMAGE_SRC;

  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }

  syncUI();
  updateHint();
  resize();
})();
