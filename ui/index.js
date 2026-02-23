"use strict";

/**
 * YouTube Shorts-style infinite scroll player.
 *
 * Architecture
 * ─────────────────────────────────────────────────────────────────
 *  FeedManager   – fetches & caches video IDs from the API
 *  DOMManager    – owns #track DOM, slides, and all CSS transforms
 *  PlayerManager – ONLY place that calls playVideo / pauseVideo
 *  App           – wires the above, owns navigation state
 * ─────────────────────────────────────────────────────────────────
 *
 * Critical invariants
 *  1. PlayerManager is the single playback authority.
 *  2. CSS transform must be re-anchored after ANY DOM mutation (trim).
 *  3. Only ONE trim timer is ever pending at a time (#trimTimerId).
 *  4. #onEnded routes through #tryNavigate so navLock is respected.
 *  5. autoplay:0 on ALL players — playback starts only via activate().
 */

/* ─────────────────────────────  CONSTANTS  ──────────────────────────── */

const API_ENDPOINT      = "http://localhost:3000/api/v1/videos";
const API_PAGE_SIZE     = 30;

/**
 * CSS transition duration. MUST match the value in style.css.
 * The trim timer fires after this + a safety buffer.
 */
const TRANSITION_MS     = 380;

/** Slides kept in DOM at any time. */
const DOM_WINDOW_SIZE   = 5;

/** Create a player this many slides ahead of current. */
const PRELOAD_AHEAD     = 1;

/** Start fetching more IDs when the pool has this many left. */
const FETCH_THRESHOLD   = 10;

/** Lock navigation for this many ms after a swipe/wheel. */
const NAV_COOLDOWN_MS   = 600;

/** Min px travel for a slow swipe. */
const SWIPE_MIN_PX      = 50;

/** Max ms to be classified as a "fast flick". */
const SWIPE_FAST_MS     = 260;

/** Min px travel for a fast flick. */
const SWIPE_FAST_PX     = 25;

/** Min px/ms velocity to count as a flick. */
const SWIPE_MIN_VEL     = 0.3;

/** Min ms between wheel events. */
const WHEEL_COOLDOWN_MS = 500;


/* ─────────────────────────────  FEED MANAGER  ──────────────────────── */

class FeedManager {
  #pool        = [];
  #nextCursor  = null;
  #hasMore     = true;
  #isFetching  = false;
  #inflight    = null;

  get poolSize() { return this.#pool.length; }

  videoIdForSeq(seq) {
    if (this.#pool.length === 0) return null;
    return this.#pool[seq % this.#pool.length];
  }

  fetch() {
    if (this.#isFetching) return this.#inflight;
    if (!this.#hasMore)   return Promise.resolve();

    this.#isFetching = true;

    const url = new URL(API_ENDPOINT);
    url.searchParams.set("limit", String(API_PAGE_SIZE));
    if (this.#nextCursor) url.searchParams.set("after", this.#nextCursor);

    this.#inflight = fetch(url.toString())
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body) => {
        const ids = Array.isArray(body?.data) ? body.data : [];
        if (ids.length === 0) { this.#hasMore = false; return; }
        this.#pool.push(...ids);
        this.#nextCursor = body.nextCursor ?? null;
        this.#hasMore    = body.hasMore    ?? false;
      })
      .catch((err) => {
        console.error("[FeedManager] fetch failed:", err);
      })
      .finally(() => {
        this.#isFetching = false;
        this.#inflight   = null;
      });

    return this.#inflight;
  }

  maybePreFetch(currentSeq) {
    const remaining = this.#pool.length > 0
      ? this.#pool.length - (currentSeq % this.#pool.length)
      : 0;
    if (remaining < FETCH_THRESHOLD) this.fetch();
  }
}


/* ─────────────────────────────  DOM MANAGER  ──────────────────────────  */

class DOMManager {
  #track;
  #firstSeq = 0;

  constructor(trackEl) { this.#track = trackEl; }

  get firstSeq()    { return this.#firstSeq; }
  get slideCount()  { return this.#track.children.length; }
  get lastSeq()     { return this.#firstSeq + this.#track.children.length - 1; }

  get slideHeight() {
    const el = this.#track.firstElementChild;
    return el ? el.getBoundingClientRect().height : window.innerHeight;
  }

  appendSlides(startSeq, count) {
    for (let i = 0; i < count; i++) {
      this.#track.appendChild(this.#makeSlide(startSeq + i));
    }
  }

  /**
   * Prepend slides so DOM head reaches newFirstSeq.
   * Immediately re-anchors the transform (no-animate) so the currently
   * visible slide stays in place despite the DOM shift.
   */
  prependSlides(newFirstSeq, currentSeq) {
    if (newFirstSeq >= this.#firstSeq) return 0;
    const frag = document.createDocumentFragment();
    for (let s = newFirstSeq; s < this.#firstSeq; s++) {
      frag.appendChild(this.#makeSlide(s));
    }
    const inserted = this.#firstSeq - newFirstSeq;
    this.#track.insertBefore(frag, this.#track.firstChild);
    this.#firstSeq = newFirstSeq;
    // DOM shifted — re-anchor without animation so user sees the same slide.
    this.scrollToSeq(currentSeq, false);
    return inserted;
  }

  /**
   * Remove excess slides from the head.
   * CRITICAL: after calling this, always call scrollToSeq(currentSeq, false)
   * to re-anchor the transform. trimHead changes #firstSeq so the existing
   * translateY is pointing to the wrong slide.
   */
  trimHead(targetMax) {
    const removed = [];
    while (this.#track.children.length > targetMax) {
      const first = this.#track.firstElementChild;
      removed.push(this.#seqOf(first));
      this.#track.removeChild(first);
      this.#firstSeq++;
    }
    return removed;
  }

  /** Remove excess slides from the tail. Same re-anchor warning as trimHead. */
  trimTail(targetMax) {
    const removed = [];
    while (this.#track.children.length > targetMax) {
      const last = this.#track.lastElementChild;
      removed.push(this.#seqOf(last));
      this.#track.removeChild(last);
    }
    return removed;
  }

  /** Translate track to show seq. animate=false is instant. */
  scrollToSeq(seq, animate) {
    const y = -((seq - this.#firstSeq) * this.slideHeight);
    if (animate) {
      this.#track.classList.remove("no-transition");
    } else {
      this.#track.classList.add("no-transition");
    }
    this.#track.style.transform = `translateY(${y}px)`;
    if (!animate) {
      // Force synchronous reflow so the instant position commits to the
      // compositor before the transition class is potentially re-added.
      void this.#track.offsetHeight;
    }
  }

  /** Move track by deltaY px from the resting position of currentSeq. */
  drag(deltaY, currentSeq) {
    const base = -((currentSeq - this.#firstSeq) * this.slideHeight);
    this.#track.classList.add("no-transition");
    this.#track.style.transform = `translateY(${base + deltaY}px)`;
  }

  markLoaded(seq) {
    const el = this.#track.querySelector(`[data-seq="${seq}"]`);
    if (el) el.classList.add("loaded");
  }

  playerContainerFor(seq) {
    return document.getElementById(`yt-${seq}`);
  }

  reset() {
    this.#track.innerHTML = "";
    this.#firstSeq = 0;
  }

  #makeSlide(seq) {
    const slide       = document.createElement("div");
    slide.className   = "slide";
    slide.dataset.seq = String(seq);
    const wrap        = document.createElement("div");
    wrap.className    = "yt-wrap";
    wrap.id           = `yt-${seq}`;
    slide.appendChild(wrap);
    return slide;
  }

  #seqOf(el) { return parseInt(el.dataset.seq, 10); }
}


/* ─────────────────────────────  PLAYER MANAGER  ─────────────────────── */

class PlayerManager {
  #players       = new Map();
  #feed;
  #dom;
  #activeSeq     = null;
  #onEnded;
  #unlockedAudio = false;

  constructor(feed, dom, onEnded) {
    this.#feed    = feed;
    this.#dom     = dom;
    this.#onEnded = onEnded;
  }

  /**
   * Create a YT.Player for seq if one doesn't exist.
   * autoplay:0 — player buffers but does NOT start playing.
   * Playback starts exclusively via activate().
   */
  ensure(seq) {
    if (this.#players.has(seq)) return;
    const videoId = this.#feed.videoIdForSeq(seq);
    if (!videoId) return;
    if (!this.#dom.playerContainerFor(seq)) return;

    this.#players.set(seq, new YT.Player(`yt-${seq}`, {  // eslint-disable-line no-undef
      videoId,
      playerVars: {
        autoplay:       0,
        mute:           1,
        controls:       0,
        playsinline:    1,
        rel:            0,
        modestbranding: 1,
        iv_load_policy: 3,
        disablekb:      1,
        fs:             0,
        loop:           0,
        origin:         window.location.origin,
      },
      events: {
        onReady:       (e) => this.#onPlayerReady(seq, e),
        onStateChange: (e) => this.#onPlayerStateChange(seq, e),
      },
    }));
  }

  /** Pause prev, activate seq. onReady will play if not yet loaded. */
  activate(seq) {
    const prev     = this.#activeSeq;
    this.#activeSeq = seq;
    if (prev !== null && prev !== seq) this.#pause(prev);
    this.#play(seq);
  }

  /** Pause every player that is not the active one. Safety net. */
  pauseAll() {
    for (const [seq] of this.#players) {
      if (seq !== this.#activeSeq) this.#pause(seq);
    }
  }

  destroyMany(seqs) {
    for (const seq of seqs) this.#destroy(seq);
  }

  reset() {
    for (const [seq] of this.#players) this.#destroy(seq);
    this.#activeSeq    = null;
    this.#unlockedAudio = false;
  }

  unlockAudio() {
    if (this.#unlockedAudio) return;
    this.#unlockedAudio = true;
    const p = this.#players.get(this.#activeSeq);
    try { p?.unMute(); } catch (_) {}
  }

  toggleActive() {
    if (this.#activeSeq === null) return;
    const p = this.#players.get(this.#activeSeq);
    if (!p?.getPlayerState) return;
    try {
      if (p.getPlayerState() === YT.PlayerState.PLAYING) {  // eslint-disable-line no-undef
        p.pauseVideo();
      } else {
        if (this.#unlockedAudio) p.unMute();
        p.playVideo();
      }
    } catch (_) {}
  }

  #play(seq) {
    const p = this.#players.get(seq);
    if (!p?.playVideo) return;
    try {
      if (this.#unlockedAudio) p.unMute();
      p.playVideo();
    } catch (_) {}
  }

  #pause(seq) {
    const p = this.#players.get(seq);
    if (!p?.pauseVideo) return;
    try { p.pauseVideo(); } catch (_) {}
  }

  #destroy(seq) {
    const p = this.#players.get(seq);
    if (!p) return;
    try { p.destroy(); } catch (_) {}
    this.#players.delete(seq);
  }

  #onPlayerReady(seq, event) {
    this.#dom.markLoaded(seq);
    if (seq === this.#activeSeq) {
      try {
        if (this.#unlockedAudio) event.target.unMute();
        event.target.playVideo();
      } catch (_) {}
    }
  }

  #onPlayerStateChange(seq, event) {
    if (seq !== this.#activeSeq) return;
    switch (event.data) {  // eslint-disable-line no-undef
      case YT.PlayerState.ENDED:  // eslint-disable-line no-undef
        this.#onEnded(seq);
        break;
      case YT.PlayerState.PLAYING:  // eslint-disable-line no-undef
        for (let k = 1; k <= PRELOAD_AHEAD; k++) this.ensure(seq + k);
        break;
    }
  }
}


/* ─────────────────────────────  APP  ─────────────────────────────────── */

class App {
  #feed        = new FeedManager();
  #dom         = new DOMManager(document.getElementById("track"));
  #players     = null;
  #ytReady     = false;
  #currentSeq  = 0;
  #tailSeq     = 0;
  #navLock     = false;
  #lastWheel   = 0;
  #isDragging  = false;
  /**
   * There is exactly ONE pending trim timer at any time.
   * Each navigate() clears this before scheduling a new one.
   * Without this, rapid swipes stack multiple trim callbacks that fire
   * with stale #currentSeq and over-trim the DOM.
   */
  #trimTimerId = null;

  constructor() {
    this.#players = new PlayerManager(
      this.#feed,
      this.#dom,
      // MUST route through #tryNavigate — not #navigate directly.
      // The old code called #navigate() directly from onEnded, bypassing
      // navLock. If a video ended during an active swipe, it would
      // double-advance regardless of the user's intent.
      (endedSeq) => this.#tryNavigate(endedSeq + 1)
    );

    this.#registerInputHandlers();
    window.addEventListener("resize", () => this.#dom.scrollToSeq(this.#currentSeq, false));
  }

  async start() {
    await this.#feed.fetch();
    if (this.#feed.poolSize === 0) {
      console.error("[App] No videos available from API.");
      return;
    }
    if (this.#ytReady) this.#init();
  }

  onYouTubeReady() {
    this.#ytReady = true;
    if (this.#feed.poolSize > 0) this.#init();
  }

  #init() {
    clearTimeout(this.#trimTimerId);
    this.#players.reset();
    this.#dom.reset();
    this.#currentSeq = 0;
    this.#tailSeq    = 0;
    this.#navLock    = false;
    this.#isDragging = false;

    this.#appendToTail(DOM_WINDOW_SIZE);
    this.#dom.scrollToSeq(0, false);
    this.#players.ensure(0);
    this.#players.activate(0);
  }

  /**
   * Navigate to targetSeq.
   *
   * DOM mutation order (order matters — do NOT change):
   *  1. Grow DOM to include target (append or prepend).
   *     prependSlides() re-anchors the transform internally.
   *  2. Animate to target.
   *  3. After TRANSITION_MS: trim the opposite end, then re-anchor.
   *     Re-anchoring after trim is mandatory — trimHead() increments
   *     #firstSeq, making the old translateY point to the wrong slide.
   *     Without re-anchoring, the viewport visually shows seq+1 while
   *     #currentSeq = seq. Every subsequent swipe cascades this off-by-one,
   *     which is what users experienced as "skipping to the third video".
   */
  #navigate(targetSeq) {
    const seq       = Math.max(0, targetSeq);
    if (seq === this.#currentSeq) return;

    const prevSeq       = this.#currentSeq;
    const movingForward = seq > prevSeq;
    this.#currentSeq    = seq;

    // 1. Grow DOM to reach target
    if (movingForward) {
      while (this.#tailSeq <= seq + PRELOAD_AHEAD) this.#appendToTail(1);
    } else {
      this.#dom.prependSlides(seq, prevSeq); // handles re-anchor internally
    }

    // 2. Animate
    this.#dom.scrollToSeq(seq, true);

    // 3. Trim after animation, then re-anchor
    clearTimeout(this.#trimTimerId);
    this.#trimTimerId = setTimeout(() => {
      if (movingForward) {
        const removed = this.#dom.trimHead(DOM_WINDOW_SIZE);
        if (removed.length > 0) {
          // trimHead changed #firstSeq — old transform is now wrong.
          this.#dom.scrollToSeq(this.#currentSeq, false);
          this.#players.destroyMany(removed);
        }
      } else {
        const removed = this.#dom.trimTail(DOM_WINDOW_SIZE);
        if (removed.length > 0) {
          this.#dom.scrollToSeq(this.#currentSeq, false);
          this.#tailSeq = Math.min(...removed);
          this.#players.destroyMany(removed);
        }
      }
    }, TRANSITION_MS + 60);

    // 4. Players
    this.#players.ensure(seq);
    for (let k = 1; k <= PRELOAD_AHEAD; k++) this.#players.ensure(seq + k);
    this.#players.activate(seq);
    this.#players.pauseAll(); // stop anything that shouldn't be playing
    this.#feed.maybePreFetch(seq);
  }

  #appendToTail(count) {
    this.#dom.appendSlides(this.#tailSeq, count);
    this.#tailSeq += count;
  }

  /** ALL navigation goes through here — navLock is the single gate. */
  #tryNavigate(seq) {
    if (this.#navLock) return;
    this.#navLock = true;
    this.#navigate(seq);
    setTimeout(() => { this.#navLock = false; }, NAV_COOLDOWN_MS);
  }

  #registerInputHandlers() {
    const appEl = document.getElementById("app");

    /* ── Touch ──────────────────────────────────────────────────────── */

    let touchStartY  = 0;
    let touchStartX  = 0;
    let touchStartMs = 0;

    appEl.addEventListener("touchstart", (e) => {
      if (this.#navLock) return; // navLock blocks new gestures
      touchStartY      = e.touches[0].clientY;
      touchStartX      = e.touches[0].clientX;
      touchStartMs     = Date.now();
      this.#isDragging = true;

      // Pre-populate adjacent slides so the live drag reveals them.
      if (this.#tailSeq <= this.#currentSeq + 1) this.#appendToTail(1);
      if (this.#currentSeq > 0) {
        this.#dom.prependSlides(this.#currentSeq - 1, this.#currentSeq);
      }
    }, { passive: true });

    appEl.addEventListener("touchmove", (e) => {
      if (!this.#isDragging) return;

      const dy = e.touches[0].clientY - touchStartY;
      const dx = e.touches[0].clientX - touchStartX;
      if (Math.abs(dx) > Math.abs(dy) + 10) return; // horizontal — ignore

      const clampedDy = (this.#currentSeq === 0 && dy > 0)
        ? dy * 0.15  // rubber-band at start of feed
        : dy;

      this.#dom.drag(clampedDy, this.#currentSeq);
    }, { passive: true });

    appEl.addEventListener("touchend", (e) => {
      // Capture before clearing — touchstart sets isDragging only when
      // navLock was false. If it was blocked, we must not process this end.
      const wasDragging = this.#isDragging;
      this.#isDragging  = false;
      if (!wasDragging) return;

      this.#players.unlockAudio();

      const dy = e.changedTouches[0].clientY - touchStartY;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dt = Date.now() - touchStartMs;

      if (Math.abs(dx) > Math.abs(dy) + 10) {
        this.#dom.scrollToSeq(this.#currentSeq, true);
        return;
      }

      const velocity  = Math.abs(dy) / Math.max(dt, 1);
      const isFlick   = velocity >= SWIPE_MIN_VEL && dt <= SWIPE_FAST_MS;
      const threshold = isFlick ? SWIPE_FAST_PX : SWIPE_MIN_PX;

      if (Math.abs(dy) >= threshold) {
        this.#tryNavigate(dy < 0 ? this.#currentSeq + 1 : this.#currentSeq - 1);
      } else if (Math.abs(dy) < 10) {
        this.#players.toggleActive(); // tap
      } else {
        this.#dom.scrollToSeq(this.#currentSeq, true); // partial drag — snap back
      }
    }, { passive: true });

    appEl.addEventListener("touchcancel", () => {
      this.#isDragging = false;
      this.#dom.scrollToSeq(this.#currentSeq, true);
    }, { passive: true });

    /* ── Mouse / pointer ────────────────────────────────────────────── */

    let pDownX = 0, pDownY = 0;
    appEl.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      pDownX = e.clientX; pDownY = e.clientY;
    });
    appEl.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      if (Math.hypot(e.clientX - pDownX, e.clientY - pDownY) < 8) {
        this.#players.unlockAudio();
        this.#players.toggleActive();
      }
    });

    /* ── Wheel ──────────────────────────────────────────────────────── */

    document.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.#players.unlockAudio();
      const now = Date.now();
      if (now - this.#lastWheel < WHEEL_COOLDOWN_MS) return;
      this.#lastWheel = now;
      this.#tryNavigate(e.deltaY > 0 ? this.#currentSeq + 1 : this.#currentSeq - 1);
    }, { passive: false });

    /* ── Keyboard ───────────────────────────────────────────────────── */

    document.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowDown": case "ArrowRight":
          e.preventDefault();
          this.#players.unlockAudio();
          this.#tryNavigate(this.#currentSeq + 1);
          break;
        case "ArrowUp": case "ArrowLeft":
          e.preventDefault();
          this.#players.unlockAudio();
          this.#tryNavigate(this.#currentSeq - 1);
          break;
        case " ":
          e.preventDefault();
          this.#players.toggleActive();
          break;
      }
    });
  }
}


/* ──────────────────────────────  BOOT  ────────────────────────────────── */

const app = new App();
window.onYouTubeIframeAPIReady = () => app.onYouTubeReady();
app.start();