import React from 'react';

/**
 * Decorative hero background: a layered Maluti-mountains silhouette, echoing the reference
 * design's photographic hero without depending on an external image asset (keeps the prototype
 * fully self-contained and offline-safe).
 *
 * This full-bleed layer uses preserveAspectRatio="slice", which crops from the top on a hero
 * that is proportionally shorter than the viewBox (the Dashboard hero is much shorter than the
 * Landing hero). That's fine for a mountain range — losing a sliver off the top few peaks reads
 * as "closer to the mountains", not as a bug — but it is NOT safe for anything that must stay
 * fully visible and correctly proportioned (like a flag). That content lives in the separate
 * <FlagOnPole> component instead, sized in real pixels so it is never clipped or squashed.
 *
 * Purely decorative: aria-hidden, absolutely positioned behind the hero content.
 */
export function HeroBackdrop({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 420"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      {/* far mountain range */}
      <path
        d="M0,260 L120,190 L230,245 L340,160 L460,235 L560,175 L660,240 L780,150 L900,230 L1020,175 L1140,235 L1260,185 L1380,245 L1440,210 L1440,420 L0,420 Z"
        fill="#13315c"
        opacity="0.55"
      />
      {/* mid mountain range (the classic Basotho-hat silhouette) */}
      <path
        d="M0,340 L100,300 L190,330 L300,235 L340,255 L400,175 L470,255 L520,230 L610,320 L700,270 L760,300 L860,225 L930,290 L1010,255 L1080,320 L1180,270 L1260,310 L1360,265 L1440,300 L1440,420 L0,420 Z"
        fill="#0b2545"
        opacity="0.85"
      />
      {/* near foothills */}
      <path
        d="M0,395 L140,360 L260,390 L400,345 L540,385 L680,350 L820,392 L960,355 L1100,390 L1240,358 L1380,392 L1440,375 L1440,420 L0,420 Z"
        fill="#081a33"
      />
    </svg>
  );
}

/**
 * Flag on a pole, sized in real CSS pixels (not viewBox units) so it always renders at its
 * correct proportions and is never cropped by a hero section whose height varies by page —
 * unlike a full-bleed "slice" background, a flag looks broken with even a little clipped off.
 * Defaults to a size that fits the shortest hero variant in this app (~150px tall); pass a
 * larger `className` height on taller heroes if desired.
 */
export function FlagOnPole({ className = 'h-28 w-20 sm:h-32 sm:w-24' }) {
  return (
    <svg viewBox="0 0 100 140" className={className} aria-hidden="true" focusable="false">
      <line x1="8" y1="4" x2="8" y2="140" stroke="#cbd5e1" strokeWidth="2.5" opacity="0.85" />
      <circle cx="8" cy="3" r="3.5" fill="#d4af5a" />
      <g transform="translate(8,10)">
        <path d="M0,0 L92,5 L92,24 L0,19 Z" fill="#00209f" />
        <path d="M0,19 L92,24 L92,52 L0,47 Z" fill="#ffffff" />
        <path d="M0,47 L92,52 L92,71 L0,66 Z" fill="#009543" />
        <path d="M38,21 C43,14 51,14 56,21 L59,31 L35,31 Z" fill="#0a0a0a" opacity="0.9" />
      </g>
    </svg>
  );
}

export default HeroBackdrop;
