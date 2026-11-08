/* WaqtPlayer — one sound session for the whole Waqt site (Sunny, 2026-11-08).
   Start a sound on the homepage hero or in the Sounds Library, then keep
   browsing: every page that loads this script resumes the sound where it
   left off (position is saved every second). The sound stops ONLY when
   (a) the user stops it, or
   (b) the user plays something else — any other media element on the
   page taking over ends the session.
   Controls: a floating pair of round balls (pause/play + stop) that the
   user can drag anywhere on the screen; left alone, the balls fade to
   low opacity. The Media Session API keeps playback going with the
   screen off and controllable from the lock screen.
   Looping: playback runs through WebAudio — the file is decoded once
   and looped with a 2.5s crossfade across the join, so the loop point
   cannot be heard on any phone (a plain <audio> loop clicks on MP3
   padding and on some browsers even on OGG). If WebAudio or decoding
   is unavailable, a plain <audio> loop is the fallback.
   State lives in sessionStorage: closing the tab ends the session. */
(function () {
  if (window.WaqtPlayer) return;
  var KEY = 'waqtSndV1', POSKEY = 'waqtSndBallPos';
  var XF = 2.5; /* loop crossfade seconds */
  var state = null; /* {key, src, vol, labelBn, labelEn, pos, playing} */
  var playingNow = false, started = false, token = 0;
  var pill = null, tglEl = null, idleTimer = null, lastSave = 0;
  var extEl = null; /* a foreign media element the balls currently control (surah recitation etc.) */

  function lang() { try { return localStorage.getItem('waqtLang') === 'en' ? 'en' : 'bn'; } catch (e) { return 'bn'; } }
  function load() { try { state = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { state = null; } }
  function curPos() {
    if (wa.playing || wa.buffer) return waPos();
    if (elAudio) { try { return elAudio.currentTime || 0; } catch (e) {} }
    return state ? state.pos || 0 : 0;
  }
  function save() {
    try {
      if (state) { state.pos = curPos(); sessionStorage.setItem(KEY, JSON.stringify(state)); }
      else sessionStorage.removeItem(KEY);
    } catch (e) {}
  }
  function pub() { return state ? { key: state.key, playing: playingNow, src: state.src } : { key: null, playing: false, src: null }; }
  function emit() { try { window.dispatchEvent(new CustomEvent('waqtsnd', { detail: pub() })); } catch (e) {} }
  function changed() { setSessionMeta(); updatePill(); emit(); }

  /* ============ WebAudio transport (preferred) ============ */
  var AC = window.AudioContext || window.webkitAudioContext || null;
  var wa = { ok: !!AC, ctx: null, master: null, buffer: null, bufSrc: null, cur: null, seg: null, timer: null, playing: false, live: null };
  function waCtx() {
    if (!wa.ctx) {
      wa.ctx = new AC();
      wa.master = wa.ctx.createGain();
      wa.master.connect(wa.ctx.destination);
      wa.live = new Set();
    }
    return wa.ctx;
  }
  function waLoad(src) {
    if (wa.buffer && wa.bufSrc === src) return Promise.resolve(wa.buffer);
    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('fetch ' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      return new Promise(function (res, rej) { waCtx().decodeAudioData(ab, res, rej); });
    }).then(function (buf) { wa.buffer = buf; wa.bufSrc = src; return buf; });
  }
  function waSpawn(atTime, offset, fadeIn) {
    var ctx = wa.ctx;
    var src = ctx.createBufferSource(); src.buffer = wa.buffer;
    var g = ctx.createGain();
    if (fadeIn > 0) { g.gain.setValueAtTime(0, atTime); g.gain.linearRampToValueAtTime(1, atTime + fadeIn); }
    else g.gain.setValueAtTime(1, atTime);
    src.connect(g); g.connect(wa.master);
    src.start(atTime, offset);
    wa.live.add(src);
    src.onended = function () { wa.live.delete(src); try { g.disconnect(); } catch (e) {} };
    return { node: src, gain: g, endCtx: atTime + (wa.buffer.duration - offset) };
  }
  function waTick() {
    if (!wa.playing || !wa.cur || !wa.buffer) return;
    var ctx = wa.ctx, dur = wa.buffer.duration;
    if (wa.cur.endCtx - ctx.currentTime > XF + 0.5) return;
    var nextStart = wa.cur.endCtx - XF;
    if (nextStart < ctx.currentTime) nextStart = ctx.currentTime;
    var nxt = waSpawn(nextStart, 0, 0);
    try {
      nxt.gain.gain.cancelScheduledValues(nextStart);
      nxt.gain.gain.setValueAtTime(0, nextStart);
      nxt.gain.gain.linearRampToValueAtTime(1, nextStart + XF);
      var old = wa.cur;
      old.gain.gain.cancelScheduledValues(nextStart);
      old.gain.gain.setValueAtTime(1, nextStart);
      old.gain.gain.linearRampToValueAtTime(0, nextStart + XF);
      old.node.stop(nextStart + XF + 0.15);
    } catch (e) {}
    wa.cur = nxt;
    wa.seg = { startCtx: nextStart, startOffset: 0 };
  }
  function waStart(offset) {
    var ctx = waCtx(), dur = wa.buffer.duration;
    waStopNodes();
    offset = ((offset % dur) + dur) % dur;
    wa.master.gain.setTargetAtTime(state && state.vol != null ? state.vol : 1, ctx.currentTime, 0.05);
    var t0 = ctx.currentTime + 0.06;
    wa.seg = { startCtx: t0, startOffset: offset };
    wa.cur = waSpawn(t0, offset, 0.25);
    wa.playing = true; playingNow = true;
    clearInterval(wa.timer);
    wa.timer = setInterval(function () {
      waTick();
      var now = Date.now();
      if (now - lastSave > 1000) { lastSave = now; save(); }
    }, 350);
    if (ctx.state === 'suspended') {
      var rp = ctx.resume();
      if (rp && rp.then) rp.then(function () {
        if (wa.ctx && wa.ctx.state !== 'running') { playingNow = false; updatePill(); emit(); }
      });
      if (rp && rp.catch) rp.catch(function () {});
    }
  }
  function waStopNodes() {
    if (wa.live) wa.live.forEach(function (n) { try { n.onended = null; n.stop(); } catch (e) {} });
    if (wa.live) wa.live.clear();
    wa.cur = null;
  }
  function waPause() {
    save();
    wa.playing = false; playingNow = false;
    clearInterval(wa.timer);
    if (wa.ctx) { var p = wa.ctx.suspend(); if (p && p.catch) p.catch(function () {}); }
  }
  function waResume() {
    if (!wa.ctx || !wa.buffer) return false;
    if (!wa.cur) { waStart(state ? state.pos || 0 : 0); return true; }
    wa.playing = true; playingNow = true;
    var p = wa.ctx.resume(); if (p && p.catch) p.catch(function () {});
    clearInterval(wa.timer);
    wa.timer = setInterval(function () {
      waTick();
      var now = Date.now();
      if (now - lastSave > 1000) { lastSave = now; save(); }
    }, 350);
    return true;
  }
  function waPos() {
    if (!wa.buffer || !wa.seg || !wa.ctx) return state ? state.pos || 0 : 0;
    var dur = wa.buffer.duration;
    var p = wa.seg.startOffset + (wa.ctx.currentTime - wa.seg.startCtx);
    return ((p % dur) + dur) % dur;
  }

  /* ============ <audio> transport (fallback) ============ */
  var elAudio = null;
  function elEnsure() {
    if (elAudio || !state) return elAudio;
    elAudio = new Audio();
    elAudio.loop = true;
    elAudio.preload = 'auto';
    elAudio.src = state.src;
    elAudio.volume = state.vol != null ? state.vol : 1;
    elAudio.addEventListener('play', function () { playingNow = true; if (state) state.playing = true; changed(); });
    elAudio.addEventListener('pause', function () { playingNow = false; if (state) state.playing = false; save(); changed(); });
    elAudio.addEventListener('timeupdate', function () {
      var now = Date.now();
      if (now - lastSave > 1000) { lastSave = now; save(); }
    });
    elAudio.addEventListener('loadedmetadata', function () {
      try { if (state && state.pos > 0 && isFinite(elAudio.duration) && state.pos < elAudio.duration - 0.3) elAudio.currentTime = state.pos; } catch (e) {}
    });
    return elAudio;
  }
  function elPlay() {
    elEnsure();
    if (!elAudio) return;
    if (elAudio.src && elAudio.src.indexOf(state.src) < 0) elAudio.src = state.src;
    elAudio.loop = true;
    elAudio.volume = state.vol != null ? state.vol : 1;
    var p = elAudio.play();
    if (p && p.catch) p.catch(function () { playingNow = false; updatePill(); });
  }

  /* ============ transport facade ============ */
  function tPlay(pos) {
    started = true;
    var my = ++token;
    if (wa.ok) {
      waLoad(state.src).then(function () {
        if (my !== token || !state) return;
        waStart(pos || 0);
        changed();
      }).catch(function () {
        if (my !== token || !state) return;
        wa.ok = false; /* decode/fetch failed — stay on the element path */
        elPlay();
        changed();
      });
    } else elPlay();
  }
  function tPause() {
    token++;
    if (state) state.playing = false;
    if (wa.playing) waPause();
    else if (elAudio) { try { elAudio.pause(); } catch (e) {} }
    playingNow = false;
    save(); changed();
  }
  function tResume() {
    if (state) { state.playing = true; save(); }
    if (wa.ok && wa.buffer) { if (waResume()) { changed(); return; } }
    if (elAudio) elPlay();
    else if (state) tPlay(state.pos || 0);
  }
  function tStop() {
    token++;
    if (wa.ctx) { clearInterval(wa.timer); waStopNodes(); wa.playing = false; wa.seg = null; wa.cur = null; }
    if (elAudio) { try { elAudio.pause(); } catch (e) {} }
    playingNow = false; started = false;
  }
  function tToggle() {
    if (playingNow) tPause();
    else tResume();
  }

  function setSessionMeta() {
    if (!('mediaSession' in navigator) || !state) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: lang() === 'en' ? (state.labelEn || state.labelBn || 'Sound') : (state.labelBn || 'শব্দ'),
        artist: 'Waqt (ওয়াক্ত)',
        album: lang() === 'en' ? 'Sounds Library' : 'সাউন্ড লাইব্রেরি',
        artwork: [{ src: 'logo.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('play', function () { tResume(); changed(); });
      navigator.mediaSession.setActionHandler('pause', function () { tPause(); });
      navigator.mediaSession.setActionHandler('stop', function () { api.stop(); });
    } catch (e) {}
  }

  /* ============ floating balls (draggable, fade when idle) ============ */
  var SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  var SVG_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  function wake() {
    if (!pill) return;
    pill.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (pill) pill.classList.add('idle'); }, 2600);
  }
  function applySavedPos() {
    try {
      var p = JSON.parse(sessionStorage.getItem(POSKEY) || 'null');
      if (!p) return;
      var w = pill.offsetWidth, h = pill.offsetHeight;
      var x = Math.max(4, Math.min(p.x, window.innerWidth - w - 4));
      var y = Math.max(4, Math.min(p.y, window.innerHeight - h - 4));
      pill.style.left = x + 'px'; pill.style.top = y + 'px';
      pill.style.right = 'auto'; pill.style.bottom = 'auto';
    } catch (e) {}
  }
  function buildPill() {
    if (pill || (!state && !extEl)) return;
    var st = document.createElement('style');
    st.textContent =
      '#wqSndPill{position:fixed;right:12px;bottom:14px;z-index:99990;touch-action:none;-webkit-user-select:none;user-select:none;cursor:grab;opacity:1;transition:opacity .6s ease;font-family:inherit}' +
      '#wqSndPill.idle{opacity:.38}' +
      '#wqSndPill .wrap{position:relative;width:52px;height:52px}' +
      '#wqSndPill .tgl{width:52px;height:52px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 6px 18px rgba(0,0,0,.35);background:linear-gradient(135deg,#f3d27a,#c9a227);color:#3a2c00;border:1px solid rgba(255,255,255,.5)}' +
      '#wqSndPill.playing .tgl{animation:wqPulse 1.8s ease-in-out infinite}' +
      '@keyframes wqPulse{0%,100%{box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 0 0 rgba(243,210,122,.45)}50%{box-shadow:0 6px 18px rgba(0,0,0,.35),0 0 0 9px rgba(243,210,122,0)}}' +
      '@media (prefers-reduced-motion: reduce){ #wqSndPill.playing .tgl{animation:none} }' +
      '#wqSndPill .x{position:absolute;top:-4px;right:-4px;width:22px;height:22px;padding:0;background:none;border:0;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.75));opacity:0;pointer-events:none;transition:opacity .4s ease}' +
      '#wqSndPill:not(.idle) .x{opacity:1;pointer-events:auto}' +
      '#wqSndPill .tgl svg{width:22px;height:22px;display:block}' +
      '#wqSndPill .x svg{width:13px;height:13px;display:block}';
    document.head.appendChild(st);
    pill = document.createElement('div');
    pill.id = 'wqSndPill';
    pill.setAttribute('role', 'region');
    pill.setAttribute('aria-label', 'Sound player');
    if (document.querySelector('.bottomnav')) pill.style.bottom = '74px';
    pill.innerHTML =
      '<div class="wrap">' +
      '<button type="button" class="tgl" aria-label="Pause">' + SVG_PAUSE + '</button>' +
      '<button type="button" class="x" aria-label="Stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button>' +
      '</div>';
    tglEl = pill.querySelector('.tgl');
    tglEl.addEventListener('click', function () {
      if (!state && extEl) {
        if (extEl.paused || extEl.ended) { var p = extEl.play(); if (p && p.catch) p.catch(function () {}); }
        else extEl.pause();
        updatePill();
      } else tToggle();
    });
    pill.querySelector('.x').addEventListener('click', function () {
      if (!state && extEl) { try { extEl.pause(); } catch (e) {} extEl = null; hidePill(); return; }
      api.stop();
    });
    /* drag anywhere; a real drag suppresses the click that follows */
    var drag = null, suppress = false;
    pill.addEventListener('click', function (e) {
      if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; }
    }, true);
    pill.addEventListener('pointerdown', function (e) {
      wake();
      var r = pill.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      try { pill.setPointerCapture(e.pointerId); } catch (err) {}
    });
    pill.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var x = e.clientX - drag.dx, y = e.clientY - drag.dy;
      x = Math.max(4, Math.min(x, window.innerWidth - pill.offsetWidth - 4));
      y = Math.max(4, Math.min(y, window.innerHeight - pill.offsetHeight - 4));
      if (!drag.moved) {
        var r0 = pill.getBoundingClientRect();
        if (Math.abs(x - r0.left) + Math.abs(y - r0.top) < 7) return;
        drag.moved = true;
      }
      pill.style.left = x + 'px'; pill.style.top = y + 'px';
      pill.style.right = 'auto'; pill.style.bottom = 'auto';
      drag.x = x; drag.y = y;
    });
    function dragEnd(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) {
        suppress = true;
        setTimeout(function () { suppress = false; }, 350);
        try { sessionStorage.setItem(POSKEY, JSON.stringify({ x: drag.x, y: drag.y })); } catch (err) {}
      }
      drag = null;
      wake();
    }
    pill.addEventListener('pointerup', dragEnd);
    pill.addEventListener('pointercancel', dragEnd);
    document.body.appendChild(pill);
    applySavedPos();
    updatePill();
    wake();
  }
  function updatePill() {
    if (!pill || (!state && !extEl)) return;
    var playing = state ? playingNow : (extEl ? (!extEl.paused && !extEl.ended) : false);
    pill.classList.toggle('playing', playing);
    tglEl.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
    tglEl.setAttribute('aria-label', playing ? (lang() === 'en' ? 'Pause' : 'থামান') : (lang() === 'en' ? 'Play' : 'চালান'));
    wake();
  }
  function hidePill() { if (pill) { pill.remove(); pill = null; tglEl = null; clearTimeout(idleTimer); } }

  var api = {
    play: function (cfg) {
      if (extEl) { try { extEl.pause(); } catch (e) {} extEl = null; }
      load();
      var sameSrc = state && state.src === cfg.src;
      var pos = sameSrc && state ? (curPos() || state.pos || 0) : 0;
      state = {
        key: cfg.key, src: cfg.src,
        vol: cfg.vol != null ? cfg.vol : 1,
        labelBn: cfg.labelBn || '', labelEn: cfg.labelEn || '',
        pos: pos, playing: true
      };
      buildPill();
      tPlay(pos);
      save(); updatePill(); emit();
    },
    setSrc: function (src, vol) {
      if (!state) return;
      state.src = src;
      if (vol != null) state.vol = vol;
      state.pos = 0;
      if (started) {
        var was = playingNow;
        tStop();
        if (was) { state.playing = true; tPlay(0); }
      }
      save(); emit();
    },
    toggleKey: function (cfg) {
      load();
      if (state && cfg && state.key === cfg.key && started) tToggle();
      else if (cfg) api.play(cfg);
    },
    pause: function () { tPause(); },
    stop: function () {
      tStop();
      state = null; save(); hidePill(); emit();
    },
    current: pub
  };
  window.WaqtPlayer = api;

  /* Yield rule: any OTHER media element on the page starting playback
     ends this sound session — the user chose something else. (Our own
     fallback audio is created with new Audio() and never enters the
     document, so it cannot trigger this; hero/library thunder
     one-shots use new Audio() too.) */
  document.addEventListener('play', function (e) {
    var t = e.target;
    if (!t || (t.tagName !== 'AUDIO' && t.tagName !== 'VIDEO') || t === elAudio) return;
    if (state) api.stop();
    adoptExt(t);
  }, true);
  function adoptExt(t) {
    if (extEl === t) { buildPill(); updatePill(); return; }
    extEl = t;
    if (!t.__wqAdopted) {
      t.__wqAdopted = true;
      t.addEventListener('pause', function () { if (extEl === t) updatePill(); });
      t.addEventListener('play', function () { if (extEl === t) updatePill(); });
      t.addEventListener('ended', function () { if (extEl === t) { extEl = null; if (!state) hidePill(); } });
    }
    buildPill(); updatePill();
  }

  window.addEventListener('pagehide', save);
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    load();
    if (!state || !state.src) return;
    started = true;
    buildPill(); updatePill();
    if (!state.playing) return;
    if (wa.ok && wa.buffer) { waStart(state.pos || 0); changed(); }
    else if (wa.ok || elAudio) tPlay(state.pos || 0);
    else tPlay(state.pos || 0);
  });

  /* Resume an active session on this page. */
  function boot() {
    load();
    if (state && state.src) {
      started = true;
      buildPill();
      if (state.playing) tPlay(state.pos || 0);
      else updatePill();
      emit();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
