import React from 'react';

export default function FogOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none"
    >
      {/* Layer 1: Atmospheric Violet-Slate Mist */}
      <div
        className="absolute -inset-24 animate-fog opacity-[0.12]"
        style={{
          background:
            'radial-gradient(ellipse 65% 45% at 22% 28%, rgba(92, 56, 148, 0.26), transparent 70%), radial-gradient(ellipse 55% 40% at 78% 72%, rgba(255, 107, 53, 0.08), transparent 65%)',
          filter: 'blur(36px)',
        }}
      />
      {/* Layer 2: Slow Counter-Drifting Night Control Room Haze */}
      <div
        className="absolute -inset-28 animate-fogSlow opacity-[0.09]"
        style={{
          background:
            'radial-gradient(circle at 60% 18%, rgba(139, 92, 246, 0.16), transparent 60%), radial-gradient(ellipse 75% 35% at 40% 85%, rgba(45, 27, 78, 0.45), transparent 75%)',
          filter: 'blur(48px)',
        }}
      />
      {/* Subtle Tactical Grid Overlay */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.4) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
    </div>
  );
}
