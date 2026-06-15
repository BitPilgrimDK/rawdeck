(function() {
  'use strict';

  /* ==================================================================
     STATE
     ================================================================== */
  const state = {
    stations:           [],       // full station array
    filtered:           [],       // currently displayed
    currentIndex:       -1,
    isPlaying:          false,
    isPaused:           false,
    volume:             0.75,
    balance:            0,        // -1..1
    shuffle:            false,
    repeat:             false,
    showRemaining:      false,
    eqEnabled:          true,
    eqValues:           [0,0,0,0,0,0,0,0,0,0],
    eqPreamp:           0,
    currentSourceType:  null,     // 'radio' | 'local' | 'custom'
    title:              'RawDeck — Radio Stream Player — Click Play to start',
    favorites:          new Set(), // station ids that are favorited
  };

  // Persist favorites to localStorage
  function loadFavorites() {
    try {
      const stored = localStorage.getItem('rawdeck_favorites');
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) state.favorites = new Set(arr);
      }
    } catch (e) { console.warn('Could not load favorites:', e); }
  }

  function saveFavorites() {
    try {
      localStorage.setItem('rawdeck_favorites', JSON.stringify([...state.favorites]));
    } catch (e) { console.warn('Could not save favorites:', e); }
  }

  /* ---- Custom station persistence ---- */
  function loadCustomStations() {
    try {
      const stored = localStorage.getItem('rawdeck_customs');
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) { console.warn('Could not load custom stations:', e); }
    return [];
  }

  function saveCustomStations() {
    try {
      const customEntries = state.stations.filter(s => s.source === 'custom');
      const data = customEntries.map(s => ({
        name: s.name,
        url: s.streamUrl,
        genre: s.genre,
        country: s.country,
      }));
      localStorage.setItem('rawdeck_customs', JSON.stringify(data));
    } catch (e) { console.warn('Could not save custom stations:', e); }
  }

  function toggleFavorite(stationId, event) {
    if (event) event.stopPropagation();
    if (state.favorites.has(stationId)) {
      state.favorites.delete(stationId);
    } else {
      state.favorites.add(stationId);
    }
    saveFavorites();
    // Refresh current view (keep position)
    const scrollTop = dom.stationList.scrollTop;
    renderPlaylist();
    dom.stationList.scrollTop = scrollTop;
    // Update dropdown if open
    populateFilters();
  }

  // Init favorites from localStorage
  loadFavorites();

  /* ==================================================================
     DOM REFS
     ================================================================== */
  const $ = id => document.getElementById(id);
  const audio          = new Audio();
  audio.crossOrigin    = 'anonymous';
  audio.preload        = 'metadata';

  const dom = {
    marqueeText:   $('marquee-text'),
    tMin1:         $('t-min1'),
    tMin2:         $('t-min2'),
    tSec1:         $('t-sec1'),
    tSec2:         $('t-sec2'),
    spectrum:      $('spectrum-canvas'),
    statusStereo:  $('status-stereo'),
    statusBitrate: $('status-bitrate'),
    statusSample:  $('status-samplerate'),
    posSlider:     $('pos-slider'),
    volSlider:     $('vol-slider'),
    balSlider:     $('bal-slider'),
    stationList:   $('station-list'),
    searchInput:   $('search-input'),
    genreSelect:   $('genre-select'),
    sourceSelect:  $('source-select'),
    plCount:       $('pl-count'),
    plInfo:        $('pl-info'),
    loadStatus:    $('load-status'),
    timeDisplay:   $('time-display'),
    eqWindow:      $('eq-window'),
    playlistWin:   $('playlist-window'),
    urlDialog:     $('url-dialog'),
    fileInput:     $('file-input'),
    eqPre:         $('eq-pre'),
    eqPreVal:      $('eq-val-pre'),
    btnPlay:       $('btn-play'),
    btnPause:      $('btn-pause'),
    btnStop:       $('btn-stop'),
    btnPrev:       $('btn-prev'),
    btnNext:       $('btn-next'),
    btnEject:      $('btn-eject'),
    btnShuffle:    $('btn-shuffle'),
    btnRepeat:     $('btn-repeat'),
    btnToggleEq:   $('btn-toggle-eq'),
    btnTogglePl:   $('btn-toggle-pl'),
    btnAddUrl:     $('btn-add-url'),
    btnEqOn:       $('btn-eq-on'),
    btnEqAuto:     $('btn-eq-auto'),
    btnEqPresets:  $('btn-eq-presets'),
    btnEqReset:    $('btn-eq-reset'),
    btnEqClose:    $('btn-eq-close'),
    btnPlClose:    $('btn-pl-close'),
    btnMinimize:   $('btn-minimize'),
    btnClose:      $('btn-close'),
  };

  /* EQ slider elements */
  const eqSliders = [];
  const eqValDisps = [];
  for (let i = 0; i < 10; i++) {
    eqSliders.push($('eq-' + i));
    eqValDisps.push($('eq-val-' + i));
  }

  /* ==================================================================
     RECONNECTION STATE & ENGINE
     ================================================================== */
  const reconnectState = {
    retryCount: 0,
    maxRetries: 5,
    baseDelay: 2000,       // Start with 2 seconds
    maxDelay: 30000,       // Max delay of 30 seconds
    reconnectTimeoutId: null,
    watchdogTimeoutId: null,
    isReconnecting: false,
    
    // For watchdog tracking
    lastPlayheadTime: -1,
    lastPlayheadUpdate: 0,
    watchdogIntervalId: null,
  };

  function startWatchdog() {
    stopWatchdog();
    reconnectState.lastPlayheadTime = audio.currentTime;
    reconnectState.lastPlayheadUpdate = Date.now();

    reconnectState.watchdogIntervalId = setInterval(() => {
      // Only watch live streams (radio or custom)
      if (state.currentSourceType === 'local' || !state.isPlaying || state.isPaused) {
        return;
      }

      const now = Date.now();
      const currentPos = audio.currentTime;

      // Check if audio position is advancing
      if (currentPos !== reconnectState.lastPlayheadTime) {
        reconnectState.lastPlayheadTime = currentPos;
        reconnectState.lastPlayheadUpdate = now;
      } else {
        // Playhead has stalled. If it persists for more than 8 seconds, trigger reconnect.
        const idleDuration = now - reconnectState.lastPlayheadUpdate;
        if (idleDuration > 8000) {
          console.warn('Watchdog: Stream playhead stalled for 8s. Reconnecting...');
          dom.loadStatus.textContent = '⚠ Stream stalled. Reconnecting…';
          dom.loadStatus.className = 'error';
          stopWatchdog();
          triggerReconnect();
        }
      }
    }, 2000);
  }

  function stopWatchdog() {
    if (reconnectState.watchdogIntervalId) {
      clearInterval(reconnectState.watchdogIntervalId);
      reconnectState.watchdogIntervalId = null;
    }
  }

  function resetReconnectState() {
    reconnectState.retryCount = 0;
    reconnectState.isReconnecting = false;
    if (reconnectState.reconnectTimeoutId) {
      clearTimeout(reconnectState.reconnectTimeoutId);
      reconnectState.reconnectTimeoutId = null;
    }
  }

  function triggerReconnect() {
    // Prevent overlapping reconnect timers
    if (reconnectState.reconnectTimeoutId) return;

    // Local files don't reconnect
    if (state.currentSourceType === 'local') return;

    if (reconnectState.retryCount >= reconnectState.maxRetries) {
      dom.loadStatus.textContent = '⚠ Lost stream. Max retries reached.';
      dom.loadStatus.className = 'error';
      stopPlaybackGracefully();
      return;
    }

    reconnectState.retryCount++;
    reconnectState.isReconnecting = true;

    // Exponential backoff: baseDelay * 2^(retryCount - 1) up to maxDelay
    const backoff = Math.min(
      reconnectState.baseDelay * Math.pow(2, reconnectState.retryCount - 1), 
      reconnectState.maxDelay
    );
    // Add 0-1000ms jitter
    const delay = backoff + Math.floor(Math.random() * 1000);

    dom.loadStatus.textContent = `🔄 Reconnecting (${reconnectState.retryCount}/${reconnectState.maxRetries}) in ${(delay / 1000).toFixed(0)}s…`;
    dom.loadStatus.className = 'loading';
    
    // Visually update the track marquee with reconnect status
    dom.marqueeText.textContent = `[Reconnecting...] ${state.title}`;

    // Pause current audio instance cleanly
    audio.pause();

    reconnectState.reconnectTimeoutId = setTimeout(() => {
      reconnectState.reconnectTimeoutId = null;
      reconnectStream();
    }, delay);
  }

  function reconnectStream() {
    if (!state.isPlaying || state.isPaused) return;

    const items = state.filtered;
    if (state.currentIndex < 0 || state.currentIndex >= items.length) {
      // For custom URLs, re-fetch original input URL
      const currentUrl = audio.src; // fallback
      resolveAndPlayUrl(currentUrl);
      return;
    }

    const station = items[state.currentIndex];
    dom.loadStatus.textContent = '🔄 Resolving fresh stream URL…';
    dom.loadStatus.className = 'loading';

    // Re-resolve stream to ensure tokens/expired links are refreshed
    resolveStreamUrl(station.streamUrl).then(resolvedUrl => {
      // Append a tiny timestamp to force browser cache busting
      let finalUrl = resolvedUrl;
      try {
        const cacheBustUrl = new URL(resolvedUrl);
        cacheBustUrl.searchParams.set('_rawdeck_cb', Date.now());
        finalUrl = cacheBustUrl.toString();
      } catch (e) {
        // Fallback for non-standard URLs
        finalUrl = resolvedUrl + (resolvedUrl.includes('?') ? '&' : '?') + '_rawdeck_cb=' + Date.now();
      }

      audio.src = finalUrl;
      return audio.play();
    }).then(() => {
      // Success! Resets reconnect counter
      reconnectState.retryCount = 0;
      reconnectState.isReconnecting = false;
      dom.loadStatus.textContent = '▶ Reconnected successfully!';
      dom.loadStatus.className = 'success';
      dom.marqueeText.textContent = state.title;
      startWatchdog();
    }).catch(err => {
      console.error(`Reconnect attempt ${reconnectState.retryCount} failed:`, err);
      triggerReconnect();
    });
  }

  function resolveAndPlayUrl(url) {
    resolveStreamUrl(url).then(resolvedUrl => {
      audio.src = resolvedUrl;
      return audio.play();
    }).then(() => {
      reconnectState.retryCount = 0;
      reconnectState.isReconnecting = false;
      dom.loadStatus.textContent = '▶ Reconnected successfully!';
      dom.loadStatus.className = 'success';
      startWatchdog();
    }).catch(() => triggerReconnect());
  }

  function stopPlaybackGracefully() {
    stopWatchdog();
    resetReconnectState();
    audio.pause();
    audio.src = '';
    onStop();
    stopSpectrum();
    startIdleSpectrum();
    renderPlaylist();
  }

  /* ==================================================================
     WEB AUDIO API SETUP
     ================================================================== */
  let ctx = null;
  let sourceNode = null;
  let preampNode = null;
  let eqFilters = [];
  let volNode = null;
  let panNode = null;
  let analyserNode = null;
  let audioInited = false;

  function initAudioGraph() {
    if (audioInited) return;
    audioInited = true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error('Web Audio API not available:', e);
      return;
    }
    sourceNode = ctx.createMediaElementSource(audio);

    // Preamp
    preampNode = ctx.createGain();
    preampNode.gain.value = Math.pow(10, state.eqPreamp / 20);
    sourceNode.connect(preampNode);

    // 10-band peaking EQ filters
    const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    let prev = preampNode;
    eqFilters = freqs.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.41;
      f.gain.value = state.eqValues[i];
      prev.connect(f);
      prev = f;
      return f;
    });

    // Volume
    volNode = ctx.createGain();
    volNode.gain.value = state.volume;
    prev.connect(volNode);

    // Balance (stereo panner)
    panNode = ctx.createStereoPanner();
    panNode.pan.value = state.balance;
    volNode.connect(panNode);

    // Analyser
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.8;
    panNode.connect(analyserNode);
    analyserNode.connect(ctx.destination);

    // Audio element volume must be 1 when using Web Audio graph
    audio.volume = 1.0;
  }

  function applyEQ() {
    if (!eqFilters.length) return;
    eqFilters.forEach((f, i) => {
      f.gain.value = state.eqEnabled ? state.eqValues[i] : 0;
    });
    if (preampNode) {
      preampNode.gain.value = state.eqEnabled ? Math.pow(10, state.eqPreamp / 20) : 1;
    }
  }

  function applyVolume() {
    if (volNode) volNode.gain.value = state.volume;
  }

  function applyBalance() {
    if (panNode) panNode.pan.value = state.balance;
  }

  /* ==================================================================
     AUDIO ELEMENT EVENT BINDING
     ================================================================== */
  let timeRAF = null;
  const TIME_UPDATE_INTERVAL = 100; // throttle time display to ~10fps
  let lastTimeUpdate = 0;

  function updateTimeDisplay() {
    if (!isFinite(audio.currentTime)) {
      dom.tMin1.textContent = '0';
      dom.tMin2.textContent = '0';
      dom.tSec1.textContent = '0';
      dom.tSec2.textContent = '0';
      return;
    }
    let t = state.showRemaining
      ? Math.max(0, (audio.duration || 0) - audio.currentTime)
      : audio.currentTime;
    if (!isFinite(t)) t = 0;
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    dom.tMin1.textContent = Math.floor(mins / 10);
    dom.tMin2.textContent = mins % 10;
    dom.tSec1.textContent = Math.floor(secs / 10);
    dom.tSec2.textContent = secs % 10;
  }

  function updatePositionSlider() {
    if (audio.duration && isFinite(audio.duration)) {
      dom.posSlider.max = 1000;
      dom.posSlider.value = (audio.currentTime / audio.duration) * 1000;
    } else {
      dom.posSlider.value = 0;
    }
  }

  function onTimeUpdate() {
    updateTimeDisplay();
    updatePositionSlider();
    if (!timeRAF) {
      lastTimeUpdate = performance.now();
      timeRAF = requestAnimationFrame(function tick(now) {
        if (state.isPlaying && !state.isPaused) {
          if (now - lastTimeUpdate >= TIME_UPDATE_INTERVAL) {
            updateTimeDisplay();
            updatePositionSlider();
            lastTimeUpdate = now;
          }
        }
        timeRAF = requestAnimationFrame(tick);
      });
    }
  }

  function onLoadedMetadata() {
    const sr = audio.sampleRate || audio.element?.sampleRate;
    const br = audio.bitrate;
    if (sr) {
      dom.statusSample.textContent = (sr / 1000).toFixed(1) + ' kHz';
    } else {
      dom.statusSample.textContent = '— kHz';
    }
  }

  /* ==================================================================
     UPDATED AUDIO ELEMENT EVENT BINDING
     ================================================================== */
  
  function onWaiting() {
    // Only flag buffering for live network streams
    if (state.currentSourceType !== 'local' && state.isPlaying && !state.isPaused) {
      dom.loadStatus.textContent = '⏳ Buffering stream…';
      dom.loadStatus.className = 'loading';
    }
  }

  function onStalled() {
    if (state.currentSourceType !== 'local' && state.isPlaying && !state.isPaused) {
      dom.loadStatus.textContent = '⏳ Stream stalled, waiting for packets…';
      dom.loadStatus.className = 'loading';
    }
  }

  function onPlay() {
    state.isPlaying = true;
    state.isPaused = false;
    dom.btnPlay.textContent = '►';
    dom.btnPlay.disabled = true;
    dom.btnPause.disabled = false;
    dom.statusStereo.className = 'active';
    
    // Clear reconnection state if we succeed in initial playback
    if (!reconnectState.isReconnecting) {
      resetReconnectState();
    }
    startWatchdog();

    if (!timeRAF) {
      lastTimeUpdate = performance.now();
      timeRAF = requestAnimationFrame(function tick(now) {
        if (state.isPlaying && !state.isPaused) {
          if (now - lastTimeUpdate >= TIME_UPDATE_INTERVAL) {
            updateTimeDisplay();
            updatePositionSlider();
            lastTimeUpdate = now;
          }
        }
        timeRAF = requestAnimationFrame(tick);
      });
    }
    // Start spectrum if not already
    if (!spectrumRunning) startSpectrum();
  }

  function onPause() {
    state.isPaused = true;
    dom.btnPlay.textContent = '►';
    dom.btnPlay.disabled = false;
    dom.btnPause.disabled = true;
    stopWatchdog();
  }

  function onStop() {
    state.isPlaying = false;
    state.isPaused = false;
    dom.btnPlay.textContent = '►';
    dom.btnPlay.disabled = false;
    dom.btnPause.disabled = true;
    dom.statusStereo.className = '';
    dom.tMin1.textContent = '0';
    dom.tMin2.textContent = '0';
    dom.tSec1.textContent = '0';
    dom.tSec2.textContent = '0';
    dom.posSlider.value = 0;
    if (timeRAF) { cancelAnimationFrame(timeRAF); timeRAF = null; }
  }

  function onEnded() {
    if (state.currentSourceType === 'local') {
      if (state.repeat) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        playNext();
      }
    } else {
      // Live stream shouldn't end; treat as server dropout -> Reconnect!
      console.warn('Live stream ended unexpectedly. Attempting reconnection...');
      triggerReconnect();
    }
  }

  function onError(e) {
    console.error('Audio error encountered:', e);
    
    if (state.currentSourceType === 'local') {
      const errMsg = audio.error ? (audio.error.message || 'Media format not supported') : 'Unknown file error';
      dom.loadStatus.textContent = '⚠ Local playback error: ' + errMsg;
      dom.loadStatus.className = 'error';
      stopPlaybackGracefully();
      return;
    }

    // Trigger Reconnect Loop for streams
    triggerReconnect();
  }

  // Hook listeners
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('loadedmetadata', onLoadedMetadata);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);
  audio.addEventListener('waiting', onWaiting);
  audio.addEventListener('stalled', onStalled);

  /* ==================================================================
     SPECTRUM ANALYZER
     ================================================================== */
  let spectrumRunning = false;
  let spectrumRAF = null;

  function startSpectrum() {
    if (spectrumRunning) return;
    stopIdleSpectrum();
    spectrumRunning = true;
    lastSpectrumTime = performance.now();
    drawSpectrum();
  }

  function stopSpectrum() {
    spectrumRunning = false;
    if (spectrumRAF) { cancelAnimationFrame(spectrumRAF); spectrumRAF = null; }
    const canvas = dom.spectrum;
    const c = canvas.getContext('2d');
    c.fillStyle = '#050510';
    c.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Throttle variables for spectrum
  const SPECTRUM_INTERVAL = 33; // ~30fps
  let lastSpectrumTime = 0;

  function drawSpectrum() {
    if (!spectrumRunning) return;

    // Throttle to ~30fps
    const now = performance.now();
    if (now - lastSpectrumTime < SPECTRUM_INTERVAL) {
      spectrumRAF = requestAnimationFrame(drawSpectrum);
      return;
    }
    lastSpectrumTime = now;

    const canvas = dom.spectrum;
    const c = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    c.fillStyle = '#050510';
    c.fillRect(0, 0, w, h);

    if (analyserNode && state.isPlaying && !state.isPaused) {
      const bufferLength = analyserNode.frequencyBinCount;
      const data = new Uint8Array(bufferLength);
      analyserNode.getByteFrequencyData(data);

      const barCount = Math.min(bufferLength, 32);
      const barWidth = (w - (barCount - 1) * 1) / barCount;
      const midY = h / 2;

      // Set up glow once for all bars (avoids per-bar shadow toggling)
      c.shadowColor = '#00ff41';
      c.shadowBlur = 3;

      // Single gradient covering the full vertical range, reused for every bar
      const grad = c.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#006a1a');
      grad.addColorStop(0.33, '#00cc33');
      grad.addColorStop(0.66, '#00ff41');
      c.fillStyle = grad;

      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor(i * (bufferLength / barCount));
        const norm = Math.min(1, data[idx] / 255);
        const barH = Math.max(1, norm * midY * 1.6);

        const x = i * (barWidth + 1);
        const y = midY - barH;
        c.fillRect(x, y, barWidth, barH * 2);
      }

      c.shadowBlur = 0;
    }

    spectrumRAF = requestAnimationFrame(drawSpectrum);
  }

  // Idle spectrum when not playing (throttled to ~15fps)
  let idleSpectrumRAF = null;
  const IDLE_INTERVAL = 66; // ~15fps
  let lastIdleTime = 0;
  function startIdleSpectrum() {
    if (idleSpectrumRAF) return;
    lastIdleTime = performance.now();
    function drawIdle() {
      const now = performance.now();
      if (now - lastIdleTime < IDLE_INTERVAL) {
        idleSpectrumRAF = requestAnimationFrame(drawIdle);
        return;
      }
      lastIdleTime = now;
      const canvas = dom.spectrum;
      const c = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      c.fillStyle = '#050510';
      c.fillRect(0, 0, w, h);
      const barCount = 32;
      const barWidth = (w - (barCount - 1) * 1) / barCount;
      const t = performance.now() / 500;
      for (let i = 0; i < barCount; i++) {
        const idleH = 2 + Math.sin(t + i * 0.5) * 2;
        const x = i * (barWidth + 1);
        const y = (h - idleH) / 2;
        c.fillStyle = '#001a00';
        c.fillRect(x, y, barWidth, idleH);
      }
      idleSpectrumRAF = requestAnimationFrame(drawIdle);
    }
    drawIdle();
  }
  startIdleSpectrum();

  // Replace with real spectrum when playing starts
  function stopIdleSpectrum() {
    if (idleSpectrumRAF) { cancelAnimationFrame(idleSpectrumRAF); idleSpectrumRAF = null; }
  }

  /* ---- Deterministic ID generator (stable across sessions) ---- */
  function stableId(prefix, url, name) {
    var hash = 0;
    var str = String(url) + '::' + String(name);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + c;
      hash |= 0;
    }
    return prefix + '-' + Math.abs(hash).toString(36);
  }

  /* ==================================================================
     STATION DATA — FETCHING & PARSING
     ================================================================== */

  // ---- UNIFIED SCHEMA ----
  // { id, name, country, genre, streamUrl, favicon, source, quality_tier }

  // ---- SOURCE 1: rrradio ----
  async function fetchRRRadio() {
    const url = 'https://raw.githubusercontent.com/MarkusSteinbrecher/rrradio/main/public/stations.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error('rrradio HTTP ' + res.status);
    const data = await res.json();
    const stations = [];
    // rrradio wraps stations in a {stations:[...]} object
    const list = Array.isArray(data) ? data : (data && data.stations ? data.stations : []);
    if (!Array.isArray(list)) return stations;
    for (const item of list) {
      try {
        const name = item.name || item.title || 'Unknown';
        const country = item.country || '';
        // tags or genres
        let genre = '';
        if (Array.isArray(item.tags)) genre = item.tags.join(', ');
        else if (Array.isArray(item.genres)) genre = item.genres.join(', ');
        else if (typeof item.tags === 'string') genre = item.tags;
        else if (typeof item.genres === 'string') genre = item.genres;
        // stream URL — prefer primary verified stream
        let streamUrl = '';
        if (item.url) streamUrl = item.url;
        else if (item.streamUrl) streamUrl = item.streamUrl;
        else if (item.stream_url) streamUrl = item.stream_url;
        else if (item.urls && Array.isArray(item.urls) && item.urls.length > 0) {
          // Pick first that looks like a stream URL
          for (const u of item.urls) {
            if (typeof u === 'string') { streamUrl = u; break; }
            if (u.url) { streamUrl = u.url; break; }
          }
          if (!streamUrl && item.urls.length > 0) streamUrl = item.urls[0];
        }
        const favicon = item.favicon || item.logo || '';
        // Quality tier: 1-3 stars based on verification/schedule/metadata
        let quality = 1;
        if (item.verified || item.verified === true) quality = 2;
        if (item.schedule || item.bitrate) quality = 3;

        if (!streamUrl) continue;

        const id = item.id || item.uuid || 'rr-' + stableId(streamUrl, name);
        stations.push({
          id: String(id),
          name: String(name),
          country: String(country || '').trim(),
          genre: String(genre || '').trim(),
          streamUrl: String(streamUrl),
          favicon: String(favicon),
          source: 'rrradio',
          quality_tier: quality,
        });
      } catch (e) {
        console.warn('rrradio: skip item', e);
      }
    }
    return stations;
  }

  // ---- SOURCE 2: deroverda recommended-radio-streams (bullet-list format) ----
  async function fetchDeroverda() {
    const url = 'https://raw.githubusercontent.com/deroverda/recommended-radio-streams/main/README.md';
    const res = await fetch(url);
    if (!res.ok) throw new Error('deroverda HTTP ' + res.status);
    const text = await res.text();
    const stations = [];

    // Split by ### headings (section headers) — they contain the genre
    const lines = text.split('\n');
    let currentGenre = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect ### heading (genre)
      const hMatch = line.match(/^#{3}\s+(.+?)(?:\s*<a\s+[^>]*>)?\s*$/);
      if (hMatch) {
        currentGenre = hMatch[1].replace(/\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/<[^>]+>/g, '').trim();
        continue;
      }

      // Skip TOC entries and non-station lines
      if (!line.startsWith('- ')) continue;
      const bullet = line.slice(2).trim();
      if (!bullet || bullet.startsWith('[') && bullet.includes('(#') || bullet.includes('##')) continue;

      // Extract all markdown links: [text](url)
      const links = [];
      const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
      let m;
      while ((m = linkRe.exec(bullet)) !== null) {
        links.push({ text: m[1].trim(), url: m[2].trim() });
      }
      if (links.length === 0) continue;

      // Find stream URL: look for [Stream](url) first, or first external http link
      let streamUrl = '';
      let stationName = '';
      let websiteUrl = '';

      // First check for "Stream" labeled link
      for (const link of links) {
        if (link.text.toLowerCase() === 'stream' || link.text.toLowerCase() === 'listen') {
          streamUrl = link.url;
        }
      }

      // No Stream label found — use first external link that looks like audio
      if (!streamUrl) {
        for (const link of links) {
          if (link.url.startsWith('http') && !link.url.includes('#')) {
            if (/[\.](mp3|aac|ogg|flac|wav|m3u8?|pls|opus)$/i.test(link.url) ||
                /\/(stream|listen|live|radio)/i.test(link.url) ||
                /:\d+\//.test(link.url) ||
                link.url.includes('radioca.st') ||
                link.url.includes('stream') ||
                link.url.includes('ice') ||
                link.url.includes('shoutcast')) {
              streamUrl = link.url;
              break;
            }
          }
        }
      }

      // Still nothing — take first http link that isn't a section anchor
      if (!streamUrl) {
        for (const link of links) {
          if (link.url.startsWith('http') && !link.url.includes('#')) {
            streamUrl = link.url;
            break;
          }
        }
      }

      if (!streamUrl) continue;

      // Station name: first link text that isn't "Stream" or "Listen"
      for (const link of links) {
        const lt = link.text.toLowerCase();
        if (lt !== 'stream' && lt !== 'listen' && lt !== 'homepage' && lt !== 'website') {
          stationName = link.text;
          break;
        }
      }
      if (!stationName && links.length > 0) stationName = links[0].text;
      if (!stationName) stationName = 'Unknown';

      // Region: try to extract from text after the stream link or at end of line
      let country = '';
      const afterStream = bullet.split(streamUrl).pop() || '';
      const regionMatch = afterStream.match(/[–\-—]\s*([A-Za-z\s]{2,30})$/);
      if (regionMatch) country = regionMatch[1].trim();

      // Clean station name — remove leading ⭐ and whitespace
      stationName = stationName.replace(/^[⭐✨★]+\s*/, '').trim();
      currentGenre = currentGenre.replace(/^[⭐✨★]+\s*/, '').trim();

      stations.push({
        id: 'dero-' + stableId(streamUrl, stationName),
        name: stationName,
        country: country,
        genre: currentGenre,
        streamUrl: streamUrl,
        favicon: '',
        source: 'deroverda',
        quality_tier: 2,
      });
    }

    return stations;
  }

  // ---- SOURCE 3: DonutsDelivery Free-Radio-NoAds-NoTalk (radio_research/ files) ----
  async function fetchDonutsDelivery() {
    // The README.md has no stations. Fetch from radio_research/*.md files instead.
    const researchFiles = [
      'ambient_chill.md', 'blues_funk_soul.md', 'classical.md',
      'country_americana.md', 'electronic_edm.md', 'folk_world.md',
      'hiphop_rap.md', 'jazz.md', 'metal_hardrock.md', 'pop_indie.md',
      'reggae_ska_dub.md', 'rock_alternative.md', 'talk_english.md'
    ];
    const base = 'https://raw.githubusercontent.com/DonutsDelivery/Free-Radio-NoAds-NoTalk/main/radio_research/';
    const stations = [];

    for (const file of researchFiles) {
      try {
        const res = await fetch(base + file);
        if (!res.ok) continue;
        const text = await res.text();
        const lines = text.split('\n');
        let currentGenre = file.replace(/\.md$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // ### headings contain station names or sub-genre refinements
          const headingMatch = line.match(/^###\s+(.+)/);
          if (headingMatch) {
            // Some ### lines are section headers (like "SomaFM Stations"), not stations
            const headingText = headingMatch[1].trim();
            // Check if next line is a separator or another heading — if so, skip
            if (i + 1 < lines.length) {
              const next = lines[i+1].trim();
              if (next.startsWith('---') || next.startsWith('===') || next.startsWith('#')) continue;
            }
            // Try to extract stream URL from the following lines
            let streamUrl = '';
            let stationName = headingText;
            let country = '';
            let description = '';

            // Look ahead up to 10 lines for Stream URL
            for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
              const l = lines[j].trim();

              // Stop at next heading
              if (l.startsWith('#')) break;

              // Stream URL field: - **Stream URL**: https://...
              const urlMatch = l.match(/\*\*Stream URL\*\*\s*[:：]\s*(https?:\/\/[^\s]+)/i);
              if (urlMatch) {
                streamUrl = urlMatch[1].replace(/[.,;)]$/,'');
                continue;
              }

              // High Quality Stream fallback
              const hqMatch = l.match(/\*\*High Quality Stream\*\*\s*[:：]\s*(https?:\/\/[^\s]+)/i);
              if (hqMatch && !streamUrl) {
                streamUrl = hqMatch[1].replace(/[.,;)]$/,'');
                continue;
              }

              // Bare URL on a line
              const bareUrl = l.match(/^https?:\/\/[^\s]+/);
              if (bareUrl && !streamUrl) {
                streamUrl = bareUrl[0].replace(/[.,;)]$/,'');
              }

              // Location field for country
              const locMatch = l.match(/\*\*(?:Location|Country|Region)\*\*\s*[:：]\s*(.+)/i);
              if (locMatch) country = locMatch[1].replace(/\*+/g, '').trim();

              // Description
              const descMatch = l.match(/\*\*Description\*\*\s*[:：]\s*(.+)/i);
              if (descMatch) description = descMatch[1].trim();
            }

            // Also scan the line itself for markdown links with stream URLs
            if (!streamUrl) {
              const linkM = line.match(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/);
              if (linkM) {
                const url = linkM[2];
                if (/(mp3|aac|ogg|flac|wav|m3u8?|pls|opus)/i.test(url) ||
                    /(stream|listen|radio)/i.test(url) || /:\d+\//.test(url)) {
                  streamUrl = url;
                  if (!stationName || stationName === headingText) stationName = linkM[1];
                }
              }
            }

            if (streamUrl) {
              // Clean station name — remove trailing stream URL if accidentally included
              stationName = stationName.replace(/\s*https?:\/\/[^\s]+$/, '').trim();
              stations.push({
                id: 'dd-' + stableId(streamUrl, stationName),
                name: stationName,
                country: country,
                genre: currentGenre,
                streamUrl: streamUrl,
                favicon: '',
                source: 'DonutsDelivery',
                quality_tier: 2,
              });
            }
          }
        }
      } catch (e) {
        console.warn('DonutsDelivery: error fetching ' + file, e);
      }
    }

    return stations;
  }

  // ---- Aggregate all sources ----
  // ---- Stream URL Resolver (handles .pls/.m3u playlist files) ----
  async function resolveStreamUrl(url) {
    // If it's already a direct audio URL, return as-is
    if (/[\.](mp3|aac|ogg|flac|wav|opus)$/i.test(url) ||
        (/\/listen|\/stream|\/live/i.test(url) && /:\d+/.test(url)) ||
        !/[\.](pls|m3u|m3u8)$/i.test(url)) {
      return url;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return url;
      const text = await res.text();
      // PLS format: File1=http://...
      const plsMatch = text.match(/^File\d+\s*=\s*(https?:\/\/[^\s]+)/im);
      if (plsMatch) return plsMatch[1].trim();
      // M3U format: first line that starts with http
      const m3uMatch = text.match(/^(https?:\/\/[^\s]+)/m);
      if (m3uMatch) return m3uMatch[1].trim();
    } catch (e) {
      // Network error resolving — try original URL anyway
    }
    return url;
  }

  async function fetchAllStations() {
    dom.loadStatus.innerHTML = '<span class="spinner"></span> Fetching stations from 3 sources…';
    dom.loadStatus.className = 'loading';

    const results = await Promise.allSettled([
      fetchRRRadio(),
      fetchDeroverda(),
      fetchDonutsDelivery(),
    ]);

    const all = [];
    const errors = [];

    results.forEach((result, i) => {
      const names = ['rrradio', 'deroverda', 'DonutsDelivery'];
      if (result.status === 'fulfilled') {
        all.push(...result.value);
        console.log(`RawDeck: Loaded ${result.value.length} stations from ${names[i]}`);
      } else {
        errors.push(`${names[i]}: ${result.reason.message || result.reason}`);
        console.error(`RawDeck: Failed to load ${names[i]}:`, result.reason);
      }
    });

    // Deduplicate by stream URL
    const seen = new Set();
    const unique = [];
    for (const s of all) {
      if (!seen.has(s.streamUrl)) {
        seen.add(s.streamUrl);
        unique.push(s);
      }
    }

    // Load saved custom stations and prepend them
    const customData = loadCustomStations();
    const customStations = customData.map(c => ({
      id: 'custom-' + stableId(c.url, c.name),
      name: c.name,
      country: c.country || '',
      genre: c.genre || 'Custom',
      streamUrl: c.url,
      favicon: '',
      source: 'custom',
      quality_tier: 3,
    }));

    state.stations = [...customStations, ...unique];
    state.filtered = [...state.stations];

    if (errors.length > 0) {
      dom.loadStatus.textContent = `⚠ ${unique.length} stations loaded. Errors: ${errors.join('; ')}`;
      dom.loadStatus.className = 'error';
    } else {
      dom.loadStatus.textContent = `✔ ${unique.length} stations loaded from 3 sources`;
      dom.loadStatus.className = 'success';
    }

    populateFilters();
    renderPlaylist();
  }

  /* ==================================================================
     FILTERS & RENDERING
     ================================================================== */
  function populateFilters() {
    // Genre
    const genres = new Set();
    state.stations.forEach(s => {
      if (s.genre) {
        s.genre.split(/[,;/\s]+/).forEach(g => { if (g.trim()) genres.add(g.trim()); });
      }
    });
    const sortedGenres = Array.from(genres).sort();
    dom.genreSelect.innerHTML = '<option value="">All Genres</option>'
      + sortedGenres.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');

    // Source
    const sources = new Set(state.stations.map(s => s.source).filter(Boolean));
    // Build source options: All Sources, Favorites, Custom (if any custom URLs), then individual sources
    let optionsHtml = '<option value="">All Sources</option>';
    optionsHtml += '<option value="__favorites__">★ Favorites</option>';
    const hasCustom = [...sources].some(s => s === 'custom');
    if (hasCustom) optionsHtml += '<option value="custom">Custom</option>';
    optionsHtml += [...sources]
      .filter(s => s !== 'custom')
      .sort()
      .map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join('');
    dom.sourceSelect.innerHTML = optionsHtml;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function applyFilters() {
    const query = dom.searchInput.value.toLowerCase().trim();
    const genreFilter = dom.genreSelect.value;
    const sourceFilter = dom.sourceSelect.value;

    state.filtered = state.stations.filter(s => {
      // Search query
      if (query) {
        const haystack = (s.name + ' ' + s.genre + ' ' + s.country + ' ' + s.source).toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      // Genre filter
      if (genreFilter) {
        const sGenres = s.genre.toLowerCase();
        if (!sGenres.includes(genreFilter.toLowerCase())) return false;
      }
      // Source filter
      if (sourceFilter) {
        if (sourceFilter === '__favorites__') {
          if (!state.favorites.has(s.id)) return false;
        } else if (s.source !== sourceFilter) {
          return false;
        }
      }
      return true;
    });

    renderPlaylist();
  }

  function renderPlaylist() {
    const list = dom.stationList;
    const items = state.filtered;

    if (items.length === 0) {
      list.innerHTML = '<div class="station-item" style="color:#666;cursor:default;justify-content:center;">No stations match your filters</div>';
      dom.plCount.textContent = '0 stations';
      return;
    }

    let html = '';
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const isActive = i === state.currentIndex && state.isPlaying;
      const isCur = i === state.currentIndex;

      // Favicon
      const iconHtml = s.favicon
        ? `<img class="favicon" src="${escapeHtml(s.favicon)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : '';

      // Badge
      let badgeHtml = '<span class="badge live">LIVE</span>';
      if (s.quality_tier === 3) badgeHtml += '<span class="badge source">HD</span>';
      if (s.source) badgeHtml += `<span class="badge source">${escapeHtml(s.source)}</span>`;

      // Star
      const isFav = state.favorites.has(s.id);
      const starHtml = `<button class="fav-btn${isFav ? ' favorited' : ''}" data-id="${escapeHtml(s.id)}" title="${isFav ? 'Remove from Favorites' : 'Add to Favorites'}">${isFav ? '★' : '☆'}</button>`;

      html += `<div class="station-item ${isActive ? 'active' : ''}" data-index="${i}">
        <span class="index">${i + 1}.</span>
        ${iconHtml}
        <span class="name">${escapeHtml(s.name)}${s.country ? ' (' + escapeHtml(s.country) + ')' : ''}</span>
        ${starHtml}
        ${badgeHtml}
      </div>`;
    }

    list.innerHTML = html;

    // Click handler
    list.querySelectorAll('.station-item').forEach(el => {
      el.addEventListener('click', function(e) {
        // Ignore clicks on the favorite button itself
        if (e.target.classList.contains('fav-btn')) return;
        const idx = parseInt(this.dataset.index);
        if (!isNaN(idx)) playStation(idx);
      });
    });

    // Favorite button handlers
    list.querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        const stationId = this.dataset.id;
        toggleFavorite(stationId, e);
      });
    });

    dom.plCount.textContent = items.length + ' stations';
  }

  /* ==================================================================
     PLAYBACK CONTROLS
     ================================================================== */
  function playStation(index) {
    const items = state.filtered;
    if (!items || index < 0 || index >= items.length) return;

    resetReconnectState();
    stopWatchdog();

    const station = items[index];
    state.currentIndex = index;
    state.currentSourceType = 'radio';

    // Update title
    state.title = station.name + (station.genre ? ' — ' + station.genre : '');
    dom.marqueeText.textContent = state.title;
    // Reset marquee animation
    dom.marqueeText.style.animation = 'none';
    dom.marqueeText.offsetHeight; // trigger reflow
    dom.marqueeText.style.animation = '';

    // Init audio graph if needed
    if (!audioInited) initAudioGraph();

    // Resume audio context if suspended
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(e => console.warn('AudioContext resume:', e));
    }

    // Stop current
    audio.pause();
    audio.src = '';
    audio.load();

    // Resolve .pls/.m3u playlists to actual audio URLs, then play
    dom.loadStatus.textContent = '🔍 Resolving stream URL for ' + station.name + '…';
    dom.loadStatus.className = 'loading';
    resolveStreamUrl(station.streamUrl).then(resolvedUrl => {
      audio.src = resolvedUrl;
      return audio.play();
    }).then(() => {
      state.isPlaying = true;
      state.isPaused = false;
      dom.btnPlay.textContent = '►';
      dom.btnPlay.disabled = true;
      dom.btnPause.disabled = false;
      dom.loadStatus.textContent = '▶ Playing: ' + station.name;
      dom.loadStatus.className = 'success';
      renderPlaylist();
    }).catch(err => {
      console.error('Playback error:', err);
      const details = err.message || String(err);
      // Try once more with the original URL (some streams prefer it)
      if (station.streamUrl !== audio.src) {
        audio.src = station.streamUrl;
        audio.play().catch(e2 => {
          dom.loadStatus.textContent = '⚠ Cannot play: ' + station.name + ' — ' + details;
          dom.loadStatus.className = 'error';
          console.error('Second attempt also failed:', e2);
        }).then(() => {
          if (state.isPlaying) return;
          state.isPlaying = true;
          state.isPaused = false;
          dom.btnPlay.disabled = true;
          dom.btnPause.disabled = false;
          dom.loadStatus.textContent = '▶ Playing: ' + station.name;
          dom.loadStatus.className = 'success';
        });
      } else {
        dom.loadStatus.textContent = '⚠ Cannot play: ' + station.name + ' — ' + details;
        dom.loadStatus.className = 'error';
      }
    });
  }

  function playLocalFile(file) {
    resetReconnectState();
    stopWatchdog();

    // Revoke previous object URL to prevent memory leak
    if (audio.src && audio.src.startsWith('blob:')) {
      URL.revokeObjectURL(audio.src);
    }
    const url = URL.createObjectURL(file);
    const fileName = file.name.replace(/\.[^.]+$/, '');

    state.title = fileName;
    state.currentSourceType = 'local';
    dom.marqueeText.textContent = fileName;
    dom.marqueeText.style.animation = 'none';
    dom.marqueeText.offsetHeight;
    dom.marqueeText.style.animation = '';

    if (!audioInited) initAudioGraph();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});

    audio.pause();
    audio.src = url;
    audio.play().then(() => {
      state.isPlaying = true;
      state.isPaused = false;
      dom.btnPlay.textContent = '►';
      dom.btnPlay.disabled = true;
      dom.btnPause.disabled = false;

      // Add to station list as a temporary entry
      const tempId = 'local-' + stableId(fileName, 'local');
      const entry = {
        id: tempId,
        name: fileName,
        country: '',
        genre: 'Local File',
        streamUrl: url,
        favicon: '',
        source: 'local',
        quality_tier: 3,
      };
      state.stations.unshift(entry);
      state.filtered.unshift(entry);
      state.currentIndex = 0;
      populateFilters();
      renderPlaylist();
    }).catch(err => {
      console.error('Local playback error:', err);
      dom.loadStatus.textContent = '⚠ Cannot play local file: ' + err.message;
      dom.loadStatus.className = 'error';
    });
  }

  function playCustomUrl(url, name, genre, country) {
    if (!url) return;
    resetReconnectState();
    stopWatchdog();

    const stationName = name || url.split('/').pop() || 'Custom Stream';

    state.title = stationName;
    state.currentSourceType = 'custom';
    dom.marqueeText.textContent = state.title;
    dom.marqueeText.style.animation = 'none';
    dom.marqueeText.offsetHeight;
    dom.marqueeText.style.animation = '';

    if (!audioInited) initAudioGraph();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});

    audio.pause();
    dom.loadStatus.textContent = '🔍 Resolving stream URL…';
    dom.loadStatus.className = 'loading';
    resolveStreamUrl(url).then(resolvedUrl => {
      audio.src = resolvedUrl;
      return audio.play();
    }).then(() => {
      state.isPlaying = true;
      state.isPaused = false;
      dom.btnPlay.textContent = '►';
      dom.btnPlay.disabled = true;
      dom.btnPause.disabled = false;
      dom.loadStatus.textContent = '▶ Playing: ' + stationName;
      dom.loadStatus.className = 'success';

      const tempId = 'custom-' + stableId(url, stationName);
      const entry = {
        id: tempId,
        name: stationName,
        country: country || '',
        genre: genre || 'Custom',
        streamUrl: url,
        favicon: '',
        source: 'custom',
        quality_tier: 3,
      };
      state.stations.unshift(entry);
      state.filtered.unshift(entry);
      state.currentIndex = 0;
      populateFilters();
      renderPlaylist();
      saveCustomStations();
    }).catch(err => {
      console.error('Custom URL playback error:', err);
      // Try original URL as fallback
      if (audio.src !== url) {
        audio.src = url;
        audio.play().catch(e2 => {
          dom.loadStatus.textContent = '⚠ Cannot play URL: ' + err.message;
          dom.loadStatus.className = 'error';
        });
      } else {
        dom.loadStatus.textContent = '⚠ Cannot play URL: ' + err.message;
        dom.loadStatus.className = 'error';
      }
    });
  }

  function togglePlay() {
    if (state.isPlaying && !state.isPaused) {
      audio.pause();
    } else if (state.isPaused) {
      audio.play().catch(e => console.error(e));
    } else {
      // No station selected, try first
      if (state.filtered.length > 0) {
        playStation(state.currentIndex >= 0 ? state.currentIndex : 0);
      }
    }
  }

  function playNext() {
    const items = state.filtered;
    if (items.length === 0) return;

    let next = state.currentIndex + 1;
    if (state.shuffle) {
      next = Math.floor(Math.random() * items.length);
    }
    if (next >= items.length) {
      if (state.repeat) next = 0;
      else return;
    }
    playStation(next);
  }

  function playPrev() {
    const items = state.filtered;
    if (items.length === 0) return;
    let prev = state.currentIndex - 1;
    if (prev < 0) prev = items.length - 1;
    playStation(prev);
  }

  /* ==================================================================
     UI EVENT BINDING
     ================================================================== */

  // --- Transport buttons ---
  dom.btnPlay.addEventListener('click', () => {
    if (state.isPlaying && !state.isPaused) {
      audio.pause();
    } else if (state.isPaused) {
      audio.play().catch(e => console.error(e));
    } else {
      if (state.currentIndex >= 0 && state.currentIndex < state.filtered.length) {
        playStation(state.currentIndex);
      } else if (state.filtered.length > 0) {
        playStation(0);
      } else {
        dom.loadStatus.textContent = '⚠ No stations loaded. Try again or add a URL.';
        dom.loadStatus.className = 'error';
      }
    }
  });

  dom.btnPause.addEventListener('click', () => {
    audio.pause();
  });

  dom.btnStop.addEventListener('click', () => {
    stopPlaybackGracefully();
  });

  dom.btnPrev.addEventListener('click', playPrev);
  dom.btnNext.addEventListener('click', playNext);

  dom.btnEject.addEventListener('click', () => {
    dom.fileInput.click();
  });

  dom.fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      playLocalFile(files[0]);
    }
    dom.fileInput.value = '';
  });

  // --- Shuffle & Repeat ---
  dom.btnShuffle.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    dom.btnShuffle.classList.toggle('active');
  });

  dom.btnRepeat.addEventListener('click', () => {
    state.repeat = !state.repeat;
    dom.btnRepeat.classList.toggle('active');
  });

  // --- Volume & Balance ---
  dom.volSlider.addEventListener('input', () => {
    state.volume = parseInt(dom.volSlider.value) / 100;
    if (volNode) {
      applyVolume();
    } else {
      audio.volume = state.volume;
    }
  });

  dom.balSlider.addEventListener('input', () => {
    state.balance = (parseInt(dom.balSlider.value) - 50) / 50; // -1..1
    applyBalance();
  });

  // --- Position slider ---
  dom.posSlider.addEventListener('input', () => {
    if (audio.duration && isFinite(audio.duration)) {
      const pct = parseInt(dom.posSlider.value) / 1000;
      audio.currentTime = pct * audio.duration;
    }
  });

  // --- Time display toggle ---
  dom.timeDisplay.addEventListener('click', () => {
    state.showRemaining = !state.showRemaining;
    updateTimeDisplay();
  });

  // --- Filter controls ---
  // Debounce search filter to avoid re-rendering entire playlist on every keystroke
  let searchDebounce = null;
  dom.searchInput.addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyFilters, 120);
  });
  dom.genreSelect.addEventListener('change', applyFilters);
  dom.sourceSelect.addEventListener('change', applyFilters);

  dom.btnClearFilter = $('btn-clear-filter');
  dom.btnClearFilter.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.genreSelect.value = '';
    dom.sourceSelect.value = '';
    applyFilters();
  });

  // --- EQ toggle ---
  dom.btnToggleEq.addEventListener('click', () => {
    dom.eqWindow.classList.toggle('visible');
    dom.btnToggleEq.classList.toggle('active');
  });

  // --- Playlist toggle ---
  dom.btnTogglePl.addEventListener('click', () => {
    const pl = dom.playlistWin;
    const btn = dom.btnTogglePl;
    if (pl.style.display === 'none') {
      pl.style.display = 'block';
      btn.classList.add('active');
      btn.textContent = 'PL';
    } else {
      pl.style.display = 'none';
      btn.classList.remove('active');
      btn.textContent = 'PL';
    }
  });

  dom.btnPlClose.addEventListener('click', () => {
    dom.playlistWin.style.display = 'none';
    dom.btnTogglePl.classList.remove('active');
  });

  dom.btnEqClose.addEventListener('click', () => {
    dom.eqWindow.classList.remove('visible');
    dom.btnToggleEq.classList.remove('active');
  });

  dom.btnMinimize.addEventListener('click', () => {
    // Toggle playlist
    const pl = dom.playlistWin;
    if (pl.style.display === 'none') {
      pl.style.display = 'block';
      dom.btnTogglePl.classList.add('active');
    } else {
      pl.style.display = 'none';
      dom.btnTogglePl.classList.remove('active');
    }
  });

  dom.btnClose.addEventListener('click', () => {
    if (confirm('Close RawDeck?')) {
      audio.pause();
      audio.src = '';
      if (ctx && ctx.state !== 'closed') ctx.close();
      document.body.innerHTML = '<div style="color:#00ff41;background:#0a0a14;padding:40px;text-align:center;font-family:monospace;min-height:100vh;">RawDeck closed. Reload the page to restart.</div>';
    }
  });

  // --- URL Dialog ---
  dom.btnAddUrl.addEventListener('click', () => {
    dom.urlDialog.classList.add('visible');
    dom.urlInput = $('url-input');
    dom.urlName = $('url-name');
    dom.urlGenre = $('url-genre');
    dom.urlCountry = $('url-country');
    dom.urlInput.value = '';
    dom.urlName.value = '';
    dom.urlGenre.value = '';
    dom.urlCountry.value = '';
    dom.urlInput.focus();
  });

  $('btn-url-cancel').addEventListener('click', () => {
    dom.urlDialog.classList.remove('visible');
  });

  $('btn-url-add').addEventListener('click', () => {
    const url = dom.urlInput.value.trim();
    const name = dom.urlName.value.trim();
    const genre = dom.urlGenre.value.trim();
    const country = dom.urlCountry.value.trim();
    if (!url) {
      dom.urlInput.focus();
      dom.urlInput.style.borderColor = '#ff4444';
      setTimeout(() => dom.urlInput.style.borderColor = '', 1500);
      return;
    }
    dom.urlDialog.classList.remove('visible');
    playCustomUrl(url, name, genre, country);
  });

  // Close dialog on overlay click
  dom.urlDialog.addEventListener('click', (e) => {
    if (e.target === dom.urlDialog) dom.urlDialog.classList.remove('visible');
  });

  // Enter key in URL dialog
  $('url-country').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-url-add').click();
  });

  // --- EQ controls ---
  // Individual EQ sliders
  eqSliders.forEach((slider, i) => {
    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);
      state.eqValues[i] = val;
      eqValDisps[i].textContent = val > 0 ? '+' + val : val;
      applyEQ();
    });
  });

  dom.eqPre.addEventListener('input', () => {
    state.eqPreamp = parseInt(dom.eqPre.value);
    dom.eqPreVal.textContent = state.eqPreamp > 0 ? '+' + state.eqPreamp : state.eqPreamp;
    applyEQ();
  });

  dom.btnEqOn.addEventListener('click', () => {
    state.eqEnabled = !state.eqEnabled;
    dom.btnEqOn.classList.toggle('active');
    dom.btnEqOn.textContent = state.eqEnabled ? 'ON' : 'OFF';
    applyEQ();
  });

  dom.btnEqAuto.addEventListener('click', () => {
    dom.btnEqAuto.classList.toggle('active');
  });

  dom.btnEqPresets.addEventListener('click', () => {
    // Cycle through some presets
    const presets = [
      { name: 'Flat', vals: [0,0,0,0,0,0,0,0,0,0], pre: 0 },
      { name: 'Rock', vals: [4,3,2,1,0,-1,0,2,3,4], pre: 2 },
      { name: 'Pop', vals: [-1,0,2,3,2,0,-1,-1,0,1], pre: 1 },
      { name: 'Jazz', vals: [3,2,1,2,1,0,-1,0,2,3], pre: 1 },
      { name: 'Classical', vals: [4,3,1,0,0,-1,-1,0,2,4], pre: 2 },
      { name: 'Dance', vals: [2,4,3,1,0,-1,-1,1,3,4], pre: 3 },
      { name: 'Speech', vals: [-2,-1,0,2,3,4,3,1,-1,-2], pre: 0 },
    ];
    // Find current preset or cycle
    const currentVals = state.eqValues.join(',');
    let idx = presets.findIndex(p => p.vals.join(',') === currentVals);
    idx = (idx + 1) % presets.length;
    const preset = presets[idx];

    state.eqPreamp = preset.pre;
    dom.eqPre.value = preset.pre;
    dom.eqPreVal.textContent = preset.pre > 0 ? '+' + preset.pre : preset.pre;

    preset.vals.forEach((v, i) => {
      state.eqValues[i] = v;
      eqSliders[i].value = v;
      eqValDisps[i].textContent = v > 0 ? '+' + v : v;
    });

    applyEQ();
    dom.loadStatus.textContent = 'EQ Preset: ' + preset.name;
    dom.loadStatus.className = 'success';
    setTimeout(() => {
      if (state.stations.length > 0) {
        dom.loadStatus.textContent = '✔ ' + state.stations.length + ' stations loaded';
        dom.loadStatus.className = 'success';
      }
    }, 2000);
  });

  dom.btnEqReset.addEventListener('click', () => {
    state.eqPreamp = 0;
    dom.eqPre.value = 0;
    dom.eqPreVal.textContent = '0';
    for (let i = 0; i < 10; i++) {
      state.eqValues[i] = 0;
      eqSliders[i].value = 0;
      eqValDisps[i].textContent = '0';
    }
    applyEQ();
  });

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in inputs, selects, or textareas
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (dom.urlDialog.classList.contains('visible')) return;
    switch (e.key.toLowerCase()) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'n': playNext(); break;
      case 'p': playPrev(); break;
      case 's': if (!e.ctrlKey) { e.preventDefault(); dom.btnStop.click(); } break;
      case 'v': if (!e.ctrlKey) { e.preventDefault(); dom.btnShuffle.click(); } break;
      case 'r': if (!e.ctrlKey) { e.preventDefault(); dom.btnRepeat.click(); } break;
      case 'e': dom.btnToggleEq.click(); break;
      case 'l': dom.btnTogglePl.click(); break;
      case 'o': if (!e.ctrlKey) { e.preventDefault(); dom.btnEject.click(); } break;
      case 'u': dom.btnAddUrl.click(); break;
    }
  });

  /* ==================================================================
     INITIALIZATION
     ================================================================== */
  // Ensure playlist starts visible
  dom.playlistWin.style.display = 'block';

  // Set initial volume/balance
  audio.volume = state.volume;

  // Load stations
  fetchAllStations();

  // Retry button in status (double click to retry)
  dom.loadStatus.addEventListener('dblclick', () => {
    dom.loadStatus.textContent = 'Retrying…';
    dom.loadStatus.className = 'loading';
    state.stations = [];
    state.filtered = [];
    fetchAllStations();
  });

  console.log('RawDeck v2.0 — Winamp-style Radio Player');
  console.log('Keyboard: Space=play/pause, N=next, P=prev, S=stop, V=shuffle, R=repeat, E=EQ, L=playlist, O=open file, U=add URL');

})();
