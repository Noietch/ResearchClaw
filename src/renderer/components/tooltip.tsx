import {
  type ReactNode,
  type ReactElement,
  useState,
  useRef,
  useEffect,
  useCallback,
  cloneElement,
  isValidElement,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number; // delay in ms, default 0 (immediate)
}

/**
 * Tooltip that uses a portal — does NOT insert any wrapper div around children,
 * so it never breaks flex/grid layout. Attaches mouse events via cloneElement.
 */
export function Tooltip({ content, children, position = 'top', delay = 0 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const show = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setCoords({
          x: rect.left + rect.width / 2,
          y: position === 'top' ? rect.top : rect.bottom,
        });
      }
      setIsVisible(true);
    };
    if (delay > 0) {
      timeoutRef.current = setTimeout(show, delay);
    } else {
      show();
    }
  }, [delay, position]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Clone the single child element and attach ref + mouse events
  if (!isValidElement(children)) {
    return <>{children}</>;
  }

  const child = children as ReactElement<Record<string, unknown>>;

  const cloned = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      // Forward existing ref if any
      const existingRef = (child as { ref?: unknown }).ref;
      if (typeof existingRef === 'function') existingRef(node);
      else if (existingRef && typeof existingRef === 'object' && 'current' in existingRef) {
        (existingRef as { current: HTMLElement | null }).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      showTooltip();
      if (typeof child.props.onMouseEnter === 'function') {
        (child.props.onMouseEnter as (e: React.MouseEvent) => void)(e);
      }
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hideTooltip();
      if (typeof child.props.onMouseLeave === 'function') {
        (child.props.onMouseLeave as (e: React.MouseEvent) => void)(e);
      }
    },
  } as Record<string, unknown>);

  return (
    <>
      {cloned}
      {createPortal(
        <AnimatePresence>
          {isVisible && coords && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg"
              style={{
                left: coords.x,
                top: position === 'top' ? coords.y - 8 : coords.y + 8,
                transform: `translateX(-50%) ${position === 'top' ? 'translateY(-100%)' : ''}`,
              }}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
