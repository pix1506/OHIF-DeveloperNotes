import React from 'react';

const BrightnessButton = ({ onClick }) => (
  <button onClick={onClick} style={{ position: 'absolute', top: 10, right: 10 }}>
    Adjust Brightness
  </button>
);

export default BrightnessButton;
