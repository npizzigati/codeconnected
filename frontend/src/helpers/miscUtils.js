'use strict';

function handlePointerDown (ev, callback, ...args) {
  // Do nothing if this is a mouse click and not button 0 (left click)
  if (ev.pointerType === 'mouse' && ev.button !== 0) {
    return;
  }
  callback(...args);
}

export { handlePointerDown };
