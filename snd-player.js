/* WaqtPlayer — one sound session for the whole Waqt site (Sunny, 2026-11-08).
   Start a sound on the homepage hero or in the Sounds Library, then keep
   browsing: every page that loads this script resumes the sound where it
   left off (position is saved every second). The sound stops ONLY when
   (a) the user stops it (pill close / hero chip / library row), or
   (b) the user plays something else — any other media element on the
   page taking over ends the session. A floating pill shows what is
   playing, with pause/resume and stop controls; the Media Session API
   keeps it playing with the screen off and controllable from the lock
   screen. State lives in sessionStorage: closing the tab ends it. */
(function () {
  if (window.WaqtPlayer) return;
  var KEY = 'waqtSndV1';
  var state = null; /* {key, src, vol, labelBn, labelEn, pos, playing} */
  var audio = null, pill = null, lblEl = null, tglEl = null, eqEl = null, lastSave = 0;

  function lang() { try { return localStorage.getItem('waqtLang') === 'en' ? 'en' : 'bn'; } catch (e) { return 'bn'; } }
  function load() { try { state = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { state = null; } }
  function save() {
    try {
      if (state) { if (audio) state.pos = audio.currentTime || 0; sessionStorage.setItem(KEY, JSON.stringify(state)); }
      else sessionStorage.removeItem(KEY);
    } catch (e) {}
  }
  function isPlaying() { return !!(audio && !audio.paused && !audio.ended); }
  function pub() { return state ? { key: state.key, playing: isPlaying(), src: state.src } : { key: null, playing: false, src: null }; }
  function emit() { try { window.dispatchEvent(new CustomEvent('waqtsnd', { detail: pub() })); } catch (e) {} }

  function ensureAudio() {
    if (audio || !state) return audio;
    audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.src = state.src;
    audio.volume = state.vol != null ? state.vol : 1;
    audio.addEventListener('play', function () { setSessionMeta(); updatePill(); emit(); });
    audio.addEventListener('pause', function () { save(); updatePill(); emit(); });
    audio.addEventListener('timeupdate', function () {
      var now = Date.now();
      if (now - lastSave > 1000) { lastSave = now; save(); }
    });
    audio.addEventListener('loadedmetadata', function () {
      try { if (state && state.pos > 0 && isFinite(audio.duration) && state.pos < audio.duration - 0.3) audio.currentTime = state.pos; } catch (e) {}
    });
    window.addEventListener('pagehide', save);
    return audio;
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
      navigator.mediaSession.setActionHandler('play', function () { if (audio) { var p = audio.play(); if (p && p.catch) p.catch(function () {}); } });
      navigator.mediaSession.setActionHandler('pause', function () { if (audio) audio.pause(); });
      navigator.mediaSession.setActionHandler('stop', function () { api.stop(); });
    } catch (e) {}
  }

  function buildPill() {
    if (pill || !state) return;
    var st = document.createElement('style');
    st.textContent =
      '#wqSndPill{position:fixed;right:12px;bottom:14px;z-index:99990;display:flex;align-items:center;gap:9px;max-width:min(78vw,340px);' +
      'background:rgba(7,38,28,.90);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;border:1px solid rgba(243,210,122,.45);' +
      'border-radius:999px;padding:7px 8px 7px 13px;box-shadow:0 8px 24px rgba(0,0,0,.35);font-family:inherit}' +
      '#wqSndPill .eq{display:inline-flex;align-items:flex-end;gap:2px;height:14px;flex:none}' +
      '#wqSndPill .eq i{width:3px;background:#f3d27a;border-radius:2px;height:5px}' +
      '#wqSndPill.playing .eq i{animation:wqEq 0.9s ease-in-out infinite alternate}' +
      '#wqSndPill.playing .eq i:nth-child(2){animation-delay:.25s}#wqSndPill.playing .eq i:nth-child(3){animation-delay:.5s}' +
      '@keyframes wqEq{from{height:4px} to{height:14px}}' +
      '@media (prefers-reduced-motion: reduce){ #wqSndPill.playing .eq i{animation:none} }' +
      '#wqSndPill .lbl{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#wqSndPill button{flex:none;width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
      '#wqSndPill .tgl{background:linear-gradient(135deg,#f3d27a,#c9a227);color:#3a2c00}' +
      '#wqSndPill .x{background:rgba(255,255,255,.14);color:#fff}' +
      '#wqSndPill button svg{width:17px;height:17px;display:block}';
    document.head.appendChild(st);
    pill = document.createElement('div');
    pill.id = 'wqSndPill';
    pill.setAttribute('role', 'region');
    pill.setAttribute('aria-label', 'Sound player');
    if (document.querySelector('.bottomnav')) pill.style.bottom = '74px';
    pill.innerHTML =
      '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="lbl"></span>' +
      '<button type="button" class="tgl" aria-label="Pause"></button>' +
      '<button type="button" class="x" aria-label="Stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button>';
    lblEl = pill.querySelector('.lbl');
    tglEl = pill.querySelector('.tgl');
    eqEl = pill.querySelector('.eq');
    tglEl.addEventListener('click', function () {
      if (!audio) return;
      if (isPlaying()) audio.pause();
      else { var p = audio.play(); if (p && p.catch) p.catch(function () {}); }
    });
    pill.querySelector('.x').addEventListener('click', function () { api.stop(); });
    document.body.appendChild(pill);
    updatePill();
  }

  var SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  var SVG_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  function updatePill() {
    if (!pill || !state) return;
    var playing = isPlaying();
    pill.classList.toggle('playing', playing);
    lblEl.textContent = lang() === 'en' ? (state.labelEn || state.labelBn || 'Sound') : (state.labelBn || 'শব্দ');
    tglEl.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
    tglEl.setAttribute('aria-label', playing ? (lang() === 'en' ? 'Pause' : 'থামান') : (lang() === 'en' ? 'Play' : 'চালান'));
  }
  function hidePill() { if (pill) { pill.remove(); pill = null; lblEl = tglEl = eqEl = null; } }

  var api = {
    play: function (cfg) {
      load();
      var sameSrc = state && state.src === cfg.src;
      state = {
        key: cfg.key, src: cfg.src,
        vol: cfg.vol != null ? cfg.vol : 1,
        labelBn: cfg.labelBn || '', labelEn: cfg.labelEn || '',
        pos: sameSrc && state ? (state.pos || 0) : 0, playing: true
      };
      ensureAudio();
      if (audio.src && audio.src.indexOf(state.src) < 0) { audio.src = state.src; }
      audio.loop = true;
      audio.volume = state.vol;
      buildPill();
      var p = audio.play();
      if (p && p.catch) p.catch(function () { updatePill(); });
      save(); updatePill(); emit();
    },
    setSrc: function (src, vol) {
      if (!state) return;
      state.src = src;
      if (vol != null) state.vol = vol;
      state.pos = 0;
      if (audio) {
        var wasPlaying = isPlaying();
        audio.src = src;
        audio.volume = state.vol;
        if (wasPlaying) { var p = audio.play(); if (p && p.catch) p.catch(function () {}); }
      }
      save(); emit();
    },
    toggleKey: function (cfg) {
      load();
      if (state && cfg && state.key === cfg.key && audio) {
        if (isPlaying()) audio.pause();
        else { var p = audio.play(); if (p && p.catch) p.catch(function () {}); }
      } else if (cfg) api.play(cfg);
    },
    pause: function () { if (audio) audio.pause(); },
    stop: function () {
      if (audio) { try { audio.pause(); } catch (e) {} }
      state = null; save(); hidePill(); emit();
    },
    current: pub
  };
  window.WaqtPlayer = api;

  /* Yield rule: any OTHER media element on the page starting playback
     ends this sound session — the user chose something else. (Our own
     audio is created with new Audio() and never enters the document,
     so it cannot trigger this; hero/library thunder one-shots use
     new Audio() too.) */
  document.addEventListener('play', function (e) {
    if (!state) return;
    var t = e.target;
    if (t && (t.tagName === 'AUDIO' || t.tagName === 'VIDEO') && t !== audio) api.stop();
  }, true);

  /* Language flips re-label the pill. */
  new MutationObserver(function () { updatePill(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  /* Resume an active session on this page. */
  function boot() {
    load();
    if (state && state.playing && state.src) {
      ensureAudio();
      buildPill();
      var p = audio.play();
      if (p && p.catch) p.catch(function () { updatePill(); emit(); });
      emit();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
