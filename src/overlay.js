var RMX = window.RMX || (window.RMX = {});

// View-agnostic renderer: it only knows how to colour a line range, show a
// tooltip, and scroll to a refactoring. It never reaches into page structure
// itself — it goes through RMX.github — so the same renderer serves every view
// adapter.
RMX.overlay = (function () {
  const CLASS = 'rmx-hl';
  const TIP = 'rmx-tip';
  const FLASH = 'rmx-flash';

  function ensureStyle() {
    if (document.getElementById('rmx-style')) return;
    const s = document.createElement('style');
    s.id = 'rmx-style';
    s.textContent = `
      .${CLASS} { background: rgba(255,213,0,.16) !important; }
      .${CLASS}[data-rmx-side="L"] { box-shadow: inset 3px 0 0 #cf222e; }
      .${CLASS}[data-rmx-side="R"] { box-shadow: inset 3px 0 0 #1a7f37; }
      .${TIP} { position: absolute; z-index: 2147483647; max-width: 420px;
                white-space: pre-wrap; background: #1f2328; color: #fff;
                padding: 6px 9px; border-radius: 6px; pointer-events: none;
                font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                opacity: 0; transition: opacity .08s; }
      .${FLASH} { animation: rmx-flash 1.1s ease-out 2; }
      @keyframes rmx-flash { 0%,100% { background: transparent; } 50% { background: rgba(255,213,0,.5); } }
    `;
    document.head.appendChild(s);
  }

  function clearAll() {
    document.querySelectorAll('.' + CLASS).forEach((el) => {
      el.classList.remove(CLASS, FLASH);
      el.removeAttribute('data-rmx-side');
      el.removeAttribute('data-rmx-desc');
      el.removeAttribute('data-rmx-index');
    });
  }

  // Highlight every line in [startLine,endLine] for one side of one file.
  // A row touched by multiple refactorings accumulates their labels/indices.
  // Returns how many lines were actually found in the DOM.
  function highlightRange({ anchor, side, startLine, endLine, label, index }) {
    let painted = 0;
    for (let line = startLine; line <= endLine; line++) {
      const row = RMX.github.rowFor(RMX.github.lineCell(anchor, side, line));
      if (!row) continue;
      row.classList.add(CLASS);
      row.setAttribute('data-rmx-side', side);
      append(row, 'data-rmx-desc', label, '\n');
      append(row, 'data-rmx-index', String(index), ' ');
      painted++;
    }
    return painted;
  }

  function append(el, attr, value, sep) {
    const prev = el.getAttribute(attr);
    el.setAttribute(attr, prev ? prev + sep + value : value);
  }

  // A single delegated tooltip shared by all highlighted rows.
  function installTooltip() {
    ensureStyle();
    if (window.__rmxTip) return;
    const tip = document.createElement('div');
    tip.className = TIP;
    document.body.appendChild(tip);
    window.__rmxTip = tip;
    document.addEventListener('mouseover', (e) => {
      const row = e.target.closest && e.target.closest('.' + CLASS);
      if (!row) {
        tip.style.opacity = 0;
        return;
      }
      tip.textContent = row.getAttribute('data-rmx-desc') || '';
      const r = row.getBoundingClientRect();
      tip.style.top = window.scrollY + r.top - tip.offsetHeight - 6 + 'px';
      tip.style.left = window.scrollX + r.left + 'px';
      tip.style.opacity = 1;
    });
  }

  // Scroll to and flash a refactoring by its feed index (for ?rm= deep links).
  function scrollToRefactoring(index) {
    const row = document.querySelector(`.${CLASS}[data-rmx-index~="${index}"]`);
    if (!row) return false;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add(FLASH);
    setTimeout(() => row.classList.remove(FLASH), 2400);
    return true;
  }

  return { ensureStyle, clearAll, highlightRange, installTooltip, scrollToRefactoring };
})();
