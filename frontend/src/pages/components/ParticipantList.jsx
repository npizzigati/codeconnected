'use strict';

import React from 'react';
import { handlePointerDown } from '../../helpers/miscUtils.js';

function ParticipantList ({ participantNames }) {
  return (
    <>
      <div className='participants-list'>
        <span className='participants-list__label'>Participants: </span>
        <span className='participants-list__count'>{participantNames?.length}</span>
      </div>
    </>
  );
}

export { ParticipantList as default };
