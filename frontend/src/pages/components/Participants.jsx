'use strict';

import React, { useState } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function Participants ({ participantNames }) {
  const [showNames, setShowNames] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <>
      <div
        className='participants-list'
        onPointerDown={ev => handlePointerDown(ev, toggleNames)}
        onPointerEnter={displayTooltip}
        onPointerLeave={hideTooltip}
      >
        {showNames
          ? <div>
              <span className='participants-list__label'>Participants: </span>
              <span className='participants-list__count'>{participantNames?.join(', ')}</span>
            </div>
          : <div>
              <span className='participants-list__label'>Participants: </span>
              <span className='participants-list__count'>{participantNames?.length}</span>
            </div>
        }
        {showTooltip &&
          <div className='tooltip'>
            <span className='tooltip__text'>Click to {showNames ? 'hide' : 'show'} names</span>
          </div>
        }
      </div>
    </>
  );

  function toggleNames () {
    setShowTooltip(false);
    setShowNames(!showNames);
  }

  function displayTooltip () {
    setShowTooltip(true);
  }

  function hideTooltip () {
    setShowTooltip(false);
  }
}

export { Participants as default };
