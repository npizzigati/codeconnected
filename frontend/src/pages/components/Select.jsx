'use strict';

import React, { useState, useRef, useEffect } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function Select ({ options, title, callback, config }) {
  const dropdown = useRef(null);
  const button = useRef(null);
  const titlePart = useRef(null);
  const [displayDropdown, setDisplayDropdown] = useState(false);
  const arrow = useRef(null);

  useEffect(() => {
    document.addEventListener('pointerdown', (ev) => {
      if (ev.target !== titlePart.current && ev.target !== arrow.current) {
        hideDropdown();
      }
    });

    // If escape key custom event fires, close this component's modal dialog
    document.addEventListener('escapePressed', hideDropdown);
  }, []);

  function handleSelect (ev, callback) {
    const label = ev.target.dataset.label;
    if (config.staticTitle === false) {
      titlePart.current.innerText = label;
    }
    callback(ev);
  }

  function hideDropdown () {
    setDisplayDropdown(false);
    if (dropdown.current) {
      dropdown.current.className = 'select-dropdown--hidden';
    }
  }

  function showDropdown () {
    setDisplayDropdown(true);
    dropdown.current.className = 'select-dropdown';
  }

  function toggleDropdown () {
    if (displayDropdown) {
      hideDropdown();
    } else {
      showDropdown();
    }
  }

  return (
    <>
      <div className='select'>
        <div
          className='select-button'
          ref={button}
          onPointerDown={(ev) => handlePointerDown(ev, toggleDropdown, ev)}
        >
          <div ref={titlePart} className='select-title'>{title}</div>
          <img className='select__expand-icon' ref={arrow} src='./images/expand_more.png' alt='expand icon' />
        </div>
        <div
          ref={dropdown}
          className='select-dropdown--hidden'
        >
          {options.map((option, index) => (
            <div
              key={index}
              className='select-dropdown__item'
              onPointerDown={(ev) => handlePointerDown(ev, handleSelect, ev, callback)}
              data-value={option.value}
              data-label={option.label}
            >
              {option.label}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export { Select as default };
