/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePdfViewport } from '../../src/renderer/components/pdf/use-pdf-viewport';

describe('usePdfViewport', () => {
  it('initializes with fit-width mode and scale 1.0', () => {
    const { result } = renderHook(() => usePdfViewport());
    expect(result.current.fitMode).toBe('fit-width');
    expect(result.current.customScale).toBe(1.0);
  });

  it('restores initial custom scale and fit mode', () => {
    const { result } = renderHook(() =>
      usePdfViewport({ initialFitMode: 'custom', initialCustomScale: 1.67 }),
    );
    expect(result.current.fitMode).toBe('custom');
    expect(result.current.customScale).toBe(1.67);
  });

  it('zoomIn increases scale from current actual value', () => {
    const { result } = renderHook(() => usePdfViewport());
    // Simulate: fit-width computed actualScale = 1.47, user clicks zoom in
    act(() => result.current.zoomIn(1.47));
    expect(result.current.fitMode).toBe('custom');
    expect(result.current.customScale).toBeCloseTo(1.67, 1);
  });

  it('zoomOut decreases scale from current actual value', () => {
    const { result } = renderHook(() => usePdfViewport());
    act(() => result.current.zoomOut(1.47));
    expect(result.current.fitMode).toBe('custom');
    expect(result.current.customScale).toBeCloseTo(1.27, 1);
  });

  it('zoomIn respects max scale of 5.0', () => {
    const { result } = renderHook(() => usePdfViewport());
    act(() => result.current.zoomIn(4.95));
    expect(result.current.customScale).toBe(5.0);
  });

  it('zoomOut respects min scale of 0.25', () => {
    const { result } = renderHook(() => usePdfViewport());
    act(() => result.current.zoomOut(0.3));
    expect(result.current.customScale).toBe(0.25);
  });

  it('resetZoom returns to fit-width mode with scale 1.0', () => {
    const { result } = renderHook(() =>
      usePdfViewport({ initialFitMode: 'custom', initialCustomScale: 2.0 }),
    );
    expect(result.current.fitMode).toBe('custom');
    act(() => result.current.resetZoom());
    expect(result.current.fitMode).toBe('fit-width');
    expect(result.current.customScale).toBe(1.0);
  });

  it('setCustomScale switches to custom mode', () => {
    const { result } = renderHook(() => usePdfViewport());
    expect(result.current.fitMode).toBe('fit-width');
    act(() => result.current.setCustomScale(1.5));
    expect(result.current.fitMode).toBe('custom');
    expect(result.current.customScale).toBe(1.5);
  });

  it('consecutive zooms accumulate correctly from actual scale', () => {
    const { result } = renderHook(() => usePdfViewport());
    act(() => result.current.zoomIn(1.47)); // 1.47 + 0.2 = 1.67
    expect(result.current.customScale).toBeCloseTo(1.67, 1);

    act(() => result.current.zoomIn(result.current.customScale)); // 1.67 + 0.2 = 1.87
    expect(result.current.customScale).toBeCloseTo(1.87, 1);

    act(() => result.current.zoomOut(result.current.customScale)); // 1.87 - 0.2 = 1.67
    expect(result.current.customScale).toBeCloseTo(1.67, 1);
  });
});
