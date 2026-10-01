import React from 'react';

/**
 * Flag of Lesotho — rendered from a downloaded image file rather than hand-drawn shapes, so it
 * reads as the real flag everywhere it's used (header, footer, hero banners, certificates).
 *
 * Save your flag image as: frontend/public/images/lesotho-flag.png
 * (The filename must match exactly. PNG works well since it can have a clean/transparent edge,
 * but any image format is fine as long as you save it under that exact name.)
 */
export default function LesothoFlag({ className = 'h-5 w-8' }) {
  return (
    <img
      src="/images/lesotho-flag.png"
      alt="Flag of Lesotho"
      className={`object-cover ${className}`}
    />
  );
}