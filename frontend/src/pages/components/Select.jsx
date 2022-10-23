'use strict';

import React, { useState, useRef, useEffect, forwardRef } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

const Select = forwardRef(SelectFunc);

function SelectFunc ({ enabled, options, title, callback, config, className }, ref) {
  const dropdown = useRef(null);
  const button = useRef(null);
  const titlePart = useRef(null);
  const [displayDropdown, setDisplayDropdown] = useState(false);
  const arrow = useRef(null);
  const titleImageRef = useRef(null);

  useEffect(() => {
    document.addEventListener('pointerdown', (ev) => {
      if (ev.target !== titlePart.current && ev.target !== arrow.current && ev.target !== titleImageRef.current) {
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
      dropdown.current.classList.add('hidden');
    }
  }

  function showDropdown () {
    setDisplayDropdown(true);
    dropdown.current.classList.remove('hidden');
  }

  function toggleDropdown () {
    if (!enabled) {
      return;
    }
    if (displayDropdown) {
      hideDropdown();
    } else {
      showDropdown();
    }
  }

  return (
    <>
      <div className={'select' + (className === undefined ? '' : ` ${className}`)} ref={ref}>
        <div
          className={enabled ? 'select-button' : 'select-button disabled'}
          ref={button}
          onPointerDown={(ev) => handlePointerDown(ev, toggleDropdown, ev)}
        >
          {title === undefined
            ? <img className='select__title-image' ref={titleImageRef} src={config.titleImage} alt='title image' />
            : <div ref={titlePart} className='select-title'>{title}</div>}
          {title !== undefined &&
            <img className='select__expand-icon' ref={arrow} src='./images/expand_more.png' alt='expand icon' />}
        </div>
        <div
          ref={dropdown}
          className='select-dropdown hidden'
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
