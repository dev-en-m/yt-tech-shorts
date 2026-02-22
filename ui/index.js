/*
 Infinite scroll implementation:
 - seq: ever-increasing sequence number (0,1,2,...)
 - videoPool: the finite pool of IDs (rotate by modulo)
 - windowSize: number of slides kept in DOM
 - firstSeq: sequence number of the first slide currently in DOM
 - players[seq]: YT player for sequence number
*/

const videoPool = [
  /* example pool (replace/extend up to your 400 ids) */
  "LXmNeVLM4e4",
  "HgXu-4ITMdQ",
  "WA4PM81-uR0",
  "kGynnbypNso",
  "b9qR8iXTB88",
  "5hESwPAf4yA",
];

// CONFIG
const WINDOW_SIZE = 7; // how many slides in DOM at once (tweak)
const PRELOAD_AHEAD = 1; // create player for this many slides ahead
const TRIM_BUFFER = 4; // extra slides to keep beyond WINDOW_SIZE
const ROTATE = true; // true -> map seq % pool.length
// if pool length is 0 -> nothing to render
if (!videoPool.length) throw new Error("videoPool is empty");

let seqCounter = 0; // next sequence number to allocate at the tail
let firstSeq = 0; // sequence number of first DOM slide
let currentSeq = 0; // sequence number that is currently playing
let players = Object.create(null); // map seq -> YT.Player
let navLock = false;
let ytReady = false,
  pendingInit = false;

const track = document.getElementById("track");
const flash = document.getElementById("flash");
const flashIcon = document.getElementById("flash-icon");

window.onYouTubeIframeAPIReady = () => {
  ytReady = true;
  if (pendingInit) init();
};

function videoIdForSeq(seq) {
  if (ROTATE) return videoPool[seq % videoPool.length];
  return videoPool[seq];
}

// create a single slide DOM for sequence `seq` and append to tail
function createSlideElement(seq) {
  const slide = document.createElement("div");
  slide.className = "slide";
  slide.dataset.seq = seq;

  // Video wrapper
  const wrap = document.createElement("div");
  wrap.className = "yt-wrap";
  wrap.id = `yt-${seq}`;
  slide.appendChild(wrap);

  // Info overlay (video title)
  const info = document.createElement("div");
  info.className = "info";
  info.innerHTML = `<div class="video-title"></div>`;
  slide.appendChild(info);

  // Sidebar (Like/Share buttons)
  const sidebar = document.createElement("div");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <div class="sidebar-btn">
      <div class="icon">
        <svg viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.3l.9-4.6.1-.3c0-.4-.2-.8-.5-1.1L14 1 7.6 7.6c-.4.4-.6.9-.6 1.4v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7c.1-.2.2-.5.2-.7v-2z"/></svg>
      </div>
      <span>Like</span>
    </div>
    <div class="sidebar-btn">
      <div class="icon">
        <svg viewBox="0 0 24 24"><path d="M18 16.1c-.8 0-1.4.3-2 .8l-7.1-4.2c.1-.2.1-.4.1-.7s0-.5-.1-.7l7.1-4.1c.6.5 1.3.8 2 .8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .2 0 .5.1.7L8 9.8c-.6-.5-1.3-.8-2-.8-1.7 0-3 1.3-3 3s1.3 3 3 3c.7 0 1.4-.3 2-.8l7.1 4.2c-.1.2-.1.4-.1.7 0 1.6 1.3 3 3 3s3-1.4 3-3-1.3-3-3-3z"/></svg>
      </div>
      <span>Share</span>
    </div>
  `;
  sidebar.addEventListener("touchend", (e) => e.stopPropagation());
  sidebar.addEventListener("click", (e) => e.stopPropagation());
  slide.appendChild(sidebar);

  // Touch overlay
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  slide.appendChild(overlay);

  return slide;
}

// append n slides at the tail (seqCounter..seqCounter+n-1)
function appendSlides(n) {
  for (let i = 0; i < n; i++) {
    const seq = seqCounter++;
    const el = createSlideElement(seq);
    track.appendChild(el);
  }
}

// prepend slides at the head (for backward navigation) - creates firstSeq-n .. firstSeq-1
function prependSlides(n) {
  for (let i = 0; i < n; i++) {
    const seq = firstSeq - 1 - i;
    const el = createSlideElement(seq);
    track.insertBefore(el, track.firstChild);
  }
  // update firstSeq since we inserted earlier sequences
  firstSeq = firstSeq - n;
}

function trimHeadIfNeeded() {
  while (track.children.length > WINDOW_SIZE + TRIM_BUFFER) {
    const first = track.firstChild;
    destroyPlayer(parseInt(first.dataset.seq, 10));
    track.removeChild(first);
    firstSeq++;
  }
}

function trimTailIfNeeded() {
  while (track.children.length > WINDOW_SIZE + TRIM_BUFFER) {
    const last = track.lastChild;
    destroyPlayer(parseInt(last.dataset.seq, 10));
    track.removeChild(last);
  }
}

// create YT player for sequence `seq`
function createPlayerForSeq(seq) {
  const id = videoIdForSeq(seq);
  const containerId = `yt-${seq}`;

  // avoid recreating
  if (players[seq]) return;

  // if container doesn't exist yet (race), skip
  const container = document.getElementById(containerId);
  if (!container) return;

  players[seq] = new YT.Player(containerId, {
    videoId: id,
    playerVars: {
      autoplay: 1,
      mute: 1,
      controls: 1,
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      iv_load_policy: 3,
      disablekb: 1,
      origin: window.location.origin,
    },
    events: {
      onReady: (e) => {
        if (seq === currentSeq) e.target.playVideo();
      },
      onStateChange: (e) => {
        if (seq !== currentSeq) return;
        if (e.data === YT.PlayerState.ENDED) safeGoSeq(currentSeq + 1);
        if (e.data === YT.PlayerState.PLAYING) {
          for (let k = 1; k <= PRELOAD_AHEAD; k++) createPlayerForSeq(currentSeq + k);
        }
      },
    },
  });
}

// destroy player for seq
function destroyPlayer(seq) {
  const p = players[seq];
  if (p) {
    try { p.destroy(); } catch (_) {}
    delete players[seq];
  }
}

// compute slide height
function slideHeight() {
  const s = track.querySelector(".slide");
  return s ? s.getBoundingClientRect().height : window.innerHeight;
}

// translate track to show sequence `seq`
function setTrackToSeq(seq, animate = true) {
  // ensure seq is inside DOM; if not, extend window
  const domFirst = firstSeq;
  const domLast = firstSeq + track.children.length - 1;

  if (seq < domFirst) {
    // need to prepend enough slides
    const need = Math.min(domFirst - seq + 2, WINDOW_SIZE); // safety
    prependSlides(need);
  } else if (seq > domLast) {
    const need = seq - domLast + 2;
    appendSlides(need);
  }

  // after possible append/prepend, update trimming
  trimHeadIfNeeded();
  trimTailIfNeeded();

  // compute current DOM offset
  const indexInDOM = seq - firstSeq;
  const h = slideHeight();
  if (!animate) {
    track.style.transition = "none";
    track.style.transform = `translateY(${-indexInDOM * h}px)`;
    // force reflow then re-enable transition
    // eslint-disable-next-line no-unused-expressions
    track.offsetHeight;
    track.style.transition = "";
  } else {
    track.style.transform = `translateY(${-indexInDOM * h}px)`;
  }
}

// go to a specific sequence (plays it)
function goToSeq(seq) {
  if (seq === currentSeq) return;
  // pause previous
  const prev = players[currentSeq];
  if (prev) {
    try { prev.pauseVideo(); } catch (_) {}
  }

  // sanity: create DOM / players for target
  setTrackToSeq(seq, true);
  currentSeq = seq;

  if (ytReady) {
    createPlayerForSeq(currentSeq);
    for (let k = 1; k <= PRELOAD_AHEAD; k++) createPlayerForSeq(currentSeq + k);
  }

  // if we are near the tail, ensure more slides are appended
  const domLast = firstSeq + track.children.length - 1;
  if (currentSeq >= domLast - 2) appendSlides(3);
  trimHeadIfNeeded();
}

// safe navigation wrapper
function safeGoSeq(seq) {
  if (navLock) return;
  navLock = true;
  goToSeq(seq);
  setTimeout(() => (navLock = false), 620);
}

// toggle play/pause for current
function togglePlayCurrent() {
  const p = players[currentSeq];
  if (!p || !p.getPlayerState) return;
  const s = p.getPlayerState();
  if (s === YT.PlayerState.PLAYING) {
    try {
      p.pauseVideo();
    } catch (_) {}
    showFlash(false);
  } else {
    try {
      p.playVideo();
    } catch (_) {}
    showFlash(true);
  }
}

function showFlash(playing) {
  flashIcon.innerHTML = playing
    ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  flash.classList.add("show");
  setTimeout(() => flash.classList.remove("show"), 600);
}

/* init: create initial window */
function init() {
  pendingInit = false;
  track.innerHTML = "";
  players = Object.create(null);
  seqCounter = 0;
  firstSeq = 0;
  currentSeq = 0;

  appendSlides(WINDOW_SIZE); // fill initial window
  // set track position without animation
  setTrackToSeq(0, false);
  if (ytReady) {
    createPlayerForSeq(0);
    createPlayerForSeq(1);
  }
}

/* gestures */
(function () {
  const app = document.getElementById("app");
  let sy = 0,
    sx = 0,
    t0 = 0,
    suppress = false;

  app.addEventListener(
    "touchstart",
    (e) => {
      sy = e.touches[0].clientY;
      sx = e.touches[0].clientX;
      t0 = Date.now();
      suppress = false;
    },
    { passive: true },
  );

  app.addEventListener("touchend", (e) => {
    const dy = e.changedTouches[0].clientY - sy;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > Math.abs(dy)) return;
    const fast = Date.now() - t0 < 300;
    if (Math.abs(dy) > (fast ? 35 : 70)) {
      suppress = true;
      dy < 0 ? safeGoSeq(currentSeq + 1) : safeGoSeq(currentSeq - 1);
    } else {
      suppress = true;
      togglePlayCurrent();
    }
  });

  app.addEventListener("click", () => {
    if (suppress) {
      suppress = false;
      return;
    }
    togglePlayCurrent();
  });
})();

/* wheel */
let wheelLock = 0;
document.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock < 500) return;
    wheelLock = now;
    e.deltaY > 0 ? safeGoSeq(currentSeq + 1) : safeGoSeq(currentSeq - 1);
  },
  { passive: false },
);

/* keep track of window resize to recalc translate */
window.addEventListener("resize", () => {
  // reapply transform at current seq without animation
  setTrackToSeq(currentSeq, false);
});

/* boot */
if (ytReady) init();
else pendingInit = true;
