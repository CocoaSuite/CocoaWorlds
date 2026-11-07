/** Flat vector icons for base-building stages (single colour, no glow), by the names stages and prompts use. */
import type { JSX } from 'react';

const P: Record<string, JSX.Element> = {
  // A box with a plus: place a piece or an item.
  place: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  // A hammer: taps (driving posts, nailing).
  hammer: (
    <>
      <path d="M5 7h9l2 2v2h-4v-1H8L5 9z" fill="currentColor" />
      <rect x="10.5" y="11" width="3" height="10" rx="1" fill="currentColor" />
    </>
  ),
  // An open hand: hold E.
  hand: (
    <path d="M8 21v-9l-2-3a1.3 1.3 0 0 1 2-1.5L10 10V4.5a1.2 1.2 0 0 1 2.4 0V10V3.5a1.2 1.2 0 0 1 2.4 0V10V5a1.2 1.2 0 0 1 2.4 0v7.5c0 4-2 8.5-6 8.5z" fill="currentColor" />
  ),
  // A tipped bucket: pour.
  bucket: (
    <>
      <path d="M4 8h12l-1.5 11h-9z" fill="currentColor" />
      <path d="M16 10l3 2-1 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 8a5 4 0 0 1 10 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  // A clock: wait (curing).
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  // A bolt: slide to lock.
  bolt: (
    <>
      <rect x="3" y="10" width="13" height="4" rx="1" fill="currentColor" />
      <rect x="15" y="7" width="6" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="8" y="6" width="3" height="5" fill="currentColor" />
    </>
  ),
  // A chair: the wedge.
  chair: (
    <path d="M7 3h2v8h7v2H9v8H7zM14 13h2v8h-2zM9 13h2" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
  ),
  // A door ajar, and shut.
  open: (
    <>
      <rect x="5" y="3" width="12" height="18" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M5 3l7 3v17l-7-2z" fill="currentColor" />
    </>
  ),
  close: (
    <>
      <rect x="5" y="3" width="12" height="18" fill="currentColor" />
      <circle cx="14" cy="12" r="1.2" fill="#1a1a1a" />
    </>
  ),
};

export function BuildIcon({ name }: { name: string }) {
  return (
    <svg className="cw-build-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      {P[name] ?? P.hand}
    </svg>
  );
}
