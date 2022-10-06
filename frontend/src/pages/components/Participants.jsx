'use strict';

import React, { useState } from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function Participants ({ participantNames }) {
  const [showNames, setShowNames] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className='participants-list__container'
      onPointerDown={ev => handlePointerDown(ev, toggleNames)}
      onPointerEnter={displayTooltip}
      onPointerLeave={hideTooltip}
    >
      {showNames
        ? <div className='participants-list'>
            <span className='participants-list__label'>Participants: </span>
            <span className='participants-list__names'>{participantNames?.join(', ')}</span>
          </div>
        : <div className='participants-list'>
            <span className='participants-list__label'>Participants: </span>
            <span>{participantNames?.length}</span>
          </div>
      }
      {showTooltip && !showNames &&
        <div className='tooltip'>
          <span className='tooltip__text'>Click to show names</span>
        </div>
      }
    </div>
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
