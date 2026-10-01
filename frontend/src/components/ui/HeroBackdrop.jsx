import React from 'react';

/**
 * Decorative hero background — a real photo instead of a drawn mountain silhouette.
 *
 * Save your chosen photo as: frontend/public/images/hero-background.jpg
 * (Any wide, landscape-oriented photo works well — Maluti mountains, a government building,
 * Maseru skyline, etc. The dark overlay on top keeps the white hero text readable no matter
 * how bright the photo is.)
 *
 * Purely decorative: aria-hidden, absolutely positioned behind the hero content. The caller
 * supplies the full absolute-positioning className (e.g. "absolute inset-0 h-full w-full"),
 * which also makes this element the positioning context for the overlay below.
 */
export function HeroBackdrop({ className = '' }) {
  return (
    <div className={`${className} overflow-hidden`} aria-hidden="true">
      <img src="/images/hero-background.jpg" alt="" className="h-full w-full object-cover" />
      {/* Dark overlay so the white hero title/search box/buttons stay readable over any photo. */}
      <div className="absolute inset-0 bg-gov-navy/70" />
    </div>
  );
}

/**
 * Flag on a pole. The pole and finial stay simple shapes (there's nothing unpolished about a
 * plain pole) — the flag itself is the same real image used everywhere else, see LesothoFlag.jsx.
 */
export function FlagOnPole({ className = 'h-28 w-20 sm:h-32 sm:w-24' }) {
  // Note: deliberately NOT prefixing a hardcoded "relative" here. The caller always passes
  // "absolute ..." in className, and position:absolute on its own already gives this element's
  // children a valid positioning anchor. Adding a redundant "relative" class would conflict with
  // the caller's "absolute" (same CSS property, and Tailwind's compiled stylesheet orders
  // .relative after .absolute, so .relative would silently win) and knock this out of its
  // intended bottom-right position.
  return (
    <div className={className} aria-hidden="true">
      {/* pole */}
      <div className="absolute left-[10%] top-0 h-full w-[4%] rounded-full bg-slate-300/85" />
      {/* finial */}
      <div className="absolute left-[10%] top-0 h-[7%] w-[7%] -translate-x-1/3 -translate-y-1/2 rounded-full bg-gov-goldLight" />
      {/* flag */}
      <img
        src="/images/lesotho-flag.png"
        alt=""
        className="absolute left-[13%] top-[8%] h-[45%] w-[85%] object-cover shadow-sm"
      />
    </div>
  );
}

export default HeroBackdrop;