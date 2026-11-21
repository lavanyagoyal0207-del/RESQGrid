import React from 'react';

export default function FogOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {/* Subtle tactical coordinate grid texture */}
      <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:28px_28px] opacity-25" />
      {/* Subtle command center ambient horizon wash */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[350px] bg-sky-600/5 blur-[140px] rounded-full pointer-events-none" />
    </div>
  );
}
