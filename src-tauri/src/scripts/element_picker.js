(function() {
  'use strict';

  const MAX_HTML_LENGTH = 50000;
  const HIGHLIGHT_COLOR = 'rgba(59, 130, 246, 0.3)';
  const HIGHLIGHT_BORDER = '2px solid rgb(59, 130, 246)';

  if (window.__schaltwerk_element_picker) {
    window.__schaltwerk_element_picker.enable();
    return;
  }

  let enabled = false;
  let highlightOverlay = null;
  let currentElement = null;

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = '__schaltwerk_picker_overlay';
    overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      background: ${HIGHLIGHT_COLOR};
      border: ${HIGHLIGHT_BORDER};
      box-sizing: border-box;
      transition: all 0.1s ease;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateOverlay(element) {
    if (!highlightOverlay) return;
    if (!element) {
      highlightOverlay.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();
    highlightOverlay.style.display = 'block';
    highlightOverlay.style.left = rect.left + 'px';
    highlightOverlay.style.top = rect.top + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
  }

  function getOuterHTML(element) {
    let html = element.outerHTML;
    if (html.length > MAX_HTML_LENGTH) {
      html = html.substring(0, MAX_HTML_LENGTH) +
        '\n<!-- ... truncated (' + (html.length - MAX_HTML_LENGTH) + ' more bytes) -->';
    }
    return html;
  }

  function handleMouseMove(event) {
    if (!enabled) return;
    const target = event.target;
    if (target === highlightOverlay) return;
    if (target.id === '__schaltwerk_picker_overlay') return;

    currentElement = target;
    updateOverlay(target);
  }

  function handleClick(event) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const target = currentElement || event.target;
    if (!target || target === highlightOverlay) return;

    const html = getOuterHTML(target);

    var encoded = btoa(unescape(encodeURIComponent(html)));
    window.location.hash = '__schaltwerk_picked=' + encoded;

    disable();
    return false;
  }

  function enable() {
    if (enabled) return;
    enabled = true;

    if (!highlightOverlay) {
      highlightOverlay = createOverlay();
    }
    highlightOverlay.style.display = 'none';

    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);

    document.body.style.cursor = 'crosshair';
  }

  function disable() {
    if (!enabled) return;
    enabled = false;

    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);

    if (highlightOverlay) {
      highlightOverlay.style.display = 'none';
    }
    currentElement = null;
    document.body.style.cursor = '';
  }

  window.__schaltwerk_element_picker = {
    enable: enable,
    disable: disable,
    isEnabled: function() { return enabled; }
  };

  enable();
})();
