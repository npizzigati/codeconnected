'use strict';

const debounceTimeouts = {};

function handlePointerDown (ev, callback, ...args) {
  // Do nothing if this is a mouse click and not button 0 (left click)
  ev.preventDefault();
  if (ev.pointerType === 'mouse' && ev.button !== 0) {
    return;
  }
  callback(...args);
}

function debounce (callback, wait) {
  clearTimeout(debounceTimeouts[callback.toString()]);
  debounceTimeouts[callback.toString()] = setTimeout(() => {
    callback();
    // Remove property from debounceTimeouts
    delete debounceTimeouts[callback.toString()];
  }, wait);
}

function setupWindowResizeListener (callback) {
  // This resize observer will fire on resize except
  // changes in only body height
  const resizeObserver = new ResizeObserver((entries) => {
    entries.forEach(entry => {
      // Since the 'resize' event listener (below) fires for most
      // of the same events, we should debounce any expensive operations
      // (In that case, we should also debounce the callback
      // passed into that listener)
      callback();
    });
  });
  resizeObserver.observe(document.body);

  // This resize listener works for everything except iOS
  // mobile resizing
  window.addEventListener('resize', callback);
}

/**
  * Fix for 100vh not being actual inner-height on iOS devices,
  * which caused our supposedly fixed size screen to have to be
  * scrolled down
  */
function changeCSSInnerHeight () {
  document.documentElement.style.setProperty('--inner-height', `${window.innerHeight}px`);
}

export { handlePointerDown, debounce, setupWindowResizeListener, changeCSSInnerHeight };
