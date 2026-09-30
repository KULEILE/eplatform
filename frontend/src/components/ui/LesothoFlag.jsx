import React from 'react';

/** A simplified, stylised rendering of the Lesotho national flag — used decoratively in the
 *  header and hero banner. Not a precise heraldic reproduction. */
export default function LesothoFlag({ className = 'h-5 w-8' }) {
  return (
    <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Flag of Lesotho">
      <rect width="30" height="20" fill="#ffffff" />
      <rect width="30" height="5.5" fill="#00209f" />
      <rect y="14.5" width="30" height="5.5" fill="#009543" />
      <path d="M15 7.2 L18.2 12.6 H11.8 Z" fill="#1a1a1a" />
      <rect x="14.3" y="6.2" width="1.4" height="1.4" fill="#1a1a1a" />
    </svg>
  );
}
