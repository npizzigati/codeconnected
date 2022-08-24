'use strict';

import React from 'react';

function PopupDialog ({ config }) {
  return (
    <>
      <div className='backdrop' onPointerDown={config.abortCallback} />
      <div className='popup-dialog'>
        <div className='media'>
          <div className='media__image-container'>
            <img
              className='media__image media__image--small'
              src={config.message.icon.path}
              alt={config.message.icon.alt}
            />
          </div>
          <div className='media__text media__text--constrained'>
            <div>
              <span className='popup-dialog__text'>
                {config.message.text}
              </span>
            </div>
          </div>
        </div>
        <div className='aligned-block'>
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
        onPointerDown={option.callback}
      >
        <div className='aligned-block__cell u-right-align-text'>
          <img
            className='aligned-block__image aligned-block__image--tinier'
            src={option.icon.path}
            alt={option.icon.alt}
          />
        </div>
        <div className='aligned-block__cell u-pad-left-2 u-pad-top-1'>
          <span className='popup-dialog__text popup-dialog__text--small u-pad-right-1'>
            {option.text}
          </span>
        </div>
      </div>
    );
    return optionRows;
  }
}

export { PopupDialog as default };
