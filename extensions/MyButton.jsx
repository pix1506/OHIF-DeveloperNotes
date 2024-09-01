// extensions/MyButton.jsx

import React from 'react';

const MyButton = () => {
  const handleClick = () => {
    alert('Button clicked!');
  };

  return (
    <button onClick={handleClick} style={{ padding: '5px 10px', margin: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}>
      Click Me
    </button>
  );
};

export default MyButton;
