import './TechinsIcon.css';

/**
 * TECHINS Custom Icon System
 * Cohesive SVG icon set with glow effect
 * 24px grid, 1.75px stroke, rounded joins, duotone fill
 */

const icons = {
  trophy: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 21h8M12 17v4M6 3h12a1 1 0 011 1v4a4 4 0 01-4 4h-2a4 4 0 01-4-4V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-stroke"/>
      <path d="M6 6H4a1 1 0 00-1 1v1a2 2 0 002 2h1M18 6h2a1 1 0 011 1v1a2 2 0 01-2 2h-1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-stroke"/>
      <circle cx="12" cy="3" r="1" fill="currentColor" className="icon-accent"/>
      <path d="M10 13l-1 4h6l-1-4" fill="currentColor" opacity="0.15" className="icon-fill"/>
    </svg>
  ),
  
  chart: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 20h18M7 20V10M12 20V4M17 20v-8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-stroke"/>
      <path d="M6 12l5-5 4 4 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <circle cx="17" cy="6" r="1.5" fill="currentColor" className="icon-accent"/>
      <path d="M7 10h2v10H7z" fill="currentColor" opacity="0.12" className="icon-fill"/>
      <path d="M12 4h2v16h-2z" fill="currentColor" opacity="0.12" className="icon-fill"/>
    </svg>
  ),
  
  target: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <circle cx="12" cy="12" r="2" fill="currentColor" className="icon-accent"/>
      <path d="M18 6l4-4M22 2l-1 3-3 1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  clipboard: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="4" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M9 2h6a1 1 0 011 1v1H8V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="icon-stroke"/>
      <path d="M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-accent-stroke"/>
      <rect x="5" y="4" width="14" height="18" rx="2" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  clock: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <circle cx="12" cy="12" r="1" fill="currentColor" className="icon-accent"/>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  progress: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-accent-stroke"/>
      <circle cx="21" cy="12" r="1.5" fill="currentColor" className="icon-accent"/>
      <path d="M12 12V3a9 9 0 019 9z" fill="currentColor" opacity="0.15" className="icon-fill"/>
    </svg>
  ),
  
  search: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M15 15l6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-accent-stroke"/>
      <rect x="7" y="7" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1" opacity="0.4" className="icon-stroke"/>
      <circle cx="10" cy="10" r="7" fill="currentColor" opacity="0.06" className="icon-fill"/>
    </svg>
  ),
  
  check: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  notepad: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="4" width="12" height="17" rx="2" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M10 2v3M14 2v3M6 8h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-stroke"/>
      <path d="M16 13l-2 2-2-2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <rect x="6" y="4" width="12" height="17" rx="2" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  history: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 8v4l2 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <path d="M4 12a8 8 0 1115.4 3M3 8l1 4 4-1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-stroke"/>
      <circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  gauge: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 18a6 6 0 110-12 6 6 0 010 12z" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M12 12l3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-accent-stroke"/>
      <path d="M5 12H3M21 12h-2M12 5V3M12 21v-2M7.05 7.05L5.64 5.64M18.36 18.36l-1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" className="icon-stroke"/>
      <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.1" className="icon-fill"/>
    </svg>
  ),
  
  comment: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 12a9 9 0 01-9 9c-1.5 0-2.9-.4-4.2-1L3 21l1-4.8A9 9 0 1121 12z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="icon-stroke"/>
      <path d="M8 11l2 2 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <circle cx="16" cy="8" r="2" fill="currentColor" className="icon-accent"/>
      <path d="M21 12a9 9 0 01-9 9c-1.5 0-2.9-.4-4.2-1L3 21l1-4.8A9 9 0 1121 12z" fill="currentColor" opacity="0.06" className="icon-fill"/>
    </svg>
  ),
  
  strength: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2l2.5 6h6.5l-5 4 2 6-6-4.5L6 18l2-6-5-4h6.5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="icon-stroke"/>
      <path d="M12 8v6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-accent-stroke"/>
      <circle cx="12" cy="14" r="1.5" fill="currentColor" className="icon-accent"/>
      <path d="M12 2l2.5 6h6.5l-5 4 2 6-6-4.5L6 18l2-6-5-4h6.5z" fill="currentColor" opacity="0.12" className="icon-fill"/>
    </svg>
  ),
  
  improve: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M12 16V8m0 0l3 3m-3-3L9 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <circle cx="12" cy="8" r="1.5" fill="currentColor" className="icon-accent"/>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  stopwatch: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M12 9v4l3 2M10 3h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <path d="M17 6l1.5-1.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-stroke"/>
      <circle cx="12" cy="13" r="8" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  lock: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="11" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M8 11V7a4 4 0 118 0v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-stroke"/>
      <circle cx="12" cy="16" r="1.5" fill="currentColor" className="icon-accent"/>
      <rect x="5" y="11" width="14" height="11" rx="2" fill="currentColor" opacity="0.1" className="icon-fill"/>
    </svg>
  ),
  
  folder: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="icon-stroke"/>
      <path d="M3 11h18" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  user: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="icon-stroke"/>
      <circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.12" className="icon-fill"/>
      <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 12a9 9 0 11-9-9c2.5 0 4.75 1 6.4 2.6M21 3v6h-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.06" className="icon-fill"/>
    </svg>
  ),
  
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="icon-accent-stroke"/>
    </svg>
  ),
  
  home: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="icon-stroke"/>
      <path d="M9 22V12h6v10" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="icon-accent-stroke"/>
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" fill="currentColor" opacity="0.08" className="icon-fill"/>
    </svg>
  ),
  
  grid: (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.75" className="icon-stroke"/>
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.1" className="icon-fill"/>
    </svg>
  ),
};

export default function TechinsIcon({ 
  name, 
  size = 24, 
  variant = 'light',
  className = '',
  ariaLabel,
  ariaHidden = !ariaLabel,
}) {
  const icon = icons[name];
  
  if (!icon) {
    console.warn(`TechinsIcon: icon "${name}" not found`);
    return null;
  }

  return (
    <span 
      className={`techins-icon techins-icon--${variant} ${className}`}
      style={{ 
        width: size, 
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
      role={ariaLabel ? 'img' : undefined}
    >
      {icon}
    </span>
  );
}
