window.RMX = window.RMX || {};

// View-agnostic renderer: tag the diff cells a refactoring touches (no visible
// style of their own) so a click or comment-deep-link can blink that
// refactoring in neon on both sides and peek its off-screen lines. It reaches
// the DOM only through RMX.github, so the same renderer serves every view adapter.
window.RMX.overlay = (function () {
  const RMX = window.RMX;
  const CLASS = 'rmx-hl'; // marker on every tagged cell; carries no colour itself
  const TIP = 'rmx-tip';
  const FLASH = 'rmx-flash';
  const SEL = 'rmx-sel'; // neon "selected refactoring" highlight, both sides
  const ON = 'rmx-on'; // blink "on" phase — the darker-yellow fill is visible

  // Blink colours are user-configurable (options page → chrome.storage.sync) and
  // come as two pairs: one for when GitHub itself is in light mode, one for dark.
  // The fill replaces the diff cell's background while GitHub keeps painting its
  // own syntax colours on top, so a fill that fights the text makes the code
  // unreadable — hence pale tints against GitHub's dark-on-white code, and deep
  // shades against its light-on-near-black code.
  //
  // Left is amber, right is azure: near-complementary (~39° vs ~210°), so the two
  // sides of a pair are told apart by hue rather than by brightness, and they
  // avoid the red/green that GitHub already uses for removed/added lines (which
  // also keeps them legible for the common forms of colour blindness). Within
  // each pair the two fills are matched in luminance to within 0.002, so neither
  // side visually dominates.
  //
  // `left`/`right` are the fills; `leftA`/`rightA` are the hand-picked
  // outline+stripe accents used while a side stays at its default. A custom
  // colour derives its accent from the fill instead (see accentFor) — away from
  // the page background, so it stays visible in either GitHub mode.
  //
  // Contrast against GitHub's syntax palette, worst token (its comment grey):
  // 3.6:1 for all four fills; against default code text, 12.5:1 light / 9.3:1 dark.
  // Keep in sync with the table mirrored in options.js.
  const HL_DEFAULTS = {
    light: { left: '#ffe1a8', leftA: '#9a6700', right: '#d1e7fd', rightA: '#0969da' },
    dark: { left: '#4b3a0f', leftA: '#d4a72c', right: '#143d69', rightA: '#58a6ff' },
  };

  // The pair that used to be the default for both themes. The old options page
  // wrote it out verbatim on every save, so a stored value equal to it means
  // "never actually chosen" and is treated as unset — otherwise anyone who had
  // hit Save would be pinned to the old pink/purple forever. Keep in sync with
  // options.js.
  const HL_LEGACY = { left: '#ec4899', right: '#7c3aed' };

  // Blink speed is user-configurable too (options page slider → blinkSpeed, an
  // index into this table of full pulse periods in ms). Step 0 means "constant":
  // the selection lights up and stays lit, with no blinking at all. Step 1 is the
  // original 5 s pulse, so a fresh install is unchanged. Keep in sync with
  // BLINK_PERIODS in options.js.
  const BLINK_PERIODS = [0, 5000, 3000, 1800, 1000, 600, 320];
  const BLINK_SPEED_DEFAULT = 1;
  let blinkPeriod = BLINK_PERIODS[BLINK_SPEED_DEFAULT];

  // Slide a #rgb/#rrggbb colour toward black (amt < 0) or white (amt > 0) by
  // |amt| (0–1). Returns the input unchanged if it isn't a hex colour.
  function shift(hex, amt) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    const mix = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Outline/stripe shade for a fill. Defaults keep their hand-picked accent; a
  // custom colour is pushed away from the page background so the outline reads
  // against both the fill and the canvas around it.
  function accentFor(fill, mode, side) {
    const d = HL_DEFAULTS[mode];
    if (String(fill).toLowerCase() === d[side]) return side === 'left' ? d.leftA : d.rightA;
    return shift(fill, mode === 'dark' ? 0.5 : -0.4);
  }

  // Relative luminance (0–1) of a CSS colour, or null if it can't be read as one
  // — including fully transparent, which tells us nothing about what shows through.
  function luminanceOf(color) {
    const s = String(color || '').trim();
    let r, g, b;
    const fn = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (fn) {
      const p = fn[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 4 && p[3] === 0) return null;
      [r, g, b] = p;
    } else {
      const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
      if (!m) return null;
      let h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h, 16);
      r = (n >> 16) & 255;
      g = (n >> 8) & 255;
      b = n & 255;
    }
    if (![r, g, b].every(Number.isFinite)) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  // Which palette GitHub's own theme calls for. Read from its design tokens
  // (current name first, then the older one), falling back to the rendered body
  // background and finally the OS preference. Deliberately measures the canvas
  // rather than matching theme names, so the dimmed/high-contrast/colourblind
  // variants — and any GitHub renames — classify themselves correctly.
  function githubMode() {
    const root = getComputedStyle(document.documentElement);
    for (const token of ['--bgColor-default', '--color-canvas-default']) {
      const l = luminanceOf(root.getPropertyValue(token));
      if (l !== null) return l < 0.5 ? 'dark' : 'light';
    }
    const body = document.body && luminanceOf(getComputedStyle(document.body).backgroundColor);
    if (body !== null && body !== undefined) return body < 0.5 ? 'dark' : 'light';
    const mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
    return mq && mq.matches ? 'dark' : 'light';
  }

  // Last palette read from storage, kept so a GitHub theme change can re-pick the
  // right pair without another storage round-trip.
  let hlStored = {};
  let lastMode = null;

  // The user's own colour if they picked one, else the default for whichever
  // theme GitHub is in. A chosen colour is a deliberate override and applies in
  // both themes; only the untouched default follows GitHub.
  function fillFor(mode, side) {
    const chosen = hlStored[side === 'left' ? 'hlLeft' : 'hlRight'];
    if (chosen && chosen.toLowerCase() !== HL_LEGACY[side]) return chosen;
    return HL_DEFAULTS[mode][side];
  }

  // Record which theme GitHub turned out to be in, so the options page can show
  // the defaults that actually apply. Device-local (it describes this browser,
  // not a synced preference) and written only on a change, so it isn't a write
  // on every diff load.
  function recordMode(mode) {
    if (mode === lastMode) return;
    lastMode = mode;
    const local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    if (local) local.set({ ghMode: mode });
  }

  function applyColors() {
    const mode = githubMode();
    recordMode(mode);
    const left = fillFor(mode, 'left');
    const right = fillFor(mode, 'right');
    const leftA = accentFor(left, mode, 'left');
    const rightA = accentFor(right, mode, 'right');
    const root = document.documentElement.style;
    root.setProperty('--rmx-left', left);
    root.setProperty('--rmx-left-d', leftA);
    root.setProperty('--rmx-right', right);
    root.setProperty('--rmx-right-d', rightA);
    // The peek popover is always dark, so whichever of the two is the lighter
    // one in this mode is what shows up on it: the pale fill in GitHub light
    // mode, the bright accent in GitHub dark mode.
    root.setProperty('--rmx-left-tip', mode === 'dark' ? leftA : left);
    root.setProperty('--rmx-right-tip', mode === 'dark' ? rightA : right);
  }

  // Re-pick the palette when GitHub's theme changes under us: its own switcher
  // rewrites the data-*-theme attributes on <html>, and "auto" follows the OS.
  function watchGithubTheme() {
    if (window.__rmxThemeWatch) return;
    window.__rmxThemeWatch = true;
    new MutationObserver(applyColors).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode', 'data-light-theme', 'data-dark-theme', 'class'],
    });
    const mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', applyColors);
  }

  // Adopt a blink-speed index: remember its period, scale the background-color
  // fade so a fast pulse still reaches full colour (the CSS transition would
  // otherwise outlast the phase), and re-sync an in-flight selection.
  function applyBlinkSpeed(index) {
    const i = BLINK_PERIODS[index] === undefined ? BLINK_SPEED_DEFAULT : index;
    const changed = BLINK_PERIODS[i] !== blinkPeriod;
    blinkPeriod = BLINK_PERIODS[i];
    const fade = blinkPeriod ? Math.min(2000, Math.round(blinkPeriod * 0.4)) : 250;
    document.documentElement.style.setProperty('--rmx-blink-fade', fade + 'ms');
    if (changed && selectedIndices.length) resyncPulse();
  }

  // How much of the report panel the reader wants on screen, and with it how much
  // of each refactoring's RefactoringMiner record is shown. One setting drives
  // both, because they're the same question: the panel is only as big as the
  // detail it has to carry.
  //
  //   compact  — the pinned bottom-left card. Type + element summary per row;
  //              the description opens on demand. The original panel.
  //   expanded — the same card, elongated along the bottom, with each
  //              refactoring's full description on the row itself.
  //   detailed — a full-width bottom dock: description plus every code element
  //              RefactoringMiner reported for the refactoring, and a checkbox
  //              per refactoring type to filter the list down to one kind.
  //
  // Stored as `panelView` by the options page. Keep in sync with options.js.
  const PANEL_VIEWS = ['compact', 'expanded', 'detailed'];
  const PANEL_VIEW_DEFAULT = 'compact';
  let panelView = PANEL_VIEW_DEFAULT;

  function normView(v) {
    return PANEL_VIEWS.indexOf(v) === -1 ? PANEL_VIEW_DEFAULT : v;
  }

  // Pull the stored blink colours and speed (falling back to defaults) and mirror
  // them onto :root, then keep them in sync so edits in the options page recolour
  // or re-time any open diff live. The onChanged listener is installed once per page.
  const HL_KEYS = ['hlLeft', 'hlRight'];

  function loadPrefs() {
    watchGithubTheme();
    applyColors(); // defaults up front, so nothing flashes while storage resolves
    const store =
      typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
    if (!store) return applyBlinkSpeed(BLINK_SPEED_DEFAULT);
    store.get(HL_KEYS.concat(['blinkSpeed', 'panelView']), (r) => {
      hlStored = r || {};
      applyColors();
      applyBlinkSpeed(hlStored.blinkSpeed);
      setPanelView(hlStored.panelView);
    });
    if (chrome.storage.onChanged && !window.__rmxColorWatch) {
      window.__rmxColorWatch = true;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes.blinkSpeed || changes.panelView || HL_KEYS.some((k) => changes[k])) loadPrefs();
      });
    }
  }

  function ensureStyle() {
    if (document.getElementById('rmx-style')) return;
    loadPrefs();
    const s = document.createElement('style');
    s.id = 'rmx-style';
    s.textContent = `
      .${CLASS}.${SEL}[data-rmx-side="L"]{box-shadow:inset 3px 0 0 var(--rmx-left-d,#9a6700),0 0 0 2px var(--rmx-left-d,#9a6700) !important;transition:background-color var(--rmx-blink-fade,2s) ease-in-out;}
      .${CLASS}.${SEL}[data-rmx-side="L"].${ON}{background:var(--rmx-left,#ffe1a8) !important;}
      .${CLASS}.${SEL}[data-rmx-side="R"]{box-shadow:inset 3px 0 0 var(--rmx-right-d,#0969da),0 0 0 2px var(--rmx-right-d,#0969da) !important;transition:background-color var(--rmx-blink-fade,2s) ease-in-out;}
      .${CLASS}.${SEL}[data-rmx-side="R"].${ON}{background:var(--rmx-right,#d1e7fd) !important;}
      .${TIP}{position:absolute;z-index:2147483647;max-width:460px;white-space:pre-wrap;
        background:#1f2328;color:#fff;padding:6px 9px;border-radius:6px;pointer-events:none;
        font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transition:opacity .08s;}
      .${FLASH}{animation:rmx-flash 1.1s ease-out 2;}
      @keyframes rmx-flash{0%,100%{filter:none;}50%{filter:brightness(1.45);}}

      /* Peek popover body (extends .rmx-tip): a live glance at the counterpart. */
      .rmx-tip-title{font-weight:600;}
      .rmx-tip-code{margin-top:6px;padding:6px 8px;border-radius:5px;background:rgba(255,255,255,.09);
        font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;flex-direction:column;gap:1px;}
      /* The peek popover is dark whatever mode GitHub is in, so it needs its own
         "bright on dark" variant rather than the fill or the on-canvas accent. */
      .rmx-tip-code.rmx-tip-L{box-shadow:inset 3px 0 0 var(--rmx-left-tip,#ffe1a8);}
      .rmx-tip-code.rmx-tip-R{box-shadow:inset 3px 0 0 var(--rmx-right-tip,#d1e7fd);}
      .rmx-tip-line{white-space:pre;overflow:hidden;text-overflow:ellipsis;max-width:420px;}
      .rmx-tip-more,.rmx-tip-hint{opacity:.75;margin-top:4px;}

      /* Focus navigator: a fixed pill that steps through refactorings one at a
         time (replacing the old stacked pins). One row tall — it never grows. */
      #rmx-nav{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483600;
        display:none;align-items:center;gap:8px;max-width:min(680px,92vw);padding:6px 8px;
        border-radius:10px;background:var(--bgColor-default,#fff);color:var(--fgColor-default,#1f2328);
        border:1px solid var(--borderColor-default,#d0d7de);box-shadow:0 6px 20px rgba(31,35,40,.18);
        font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      #rmx-nav.rmx-show{display:flex;}
      .rmx-nav-btn{cursor:pointer;flex:0 0 auto;width:28px;height:26px;border-radius:7px;
        border:1px solid var(--borderColor-default,#d0d7de);background:var(--bgColor-muted,#f6f8fa);
        color:inherit;font:15px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        display:flex;align-items:center;justify-content:center;}
      .rmx-nav-btn:hover{background:var(--bgColor-neutral-muted,rgba(140,149,159,.18));}
      .rmx-nav-btn:disabled{opacity:.4;cursor:default;}
      .rmx-nav-main{display:flex;align-items:center;gap:7px;min-width:0;flex:1;}
      .rmx-nav-swatch{flex:0 0 auto;width:9px;height:9px;border-radius:3px;}
      .rmx-nav-type{font-weight:600;white-space:nowrap;}
      .rmx-nav-sum{min-width:0;color:var(--fgColor-muted,#656d76);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .rmx-nav-idle{color:var(--fgColor-muted,#656d76);}
      .rmx-nav-count{flex:0 0 auto;padding:0 2px;color:var(--fgColor-muted,#656d76);font-variant-numeric:tabular-nums;}

      /* Edge chips: at most one per screen edge, pointing at the selected
         refactoring's off-screen lines. Fixed size — they can't stack up. */
      .rmx-edge{position:fixed;left:0;right:14px;z-index:2147483599;display:flex;justify-content:center;pointer-events:none;}
      #rmx-edge-top-wrap{top:48px;}
      #rmx-edge-bot-wrap{bottom:calc(16px + var(--rmx-dock-h,0px));}
      .rmx-edge-chip{display:none;pointer-events:auto;align-items:center;gap:6px;
        padding:4px 10px;border-radius:999px;background:var(--bgColor-default,#fff);color:var(--fgColor-default,#1f2328);
        border:1px solid var(--borderColor-default,#d0d7de);box-shadow:0 4px 14px rgba(31,35,40,.18);
        font:11.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      .rmx-edge-chip.rmx-show{display:inline-flex;}
      .rmx-edge-arw{font-size:12px;color:var(--fgColor-muted,#656d76);}
      .rmx-edge-seg{display:inline-flex;align-items:center;gap:4px;cursor:pointer;padding:1px 6px;border-radius:7px;}
      .rmx-edge-seg:hover{background:var(--bgColor-muted,#f6f8fa);}
      .rmx-edge-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;}
      .rmx-edge-chip b{font-weight:600;font-variant-numeric:tabular-nums;}
      .rmx-edge-lbl{color:var(--fgColor-muted,#656d76);}

      /* Minimap: a slim right-edge rail with one tick per refactoring and a
         viewport thumb — the always-on overview of where the changes are. */
      /* --rmx-dock-h is the height the detailed panel occupies along the bottom
         (0 in every other view), so the rail and the bottom edge chip sit above
         the dock instead of underneath it. */
      #rmx-minimap{position:fixed;top:44px;right:0;bottom:calc(12px + var(--rmx-dock-h,0px));width:12px;z-index:2147483598;display:none;
        background:var(--bgColor-muted,#f6f8fa);border-left:1px solid var(--borderColor-muted,#d8dee4);
        transition:width .12s;}
      #rmx-minimap.rmx-show{display:block;}
      #rmx-minimap:hover{width:16px;}
      /* Ticks take the ACCENT, not the fill: the fill is a background for code
         text and is deliberately close to the canvas, so it would barely show as
         a 3px mark on the rail. Same reasoning for the nav swatch and edge dots. */
      .rmx-mm-tick{position:absolute;left:2px;right:2px;height:3px;border-radius:2px;cursor:pointer;opacity:.7;
        transition:opacity .12s,height .12s;}
      .rmx-mm-tick.rmx-mm-L{background:var(--rmx-left-d,#9a6700);}
      .rmx-mm-tick.rmx-mm-R{background:var(--rmx-right-d,#0969da);}
      .rmx-mm-tick:hover{opacity:.9;}
      .rmx-mm-tick.rmx-mm-active{opacity:1;height:5px;left:1px;right:1px;box-shadow:0 0 0 1px var(--bgColor-default,#fff);}
      .rmx-mm-thumb{position:absolute;left:0;right:0;background:rgba(110,120,135,.16);
        border-top:1px solid var(--fgColor-muted,#656d76);border-bottom:1px solid var(--fgColor-muted,#656d76);pointer-events:none;}

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
      /* Panel title sits a notch above the 12px list rows so the header reads as
         the heading, not another entry. */
      #rmx-report .rmx-rp-title{font-size:15px;line-height:1.2;font-weight:700;}
      #rmx-report .rmx-rp-caret{font-size:10px;color:var(--fgColor-muted,#656d76);transition:transform .15s;}
      #rmx-report.rmx-collapsed .rmx-rp-body{display:none;}
      #rmx-report.rmx-collapsed .rmx-rp-head{border-bottom:0;}
      #rmx-report.rmx-collapsed .rmx-rp-caret{transform:rotate(-90deg);}
      #rmx-report .rmx-rp-body{max-height:40vh;overflow-y:auto;}
      #rmx-report .rmx-rp-item{border-bottom:1px solid var(--borderColor-muted,#d8dee4);}
      #rmx-report .rmx-rp-item:last-child{border-bottom:0;}
      #rmx-report .rmx-rp-item.rmx-rp-cur{background:var(--bgColor-muted,#f6f8fa);}
      #rmx-report .rmx-rp-row{display:flex;align-items:flex-start;gap:6px;padding:6px 11px;}
      #rmx-report .rmx-rp-main{flex:1;min-width:0;cursor:pointer;}
      #rmx-report .rmx-rp-type{font-weight:600;}
      /* Collapsed rows show only the type; the summary joins the detail card the
         moment the row is opened (by a title click or the explain caret). */
      #rmx-report .rmx-rp-sum{display:none;color:var(--fgColor-muted,#656d76);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      #rmx-report .rmx-rp-item.rmx-open .rmx-rp-sum{display:block;margin-top:1px;white-space:normal;overflow:visible;overflow-wrap:anywhere;}
      #rmx-report .rmx-rp-info{flex:0 0 auto;margin-top:1px;width:20px;height:20px;padding:0;cursor:pointer;
        display:flex;align-items:center;justify-content:center;border:0;border-radius:5px;background:transparent;
        color:var(--fgColor-muted,#656d76);font-size:11px;line-height:1;transition:background .12s,color .12s;}
      #rmx-report .rmx-rp-info:hover{background:var(--bgColor-neutral-muted,rgba(140,149,159,.18));color:var(--fgColor-default,#1f2328);}
      #rmx-report .rmx-rp-info-caret{display:inline-block;transition:transform .15s;}
      #rmx-report .rmx-rp-item.rmx-open .rmx-rp-info{background:var(--bgColor-neutral-muted,rgba(140,149,159,.18));color:var(--fgColor-default,#1f2328);}
      #rmx-report .rmx-rp-item.rmx-open .rmx-rp-info-caret{transform:rotate(180deg);}
      #rmx-report .rmx-rp-detail{display:none;padding:0 12px 11px;}
      #rmx-report .rmx-rp-item.rmx-open .rmx-rp-detail{display:block;}
      /* Detail card: RefactoringMiner's description, one clause per line. */
      #rmx-report .rmx-rp-desc{margin:0;line-height:1.55;color:var(--fgColor-default,#1f2328);overflow-wrap:anywhere;}
      #rmx-report .rmx-rp-desclist{display:flex;flex-direction:column;gap:5px;}
      #rmx-report .rmx-rp-descline{line-height:1.45;overflow-wrap:anywhere;}
      #rmx-report .rmx-rp-rel{color:var(--fgColor-muted,#656d76);}
      #rmx-report .rmx-rp-codeel{font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fgColor-default,#1f2328);}
      #rmx-report .rmx-rp-msg{padding:10px 11px;color:var(--fgColor-muted,#656d76);display:flex;align-items:center;gap:8px;}
      #rmx-report .rmx-rp-err{color:var(--fgColor-danger,#cf222e);}
      #rmx-report .rmx-rp-spinner{width:12px;height:12px;flex:0 0 auto;border-radius:50%;
        border:2px solid var(--borderColor-default,#d0d7de);border-top-color:var(--fgColor-accent,#0969da);
        animation:rmx-spin .8s linear infinite;}
      @keyframes rmx-spin{to{transform:rotate(360deg);}}

      /* --- the three detail levels ---------------------------------------
         Every row is built with all three levels' content in it; these rules
         decide what is on show and how much room the panel takes to show it.
         The base rules above ARE the compact level, so it needs no overrides. */

      /* Content that only the richer levels reveal, hidden by default. */
      #rmx-report .rmx-rp-full{display:none;}
      #rmx-report .rmx-rp-files{display:none;}
      #rmx-report .rmx-rp-locs{display:none;}
      #rmx-report .rmx-rp-num{display:none;}
      #rmx-report .rmx-rp-filter{display:none;}

      /* The refactoring's whole RefactoringMiner sentence, on the row itself.
         Clamped to three lines while the row is shut so a long Extract And Move
         description can't push the rest of the list off the panel; opening the
         row lifts the clamp. */
      /* No display property here: that stays with the level rules below, so this
         rule can style the block without un-hiding it in the compact level. */
      #rmx-report .rmx-rp-full{margin-top:3px;color:var(--fgColor-muted,#656d76);line-height:1.5;
        overflow:hidden;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:3;}
      /* File chips: where the refactoring landed, which the compact row has no
         room for and which is the first thing you want on a multi-file PR. */
      #rmx-report .rmx-rp-files{margin-top:4px;flex-wrap:wrap;gap:4px;}
      #rmx-report .rmx-rp-file{padding:1px 6px;border-radius:999px;max-width:100%;
        background:var(--bgColor-neutral-muted,rgba(140,149,159,.15));color:var(--fgColor-muted,#656d76);
        font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

      /* Elongated: same pinned card, stretched along the bottom edge, with each
         row carrying its full description instead of hiding it behind a caret. */
      #rmx-report.rmx-v-expanded{width:min(760px,58vw);max-width:58vw;}
      #rmx-report.rmx-v-expanded .rmx-rp-body{max-height:34vh;}
      #rmx-report.rmx-v-expanded .rmx-rp-row{padding:8px 12px;}
      #rmx-report.rmx-v-expanded .rmx-rp-full{display:-webkit-box;}
      #rmx-report.rmx-v-expanded .rmx-rp-item.rmx-open .rmx-rp-full{display:block;}
      #rmx-report.rmx-v-expanded .rmx-rp-files{display:flex;}
      /* The element summary is the compact level's stand-in for the description;
         with the real sentence on the row it would just say it again. */
      #rmx-report.rmx-v-expanded .rmx-rp-sum{display:none !important;}

      /* Detailed: a dock across the whole bottom of the page — the level that
         trades the diff's bottom third for the complete record. Rows become
         cards in a grid so the width is actually used rather than leaving one
         narrow column against a wide empty strip. */
      #rmx-report.rmx-v-detailed{left:0;right:0;bottom:0;width:auto;max-width:none;
        height:var(--rmx-dock-h,34vh);display:flex;flex-direction:column;
        border-radius:0;border-left:0;border-right:0;border-bottom:0;
        box-shadow:0 -6px 22px rgba(31,35,40,.22);}
      #rmx-report.rmx-v-detailed.rmx-collapsed{height:auto;}
      /* grid-auto-rows must be min-content: the dock has a definite height, and
         with auto rows the cards get squeezed into equal shares of it (each one
         clipped to a single line) instead of taking the height they need and
         letting the dock scroll. */
      #rmx-report.rmx-v-detailed .rmx-rp-body{flex:1;max-height:none;min-height:0;
        display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));
        grid-auto-rows:min-content;align-content:start;gap:8px;padding:10px;
        background:var(--bgColor-muted,#f6f8fa);}
      #rmx-report.rmx-v-detailed .rmx-rp-item{border:1px solid var(--borderColor-muted,#d8dee4);
        border-radius:8px;background:var(--bgColor-default,#fff);overflow:hidden;}
      #rmx-report.rmx-v-detailed .rmx-rp-item:last-child{border:1px solid var(--borderColor-muted,#d8dee4);}
      #rmx-report.rmx-v-detailed .rmx-rp-msg{grid-column:1/-1;background:var(--bgColor-default,#fff);}
      #rmx-report.rmx-v-detailed .rmx-rp-full{display:block;-webkit-line-clamp:unset;}
      #rmx-report.rmx-v-detailed .rmx-rp-files{display:flex;}
      #rmx-report.rmx-v-detailed .rmx-rp-locs{display:block;}
      #rmx-report.rmx-v-detailed .rmx-rp-num{display:inline;color:var(--fgColor-muted,#656d76);
        font-variant-numeric:tabular-nums;font-weight:400;margin-right:5px;}
      #rmx-report.rmx-v-detailed .rmx-rp-sum{display:none !important;}
      #rmx-report.rmx-v-detailed .rmx-rp-filter{display:flex;}
      /* The dock spans the page, so its own header does too — but the title and
         the collapse caret belong at the two ends, not floating mid-width. */
      #rmx-report.rmx-v-detailed .rmx-rp-head{padding:8px 14px;}

      /* Per-location table: one line per code element RefactoringMiner named,
         with the role it plays ("original attribute declaration") — the part of
         the JSON no other level shows. Clicking one blinks that side. */
      #rmx-report .rmx-rp-locs{margin:0 11px 8px;border-top:1px solid var(--borderColor-muted,#d8dee4);padding-top:6px;}
      #rmx-report .rmx-rp-loc{display:flex;align-items:baseline;gap:7px;padding:3px 0;cursor:pointer;border-radius:5px;}
      #rmx-report .rmx-rp-loc:hover{background:var(--bgColor-muted,#f6f8fa);}
      #rmx-report .rmx-rp-loc-side{flex:0 0 auto;width:15px;height:15px;border-radius:4px;
        display:flex;align-items:center;justify-content:center;
        font:9.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:700;
        /* The badge takes the side accent, which is dark in GitHub's light theme
           and bright in its dark one — so the glyph takes the canvas colour and
           stays legible on both instead of being pinned to white. */
        color:var(--bgColor-default,#fff);}
      #rmx-report .rmx-rp-loc-side.rmx-rp-L{background:var(--rmx-left-d,#9a6700);}
      #rmx-report .rmx-rp-loc-side.rmx-rp-R{background:var(--rmx-right-d,#0969da);}
      #rmx-report .rmx-rp-loc-body{flex:1;min-width:0;}
      #rmx-report .rmx-rp-loc-el{font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
        color:var(--fgColor-default,#1f2328);overflow-wrap:anywhere;}
      #rmx-report .rmx-rp-loc-meta{color:var(--fgColor-muted,#656d76);font-size:11px;line-height:1.45;overflow-wrap:anywhere;}
      #rmx-report .rmx-rp-loc-kind{font-variant:small-caps;letter-spacing:.02em;}

      /* Type filter: one checkbox per refactoring type present, plus an "all"
         master, so 26 refactorings of 16 kinds can be narrowed to the one kind
         being reviewed. Sits under the header, above the list. */
      #rmx-report .rmx-rp-filter{flex-wrap:wrap;gap:5px;padding:8px 14px;
        border-bottom:1px solid var(--borderColor-muted,#d8dee4);background:var(--bgColor-muted,#f6f8fa);
        max-height:22vh;overflow-y:auto;}
      #rmx-report .rmx-rp-chk{display:inline-flex;align-items:center;gap:5px;cursor:pointer;user-select:none;
        padding:2px 8px 2px 6px;border-radius:999px;border:1px solid var(--borderColor-default,#d0d7de);
        background:var(--bgColor-default,#fff);font-size:11.5px;line-height:1.6;}
      #rmx-report .rmx-rp-chk:hover{border-color:var(--fgColor-muted,#656d76);}
      #rmx-report .rmx-rp-chk input{margin:0;cursor:pointer;}
      #rmx-report .rmx-rp-chk-n{color:var(--fgColor-muted,#656d76);font-variant-numeric:tabular-nums;}
      #rmx-report .rmx-rp-chk-all{font-weight:600;}

      /* Collapsing wins over every level. The base collapse rules match on the
         same specificity as the level rules above and lose on source order, so
         they are restated here with the level in the selector. */
      #rmx-report.rmx-v-detailed.rmx-collapsed .rmx-rp-body,
      #rmx-report.rmx-v-detailed.rmx-collapsed .rmx-rp-filter{display:none;}
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
    cellsByIndex = new Map();
    selCells = [];
    cachedHost = null; // the diff (and its scroll container) is being rebuilt
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

  // The source text a line's mounted cells show, without the gutter number: the
  // widest run of text that isn't just the line number (i.e. the code cell, not
  // its numbering twin).
  function codeOf(cells, line) {
    let code = '';
    cells.forEach((c) => {
      const t = c.textContent || '';
      if (t.trim() && t.trim() !== String(line)) code = t;
    });
    return code;
  }

  // The line begins a new declaration (Python `def`/`class`). RefactoringMiner's
  // declaration ranges overshoot onto the *next* element's first line in
  // indent-based languages — and a `def`/`class` line can never legitimately be
  // the last line of a block (it needs a body) — so a range whose endLine starts
  // a declaration has over-shot. Brace languages end on `}`, so they're unaffected.
  function startsDeclaration(cells, line) {
    return /^\s*(async\s+def\b|def\b|class\b)/.test(codeOf(cells, line));
  }

  // --- annotated declarations ----------------------------------------------
  // A refactoring reported on a whole declaration (Rename Method, Move Method,
  // Change Modifier…) is tagged on that declaration's header line alone —
  // highlighting the whole body would flood the diff. But RefactoringMiner's
  // first line is the first line of the DECLARATION, and on an annotated member
  // that is `@Override`: tagging it lights up the same annotation on both sides,
  // which tells the reader nothing about the method that was renamed, while the
  // signature one line below stays dark.
  //
  // So content.js leaves the choice open — it plans the whole window the
  // signature can be in and marks those contributions with a header group — and
  // this picks the single line to tag once the source text is on the page: the
  // first line of the declaration that is not an annotation (or a Python
  // decorator, a javadoc/comment line, or blank). Every other line of the window
  // stays untagged.
  let headerLines = new Map(); // header group -> the source line its signature is on

  // A unified diff cell's text can carry the +/- marker, so allow one.
  const ANNOTATION_RE = /^[+-]?\s*@[A-Za-z_$]/;   // Java annotation / Python decorator
  const COMMENT_RE = /^[+-]?\s*(\/\/|\/\*|\*|#)/; // javadoc, block and line comments

  // Net unclosed parentheses on a line, so a multi-line annotation's argument
  // list (`@RequestMapping(value = "/x",` …) reads as part of the annotation
  // rather than as the signature. Comment tails and string literals are blanked
  // first, so a bracket inside one can't unbalance the count.
  function parenDepth(code) {
    const s = String(code)
      .replace(/\/\/.*$/, '')
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''");
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
    }
    return depth;
  }

  // Walk a header window for its signature line, reading the text off the cells
  // this paint pass found mounted. Returns 0 when it can't be decided yet — a
  // line of the window still virtualized away, or nothing but annotations in it.
  function scanHeader(mounted, group) {
    let depth = 0;
    for (let line = group.startLine; line <= group.endLine; line++) {
      const entry = mounted.get(RMX.github.cellKey(group.digest, group.side, line));
      if (!entry) return 0; // not on the page — a later paint decides
      const code = codeOf(entry.cells, line);
      if (depth > 0) { // inside an annotation's argument list
        depth += parenDepth(code);
        continue;
      }
      if (!code.trim() || COMMENT_RE.test(code)) continue;
      if (ANNOTATION_RE.test(code)) {
        depth += parenDepth(code);
        continue;
      }
      return line;
    }
    return 0;
  }

  // The line of a header window to tag. Memoized across paints once resolved (a
  // line's text can't change while the page is up) and across the cells of one
  // pass otherwise, so a scroll re-paint doesn't re-scan every window on screen.
  // Falls back to RefactoringMiner's own first line, so an undecidable window
  // tags what it always used to rather than nothing at all.
  function headerLine(plan, mounted, key, pass) {
    const known = headerLines.get(key) || pass.get(key);
    if (known) return known;
    const group = plan.headerGroups && plan.headerGroups.get(key);
    if (!group) return 0;
    const found = scanHeader(mounted, group);
    if (found) headerLines.set(key, found);
    const line = found || group.startLine;
    pass.set(key, line);
    return line;
  }

  // --- plan-driven painting -------------------------------------------------
  // content.js compiles the feed into a plan once per page: a Map keyed by
  // cellKey(digest, side, line) covering every line any refactoring paints on,
  // plus index → summary for the tooltip. Painting is then a SINGLE scan of the
  // mounted cells matched against that Map (O(cells on screen), independent of
  // how many refactorings the page carries) instead of the old per-line
  // document queries (O(refactoring-lines × whole document), which is what made
  // a 400-refactoring page crawl and scroll-repaints jank).
  //
  // Each entry: { filePath, contribs: [{ index, summary, trailing, header }] },
  // where `trailing` marks the closing line of a multi-line range (candidate for
  // the over-shot-declaration trim below) and `header` names the declaration
  // whose signature line this could be (candidate for the annotation skip above).
  let paintPlan = null;

  // index (string) -> its hover summary. A cell's data-rmx-desc dedups and joins
  // every summary it carries, losing the per-index mapping; this keeps it so the
  // tooltip can show just the active refactoring's title (see peekHtml).
  let descByIndex = {};

  // index (string) -> the cells currently tagged with it. Rebuilt by every
  // paintAll pass, so selection, minimap, tooltip, and counterpart lookups are
  // map reads instead of document scans.
  let cellsByIndex = new Map();

  function setPlan(plan) {
    // Only a genuinely new plan invalidates the resolved header lines — the
    // additive scroll re-paints hand back the same plan object, and dropping the
    // memo there would re-scan every header window on screen every frame.
    if (plan !== paintPlan) headerLines = new Map();
    paintPlan = plan || null;
    descByIndex = (plan && plan.descByIndex) || {};
  }

  function indexCell(map, index, cell) {
    let list = map.get(index);
    if (!list) map.set(index, (list = []));
    if (list.indexOf(cell) === -1) list.push(cell);
  }

  // Tag every mounted cell the plan covers, and untag every cell it no longer
  // does. The /changes diff virtualizes rows: React *recycles* a DOM node to
  // render a different line as you scroll, rewriting the text/anchor it manages
  // but leaving our class + data-rmx-* attributes on it, so a full pass ends by
  // stripping any still-classed cell it didn't touch (one recycled to a
  // non-target line). Returns the number of tagged lines.
  function paintAll() {
    const plan = paintPlan;
    const byKey = new Map(); // key -> { id, cells } for the plan lines mounted now
    if (plan && plan.byKey.size) {
      const candidates = RMX.github.candidateCells();
      for (let k = 0; k < candidates.length; k++) {
        const el = candidates[k];
        const id = RMX.github.cellIdentity(el);
        if (!id) continue;
        const key = RMX.github.cellKey(id.digest, id.side, id.line);
        if (!plan.byKey.has(key)) continue;
        let group = byKey.get(key);
        if (!group) byKey.set(key, (group = { id, cells: [] }));
        group.cells.push(el);
      }
    }

    const touched = new Set();
    const nextByIndex = new Map();
    const headerPass = new Map(); // header windows resolved during THIS pass
    let tagged = 0;
    byKey.forEach((group, key) => {
      const entry = plan.byKey.get(key);
      const line = group.id.line;
      if (!lineHasCode(group.cells, line)) return; // skip blank source lines (nothing to tag)
      // A declaration's header window covers every line its signature could be
      // on; keep the one it IS on and drop the annotations above it.
      let contribs = entry.contribs;
      if (contribs.some((c) => c.header)) {
        contribs = contribs.filter(
          (c) => !c.header || headerLine(plan, byKey, c.header, headerPass) === line,
        );
        if (!contribs.length) return;
      }
      // Stop a multi-line range before an over-shot trailing declaration (the
      // next method/class), but keep any range that OPENS on this line.
      if (contribs.some((c) => c.trailing) && startsDeclaration(group.cells, line)) {
        contribs = contribs.filter((c) => !c.trailing);
        if (!contribs.length) return;
      }
      const indices = [];
      const descs = [];
      contribs.forEach((c) => {
        if (indices.indexOf(c.index) === -1) indices.push(c.index);
        if (descs.indexOf(c.summary) === -1) descs.push(c.summary);
      });
      const indexAttr = indices.join(' ');
      const descAttr = descs.join('\n');
      group.cells.forEach((cell) => {
        touched.add(cell);
        cell.classList.add(CLASS);
        cell.setAttribute('data-rmx-side', group.id.side);
        if (entry.filePath) cell.setAttribute('data-rmx-file', entry.filePath);
        if (cell.getAttribute('data-rmx-desc') !== descAttr) cell.setAttribute('data-rmx-desc', descAttr);
        if (cell.getAttribute('data-rmx-index') !== indexAttr) cell.setAttribute('data-rmx-index', indexAttr);
        indices.forEach((i) => indexCell(nextByIndex, i, cell));
      });
      tagged++;
    });

    document.querySelectorAll('.' + CLASS).forEach((el) => {
      if (!touched.has(el)) clearCell(el);
    });
    cellsByIndex = nextByIndex;
    return tagged;
  }

  // --- click-to-pair selection -------------------------------------------
  // Clicking a highlighted cell lights up every cell of the same refactoring(s)
  // in neon on BOTH sides, so the counterpart is obvious. The selection is kept
  // in memory and re-applied after re-paints (so it survives scrolling).
  let selectedIndices = [];
  let blinkOn = false;
  let blinkTimer = null;
  let inAttentionPhase = false;
  // The cells the blink toggles, cached by applySelection so the pulse (and the
  // fast attention flashes) never run a document-wide querySelectorAll on a
  // tick: a scan that, landing mid-scroll, janked the page. Rebuilt on every
  // applySelection, so scroll repaints fold newly mounted cells in.
  let selCells = [];

  // index → [{ digest, side, line }, …]: EVERY line the refactoring paints on,
  // set by content.js from the feed data (independent of what's mounted, so
  // they're known even for a collapsed file or a folded hunk that tagged
  // nothing). select() reveals them all before blinking, so a selection also
  // works when the target file wasn't rendered — and, the common case, so the
  // parts GitHub folded away (an untouched field, a kept signature: lines
  // RefactoringMiner calls part of the refactoring but GitHub calls unchanged
  // context) light up with the rest instead of silently going missing.
  let selectTargets = {};
  function setTargets(t) {
    selectTargets = t || {};
  }
  function targetsFor(index) {
    const t = selectTargets[index];
    return Array.isArray(t) ? t : t ? [t] : [];
  }

  // Cap per file: a refactoring spanning dozens of locations shouldn't turn one
  // click into a long burst of unfold requests.
  const MAX_REVEALS_PER_FILE = 12;

  // The location a selection should land on: the first target of the first
  // index. content.js emits the right ("after") side first, which is where a
  // reader wants to be taken.
  function primaryTarget(indices) {
    for (let k = 0; k < indices.length; k++) {
      const t = targetsFor(indices[k])[0];
      if (t) return t;
    }
    return null;
  }

  // Reveal each selected refactoring's hidden lines. Grouped by file and walked
  // in order within one — unfolding for a line usually mounts its neighbours
  // too, so later targets in that file resolve without another click.
  //
  // Files are walked one after another rather than in parallel: on a large diff
  // a file that isn't mounted is reached by navigating GitHub's own file anchor,
  // and two of those in flight at once means the second supersedes the first,
  // leaving it to time out. They're independent in every other respect, and a
  // refactoring spans one or two files, so the ordering costs next to nothing.
  async function ensureRevealed(indices) {
    const byFile = {};
    indices.forEach((i) => {
      targetsFor(i).forEach((t) => {
        (byFile[t.digest] = byFile[t.digest] || []).push(t);
      });
    });
    // The primary file goes LAST. On a big diff, opening a file navigates to it,
    // and the virtualizer then unmounts whatever is now far away — including a
    // file this same call just opened. Measured on a 1,000-file commit: a
    // refactoring spanning two "Load diff" files loaded the first one's 1,208
    // rows, then opening the second threw every one of them back out, so the
    // repaint below tagged nothing and the click looked dead. Revealing the file
    // we're about to scroll to last means it is the one still standing.
    const primary = primaryTarget(indices);
    const order = Object.keys(byFile);
    if (primary && order.indexOf(primary.digest) !== -1) {
      order.splice(order.indexOf(primary.digest), 1);
      order.push(primary.digest);
    }
    for (const digest of order) {
      const targets = byFile[digest].slice(0, MAX_REVEALS_PER_FILE);
      for (const t of targets) await RMX.github.revealLine(t.digest, t.side, t.line, t.filePath);
    }
  }

  // content.js's additive re-paint, so a selection can tag the lines an unfold
  // just mounted straight away instead of waiting out the scroll observer's
  // debounce — which would leave freshly revealed lines dark for a beat, exactly
  // when the user is looking for them.
  let repaint = null;
  function setRepaint(fn) {
    repaint = fn;
  }
  const ATTENTION_BLINKS = 3;   // number of fast blinks before settling into slow pulse
  const BLINK_FAST_MS = 167;    // per phase during attention (~3 blinks in ~1 second)

  // Half-cycle of the settled pulse, derived from the user's blink speed. Zero
  // when the speed is "constant" — callers check for that and skip blinking.
  function halfPeriod() {
    return blinkPeriod / 2;
  }
  // The attention flash must stay faster than the pulse it hands off to, or the
  // top speeds would "flash" slower than they settle.
  function attentionPhaseMs() {
    return blinkPeriod ? Math.min(BLINK_FAST_MS, halfPeriod()) : BLINK_FAST_MS;
  }

  // Marks every cell of the selected refactoring(s) and sets its fill to the
  // current blink phase. Additive + idempotent, so scroll re-paints just sync
  // newly mounted cells to the current phase. SEL keeps the outline always;
  // ON (the fill) is what blinks. During the attention phase transitions are
  // suppressed so the fast blink is a crisp binary flash.
  function applySelection() {
    const seen = new Set();
    selectedIndices.forEach((i) => {
      (cellsByIndex.get(String(i)) || []).forEach((el) => {
        if (!el.isConnected || seen.has(el)) return;
        seen.add(el);
        el.classList.add(SEL);
        el.classList.toggle(ON, blinkOn);
        el.style.transitionDuration = inAttentionPhase ? '0s' : '';
      });
    });
    selCells = Array.from(seen);
    // With no selection, a repaint only needs the viewport-relative refresh (a
    // tick that just became measurable); a live selection re-syncs everything.
    schedulePins(selectedIndices.length > 0);
  }

  function removeSelectionClasses() {
    document.querySelectorAll('.' + SEL).forEach((el) => {
      el.classList.remove(SEL, ON);
      el.style.transitionDuration = '';
    });
    selCells = [];
  }

  // Toggle the fill on the cached selection. A disconnected cell (React
  // virtualized its row away) is skipped rather than re-queried; the next
  // applySelection rebuilds the set with whatever is mounted then.
  function paintFill(on) {
    for (let k = 0; k < selCells.length; k++) {
      if (selCells[k].isConnected) selCells[k].classList.toggle(ON, on);
    }
  }

  // The slow synced pulse the selection settles into after its attention blinks;
  // hoisted to module scope so it doesn't deepen select()'s function nesting.
  // fastTick hands off to it via setTimeout once the fast attention blinks end.
  function slowTick() {
    blinkOn = !blinkOn;
    paintFill(blinkOn);
    blinkTimer = setTimeout(slowTick, halfPeriod());
  }

  // Settle the current selection into the slow pulse, phase-locked to blinkEpoch
  // so every selected cell (and any cell mounted later) pulses in step.
  function settleIntoPulse() {
    inAttentionPhase = false;
    for (let k = 0; k < selCells.length; k++) selCells[k].style.transitionDuration = '';
    schedulePins(true);
    if (!blinkPeriod) return holdLit(); // "constant" speed: light up and stay lit
    const elapsed = (Date.now() - blinkEpoch) % blinkPeriod;
    blinkOn = elapsed < halfPeriod();
    paintFill(blinkOn);
    const timeUntilNext = blinkOn ? (halfPeriod() - elapsed) : (blinkPeriod - elapsed);
    blinkTimer = setTimeout(slowTick, timeUntilNext);
  }

  // The "constant" end of the speed slider: the fill goes on and never comes off.
  function holdLit() {
    blinkOn = true;
    paintFill(true);
  }

  // Re-time a live selection after the speed preference changes, so a slider move
  // in the options page takes effect on an already-blinking diff.
  function resyncPulse() {
    clearTimeout(blinkTimer);
    settleIntoPulse();
  }

  async function select(indices) {
    // Load/expand a collapsed file and unfold every hidden line of this
    // refactoring first, then re-tag what that mounted, so the blink below
    // covers the whole refactoring rather than just the parts GitHub had shown.
    await ensureRevealed(indices);
    if (repaint) await repaint();
    removeSelectionClasses();
    selectedIndices = indices.slice();
    clearTimeout(blinkTimer);

    // At "constant" speed the attention flashes would be the only blinking on the
    // page, which is exactly what that setting opts out of — go straight to lit.
    if (!blinkPeriod) {
      inAttentionPhase = false;
      blinkOn = true;
      applySelection();
      return;
    }

    // Phase 1: ATTENTION_BLINKS fast crisp flashes to grab the user's eye.
    inAttentionPhase = true;
    blinkOn = true;
    applySelection();
    let togglesLeft = ATTENTION_BLINKS * 2; // each blink = one on + one off toggle
    function fastTick() {
      blinkOn = !blinkOn;
      paintFill(blinkOn);
      if (--togglesLeft > 0) {
        blinkTimer = setTimeout(fastTick, attentionPhaseMs());
        return;
      }
      // Phase 2: attention done — restore transitions and settle into slow synced pulse.
      settleIntoPulse();
    }
    blinkTimer = setTimeout(fastTick, attentionPhaseMs());
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

  // --- focus navigation (minimap + navigator + edge chips) -----------------
  // Off-screen refactored lines are matched three ways instead of the old pin
  // stacks (which grew without bound and buried the page):
  //   • a right-edge MINIMAP with one tick per refactoring and a viewport thumb —
  //     the always-on overview of where the changes sit,
  //   • a fixed NAVIGATOR pill that steps one refactoring at a time (‹ › / j k),
  //     revealing and centring each as it goes, and
  //   • at most ONE EDGE CHIP per screen edge, pointing at the selected
  //     refactoring's lines currently above/below the fold.
  // All three are fixed-height, so a huge refactoring can't overflow them. They
  // reuse the same select()/reveal machinery, so a jump still un-collapses a
  // folded file before scrolling.
  const TOP_ZONE = 96;        // header + navigator band: cells above this read as "off-screen up"
  const BOTTOM_GAP = 20;      // matching gap at the bottom edge
  const blinkEpoch = Date.now(); // phase origin the settled pulse locks onto
  const stackCollapsed = { top: false, bottom: false }; // retained: clearSelection() still resets it
  let refreshRaf = null;

  // Which side a refactoring mainly lives on, for its accent colour — the "after"
  // (right) side by default, since that's where extracted/renamed code lands.
  function refSide(index) {
    const t = targetsFor(index)[0];
    return t && t.side === 'L' ? 'L' : 'R';
  }
  // Small solid marks (nav swatch, edge-chip dot) sit on canvas-coloured chrome,
  // so they take the accent — the fill is tuned to sit behind code, not to be
  // seen on its own against the page.
  function sideVar(side) {
    return side === 'L' ? 'var(--rmx-left-d,#9a6700)' : 'var(--rmx-right-d,#0969da)';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // The scroll container the diff actually lives in: the nearest scrollable
  // ancestor of a tagged cell, else the document. Covers both the classic
  // whole-window scroll and the React diff's inner virtualized scroller.
  //
  // Cached: this walks ancestors calling getComputedStyle (a style flush) and
  // used to run on every scroll frame. The container doesn't change within a
  // page (a diff either scrolls the window or an inner box, never both), so
  // resolve it once and hold it until clearAll rebuilds the diff; isConnected
  // guards the rare re-mount.
  let cachedHost = null;
  function scrollHost() {
    if (cachedHost && cachedHost.isConnected) return cachedHost;
    const cell = document.querySelector('.' + CLASS);
    let el = cell && cell.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 40) {
        cachedHost = el;
        return el;
      }
      el = el.parentElement;
    }
    cachedHost = document.scrollingElement || document.documentElement;
    return cachedHost;
  }

  // Every mounted, tagged cell for one refactoring (optionally one side). Reads
  // the index paintAll builds (no document scan). Empty when the refactoring's
  // lines are all virtualized out or in a collapsed file.
  function mountedCells(index, side) {
    const list = cellsByIndex.get(String(index));
    if (!list) return [];
    return list.filter(
      (c) => c.isConnected && (!side || c.getAttribute('data-rmx-side') === side),
    );
  }

  // One source line's number, from GitHub's own attribute or parsed off the
  // diff-<digest><side><line> anchor. 0 when it can't be resolved.
  function lineNum(cell) {
    const n = cell.getAttribute('data-line-number');
    if (n) return parseInt(n, 10) || 0;
    const a = cell.getAttribute('data-line-anchor') || cell.getAttribute('data-grid-cell-id') || cell.id || '';
    const m = /([LR])(\d+)$/.exec(a);
    return m ? parseInt(m[2], 10) : 0;
  }
  // A source line's stable identity: file + side + line number. The number cell
  // and the code cell of one line share all three, so keying on this collapses
  // the two mounted cells into a single entry (the old anchor key didn't — the
  // gutter twin often carries a different data-grid-cell-id, double-counting it).
  function lineKey(cell) {
    return (cell.getAttribute('data-rmx-file') || '') + '|' +
      (cell.getAttribute('data-rmx-side') || '') + '|' + lineNum(cell);
  }

  // Selected cells, one per source line — collapse each line's number + code
  // cells to one entry, keeping whichever holds the most text (the code cell).
  // Reads the cached selection set (refreshEdges calls this on every scroll
  // frame), so it never scans the whole document.
  function distinctSelected() {
    const byLine = {};
    for (let k = 0; k < selCells.length; k++) {
      const cell = selCells[k];
      if (!cell.isConnected || !lineNum(cell)) continue; // virtualized out, or a spacer
      const key = lineKey(cell);
      const len = (cell.textContent || '').length;
      if (!byLine[key] || len > byLine[key].len) byLine[key] = { cell, len };
    }
    return Object.keys(byLine).map((k) => byLine[k].cell);
  }

  /* ---- navigator ---- */
  let navEl = null, navMain = null, navCount = null, navPrev = null, navNext = null;
  let navRows = []; // [{ index, type, summary, side }] in feed order

  function ensureNav() {
    if (navEl) return navEl;
    ensureStyle();
    navEl = document.createElement('div');
    navEl.id = 'rmx-nav';
    navPrev = document.createElement('button');
    navPrev.className = 'rmx-nav-btn';
    navPrev.type = 'button';
    navPrev.setAttribute('aria-label', 'Previous refactoring');
    navPrev.textContent = '‹';
    navPrev.addEventListener('click', () => navStep(-1));
    navMain = document.createElement('div');
    navMain.className = 'rmx-nav-main';
    navCount = document.createElement('span');
    navCount.className = 'rmx-nav-count';
    navNext = document.createElement('button');
    navNext.className = 'rmx-nav-btn';
    navNext.type = 'button';
    navNext.setAttribute('aria-label', 'Next refactoring');
    navNext.textContent = '›';
    navNext.addEventListener('click', () => navStep(1));
    navEl.appendChild(navPrev);
    navEl.appendChild(navMain);
    navEl.appendChild(navCount);
    navEl.appendChild(navNext);
    document.body.appendChild(navEl);
    // j / k step through refactorings (installed once; a no-op until rows exist).
    if (!window.__rmxNavKeys) {
      window.__rmxNavKeys = true;
      document.addEventListener('keydown', (e) => {
        if (!navRows.length || e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (e.key === 'j' || e.key === 'J') { navStep(1); e.preventDefault(); }
        else if (e.key === 'k' || e.key === 'K') { navStep(-1); e.preventDefault(); }
      });
    }
    return navEl;
  }

  function navPos() {
    return navRows.findIndex((r) => selectedIndices.indexOf(String(r.index)) !== -1);
  }
  function navStep(dir) {
    if (!navRows.length) return;
    let pos = navPos();
    pos = pos === -1
      ? (dir > 0 ? 0 : navRows.length - 1)
      : (pos + dir + navRows.length) % navRows.length;
    focus(navRows[pos].index);
  }
  // What the pill currently shows; repaints re-run updateNav often, and an
  // unchanged position shouldn't cost an innerHTML rebuild each time.
  let navSig = null;
  function updateNav() {
    if (!navEl) return;
    const pos = navPos();
    const sig = pos + '/' + navRows.length;
    if (sig === navSig) return;
    navSig = sig;
    if (pos === -1) {
      navMain.innerHTML = '<span class="rmx-nav-idle">Select a refactoring to trace it across the diff</span>';
      navCount.textContent = navRows.length ? '0 / ' + navRows.length : '';
      navPrev.disabled = navNext.disabled = !navRows.length;
      return;
    }
    const r = navRows[pos];
    navMain.innerHTML =
      '<span class="rmx-nav-swatch" style="background:' + sideVar(r.side) + '"></span>' +
      '<span class="rmx-nav-type">' + escapeHtml(r.type) + '</span>' +
      '<span class="rmx-nav-sum">' + escapeHtml(r.summary) + '</span>';
    navCount.textContent = (pos + 1) + ' / ' + navRows.length;
    navPrev.disabled = navNext.disabled = false;
  }

  /* ---- minimap ---- */
  let mmEl = null, mmThumb = null;
  const mmTicks = {}; // index -> tick element

  function ensureMinimap() {
    if (mmEl) return mmEl;
    ensureStyle();
    mmEl = document.createElement('div');
    mmEl.id = 'rmx-minimap';
    mmThumb = document.createElement('div');
    mmThumb.className = 'rmx-mm-thumb';
    mmEl.appendChild(mmThumb);
    document.body.appendChild(mmEl);
    return mmEl;
  }
  function buildMinimap() {
    ensureMinimap();
    Object.keys(mmTicks).forEach((k) => { mmTicks[k].remove(); delete mmTicks[k]; });
    navRows.forEach((r) => {
      const tick = document.createElement('div');
      tick.className = 'rmx-mm-tick rmx-mm-' + r.side;
      tick.style.display = 'none'; // shown once its position is known
      tick.title = r.type + ' — ' + r.summary;
      tick.addEventListener('click', () => focus(r.index));
      mmEl.appendChild(tick);
      mmTicks[r.index] = tick;
    });
  }
  // `relocate`: re-measure every mounted tick (the layout moved: a reveal, a
  // resize, a selection change). A plain scroll passes false: a tick's position
  // within the scroll CONTENT (rect.top - hostTop + scrollTop) is invariant as
  // you scroll, so already-located ticks need no getBoundingClientRect at all;
  // only ticks never located yet (their rows just mounted) get measured. Reads
  // are gathered first and writes applied second, so measuring N ticks forces at
  // most one reflow rather than one per tick.
  function refreshMinimap(relocate) {
    if (!mmEl || !navRows.length) { if (mmEl) mmEl.classList.remove('rmx-show'); return; }
    const host = scrollHost();
    const isDoc = host === document.scrollingElement || host === document.documentElement || host === document.body;
    const sh = host.scrollHeight, ch = host.clientHeight, st = host.scrollTop;
    if (sh <= ch + 40) { mmEl.classList.remove('rmx-show'); return; } // fits on screen — no map needed

    // READ phase: measure only the ticks that actually need (re)placing.
    const hostTop = isDoc ? 0 : host.getBoundingClientRect().top;
    const measured = [];
    navRows.forEach((r) => {
      const tick = mmTicks[r.index];
      if (!tick || (!relocate && tick.dataset.pct != null)) return; // held from before
      const cell = mountedCells(r.index)[0];
      if (cell) measured.push({ tick, top: cell.getBoundingClientRect().top });
    });

    // WRITE phase: nothing below reads layout, so the reads above never
    // interleave with a style mutation. Position within the full scroll content
    // is cached on the tick, so it holds its place after that line scrolls off
    // and gets virtualized away.
    mmEl.classList.add('rmx-show');
    measured.forEach(({ tick, top }) => {
      const pct = Math.max(0, Math.min(1, (top - hostTop + st) / sh));
      tick.dataset.pct = pct;
      tick.style.top = (pct * 100) + '%';
      tick.style.display = '';
    });
    navRows.forEach((r) => {
      const tick = mmTicks[r.index];
      if (!tick) return;
      if (tick.dataset.pct == null) tick.style.display = 'none'; // never located yet
      tick.classList.toggle('rmx-mm-active', selectedIndices.indexOf(String(r.index)) !== -1);
    });
    mmThumb.style.top = (st / sh * 100) + '%';
    mmThumb.style.height = (ch / sh * 100) + '%';
  }

  /* ---- edge chips ---- */
  let edgeTop = null, edgeBot = null;

  function ensureEdges() {
    if (edgeTop) return;
    ensureStyle();
    const wrapTop = document.createElement('div');
    wrapTop.className = 'rmx-edge';
    wrapTop.id = 'rmx-edge-top-wrap';
    edgeTop = document.createElement('div');
    edgeTop.className = 'rmx-edge-chip';
    edgeTop.id = 'rmx-edge-top';
    wrapTop.appendChild(edgeTop);
    const wrapBot = document.createElement('div');
    wrapBot.className = 'rmx-edge';
    wrapBot.id = 'rmx-edge-bot-wrap';
    edgeBot = document.createElement('div');
    edgeBot.className = 'rmx-edge-chip';
    edgeBot.id = 'rmx-edge-bot';
    wrapBot.appendChild(edgeBot);
    document.body.appendChild(wrapTop);
    document.body.appendChild(wrapBot);
  }
  function fillEdge(chip, cells, dir) {
    if (!cells.length) { chip.classList.remove('rmx-show'); return; }
    // Split the off-screen lines by side so each colour carries its OWN count and
    // its own jump target. A mixed pile under one switching dot was ambiguous —
    // the number was a total but the colour named just the nearest line.
    const bySide = { L: [], R: [] };
    cells.forEach((c) => { (bySide[c.getAttribute('data-rmx-side')] || bySide.R).push(c); });
    const nearestOf = (list) => list.reduce((best, c) => {
      const b = best.getBoundingClientRect(), r = c.getBoundingClientRect();
      return dir === 'up' ? (r.bottom > b.bottom ? c : best) : (r.top < b.top ? c : best);
    });

    chip.textContent = '';
    const arw = document.createElement('span');
    arw.className = 'rmx-edge-arw';
    arw.textContent = dir === 'up' ? '↑' : '↓';
    chip.appendChild(arw);
    ['L', 'R'].forEach((side) => {
      const list = bySide[side];
      if (!list.length) return;
      const seg = document.createElement('span');
      seg.className = 'rmx-edge-seg';
      const where = side === 'L' ? 'left / before' : 'right / after';
      seg.title = list.length + ' line' + (list.length !== 1 ? 's' : '') +
        ' on the ' + where + ' side — click to jump';
      seg.innerHTML =
        '<span class="rmx-edge-dot" style="background:' + sideVar(side) + '"></span><b>' + list.length + '</b>';
      const target = nearestOf(list);
      seg.addEventListener('click', () => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      chip.appendChild(seg);
    });
    const lbl = document.createElement('span');
    lbl.className = 'rmx-edge-lbl';
    lbl.textContent = (cells.length === 1 ? 'line ' : 'lines ') + (dir === 'up' ? 'above' : 'below');
    chip.appendChild(lbl);
    chip.classList.add('rmx-show');
  }
  function refreshEdges() {
    if (!selectedIndices.length) {
      if (edgeTop) edgeTop.classList.remove('rmx-show');
      if (edgeBot) edgeBot.classList.remove('rmx-show');
      return;
    }
    ensureEdges();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const above = [], below = [];
    distinctSelected().forEach((cell) => {
      const r = cell.getBoundingClientRect();
      if (!r.height) return; // unmounted by virtualization
      if (r.bottom <= TOP_ZONE) above.push(cell);
      else if (r.top >= vh - BOTTOM_GAP) below.push(cell);
    });
    fillEdge(edgeTop, above, 'up');
    fillEdge(edgeBot, below, 'down');
  }

  /* ---- shared refresh (kept names so select()/applySelection() drive it) ---- */
  // `full` distinguishes the two triggers that share the frame budget:
  //   • scroll (full=false) only moves the viewport, so it re-runs the
  //     viewport-relative bits (edge chips, minimap thumb, any tick that just
  //     became measurable) and nothing else; the nav pill and report-row
  //     highlight don't move when you scroll, so refreshing them there was waste.
  //   • a selection/nav/resize/reveal change (full=true) re-runs everything and
  //     re-measures the minimap ticks, since the layout may have shifted.
  // A full request always wins the coalesced frame.
  let pendingFull = false;
  function schedulePins(full) {
    if (full) pendingFull = true;
    if (refreshRaf) return;
    refreshRaf = requestAnimationFrame(() => {
      refreshRaf = null;
      const runFull = pendingFull;
      pendingFull = false;
      if (runFull) updatePins(); else syncViewport();
    });
  }
  function syncViewport() {
    refreshEdges();
    refreshMinimap(false);
  }
  function updatePins() {
    refreshEdges();
    refreshMinimap(true);
    updateNav();
    syncReportRow();
  }
  function clearPins() {
    refreshEdges();        // no selection ⇒ both chips hide
    refreshMinimap(false); // drops the active-tick emphasis (positions unchanged)
    updateNav();           // back to the idle prompt
    syncReportRow();       // clear the current-row highlight
  }

  // Bring a cell into view. Smooth for a target a screen or two away (that
  // motion is what tells the user where they were taken from), but a straight
  // jump for a distant one: a large diff mounts a far-off file at its true
  // position, which can be hundreds of thousands of pixels down the page, and
  // animating that ride mounts and unmounts every file in between.
  const NEAR_SCREENS = 2;
  function scrollCellIntoView(cell) {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const top = cell.getBoundingClientRect().top;
    const far = top < -NEAR_SCREENS * vh || top > (NEAR_SCREENS + 1) * vh;
    cell.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'center' });
    return far;
  }
  // A far target means its file was just mounted at its TRUE document position —
  // hundreds of thousands of pixels away on a 1,000-file commit — and no single
  // scroll can get there: the virtualizer catches any long programmatic scroll
  // and rubber-bands it back to the edge of what it has measured, letting the
  // viewport advance only as fast as it measures files in between (~30k px/s,
  // measured live). GitHub is bound by the same limit — its own tree-click glide
  // and even a fresh page load on the file's #diff- anchor both stop hundreds of
  // thousands of pixels short. The only thing that ARRIVES is to keep re-issuing
  // the seek until the target reads as near, so that's what travel() does, at a
  // cadence the re-measuring can absorb. Mid-page on that commit this takes
  // ~20-25s; any real user input (wheel, key, pointer) cancels it, as does a
  // newer travel, so the user is never trapped in the ride.
  const TRAVEL_STEP_MS = 100;
  const TRAVEL_MAX_MS = 60000;
  let travelToken = 0; // bumped to cancel the crawl in flight
  function cancelTravel() {
    travelToken++;
  }
  // User input takes the wheel back. Capture-phase on window so no page handler
  // can swallow it; our own scrollTop writes fire none of these events.
  function watchTravelCancel() {
    if (window.__rmxTravelWatch) return;
    window.__rmxTravelWatch = true;
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((type) => {
      window.addEventListener(type, cancelTravel, { capture: true, passive: true });
    });
  }
  async function travel(cell) {
    watchTravelCancel();
    const token = ++travelToken;
    const host = scrollHost();
    const isDoc = host === document.scrollingElement || host === document.documentElement || host === document.body;
    const deadline = Date.now() + TRAVEL_MAX_MS;
    while (token === travelToken && cell.isConnected && Date.now() < deadline) {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const top = cell.getBoundingClientRect().top;
      if (top > -NEAR_SCREENS * vh && top < (NEAR_SCREENS + 1) * vh) {
        cell.scrollIntoView({ behavior: 'smooth', block: 'center' }); // arrived — centre and stop
        return;
      }
      const hostRect = isDoc ? { top: 0, height: vh } : host.getBoundingClientRect();
      host.scrollTop += top - (hostRect.top + hostRect.height / 2);
      await new Promise((resolve) => setTimeout(resolve, TRAVEL_STEP_MS));
    }
  }
  function scrollToCell(cell) {
    if (!scrollCellIntoView(cell)) return; // near: one smooth centring, done
    travel(cell);
  }

  // Re-open the refactoring's landing spot and re-tag it. The safety net for a
  // selection whose reveals were all undone before they could be painted: on a
  // virtualized diff the page moves while later targets are being opened, and
  // rows that existed a moment ago are gone by the time the repaint runs. One
  // more reveal of just the primary location, with nothing after it to scroll
  // the page away again, is what makes "open the file AND highlight it" hold.
  async function revealPrimary(index) {
    const t = primaryTarget([String(index)]);
    if (!t) return null;
    await RMX.github.revealLine(t.digest, t.side, t.line, t.filePath);
    if (repaint) await repaint();
    applySelection();
    return mountedCells(index)[0] || null;
  }

  // Focus one refactoring by feed index: reveal its file, blink it, and bring a
  // mounted line into view. Shared by the report rows, navigator, and minimap.
  async function focus(index) {
    await select([String(index)]);
    const cell = mountedCells(index)[0] || (await revealPrimary(index));
    if (cell) scrollToCell(cell);
  }

  // Focus one *location* of a refactoring: same blink, but land on the side (and,
  // where it's one of the lines we actually tag, the line) the caller names
  // rather than on the refactoring's default landing spot. Used by the detailed
  // panel's per-location rows, where the whole point is that you picked which end
  // of a Move you wanted to look at.
  //
  // The line may not be one we can land on: content.js trims RefactoringMiner's
  // ranges before tagging them (an enclosing declaration contributes its header
  // line, not its body), so fall back to any line of that side, then to the
  // refactoring as a whole.
  async function focusAt(index, side, line) {
    await select([String(index)]);
    const wanted = side === 'L' ? 'L' : 'R';
    const targets = targetsFor(index).filter((t) => t.side === wanted);
    const t = targets.find((x) => x.line === line) || targets[0];
    if (!t) return focus(index);
    await RMX.github.revealLine(t.digest, t.side, t.line, t.filePath);
    if (repaint) await repaint();
    applySelection();
    const onSide = mountedCells(index, wanted);
    const cell = onSide.find((c) => lineNum(c) === t.line) || onSide[0];
    if (cell) scrollToCell(cell);
    else await focus(index);
  }

  // Populate the navigator + minimap from the report rows (feed order). Called by
  // showReport once a page's refactorings are known.
  function setNav(rows) {
    navRows = (rows || []).map((r) => ({
      index: r.index, type: r.type, summary: r.summary, side: refSide(r.index),
    }));
    ensureNav();
    buildMinimap();
    navEl.classList.toggle('rmx-show', navRows.length > 0);
    navSig = null; // the rows changed: force the pill to re-render
    updateNav();
    schedulePins(true);
  }
  function teardownFocusUI() {
    [navEl, mmEl,
      document.getElementById('rmx-edge-top-wrap'),
      document.getElementById('rmx-edge-bot-wrap')].forEach((el) => { if (el) el.remove(); });
    navEl = navMain = navCount = navPrev = navNext = null;
    mmEl = mmThumb = null;
    edgeTop = edgeBot = null;
    Object.keys(mmTicks).forEach((k) => delete mmTicks[k]);
    navRows = [];
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
      const matches = mountedCells(indices[k]);
      for (let j = 0; j < matches.length; j++) {
        if (matches[j].getAttribute('data-rmx-side') !== side) {
          if (!inViewport(matches[j])) scrollToCell(matches[j]);
          return;
        }
      }
    }
  }

  // Hover peek: the refactoring's summary, plus a live glance at its counterpart
  // on the other side — the actual code lines when they're mounted, or a jump
  // hint when they've scrolled off / sit in a collapsed file.
  function peekHtml(cell) {
    const cellIndices = (cell.getAttribute('data-rmx-index') || '').split(' ').filter(Boolean);
    if (!cellIndices.length) {
      return '<div class="rmx-tip-title">' +
        escapeHtml(cell.getAttribute('data-rmx-desc') || '') + '</div>';
    }
    // A line can belong to several refactorings. When one is currently selected
    // (blinking / stepped to in the navigator) and this line is part of it, scope
    // the peek to just that refactoring; otherwise show every one the line joins.
    const active = cellIndices.filter((i) => selectedIndices.indexOf(i) !== -1);
    const indices = active.length ? active : cellIndices;
    // One title row per shown refactoring, using its own summary (data-rmx-desc
    // dedups them into one blob, so use the per-index map instead).
    let html = indices
      .map((i) => descByIndex[i])
      .filter(Boolean)
      .map((d) => '<div class="rmx-tip-title">' + escapeHtml(d) + '</div>')
      .join('') ||
      '<div class="rmx-tip-title">' + escapeHtml(cell.getAttribute('data-rmx-desc') || '') + '</div>';
    const other = cell.getAttribute('data-rmx-side') === 'L' ? 'R' : 'L';
    // One entry per counterpart line, gathered across the shown refactoring(s).
    // Keyed by file+side+line so the number + code cells collapse and different
    // files can't clobber each other; keeps whichever cell holds the most text.
    const byKey = {};
    indices.forEach((idx) => {
      mountedCells(idx, other).forEach((c) => {
        const ln = lineNum(c);
        if (!ln) return;
        const key = lineKey(c);
        const txt = (c.textContent || '').replace(/\s+$/, '');
        if (!byKey[key] || txt.length > byKey[key].txt.length) {
          byKey[key] = { ln, file: c.getAttribute('data-rmx-file') || '', txt };
        }
      });
    });
    const lines = Object.keys(byKey)
      .map((k) => byKey[k])
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.ln - b.ln))
      .map((e) => e.txt)
      .filter((txt) => txt && !/^\s*\d*\s*$/.test(txt))
      // Drop GitHub's leading diff marker (it sits in the cell text, before the
      // indentation) so it doesn't block the dedent below or waste a column.
      .map((txt) => txt.replace(/^[+\- ](?=\s)/, ''));
    if (lines.length) {
      // Strip the deepest shared indentation so nested code uses the full width
      // instead of wasting it on leading whitespace (relative indent is kept).
      const indent = Math.min.apply(null, lines.map((t) => /^\s*/.exec(t)[0].length));
      const shown = lines.slice(0, 5)
        .map((t) => '<span class="rmx-tip-line">' + escapeHtml(t.slice(indent, indent + 120)) + '</span>').join('');
      const more = lines.length > 5 ? '<span class="rmx-tip-more">… +' + (lines.length - 5) + ' more</span>' : '';
      html += '<div class="rmx-tip-code rmx-tip-' + other + '">' + shown + more + '</div>';
    } else {
      html += '<div class="rmx-tip-hint">Counterpart is off screen — click to jump to it</div>';
    }
    return html;
  }

  // One delegated tooltip + click handler shared by all highlighted cells.
  function installTooltip() {
    ensureStyle();
    if (window.__rmxTip) return;
    const tip = document.createElement('div');
    tip.className = TIP;
    document.body.appendChild(tip);
    window.__rmxTip = tip;
    // mouseover fires once per element entered, so moving along a single diff
    // line raises one event per token span, all resolving to the same cell.
    // Recompute (and reflow, via offsetHeight/Width below) only when the cell
    // actually changes; a move within the same cell, or across unhighlighted
    // code, does nothing.
    let tipCell = null;
    document.addEventListener('mouseover', (e) => {
      const cell = e.target.closest && e.target.closest('.' + CLASS);
      if (cell === tipCell) return;
      tipCell = cell;
      if (!cell) {
        tip.style.opacity = 0;
        return;
      }
      tip.innerHTML = peekHtml(cell);
      const r = cell.getBoundingClientRect();
      // Prefer above the line; flip below when it would clip the top of the page.
      let top = window.scrollY + r.top - tip.offsetHeight - 8;
      if (top < window.scrollY + 4) top = window.scrollY + r.bottom + 8;
      let left = window.scrollX + r.left;
      const maxLeft = window.scrollX + (window.innerWidth || 0) - tip.offsetWidth - 12;
      if (left > maxLeft) left = Math.max(window.scrollX + 4, maxLeft);
      tip.style.top = top + 'px';
      tip.style.left = left + 'px';
      tip.style.opacity = 1;
    });
    document.addEventListener('click', async (e) => {
      if (!e.target.closest) return;
      // Clicks on our own UI (navigator, minimap, edge chips, report) shouldn't clear the selection.
      if (e.target.closest('#rmx-nav, #rmx-minimap, .rmx-edge, #rmx-report')) return;
      const cell = e.target.closest('.' + CLASS);
      if (!cell) {
        clearSelection();
        return;
      }
      const idxAttr = cell.getAttribute('data-rmx-index');
      if (!idxAttr) return;
      const indices = idxAttr.split(' ');
      // await so a counterpart in a collapsed file is revealed before we scroll.
      await select(indices);
      scrollToCounterpart(cell, indices);
    });
    // Re-place the pinned bars as the user scrolls/resizes (capture so we catch
    // scrolling from any inner container, not just the window). Scroll takes the
    // light path (viewport only); resize re-measures, since the layout reflows.
    window.addEventListener('scroll', () => schedulePins(false), true);
    window.addEventListener('resize', () => schedulePins(true));
  }

  // Scroll to and flash a refactoring by its feed index (for ?rm= deep links).
  function scrollToRefactoring(index) {
    const cell = mountedCells(index)[0];
    if (!cell) return false;
    scrollToCell(cell);
    cell.classList.add(FLASH);
    setTimeout(() => cell.classList.remove(FLASH), 2400);
    return true;
  }

  // --- refactorings report panel ------------------------------------------
  // A collapsible list of every refactoring the current view carries — a stand-in
  // for the action's PR comment, and the only listing available on commit pages.
  // Clicking a row selects (blinks) that refactoring and scrolls to it. Shown in
  // both PR and commit views.
  //
  // It renders at one of three detail levels (see PANEL_VIEWS): the pinned
  // bottom-left card, the same card elongated with full descriptions, or a
  // full-width bottom dock that also lists every code element and offers a
  // per-type filter. The level only changes what the panel shows — never what
  // was analysed or what is tagged in the diff — so switching is a re-render of
  // the rows already in hand.
  let reportEl = null;

  function ensureReport() {
    if (reportEl) return reportEl;
    ensureStyle();
    reportEl = document.createElement('div');
    reportEl.id = 'rmx-report';
    reportEl.className = 'rmx-v-' + panelView;
    const head = document.createElement('div');
    head.className = 'rmx-rp-head';
    head.innerHTML = '<span class="rmx-rp-title">Refactorings</span><span class="rmx-rp-caret">▾</span>';
    head.addEventListener('click', () => {
      reportEl.classList.toggle('rmx-collapsed');
      applyDockHeight(); // a collapsed dock stops reserving the bottom strip
    });
    const filter = document.createElement('div');
    filter.className = 'rmx-rp-filter';
    const body = document.createElement('div');
    body.className = 'rmx-rp-body';
    reportEl.appendChild(head);
    reportEl.appendChild(filter);
    reportEl.appendChild(body);
    document.body.appendChild(reportEl);
    applyDockHeight();
    return reportEl;
  }

  // Only the detailed dock reserves space along the bottom edge; the minimap and
  // the bottom edge chip read this so they clear it. A collapsed dock is just its
  // header, which is short enough to sit under them.
  const DOCK_HEIGHT = '34vh';
  function applyDockHeight() {
    const docked =
      panelView === 'detailed' && reportEl && !reportEl.classList.contains('rmx-collapsed');
    document.documentElement.style.setProperty('--rmx-dock-h', docked ? DOCK_HEIGHT : '0px');
  }

  // Adopt a detail level. Re-renders from the rows already held, so a change in
  // the options page re-draws an open diff without re-analysing it.
  function setPanelView(view) {
    const next = normView(view);
    if (next === panelView && reportEl) return;
    const wasDetailed = panelView === 'detailed';
    panelView = next;
    // The type filter is part of the detailed level and its checkboxes go with
    // it, so leaving that level clears it — otherwise the reader lands in a
    // smaller panel showing a fraction of the refactorings with no visible
    // reason and no control to undo it.
    if (wasDetailed && next !== 'detailed') hiddenTypes = new Set();
    if (!reportEl) return;
    PANEL_VIEWS.forEach((v) => reportEl.classList.toggle('rmx-v-' + v, v === next));
    applyDockHeight();
    if (lastRows) showReport(lastRows);
  }

  // `n` is how many rows are on show, `total` how many the page carries. They
  // differ only when the detailed level's type filter is hiding some, and saying
  // so is what stops a filtered list from reading as a shorter analysis.
  function reportTitle(n, total) {
    const label =
      typeof n !== 'number' ? 'Refactorings'
        : typeof total === 'number' && total !== n ? `Refactorings (${n} of ${total})`
          : `Refactorings (${n})`;
    ensureReport().querySelector('.rmx-rp-title').textContent = label;
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
    reportFilter().textContent = '';
    reportBody().appendChild(msg);
  }

  function reportError(message) {
    reportTitle();
    const msg = document.createElement('div');
    msg.className = 'rmx-rp-msg rmx-rp-err';
    msg.textContent = message || 'Could not load refactorings.';
    reportFilter().textContent = '';
    reportBody().appendChild(msg);
  }

  function reportFilter() {
    return ensureReport().querySelector('.rmx-rp-filter');
  }

  // Report rows are expandable: the row body reveals/blinks the refactoring, and
  // an inline disclosure opens a card with RefactoringMiner's description for it,
  // formatted into one clause per line.
  let rpItems = {};      // feed index (string) -> item element, for current-row sync
  let rpOpenItem = null; // single-open accordion
  let lastRows = null;   // the rows showReport last drew, so a level change can redraw
  // Types the reader has switched OFF in the detailed level's filter. Held as the
  // hidden set rather than the shown one so a fresh page (or a type that only
  // appears after a re-analysis) starts visible.
  let hiddenTypes = new Set();

  // Connective phrases RefactoringMiner uses to join a description's clauses.
  // Splitting on them turns its run-on sentence into one relation per line
  // ("extracted from ...", "in class ..."), which reads better than a wall of
  // text. Longer phrases are listed first so the match prefers them.
  const DESC_CONNECTORS = [
    'extracted and moved from', 'moved and renamed from', 'moved and renamed to',
    'extracted from', 'moved from', 'inlined from', 'renamed from',
    'moved to', 'renamed to', 'inlined to', 'merged into', 'split into',
    'pulled up to', 'pushed down to',
    'from class', 'from method', 'from package',
    'to class', 'to method', 'to package',
    'in class', 'in method', 'in package',
  ];

  // Break a RefactoringMiner description into readable clauses: each is a leading
  // connective phrase (empty for the first clause) plus the element it names.
  function describeClauses(text, type) {
    let s = (text || '').replace(/\s+/g, ' ').trim();
    if (type && s.toLowerCase().indexOf(type.toLowerCase()) === 0) s = s.slice(type.length).trim();
    if (!s) return [];
    const re = new RegExp('\\s+(' + DESC_CONNECTORS.map((c) => c.replace(/ /g, '\\s+')).join('|') + ')\\s+', 'ig');
    const marked = s.replace(re, (m, c) => '\n' + c + ' ');
    return marked.split('\n').map((seg) => seg.trim()).filter(Boolean).map((seg) => {
      const rel = DESC_CONNECTORS.find((c) => seg.toLowerCase().indexOf(c) === 0) || '';
      const code = (rel ? seg.slice(rel.length) : seg).replace(/^&\s*/, '').replace(/\s*&\s*$/, '').trim();
      return { rel, code };
    });
  }

  // The explanation card body: RefactoringMiner's description for the refactoring,
  // formatted one clause per line (or shown verbatim when it doesn't split).
  function buildDetail(row) {
    const frag = document.createDocumentFragment();
    const desc = (row.detail || '').replace(/\s+/g, ' ').trim();
    if (!desc) return frag;
    const clauses = describeClauses(desc, row.type);
    if (clauses.length <= 1) {
      const p = document.createElement('p');
      p.className = 'rmx-rp-desc';
      p.textContent = desc;
      frag.appendChild(p);
      return frag;
    }
    const list = document.createElement('div');
    list.className = 'rmx-rp-desclist';
    clauses.forEach((c) => {
      const line = document.createElement('div');
      line.className = 'rmx-rp-descline';
      if (c.rel) {
        const rel = document.createElement('span');
        rel.className = 'rmx-rp-rel';
        rel.textContent = c.rel + ' ';
        line.appendChild(rel);
      }
      const code = document.createElement('span');
      code.className = 'rmx-rp-codeel';
      code.textContent = c.code;
      line.appendChild(code);
      list.appendChild(line);
    });
    frag.appendChild(list);
    return frag;
  }

  // The files a refactoring touches, as chips. Null when the row carries no
  // location data (an older caller, or a refactoring with no locations at all).
  function fileChips(row) {
    const paths = row.files || [];
    if (!paths.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'rmx-rp-files';
    paths.forEach((p) => {
      const chip = document.createElement('span');
      chip.className = 'rmx-rp-file';
      // The basename is what identifies the file at a glance; the full path is
      // there on hover for the repos where two directories hold the same name.
      chip.textContent = p.split('/').pop() || p;
      chip.title = p;
      wrap.appendChild(chip);
    });
    return wrap;
  }

  // Every code element RefactoringMiner attached to the refactoring, one line
  // each: the side it's on, its own role in the refactoring ("original attribute
  // declaration"), the element itself, and where it lives. Clicking a line takes
  // you to that side specifically, rather than to the refactoring's default
  // landing spot — the point of listing them separately.
  function buildLocations(row) {
    const locs = row.locations || [];
    if (!locs.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'rmx-rp-locs';
    locs.forEach((l) => {
      const line = document.createElement('div');
      line.className = 'rmx-rp-loc';

      const side = document.createElement('span');
      side.className = 'rmx-rp-loc-side rmx-rp-' + (l.side === 'L' ? 'L' : 'R');
      side.textContent = l.side === 'L' ? 'L' : 'R';

      const bodyEl = document.createElement('div');
      bodyEl.className = 'rmx-rp-loc-body';
      if (l.codeElement) {
        const el = document.createElement('div');
        el.className = 'rmx-rp-loc-el';
        el.textContent = l.codeElement;
        bodyEl.appendChild(el);
      }
      const meta = document.createElement('div');
      meta.className = 'rmx-rp-loc-meta';
      if (l.role) meta.appendChild(document.createTextNode(l.role + ' · '));
      const kind = document.createElement('span');
      kind.className = 'rmx-rp-loc-kind';
      kind.textContent = (l.kind || '').toLowerCase().replace(/_/g, ' ');
      if (kind.textContent) {
        meta.appendChild(kind);
        meta.appendChild(document.createTextNode(' · '));
      }
      meta.appendChild(document.createTextNode(locWhere(l)));
      bodyEl.appendChild(meta);

      line.appendChild(side);
      line.appendChild(bodyEl);
      line.title = 'Go to ' + locWhere(l);
      line.addEventListener('click', (e) => {
        e.stopPropagation(); // the row's own click would jump to the other side
        focusAt(row.index, l.side, l.startLine);
      });
      wrap.appendChild(line);
    });
    return wrap;
  }

  function locWhere(l) {
    const file = (l.filePath || '').split('/').pop() || l.filePath || '';
    if (!l.startLine) return file;
    const lines = l.endLine && l.endLine !== l.startLine ? `${l.startLine}–${l.endLine}` : l.startLine;
    return `${file}:${lines}`;
  }

  function toggleDetail(item, force) {
    const open = force !== undefined ? force : !item.classList.contains('rmx-open');
    if (rpOpenItem && rpOpenItem !== item) {
      rpOpenItem.classList.remove('rmx-open');
      rpOpenItem.querySelector('.rmx-rp-info').setAttribute('aria-expanded', 'false');
    }
    item.classList.toggle('rmx-open', open);
    item.querySelector('.rmx-rp-info').setAttribute('aria-expanded', String(open));
    rpOpenItem = open ? item : null;
  }

  // Mark the report row of the current selection, so stepping in the navigator or
  // clicking a minimap tick highlights the matching row here too. Skipped when
  // the selection hasn't changed: with hundreds of rows, re-toggling them all
  // on every repaint frame was pure waste.
  let rpSyncSig = null;
  function syncReportRow() {
    const sig = selectedIndices.join(' ');
    if (sig === rpSyncSig) return;
    rpSyncSig = sig;
    Object.keys(rpItems).forEach((idx) => {
      rpItems[idx].classList.toggle('rmx-rp-cur', selectedIndices.indexOf(idx) !== -1);
    });
  }

  // Build the detailed level's type filter: an "all" master plus one checkbox per
  // refactoring type present, each carrying how many of that type there are.
  // Filtering is a view concern — it hides rows (and the navigator/minimap entries
  // that go with them) so you can step through one kind of refactoring at a time.
  // Nothing is un-analysed and nothing in the diff is un-tagged by it, so a
  // filtered-out line still lights up if you click it.
  function buildFilter(rows) {
    const bar = reportFilter();
    bar.textContent = '';
    if (panelView !== 'detailed' || !rows.length) return;

    const counts = new Map();
    rows.forEach((r) => counts.set(r.type, (counts.get(r.type) || 0) + 1));
    // Types that vanished with a re-analysis shouldn't stay latched off.
    hiddenTypes.forEach((t) => { if (!counts.has(t)) hiddenTypes.delete(t); });

    const chip = (label, count, checked, onToggle, extra) => {
      const wrap = document.createElement('label');
      wrap.className = 'rmx-rp-chk' + (extra ? ' ' + extra : '');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.addEventListener('change', () => onToggle(box.checked));
      const text = document.createElement('span');
      text.textContent = label;
      const n = document.createElement('span');
      n.className = 'rmx-rp-chk-n';
      n.textContent = count;
      wrap.appendChild(box);
      wrap.appendChild(text);
      wrap.appendChild(n);
      bar.appendChild(wrap);
      return box;
    };

    chip('All types', rows.length, hiddenTypes.size === 0, (on) => {
      hiddenTypes = on ? new Set() : new Set(counts.keys());
      showReport(rows);
    }, 'rmx-rp-chk-all');

    Array.from(counts.keys()).forEach((type) => {
      chip(type, counts.get(type), !hiddenTypes.has(type), (on) => {
        if (on) hiddenTypes.delete(type);
        else hiddenTypes.add(type);
        showReport(rows);
      });
    });
  }

  // `rows`: [{ index, type, summary, detail, description, files, locations }].
  // The last four are only drawn by the richer levels (see PANEL_VIEWS); a row
  // without them still renders, so an older caller degrades to the compact list.
  function showReport(rows) {
    lastRows = rows;
    const shown = rows.filter((r) => !hiddenTypes.has(r.type));
    reportTitle(shown.length, rows.length);
    setNav(shown); // navigator + minimap follow the filter, in feed order
    buildFilter(rows);
    rpItems = {};
    rpOpenItem = null;
    const body = reportBody();
    if (!rows.length) {
      const msg = document.createElement('div');
      msg.className = 'rmx-rp-msg';
      msg.textContent = 'No refactorings found.';
      body.appendChild(msg);
      return;
    }
    if (!shown.length) {
      const msg = document.createElement('div');
      msg.className = 'rmx-rp-msg';
      msg.textContent = 'Every refactoring type is filtered out.';
      body.appendChild(msg);
      return;
    }
    rows = shown;
    rows.forEach((row, ordinal) => {
      const item = document.createElement('div');
      item.className = 'rmx-rp-item';

      const head = document.createElement('div');
      head.className = 'rmx-rp-row';

      const main = document.createElement('div');
      main.className = 'rmx-rp-main';
      main.title = row.summary;
      const type = document.createElement('div');
      type.className = 'rmx-rp-type';
      // The dock numbers its cards, so a refactoring can be referred to by
      // position while the list is filtered down.
      const num = document.createElement('span');
      num.className = 'rmx-rp-num';
      num.textContent = ordinal + 1 + '.';
      type.appendChild(num);
      type.appendChild(document.createTextNode(row.type));
      const sum = document.createElement('div');
      sum.className = 'rmx-rp-sum';
      sum.textContent = row.summary;
      main.appendChild(type);
      main.appendChild(sum);
      // The richer levels put RefactoringMiner's whole sentence on the row. Built
      // for every level and revealed by CSS, so switching level never rebuilds
      // the DOM from data the panel might not have.
      const full = document.createElement('div');
      full.className = 'rmx-rp-full';
      full.textContent = row.description || row.detail || '';
      if (full.textContent) main.appendChild(full);
      const files = fileChips(row);
      if (files) main.appendChild(files);
      // reveal → blink → centre (shared with the navigator and minimap), and
      // open this row so its summary + explanation appear on the same click.
      main.addEventListener('click', () => { focus(row.index); toggleDetail(item, true); });

      const info = document.createElement('button');
      info.className = 'rmx-rp-info';
      info.type = 'button';
      info.title = 'Show explanation';
      info.setAttribute('aria-label', 'Show explanation');
      info.setAttribute('aria-expanded', 'false');
      info.innerHTML = '<span class="rmx-rp-info-caret">▾</span>';
      info.addEventListener('click', (e) => { e.stopPropagation(); toggleDetail(item); });

      head.appendChild(main);
      head.appendChild(info);

      const detail = document.createElement('div');
      detail.className = 'rmx-rp-detail';
      detail.appendChild(buildDetail(row));

      item.appendChild(head);
      item.appendChild(detail);
      const locs = buildLocations(row);
      if (locs) item.appendChild(locs);
      body.appendChild(item);
      rpItems[String(row.index)] = item;
    });
    rpSyncSig = null; // fresh rows carry no current-row mark yet, so force a sync
    syncReportRow();
  }

  function hideReport() {
    if (reportEl) {
      reportEl.remove();
      reportEl = null;
    }
    rpItems = {};
    rpOpenItem = null;
    lastRows = null;
    // The filter describes one page's refactorings, so it doesn't survive to the
    // next one — a type hidden on this PR shouldn't silently hide rows on another.
    hiddenTypes = new Set();
    document.documentElement.style.setProperty('--rmx-dock-h', '0px');
    teardownFocusUI();
  }

  return {
    ensureStyle, clearAll, setPlan, paintAll, installTooltip,
    select, applySelection, clearSelection, scrollToRefactoring, setTargets, setRepaint,
    showReport, reportLoading, reportError, hideReport, setPanelView,
  };
})();
