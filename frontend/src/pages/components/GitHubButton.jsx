'use strict';

import React from 'react';

function GitHubButton ({ link }) {
  return (
    <a className='media media--button github-button' href={link}>
      <div className='media__image-container'>
        <img className='media__image media__image--nano' src='./images/github.png' alt='Logo' />
      </div>
      <div className='media__text'>
        <div>
          <span>View on GitHub</span>
        </div>
      </div>
    </a>
  );
}

export { GitHubButton as default };
