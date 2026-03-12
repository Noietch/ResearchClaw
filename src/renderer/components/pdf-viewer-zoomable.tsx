import { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerZoomableProps {
  /** Local file path (not URL) */
  path: string;
  /** Callback when file is not found, allowing parent to show download UI */
  onFileNotFound?: () => void;
}

export function PdfViewerZoomable({ path, onFileNotFound }: PdfViewerZoomableProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onFileNotFoundRef = useRef(onFileNotFound);
  const isPanningRef = useRef(false);
  const lastPanPositionRef = useRef({ x: 0, y: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);

  // Update onFileNotFound ref
  useEffect(() => {
    onFileNotFoundRef.current = onFileNotFound;
  }, [onFileNotFound]);

  // Load PDF data
  useEffect(() => {
    let isMounted = true;

    const loadPdf = async () => {
      setLoading(true);
      setError(null);

      // Cleanup previous blob URL
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      try {
        const filePath = path.replace(/^local-file:\/\//, '');
        if (!window.electronAPI) {
          throw new Error('Electron file API unavailable');
        }
        const base64 = await window.electronAPI.readLocalFile(filePath);
        if (!isMounted) return;

        // Convert base64 to Uint8Array
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        // Create blob URL to avoid ArrayBuffer detachment issues
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        cleanupRef.current = () => URL.revokeObjectURL(url);
        setPdfUrl(url);
        setLoading(false);
      } catch (err) {
        if (!isMounted) return;
        const errorMsg = err instanceof Error ? err.message : 'Failed to load PDF';
        if (errorMsg === 'File not found' && onFileNotFoundRef.current) {
          onFileNotFoundRef.current();
          return;
        }
        setError(errorMsg);
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      isMounted = false;
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, [path]);

  // Handle wheel event for zooming (trackpad pinch gesture)
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    // Check if it's a pinch gesture (ctrlKey is set for pinch on trackpad)
    if (e.ctrlKey) {
      // Pinch zoom
      const delta = -e.deltaY;
      const zoomFactor = delta > 0 ? 1.1 : 0.9;

      setScale((prevScale) => {
        const newScale = Math.max(0.5, Math.min(5.0, prevScale * zoomFactor));
        return newScale;
      });
    } else {
      // Scroll
      setPanOffset((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  }, []);

  // Attach wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Handle mouse pan (drag to pan)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button
    isPanningRef.current = true;
    lastPanPositionRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;

    const dx = e.clientX - lastPanPositionRef.current.x;
    const dy = e.clientY - lastPanPositionRef.current.y;

    setPanOffset((prev) => ({
      x: prev.x + dx,
      y: prev.y + dy,
    }));

    lastPanPositionRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // Page navigation
  const goToPrevPage = useCallback(() => {
    setPageNum((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPageNum((prev) => Math.min(numPages, prev + 1));
  }, [numPages]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(5.0, prev * 1.2));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(0.5, prev / 1.2));
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1.0);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#525659]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#525659] p-4">
        <div className="text-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#525659]">
      {/* Controls */}
      <div className="absolute left-4 top-4 z-10 flex gap-2 rounded-lg bg-black/50 p-2 backdrop-blur-sm">
        <button
          onClick={goToPrevPage}
          disabled={pageNum <= 1}
          className="rounded px-2 py-1 text-sm text-white hover:bg-white/10 disabled:opacity-50"
        >
          ←
        </button>
        <span className="px-2 py-1 text-sm text-white">
          {pageNum} / {numPages}
        </span>
        <button
          onClick={goToNextPage}
          disabled={pageNum >= numPages}
          className="rounded px-2 py-1 text-sm text-white hover:bg-white/10 disabled:opacity-50"
        >
          →
        </button>
      </div>

      <div className="absolute right-4 top-4 z-10 flex gap-2 rounded-lg bg-black/50 p-2 backdrop-blur-sm">
        <button
          onClick={zoomOut}
          className="rounded px-2 py-1 text-sm text-white hover:bg-white/10"
        >
          −
        </button>
        <span className="px-2 py-1 text-sm text-white">{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} className="rounded px-2 py-1 text-sm text-white hover:bg-white/10">
          +
        </button>
        <button
          onClick={resetZoom}
          className="rounded px-2 py-1 text-sm text-white hover:bg-white/10"
        >
          Reset
        </button>
      </div>

      {/* PDF container */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isPanningRef.current ? 'grabbing' : 'grab' }}
      >
        <div
          ref={contentRef}
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            display: 'inline-block',
            transformOrigin: 'top left',
          }}
        >
          {pdfUrl && (
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={
                <div className="flex items-center justify-center p-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </div>
              }
            >
              <Page
                pageNumber={pageNum}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          )}
        </div>
      </div>
    </div>
  );
}
