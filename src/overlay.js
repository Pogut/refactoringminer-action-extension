var RMX = window.RMX || (window.RMX = {});

// View-agnostic renderer: colour a line span in one of RefactoringMiner's
// legend categories, show a concise tooltip, and scroll to a refactoring. It
// reaches the DOM only through RMX.github, so the same renderer serves every
// view adapter.
RMX.overlay = (function () {
  const CLASS = 'rmx-hl';
  const TIP = 'rmx-tip';
  const FLASH = 'rmx-flash';

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
    `;
    document.head.appendChild(s);
  }

  function clearAll() {
    document.querySelectorAll('.' + CLASS).forEach((el) => {
      el.classList.remove(CLASS, FLASH);
      el.removeAttribute('data-rmx-cat');
      el.removeAttribute('data-rmx-desc');
      el.removeAttribute('data-rmx-index');
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
  function highlightRange({ digest, side, startLine, endLine, category, summary, index }) {
    let painted = 0;
    for (let line = startLine; line <= endLine; line++) {
      const cells = RMX.github.lineCells(digest, side, line);
      if (!cells.length) continue;
      cells.forEach((cell) => {
        cell.classList.add(CLASS);
        if (!cell.getAttribute('data-rmx-cat')) cell.setAttribute('data-rmx-cat', category);
        appendUnique(cell, 'data-rmx-desc', summary, '\n');
        appendUnique(cell, 'data-rmx-index', String(index), ' ');
      });
      painted++;
    }
    return painted;
  }

  // One delegated tooltip shared by all highlighted cells.
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

  return { ensureStyle, clearAll, highlightRange, installTooltip, showLegend, hideLegend, scrollToRefactoring };
})();
