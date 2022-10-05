'use strict';

import React from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function PopupDialog ({ config }) {
  return (
    <>
      <div
        className='backdrop'
        onPointerDown={(ev) => config.abortCallback && handlePointerDown(ev, config.abortCallback, ev)}
      />
      <div className={'popup-dialog' + ((config.theme === 'dark') ? ' popup-dialog--dark' : '')}>
        <div className='media'>
          <div className='media__image-container'>
            <img
              className='media__image media__image--small'
              src={config.message.icon.path}
              alt={config.message.icon.alt}
            />
          </div>
          <div className='media__text media__text--constrained'>
            <span className='popup-dialog__heading-text'>
              {config.message.text}
            </span>
          </div>
        </div>
        <div className='aligned-block u-pad-left-12'>
          {buildOptionRows()}
        </div>
      </div>
    </>
  );

  function buildOptionRows () {
    const optionRows = config.options.map(option =>
      <div
        key={option.number}
        className='aligned-block__row aligned-block__row--clickable'
        onPointerDown={(ev) => handlePointerDown(ev, option.callback, ev)}
      >
        <div className='aligned-block__cell u-right-align-text'>
          <img
            className='aligned-block__image aligned-block__image--tinier'
            src={option.icon.path}
            alt={option.icon.alt}
          />
        </div>
        <div className='aligned-block__cell u-pad-left-2 u-pad-top-1'>
          <span className='popup-dialog__option-text u-pad-right-1'>
            {option.text}
          </span>
        </div>
      </div>
    );
    return optionRows;
  }
}

export { PopupDialog as default };
