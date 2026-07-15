var RMX = window.RMX || (window.RMX = {});

// View-agnostic renderer: tag the diff cells a refactoring touches (no visible
// style of their own) so a click or comment-deep-link can blink that
// refactoring in neon on both sides and peek its off-screen lines. It reaches
// the DOM only through RMX.github, so the same renderer serves every view adapter.
RMX.overlay = (function () {
  const CLASS = 'rmx-hl'; // marker on every tagged cell; carries no colour itself
  const TIP = 'rmx-tip';
  const FLASH = 'rmx-flash';
  const SEL = 'rmx-sel'; // neon "selected refactoring" highlight, both sides
  const ON = 'rmx-on'; // blink "on" phase — the darker-yellow fill is visible

  // Blink colours are user-configurable (options page → chrome.storage.sync, one
  // colour per side). The stylesheet references them as CSS custom properties
  // with these defaults as fallbacks, so a fresh install (or a page loaded before
  // storage resolves) still shows the original pink/purple. Keep the fills in
  // sync with the defaults mirrored in options.js. `left`/`right` are the blink
  // fills; `leftD`/`rightD` are the hand-picked outline+stripe shades used when a
  // side stays at its default (preserving the original look exactly) — a custom
  // colour derives its darker shade from the fill instead (see applyColors).
  const HL_DEFAULTS = { left: '#ec4899', right: '#7c3aed', leftD: '#be185d', rightD: '#6d28d9' };

  // Multiply a #rgb/#rrggbb colour toward black by `amt` (0–1) to get the
  // outline/stripe shade. Returns the input unchanged if it isn't a hex colour.
  function darken(hex, amt) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    const r = Math.round(((n >> 16) & 255) * (1 - amt));
    const g = Math.round(((n >> 8) & 255) * (1 - amt));
    const b = Math.round((n & 255) * (1 - amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function applyColors(left, right) {
    const root = document.documentElement.style;
    const leftD = left.toLowerCase() === HL_DEFAULTS.left ? HL_DEFAULTS.leftD : darken(left, 0.22);
    const rightD = right.toLowerCase() === HL_DEFAULTS.right ? HL_DEFAULTS.rightD : darken(right, 0.22);
    root.setProperty('--rmx-left', left);
    root.setProperty('--rmx-left-d', leftD);
    root.setProperty('--rmx-right', right);
    root.setProperty('--rmx-right-d', rightD);
  }

  // Pull the stored blink colours (falling back to defaults) and mirror them onto
  // :root, then keep them in sync so edits in the options page recolour any open
  // diff live. The onChanged listener is installed once per page.
  function loadColors() {
    const store =
      typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
    if (!store) return applyColors(HL_DEFAULTS.left, HL_DEFAULTS.right);
    store.get(['hlLeft', 'hlRight'], (r) => {
      r = r || {};
      applyColors(r.hlLeft || HL_DEFAULTS.left, r.hlRight || HL_DEFAULTS.right);
    });
    if (chrome.storage.onChanged && !window.__rmxColorWatch) {
      window.__rmxColorWatch = true;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && (changes.hlLeft || changes.hlRight)) loadColors();
      });
    }
  }

  function ensureStyle() {
    if (document.getElementById('rmx-style')) return;
    loadColors();
    const s = document.createElement('style');
    s.id = 'rmx-style';
    s.textContent = `
      .${CLASS}.${SEL}[data-rmx-side="L"]{box-shadow:inset 3px 0 0 var(--rmx-left-d,#be185d),0 0 0 2px var(--rmx-left-d,#be185d) !important;transition:background-color 2s ease-in-out;}
      .${CLASS}.${SEL}[data-rmx-side="L"].${ON}{background:var(--rmx-left,#ec4899) !important;}
      .${CLASS}.${SEL}[data-rmx-side="R"]{box-shadow:inset 3px 0 0 var(--rmx-right-d,#6d28d9),0 0 0 2px var(--rmx-right-d,#6d28d9) !important;transition:background-color 2s ease-in-out;}
      .${CLASS}.${SEL}[data-rmx-side="R"].${ON}{background:var(--rmx-right,#7c3aed) !important;}
      .${TIP}{position:absolute;z-index:2147483647;max-width:460px;white-space:pre-wrap;
        background:#1f2328;color:#fff;padding:6px 9px;border-radius:6px;pointer-events:none;
        font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transition:opacity .08s;}
      .${FLASH}{animation:rmx-flash 1.1s ease-out 2;}
      @keyframes rmx-flash{0%,100%{filter:none;}50%{filter:brightness(1.45);}}

      /* Pinned-line bars: selected lines that scrolled out of view, stacked at
         the top/bottom edge as a floating peek of the off-screen refactored code. */
      #rmx-pin-top,#rmx-pin-bottom{position:fixed;left:0;right:0;z-index:2147483600;
        display:flex;flex-direction:column;pointer-events:none;}
      #rmx-pin-top{top:0;}
      #rmx-pin-bottom{bottom:0;flex-direction:column-reverse;}
      .rmx-pin{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:10px;
        height:28px;padding:0 12px;white-space:nowrap;overflow:hidden;
        font:12px/28px ui-monospace,SFMono-Regular,Menlo,monospace;
        color:var(--fgColor-default,#1f2328);box-shadow:0 1px 5px rgba(31,35,40,.16);
        animation:rmx-pin-blink-L 1.8s ease-in-out infinite;}
      .rmx-pin.rmx-pin-R{animation-name:rmx-pin-blink-R;}
      @keyframes rmx-pin-blink-L{0%,100%{background:var(--bgColor-default,#fff);}50%{background:var(--rmx-left,#ec4899);}}
      @keyframes rmx-pin-blink-R{0%,100%{background:var(--bgColor-default,#fff);}50%{background:var(--rmx-right,#7c3aed);}}
      @keyframes rmx-pin-fast-L{0%,49%{background:var(--bgColor-default,#fff);}50%,100%{background:var(--rmx-left,#ec4899);}}
      @keyframes rmx-pin-fast-R{0%,49%{background:var(--bgColor-default,#fff);}50%,100%{background:var(--rmx-right,#7c3aed);}}
      #rmx-pin-top .rmx-pin{border-bottom:1px solid var(--borderColor-muted,#d8dee4);}
      #rmx-pin-bottom .rmx-pin{border-top:1px solid var(--borderColor-muted,#d8dee4);}
      .rmx-pin .rmx-pin-stripe{width:4px;align-self:stretch;flex:0 0 auto;}
      .rmx-pin .rmx-pin-meta{color:var(--fgColor-muted,#656d76);flex:0 0 auto;}
      .rmx-pin .rmx-pin-code{overflow:hidden;text-overflow:ellipsis;opacity:.92;}
      .rmx-pin-toggle{pointer-events:auto;cursor:pointer;display:flex;align-items:center;
        justify-content:center;gap:6px;height:22px;padding:0 14px;white-space:nowrap;
        background:var(--bgColor-muted,#f6f8fa);color:var(--fgColor-muted,#656d76);
        font:11px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow:0 1px 3px rgba(31,35,40,.1);user-select:none;transition:background .12s,color .12s;}
      .rmx-pin-toggle:hover{color:var(--fgColor-default,#1f2328);background:var(--bgColor-neutral,#eaeef2);}
      #rmx-pin-top .rmx-pin-toggle{border-bottom:1px solid var(--borderColor-default,#d0d7de);}
      #rmx-pin-bottom .rmx-pin-toggle{border-top:1px solid var(--borderColor-default,#d0d7de);}
      .rmx-pin-toggle-caret{font-size:10px;font-weight:700;}

      /* Refactorings report — a collapsible list pinned bottom-left, shown in
         both PR and commit views. Each row selects (blinks) its refactoring. */
      /* Above the pinned bars (2147483600) so its rows stay clickable when a
         selection's off-screen peek bars appear along the bottom edge. */
      #rmx-report{position:fixed;bottom:16px;left:16px;z-index:2147483601;width:290px;max-width:42vw;
        background:var(--bgColor-default,#fff);color:var(--fgColor-default,#1f2328);
        border:1px solid var(--borderColor-default,#d0d7de);border-radius:8px;overflow:hidden;
        box-shadow:0 4px 16px rgba(31,35,40,.2);
        font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      #rmx-report .rmx-rp-head{display:flex;align-items:center;justify-content:space-between;
        padding:8px 11px;cursor:pointer;font-weight:600;user-select:none;
        border-bottom:1px solid var(--borderColor-muted,#d8dee4);}
      #rmx-report .rmx-rp-caret{font-size:10px;color:var(--fgColor-muted,#656d76);transition:transform .15s;}
      #rmx-report.rmx-collapsed .rmx-rp-body{display:none;}
      #rmx-report.rmx-collapsed .rmx-rp-head{border-bottom:0;}
      #rmx-report.rmx-collapsed .rmx-rp-caret{transform:rotate(-90deg);}
      #rmx-report .rmx-rp-body{max-height:40vh;overflow-y:auto;}
      #rmx-report .rmx-rp-row{padding:6px 11px;cursor:pointer;border-bottom:1px solid var(--borderColor-muted,#d8dee4);}
      #rmx-report .rmx-rp-row:last-child{border-bottom:0;}
      #rmx-report .rmx-rp-row:hover{background:var(--bgColor-muted,#f6f8fa);}
      #rmx-report .rmx-rp-type{font-weight:600;}
      #rmx-report .rmx-rp-sum{color:var(--fgColor-muted,#656d76);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      #rmx-report .rmx-rp-msg{padding:10px 11px;color:var(--fgColor-muted,#656d76);display:flex;align-items:center;gap:8px;}
      #rmx-report .rmx-rp-err{color:var(--fgColor-danger,#cf222e);}
      #rmx-report .rmx-rp-spinner{width:12px;height:12px;flex:0 0 auto;border-radius:50%;
        border:2px solid var(--borderColor-default,#d0d7de);border-top-color:var(--fgColor-accent,#0969da);
        animation:rmx-spin .8s linear infinite;}
      @keyframes rmx-spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(s);
  }

  function clearCell(el) {
    el.classList.remove(CLASS, FLASH, SEL, ON);
    el.removeAttribute('data-rmx-desc');
    el.removeAttribute('data-rmx-index');
    el.removeAttribute('data-rmx-side');
    el.removeAttribute('data-rmx-file');
  }

  function clearAll() {
    document.querySelectorAll('.' + CLASS).forEach(clearCell);
  }

  // --- paint reconciliation ------------------------------------------------
  // The /changes diff virtualizes rows: React *recycles* a DOM node to render a
  // different line as you scroll, rewriting the text/anchor it manages but
  // leaving our class + data-rmx-* attributes on it. Additive re-paints (the
  // scroll path) never clearAll, so that node keeps a highlight for a line no
  // refactoring references. To stop those stale highlights, each paint pass
  // records every cell it (re)touches; endPass() then strips any still-classed
  // cell that wasn't touched — i.e. one that was recycled to a non-target line.
  let paintedThisPass = null;
  function startPass() {
    paintedThisPass = new Set();
  }
  function endPass() {
    if (!paintedThisPass) return;
    const touched = paintedThisPass;
    paintedThisPass = null;
    document.querySelectorAll('.' + CLASS).forEach((el) => {
      if (!touched.has(el)) clearCell(el);
    });
  }

  function appendUnique(el, attr, value, sep) {
    const prev = el.getAttribute(attr);
    if (!prev) {
      el.setAttribute(attr, value);
    } else if (prev.split(sep).indexOf(value) === -1) {
      el.setAttribute(attr, prev + sep + value);
    }
  }

  // A diff line is "blank" when its only content is the gutter line number, i.e.
  // an empty source line. RefactoringMiner's declaration ranges are inclusive and
  // overshoot — they trail into the blank line (and the next element) after a
  // method — so skip those: tagging an empty row just makes a blank line selectable.
  function lineHasCode(cells, line) {
    return cells.some((c) => {
      const t = (c.textContent || '').trim();
      return t !== '' && t !== String(line);
    });
  }

  // The line begins a new declaration (Python `def`/`class`). RefactoringMiner's
  // declaration ranges overshoot onto the *next* element's first line in
  // indent-based languages — and a `def`/`class` line can never legitimately be
  // the last line of a block (it needs a body) — so a range whose endLine starts
  // a declaration has over-shot. Brace languages end on `}`, so they're unaffected.
  function startsDeclaration(cells, line) {
    let code = '';
    cells.forEach((c) => {
      const t = c.textContent || '';
      if (t.trim() && t.trim() !== String(line)) code = t;
    });
    return /^\s*(async\s+def\b|def\b|class\b)/.test(code);
  }

  // Tag every line in [startLine,endLine] for one side of one file so the
  // selection can find them. A cell touched by several refactorings accumulates
  // each one's summary (deduped) and index. Returns the count of mounted lines.
  function highlightRange({ digest, side, startLine, endLine, summary, index, filePath }) {
    let painted = 0;
    for (let line = startLine; line <= endLine; line++) {
      const cells = RMX.github.lineCells(digest, side, line);
      if (!cells.length) continue;
      if (!lineHasCode(cells, line)) continue; // skip blank source lines (nothing to tag)
      // Stop a multi-line range before an over-shot trailing declaration (the
      // next method/class), but never trim the range's own opening line.
      if (line === endLine && line !== startLine && startsDeclaration(cells, line)) continue;
      cells.forEach((cell) => {
        if (paintedThisPass) paintedThisPass.add(cell);
        cell.classList.add(CLASS);
        cell.setAttribute('data-rmx-side', side);
        if (filePath) cell.setAttribute('data-rmx-file', filePath);
        appendUnique(cell, 'data-rmx-desc', summary, '\n');
        appendUnique(cell, 'data-rmx-index', String(index), ' ');
      });
      painted++;
    }
    return painted;
  }

  // --- click-to-pair selection -------------------------------------------
  // Clicking a highlighted cell lights up every cell of the same refactoring(s)
  // in neon on BOTH sides, so the counterpart is obvious. The selection is kept
  // in memory and re-applied after re-paints (so it survives scrolling).
  let selectedIndices = [];
  let blinkOn = false;
  let blinkTimer = null;
  let inAttentionPhase = false;
  const ATTENTION_BLINKS = 3;   // number of fast blinks before settling into slow pulse
  const BLINK_FAST_MS = 167;    // per phase during attention (~3 blinks in ~1 second)
  const BLINK_MS = 2500;        // half-cycle — matches half of PIN_BLINK_MS so full period = 5s

  // Marks every cell of the selected refactoring(s) and sets its fill to the
  // current blink phase. Additive + idempotent, so scroll re-paints just sync
  // newly mounted cells to the current phase. SEL keeps the outline always;
  // ON (the fill) is what blinks. During the attention phase transitions are
  // suppressed so the fast blink is a crisp binary flash.
  function applySelection() {
    selectedIndices.forEach((i) => {
      document.querySelectorAll(`.${CLASS}[data-rmx-index~="${i}"]`).forEach((el) => {
        el.classList.add(SEL);
        el.classList.toggle(ON, blinkOn);
        el.style.transitionDuration = inAttentionPhase ? '0s' : '';
      });
    });
    schedulePins();
  }

  function removeSelectionClasses() {
    document.querySelectorAll('.' + SEL).forEach((el) => {
      el.classList.remove(SEL, ON);
      el.style.transitionDuration = '';
    });
  }

  function select(indices) {
    removeSelectionClasses();
    selectedIndices = indices.slice();
    clearTimeout(blinkTimer);

    // Phase 1: ATTENTION_BLINKS fast crisp flashes to grab the user's eye.
    inAttentionPhase = true;
    blinkOn = true;
    applySelection();
    let togglesLeft = ATTENTION_BLINKS * 2; // each blink = one on + one off toggle
    function fastTick() {
      blinkOn = !blinkOn;
      document.querySelectorAll(`.${CLASS}.${SEL}`).forEach((el) => el.classList.toggle(ON, blinkOn));
      if (--togglesLeft > 0) {
        blinkTimer = setTimeout(fastTick, BLINK_FAST_MS);
        return;
      }
      // Phase 2: attention done — restore transitions and settle into slow synced pulse.
      inAttentionPhase = false;
      document.querySelectorAll(`.${CLASS}.${SEL}`).forEach((el) => { el.style.transitionDuration = ''; });
      schedulePins();
      const elapsed = (Date.now() - blinkEpoch) % PIN_BLINK_MS;
      blinkOn = elapsed < BLINK_MS;
      document.querySelectorAll(`.${CLASS}.${SEL}`).forEach((el) => el.classList.toggle(ON, blinkOn));
      const timeUntilNext = blinkOn ? (BLINK_MS - elapsed) : (PIN_BLINK_MS - elapsed);
      function slowTick() {
        blinkOn = !blinkOn;
        document.querySelectorAll(`.${CLASS}.${SEL}`).forEach((el) => el.classList.toggle(ON, blinkOn));
        blinkTimer = setTimeout(slowTick, BLINK_MS);
      }
      blinkTimer = setTimeout(slowTick, timeUntilNext);
    }
    blinkTimer = setTimeout(fastTick, BLINK_FAST_MS);
  }

  function clearSelection() {
    clearTimeout(blinkTimer);
    inAttentionPhase = false;
    selectedIndices = [];
    blinkOn = false;
    removeSelectionClasses();
    stackCollapsed.top = false;
    stackCollapsed.bottom = false;
    clearPins();
  }

  // --- pinned-line peek ---------------------------------------------------
  // Selected lines that scroll out of view are mirrored as floating bars at the
  // top edge (when scrolled below them) or bottom edge (above them), stacked in
  // document order. Clones, not the real rows — GitHub virtualizes the table.
  const TOP_ZONE = 56; // approx. height of GitHub's sticky header region
  const PIN_BLINK_MS = 5000; // bar pulse period (slower than the in-diff blink)
  const blinkEpoch = Date.now(); // shared clock so rebuilt bars stay in phase
  let topLayer = null;
  let topToggle = null;
  let bottomLayer = null;
  let bottomToggle = null;
  let pinRaf = null;
  const stackCollapsed = { top: false, bottom: false };

  function makePinToggle(key) {
    const toggle = document.createElement('div');
    toggle.className = 'rmx-pin-toggle';
    toggle.style.display = 'none';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      stackCollapsed[key] = !stackCollapsed[key];
      updatePins();
    });
    return toggle;
  }

  function ensurePinLayers() {
    if (topLayer) return;
    topLayer = document.createElement('div');
    topLayer.id = 'rmx-pin-top';
    topToggle = makePinToggle('top');
    topLayer.appendChild(topToggle);

    bottomLayer = document.createElement('div');
    bottomLayer.id = 'rmx-pin-bottom';
    bottomToggle = makePinToggle('bottom');
    bottomLayer.appendChild(bottomToggle);

    document.body.appendChild(topLayer);
    document.body.appendChild(bottomLayer);
  }

  function clearPins() {
    if (topLayer) topLayer.querySelectorAll('.rmx-pin').forEach((el) => el.remove());
    if (bottomLayer) bottomLayer.querySelectorAll('.rmx-pin').forEach((el) => el.remove());
    if (topToggle) topToggle.style.display = 'none';
    if (bottomToggle) bottomToggle.style.display = 'none';
    syncReportOffset();
  }

  function schedulePins() {
    if (pinRaf) return;
    pinRaf = requestAnimationFrame(() => {
      pinRaf = null;
      updatePins();
    });
  }

  function updatePins() {
    if (!selectedIndices.length) {
      clearPins();
      return;
    }
    ensurePinLayers();

    // One entry per selected line (group the gutter + code cells that share a
    // data-line-anchor; keep the code cell — the one with the most text).
    const byAnchor = {};
    document.querySelectorAll(`.${CLASS}.${SEL}`).forEach((cell) => {
      const anchor = cell.getAttribute('data-line-anchor');
      if (!anchor) return;
      const len = (cell.textContent || '').length;
      if (!byAnchor[anchor] || len > byAnchor[anchor].len) byAnchor[anchor] = { cell, len, anchor };
    });

    const vh = window.innerHeight || document.documentElement.clientHeight;
    const above = [];
    const below = [];
    Object.keys(byAnchor).forEach((a) => {
      const entry = byAnchor[a];
      const r = entry.cell.getBoundingClientRect();
      if (!r.height) return; // unmounted by virtualization
      entry.top = r.top;
      if (r.bottom <= TOP_ZONE) above.push(entry);
      else if (r.top >= vh) below.push(entry);
    });
    above.sort((x, y) => x.top - y.top);
    below.sort((x, y) => x.top - y.top);

    renderStack(topLayer, above);
    renderStack(bottomLayer, below);
    syncReportOffset();
  }

  function renderStack(layer, entries) {
    // Remove only bar rows — the persistent toggle stays in the DOM so hover is never interrupted.
    layer.querySelectorAll('.rmx-pin').forEach((el) => el.remove());

    const isTop = layer.id === 'rmx-pin-top';
    const toggle = isTop ? topToggle : bottomToggle;
    const key = isTop ? 'top' : 'bottom';
    const collapsed = stackCollapsed[key];

    if (!entries.length) {
      toggle.style.display = 'none';
      return;
    }

    if (!collapsed) {
      entries.forEach((entry) => {
        const m = /^diff-[0-9a-f]{64}([LR])(\d+)$/.exec(entry.anchor) || [];
        const file = (entry.cell.getAttribute('data-rmx-file') || '').split('/').pop();

        const side = entry.cell.getAttribute('data-rmx-side');
        const bar = document.createElement('div');
        bar.className = 'rmx-pin' + (side ? ' rmx-pin-' + side : '');
        // Negative delay = start mid-cycle at the shared phase, so bars rebuilt on
        // scroll resume the pulse seamlessly instead of restarting it.
        if (inAttentionPhase) {
          const fastPeriod = BLINK_FAST_MS * 2;
          bar.style.animationName = side === 'R' ? 'rmx-pin-fast-R' : 'rmx-pin-fast-L';
          bar.style.animationDuration = (fastPeriod / 1000) + 's';
          bar.style.animationTimingFunction = 'linear';
          bar.style.animationDelay = '-' + ((Date.now() - blinkEpoch) % fastPeriod / 1000) + 's';
        } else {
          bar.style.animationDuration = (PIN_BLINK_MS / 1000) + 's';
          bar.style.animationDelay = '-' + (((Date.now() - blinkEpoch) % PIN_BLINK_MS) / 1000) + 's';
        }
        const stripe = document.createElement('span');
        stripe.className = 'rmx-pin-stripe';
        stripe.style.background = side === 'R' ? 'var(--rmx-right-d,#6d28d9)' : 'var(--rmx-left-d,#be185d)';
        const meta = document.createElement('span');
        meta.className = 'rmx-pin-meta';
        meta.textContent = `${file}:${m[1] || ''}${m[2] || ''}`;
        const code = document.createElement('span');
        code.className = 'rmx-pin-code';
        code.textContent = (entry.cell.textContent || '').trim().slice(0, 160);

        bar.appendChild(stripe);
        bar.appendChild(meta);
        bar.appendChild(code);
        bar.addEventListener('click', () => entry.cell.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        // Insert before the toggle so the toggle always stays last in DOM:
        // last = bottom of top stack (column), top of bottom stack (column-reverse).
        layer.insertBefore(bar, toggle);
      });
    }

    // Update the persistent toggle's label in-place (no recreation = no hover flicker).
    // Arrow points toward the bars: ▲ when bars are above the toggle (top stack expanded),
    // ▼ when bars are below (bottom stack expanded), reversed when collapsed.
    const n = entries.length;
    const caret = (isTop !== collapsed) ? '▲' : '▼';
    toggle.innerHTML = `<span class="rmx-pin-toggle-caret">${caret}</span><span>${n} line${n !== 1 ? 's' : ''} off screen</span>`;
    toggle.style.display = '';
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight);
  }

  // Bring the opposite side's first matching cell into view (only if it's
  // off-screen), so clicking the left element jumps you to the right one.
  function scrollToCounterpart(cell, indices) {
    const side = cell.getAttribute('data-rmx-side');
    for (let k = 0; k < indices.length; k++) {
      const matches = document.querySelectorAll(`.${CLASS}[data-rmx-index~="${indices[k]}"]`);
      for (let j = 0; j < matches.length; j++) {
        if (matches[j].getAttribute('data-rmx-side') !== side) {
          if (!inViewport(matches[j])) matches[j].scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    }
  }

  // One delegated tooltip + click handler shared by all highlighted cells.
  function installTooltip() {
    ensureStyle();
    if (window.__rmxTip) return;
    const tip = document.createElement('div');
    tip.className = TIP;
    document.body.appendChild(tip);
    window.__rmxTip = tip;
    document.addEventListener('mouseover', (e) => {
      const cell = e.target.closest && e.target.closest('.' + CLASS);
      if (!cell) {
        tip.style.opacity = 0;
        return;
      }
      tip.textContent = cell.getAttribute('data-rmx-desc') || '';
      const r = cell.getBoundingClientRect();
      tip.style.top = window.scrollY + r.top - tip.offsetHeight - 6 + 'px';
      tip.style.left = window.scrollX + r.left + 'px';
      tip.style.opacity = 1;
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest) return;
      // Clicks on our own UI (pinned bars, report panel) shouldn't clear the selection.
      if (e.target.closest('#rmx-pin-top, #rmx-pin-bottom, #rmx-report')) return;
      const cell = e.target.closest('.' + CLASS);
      if (!cell) {
        clearSelection();
        return;
      }
      const idxAttr = cell.getAttribute('data-rmx-index');
      if (!idxAttr) return;
      const indices = idxAttr.split(' ');
      select(indices);
      scrollToCounterpart(cell, indices);
    });
    // Re-place the pinned bars as the user scrolls/resizes (capture so we catch
    // scrolling from any inner container, not just the window).
    window.addEventListener('scroll', schedulePins, true);
    window.addEventListener('resize', schedulePins);
  }

  // Scroll to and flash a refactoring by its feed index (for ?rm= deep links).
  function scrollToRefactoring(index) {
    const cell = document.querySelector(`.${CLASS}[data-rmx-index~="${index}"]`);
    if (!cell) return false;
    cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cell.classList.add(FLASH);
    setTimeout(() => cell.classList.remove(FLASH), 2400);
    return true;
  }

  // --- refactorings report panel (bottom-left) ----------------------------
  // A collapsible list of every refactoring the current view carries — a stand-in
  // for the action's PR comment, and the only listing available on commit pages.
  // Clicking a row selects (blinks) that refactoring and scrolls to it. Shown in
  // both PR and commit views.
  let reportEl = null;

  function ensureReport() {
    if (reportEl) return reportEl;
    ensureStyle();
    reportEl = document.createElement('div');
    reportEl.id = 'rmx-report';
    const head = document.createElement('div');
    head.className = 'rmx-rp-head';
    head.innerHTML = '<span class="rmx-rp-title">Refactorings</span><span class="rmx-rp-caret">▾</span>';
    head.addEventListener('click', () => reportEl.classList.toggle('rmx-collapsed'));
    const body = document.createElement('div');
    body.className = 'rmx-rp-body';
    reportEl.appendChild(head);
    reportEl.appendChild(body);
    document.body.appendChild(reportEl);
    syncReportOffset(); // sit above the bottom pin bars if any are already showing
    return reportEl;
  }

  // Lift the report panel above the bottom pinned-line bars so their (variable)
  // stack never hides the last rows. Re-run whenever that stack changes.
  function syncReportOffset() {
    if (!reportEl) return;
    const h = bottomLayer ? bottomLayer.getBoundingClientRect().height : 0;
    reportEl.style.bottom = (h > 0 ? Math.ceil(h) + 8 : 16) + 'px';
  }

  function reportTitle(n) {
    ensureReport().querySelector('.rmx-rp-title').textContent =
      typeof n === 'number' ? `Refactorings (${n})` : 'Refactorings';
  }
  function reportBody() {
    const body = ensureReport().querySelector('.rmx-rp-body');
    body.textContent = '';
    return body;
  }

  // Loading state while the RefactoringMiner service analyses a commit.
  function reportLoading(label) {
    reportTitle();
    const msg = document.createElement('div');
    msg.className = 'rmx-rp-msg';
    const spin = document.createElement('span');
    spin.className = 'rmx-rp-spinner';
    msg.appendChild(spin);
    msg.appendChild(document.createTextNode(label || 'Analysing commit…'));
    reportBody().appendChild(msg);
  }

  function reportError(message) {
    reportTitle();
    const msg = document.createElement('div');
    msg.className = 'rmx-rp-msg rmx-rp-err';
    msg.textContent = message || 'Could not load refactorings.';
    reportBody().appendChild(msg);
  }

  // `rows`: [{ index, type, summary }]. Each row selects its refactoring on click.
  function showReport(rows) {
    reportTitle(rows.length);
    const body = reportBody();
    if (!rows.length) {
      const msg = document.createElement('div');
      msg.className = 'rmx-rp-msg';
      msg.textContent = 'No refactorings found.';
      body.appendChild(msg);
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'rmx-rp-row';
      item.title = row.detail || row.summary;
      const type = document.createElement('div');
      type.className = 'rmx-rp-type';
      type.textContent = row.type;
      const sum = document.createElement('div');
      sum.className = 'rmx-rp-sum';
      sum.textContent = row.summary;
      item.appendChild(type);
      item.appendChild(sum);
      item.addEventListener('click', () => {
        select([String(row.index)]);
        const cell = document.querySelector(`.${CLASS}[data-rmx-index~="${row.index}"]`);
        if (cell) cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      body.appendChild(item);
    });
  }

  function hideReport() {
    if (reportEl) {
      reportEl.remove();
      reportEl = null;
    }
  }

  return {
    ensureStyle, clearAll, startPass, endPass, highlightRange, installTooltip,
    select, applySelection, clearSelection, scrollToRefactoring,
    showReport, reportLoading, reportError, hideReport,
  };
})();
