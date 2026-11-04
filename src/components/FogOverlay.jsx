import React from 'react';

export default function FogOverlay({ isOperational = false }) {
  return (
    <div
      aria-hidden="true"
      className="rq-atmosphere pointer-events-none fixed inset-0 z-10 overflow-hidden select-none"
    >
      {isOperational && (
        <>
          <div className="rq-atmosphere-moon" />
          <div className="rq-atmosphere-ridge" />
          <div className="rq-atmosphere-forest" />
          <div className="rq-atmosphere-city" />
        </>
      )}
      <div
        className="rq-atmosphere-glow"
      />
      <div className="rq-atmosphere-fog rq-atmosphere-fog-low" />
      <div className="rq-atmosphere-fog rq-atmosphere-fog-high" />
    </div>
  );
}
