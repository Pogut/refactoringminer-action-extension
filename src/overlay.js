var RMX = window.RMX || (window.RMX = {});

// View-agnostic renderer: colour a line span in one of RefactoringMiner's
// legend categories, show a concise tooltip, and scroll to a refactoring. It
// reaches the DOM only through RMX.github, so the same renderer serves every
// view adapter.
RMX.overlay = (function () {
  const CLASS = 'rmx-hl';
  const TIP = 'rmx-tip';
  const FLASH = 'rmx-flash';
  const SEL = 'rmx-sel'; // neon "selected refactoring" highlight, both sides
  const ON = 'rmx-on'; // blink "on" phase — the darker-yellow fill is visible

  // RefactoringMiner-style palette: a light fill plus a stronger left stripe.
  // `order` fixes the legend's row order; `label` is the human-readable name.
  const CATS = {
    deleted: { bg: 'rgba(255,129,130,.30)', bar: '#cf222e', label: 'Deleted' },
    movedOut: { bg: 'rgba(247,153,57,.32)', bar: '#bc4c00', label: 'Moved out' },
    inserted: { bg: 'rgba(74,194,107,.28)', bar: '#1a7f37', label: 'Inserted' },
    movedIn: { bg: 'rgba(63,185,168,.32)', bar: '#137775', label: 'Moved in' },
    moved: { bg: 'rgba(245,214,77,.36)', bar: '#9a6700', label: 'Moved' },
    updated: { bg: 'rgba(84,174,255,.28)', bar: '#0969da', label: 'Updated' },
  };
  const CAT_ORDER = ['deleted', 'movedOut', 'inserted', 'movedIn', 'moved', 'updated'];

  function ensureStyle() {
    if (document.getElementById('rmx-style')) return;
    const catRules = Object.keys(CATS)
      .map((k) => `.${CLASS}[data-rmx-cat="${k}"]{background:${CATS[k].bg} !important;box-shadow:inset 3px 0 0 ${CATS[k].bar};}`)
      .join('\n');
    const s = document.createElement('style');
    s.id = 'rmx-style';
    s.textContent = `
      ${catRules}
      .${CLASS}.${SEL}{box-shadow:inset 3px 0 0 #b59f00,0 0 0 2px #b59f00 !important;transition:background-color .18s ease;}
      .${CLASS}.${SEL}.${ON}{background:#c2a000 !important;}
      .${TIP}{position:absolute;z-index:2147483647;max-width:460px;white-space:pre-wrap;
        background:#1f2328;color:#fff;padding:6px 9px;border-radius:6px;pointer-events:none;
        font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transition:opacity .08s;}
      .${FLASH}{animation:rmx-flash 1.1s ease-out 2;}
      @keyframes rmx-flash{0%,100%{filter:none;}50%{filter:brightness(1.45);}}

      /* Legend — uses GitHub's Primer theme variables so it matches light/dark. */
      #rmx-legend{position:fixed;bottom:16px;right:16px;z-index:2147483646;width:158px;
        background:var(--bgColor-default,#fff);color:var(--fgColor-default,#1f2328);
        border:1px solid var(--borderColor-default,#d0d7de);border-radius:8px;overflow:hidden;
        box-shadow:0 4px 16px rgba(31,35,40,.2);
        font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      #rmx-legend .rmx-lg-head{display:flex;align-items:center;justify-content:space-between;
        padding:7px 10px;cursor:pointer;font-weight:600;user-select:none;
        border-bottom:1px solid var(--borderColor-muted,#d8dee4);}
      #rmx-legend .rmx-lg-caret{font-size:10px;color:var(--fgColor-muted,#656d76);transition:transform .15s;}
      #rmx-legend.rmx-collapsed .rmx-lg-body{display:none;}
      #rmx-legend.rmx-collapsed .rmx-lg-head{border-bottom:0;}
      #rmx-legend.rmx-collapsed .rmx-lg-caret{transform:rotate(-90deg);}
      #rmx-legend .rmx-lg-body{padding:9px 10px;display:flex;flex-direction:column;gap:7px;}
      #rmx-legend .rmx-lg-row{display:flex;align-items:center;gap:8px;}
      #rmx-legend .rmx-lg-sw{width:26px;height:13px;border-radius:3px;flex:0 0 auto;}

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
        animation:rmx-pin-blink 1.8s ease-in-out infinite;}
      @keyframes rmx-pin-blink{0%,100%{background:var(--bgColor-default,#fff);}50%{background:#c2a000;}}
      #rmx-pin-top .rmx-pin{border-bottom:1px solid var(--borderColor-muted,#d8dee4);}
      #rmx-pin-bottom .rmx-pin{border-top:1px solid var(--borderColor-muted,#d8dee4);}
      .rmx-pin .rmx-pin-stripe{width:4px;align-self:stretch;flex:0 0 auto;background:#b59f00;}
      .rmx-pin .rmx-pin-meta{color:var(--fgColor-muted,#656d76);flex:0 0 auto;}
      .rmx-pin .rmx-pin-code{overflow:hidden;text-overflow:ellipsis;opacity:.92;}
    `;
    document.head.appendChild(s);
  }

  function clearAll() {
    document.querySelectorAll('.' + CLASS).forEach((el) => {
      el.classList.remove(CLASS, FLASH, SEL, ON);
      el.removeAttribute('data-rmx-cat');
      el.removeAttribute('data-rmx-desc');
      el.removeAttribute('data-rmx-index');
      el.removeAttribute('data-rmx-side');
      el.removeAttribute('data-rmx-file');
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

  // Highlight every line in [startLine,endLine] for one side of one file. A cell
  // touched by several refactorings keeps its first category but accumulates
  // each refactoring's summary (deduped). Returns the count of mounted lines.
  function highlightRange({ digest, side, startLine, endLine, category, summary, index, filePath }) {
    let painted = 0;
    for (let line = startLine; line <= endLine; line++) {
      const cells = RMX.github.lineCells(digest, side, line);
      if (!cells.length) continue;
      cells.forEach((cell) => {
        cell.classList.add(CLASS);
        cell.setAttribute('data-rmx-side', side);
        if (filePath) cell.setAttribute('data-rmx-file', filePath);
        if (!cell.getAttribute('data-rmx-cat')) cell.setAttribute('data-rmx-cat', category);
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
  const BLINK_MS = 550; // per phase (cursor-like)

  // Marks every cell of the selected refactoring(s) and sets its fill to the
  // current blink phase. Additive + idempotent, so scroll re-paints just sync
  // newly mounted cells to the current phase. SEL keeps the gold outline always;
  // ON (the darker-yellow fill) is what blinks off and on.
  function applySelection() {
    selectedIndices.forEach((i) => {
      document.querySelectorAll(`.${CLASS}[data-rmx-index~="${i}"]`).forEach((el) => {
        el.classList.add(SEL);
        el.classList.toggle(ON, blinkOn);
      });
    });
    schedulePins(); // refresh the pinned-line peek as cells (re)mount
  }

  function removeSelectionClasses() {
    document.querySelectorAll('.' + SEL).forEach((el) => el.classList.remove(SEL, ON));
  }

  // Select on click: blink the darker-yellow fill on/off like a text cursor.
  function select(indices) {
    removeSelectionClasses();
    selectedIndices = indices.slice();
    clearInterval(blinkTimer);
    blinkOn = true;
    applySelection();
    blinkTimer = setInterval(() => {
      blinkOn = !blinkOn;
      // Just flip the fill on already-selected cells — cheap, and avoids
      // rebuilding the pinned bars on every blink tick.
      document.querySelectorAll(`.${CLASS}.${SEL}`).forEach((el) => el.classList.toggle(ON, blinkOn));
    }, BLINK_MS);
  }

  function clearSelection() {
    clearInterval(blinkTimer);
    selectedIndices = [];
    blinkOn = false;
    removeSelectionClasses();
    clearPins();
  }

  // --- pinned-line peek ---------------------------------------------------
  // Selected lines that scroll out of view are mirrored as floating bars at the
  // top edge (when scrolled below them) or bottom edge (above them), stacked in
  // document order. Clones, not the real rows — GitHub virtualizes the table.
  const TOP_ZONE = 56; // approx. height of GitHub's sticky header region
  const PIN_BLINK_MS = 1800; // bar pulse period (slower than the in-diff blink)
  const blinkEpoch = Date.now(); // shared clock so rebuilt bars stay in phase
  let topLayer = null;
  let bottomLayer = null;
  let pinRaf = null;

  function ensurePinLayers() {
    if (topLayer) return;
    topLayer = document.createElement('div');
    topLayer.id = 'rmx-pin-top';
    bottomLayer = document.createElement('div');
    bottomLayer.id = 'rmx-pin-bottom';
    document.body.appendChild(topLayer);
    document.body.appendChild(bottomLayer);
  }

  function clearPins() {
    if (topLayer) topLayer.textContent = '';
    if (bottomLayer) bottomLayer.textContent = '';
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
  }

  function renderStack(layer, entries) {
    layer.textContent = '';
    entries.forEach((entry) => {
      const m = /^diff-[0-9a-f]{64}([LR])(\d+)$/.exec(entry.anchor) || [];
      const cat = entry.cell.getAttribute('data-rmx-cat');
      const file = (entry.cell.getAttribute('data-rmx-file') || '').split('/').pop();

      const bar = document.createElement('div');
      bar.className = 'rmx-pin';
      // Negative delay = start mid-cycle at the shared phase, so bars rebuilt on
      // scroll resume the pulse seamlessly instead of restarting it.
      bar.style.animationDelay = '-' + (((Date.now() - blinkEpoch) % PIN_BLINK_MS) / 1000) + 's';
      const stripe = document.createElement('span');
      stripe.className = 'rmx-pin-stripe';
      if (cat && CATS[cat]) stripe.style.background = CATS[cat].bar;
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
      layer.appendChild(bar);
    });
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
      // Clicks on our own UI (pinned bars, legend) shouldn't clear the selection.
      if (e.target.closest('#rmx-pin-top, #rmx-pin-bottom, #rmx-legend')) return;
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

  // A compact, collapsible legend pinned bottom-right, showing only the
  // categories actually present. Rebuilt only when that set changes, so it
  // doesn't flicker on re-paints and keeps its collapsed state.
  let legendKey = '';
  function showLegend(categories) {
    ensureStyle();
    const used = CAT_ORDER.filter((c) => categories.indexOf(c) !== -1);
    const key = used.join(',');
    let panel = document.getElementById('rmx-legend');
    if (key === legendKey && panel) return;
    legendKey = key;

    if (!used.length) {
      if (panel) panel.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'rmx-legend';
      const head = document.createElement('div');
      head.className = 'rmx-lg-head';
      head.innerHTML = '<span>Refactorings</span><span class="rmx-lg-caret">▾</span>';
      head.addEventListener('click', () => panel.classList.toggle('rmx-collapsed'));
      const body = document.createElement('div');
      body.className = 'rmx-lg-body';
      panel.appendChild(head);
      panel.appendChild(body);
      document.body.appendChild(panel);
    }

    const body = panel.querySelector('.rmx-lg-body');
    body.textContent = '';
    used.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'rmx-lg-row';
      const sw = document.createElement('span');
      sw.className = 'rmx-lg-sw';
      sw.style.background = CATS[c].bg;
      sw.style.boxShadow = 'inset 3px 0 0 ' + CATS[c].bar;
      const label = document.createElement('span');
      label.textContent = CATS[c].label;
      row.appendChild(sw);
      row.appendChild(label);
      body.appendChild(row);
    });
  }

  function hideLegend() {
    legendKey = '';
    const panel = document.getElementById('rmx-legend');
    if (panel) panel.remove();
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

  return {
    ensureStyle, clearAll, highlightRange, installTooltip,
    showLegend, hideLegend, select, applySelection, clearSelection, scrollToRefactoring,
  };
})();
