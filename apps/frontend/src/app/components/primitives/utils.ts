import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ThemeColors {
  borderColor: string;
  backgroundColor: string;
  color: string;
}

export function generateColors(hexColor: string): ThemeColors {
  // 1. Normalize and clean the hex string
  let hex = hexColor.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }

  // 2. Extract RGB values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Fallback check for invalid hex parsing
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { borderColor: '#000000', backgroundColor: '#ffffff', color: '#000000' };
  }

  // 3. Convert RGB to HSL
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h /= 6;
  }

  // Convert to degrees and percentages
  const hDeg = Math.round(h * 360);
  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);

  // 4. Smart Lightness Adjustments (Fixes clipping on extreme darks/lights)
  // Darken: drops the lightness by 15% absolute, but floors safely above 10%
  const borderLightness = Math.max(10, lPct - 15);
  
  // Lighten: if color is already light, it scales up gently instead of capping at pure white
  const bgLightness = lPct > 70 
    ? Math.min(98, lPct + (100 - lPct) * 0.5) 
    : Math.min(95, lPct + 35);

  // 5. Determine readable text color using W3C Relative Luminance
  const calcLuminance = (val: number): number => {
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * calcLuminance(rNorm) + 0.7152 * calcLuminance(gNorm) + 0.0722 * calcLuminance(bNorm);
  
  // If the background variant is going to be very bright, force dark text
  const bgLuminance = bgLightness > 70;
  const textColor = bgLuminance ? '#111111' : (luminance > 0.179 ? '#111111' : '#ffffff');

  return {
    borderColor: `hsl(${hDeg}, ${sPct}%, ${borderLightness}%)`,
    backgroundColor: `hsl(${hDeg}, ${sPct}%, ${bgLightness}%)`,
    color: textColor
  };
}