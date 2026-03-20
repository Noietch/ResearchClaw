import { useState, useCallback } from 'react';

export type FitMode = 'fit-width' | 'fit-page' | 'custom';

const MIN_SCALE = 0.25;
const MAX_SCALE = 5.0;
const ZOOM_STEP = 0.2;

interface UsePdfViewportOptions {
  initialFitMode?: FitMode;
  initialCustomScale?: number;
}

interface UsePdfViewportResult {
  customScale: number;
  fitMode: FitMode;
  zoomIn: (currentScale: number) => void;
  zoomOut: (currentScale: number) => void;
  resetZoom: () => void;
  setFitMode: (mode: FitMode) => void;
  setCustomScale: (s: number) => void;
}

export function usePdfViewport(options?: UsePdfViewportOptions): UsePdfViewportResult {
  const [customScale, setCustomScaleRaw] = useState(options?.initialCustomScale ?? 1.0);
  const [fitMode, setFitMode] = useState<FitMode>(options?.initialFitMode ?? 'fit-width');

  const setCustomScale = useCallback((s: number) => {
    setCustomScaleRaw(Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)));
    setFitMode('custom');
  }, []);

  const zoomIn = useCallback((currentScale: number) => {
    const next = Math.min(MAX_SCALE, currentScale + ZOOM_STEP);
    setCustomScaleRaw(next);
    setFitMode('custom');
  }, []);

  const zoomOut = useCallback((currentScale: number) => {
    const next = Math.max(MIN_SCALE, currentScale - ZOOM_STEP);
    setCustomScaleRaw(next);
    setFitMode('custom');
  }, []);

  const resetZoom = useCallback(() => {
    setCustomScaleRaw(1.0);
    setFitMode('fit-width');
  }, []);

  return {
    customScale,
    fitMode,
    zoomIn,
    zoomOut,
    resetZoom,
    setFitMode,
    setCustomScale,
  };
}
