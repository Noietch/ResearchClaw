/**
 * Global scroll position memory.
 * Saves scroll position per route when navigating away, restores on return.
 * Works for any scrollable container.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const scrollPositions = new Map<string, number>();

/**
 * Hook to save/restore scroll position of a container when route changes.
 * Attach the returned ref to the scrollable element.
 */
export function useScrollRestore<T extends HTMLElement>() {
  const location = useLocation();
  const ref = useRef<T>(null);
  const pathRef = useRef(location.pathname);

  // Save scroll position when route changes (before unmount)
  useEffect(() => {
    const prevPath = pathRef.current;
    pathRef.current = location.pathname;

    // Save previous route's scroll position
    if (ref.current && prevPath !== location.pathname) {
      scrollPositions.set(prevPath, ref.current.scrollTop);
    }

    // Restore scroll position for current route
    const saved = scrollPositions.get(location.pathname);
    if (ref.current && saved !== undefined) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        ref.current?.scrollTo({ top: saved });
      });
    }
  }, [location.pathname]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (ref.current) {
        scrollPositions.set(pathRef.current, ref.current.scrollTop);
      }
    };
  }, []);

  return ref;
}
