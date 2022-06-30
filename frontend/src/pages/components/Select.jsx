'use strict';

import React, { useState, useRef, useEffect } from 'react';

function Select ({ options, title, callback, config }) {
  const dropdown = useRef(null);
  const button = useRef(null);
  const arrow = useRef(null);
  const titlePart = useRef(null);
  const [displayDropdown, setDisplayDropdown] = useState(false);
  const downArrow = '▼';

  useEffect(() => {
    document.addEventListener('pointerdown', (ev) => {
      if (ev.target !== titlePart.current && ev.target !== arrow.current) {
        console.log('outside');
        hideDropdown();
      }
    });
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
    dropdown.current.className = 'select-dropdown-hidden';
    arrow.current.className = 'select-arrow-down';
    console.log(arrow);
  }

  function showDropdown () {
    setDisplayDropdown(true);
    dropdown.current.className = 'select-dropdown';
    arrow.current.className = 'select-arrow-up';
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
          onPointerDown={toggleDropdown}
        >
          <div ref={titlePart} className='select-title'>{title}</div>
          <div ref={arrow} className='select-arrow-down'>{downArrow}</div>
        </div>
        <div
          ref={dropdown}
          className='select-dropdown-hidden'
        >
          {options.map((option, index) => (
            <div
              key={index}
              className='select-dropdown-item'
              onPointerDown={ev => handleSelect(ev, callback)}
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
