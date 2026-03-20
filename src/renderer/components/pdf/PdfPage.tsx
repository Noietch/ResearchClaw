import { useEffect, useRef, useCallback, useState, memo } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf-overrides.css';

interface LinkRect {
  x: number;
  y: number;
  w: number;
  h: number;
  dest?: unknown;
  url?: string;
}

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  isVisible: boolean;
  onGoToPage?: (page: number) => void;
  onOpenUrl?: (url: string) => void;
}

export const PdfPage = memo(function PdfPage({
  document,
  pageNumber,
  scale,
  isVisible,
  onGoToPage,
  onOpenUrl,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [linkRects, setLinkRects] = useState<LinkRect[]>([]);

  // Load page object
  useEffect(() => {
    let cancelled = false;
    document.getPage(pageNumber).then((page) => {
      if (!cancelled) {
        pageRef.current = page;
        const viewport = page.getViewport({ scale: 1.0 });
        setPageSize({ width: viewport.width, height: viewport.height });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [document, pageNumber]);

  // Render canvas + text layer when visible
  const renderPage = useCallback(async () => {
    const page = pageRef.current;
    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    const containerDiv = containerRef.current;
    if (!page || !canvas || !textLayerDiv || !containerDiv) return;

    // Cancel previous render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    if (textLayerInstanceRef.current) {
      textLayerInstanceRef.current.cancel();
      textLayerInstanceRef.current = null;
    }

    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale });

    // Set --scale-factor CSS variable (required by pdf.js text layer positioning)
    containerDiv.style.setProperty('--scale-factor', String(scale));

    // Set canvas dimensions for HiDPI
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    try {
      const renderTask = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
      } as any);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
    } catch (e) {
      if ((e as Error)?.message?.includes('cancelled')) return;
    }

    // Render text layer
    textLayerDiv.innerHTML = '';
    try {
      const textContent = await page.getTextContent();
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      textLayerInstanceRef.current = textLayer;
      await textLayer.render();
    } catch (e) {
      if ((e as Error)?.message?.includes('cancelled')) return;
    }

    // Extract internal link annotations as click targets
    try {
      const annotations = await page.getAnnotations();
      const links: LinkRect[] = [];
      const baseHeight = page.getViewport({ scale: 1.0 }).height;
      for (const ann of annotations) {
        if (ann.subtype !== 'Link' || !ann.rect) continue;
        const [x1, y1, x2, y2] = ann.rect;
        const rect = {
          x: x1 * scale,
          y: (baseHeight - y2) * scale,
          w: (x2 - x1) * scale,
          h: (y2 - y1) * scale,
        };
        if (ann.dest) {
          links.push({ ...rect, dest: ann.dest });
        } else {
          // Use unsafeUrl (raw URL) if available, fallback to url (sanitized)
          const linkUrl = (ann as any).unsafeUrl || ann.url;
          if (linkUrl) {
            links.push({ ...rect, url: linkUrl });
          }
        }
      }
      setLinkRects(links);
    } catch {
      // Non-critical
    }
  }, [scale, document]);

  useEffect(() => {
    if (isVisible && pageRef.current) {
      renderPage();
    }
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (textLayerInstanceRef.current) {
        textLayerInstanceRef.current.cancel();
        textLayerInstanceRef.current = null;
      }
    };
  }, [isVisible, renderPage, pageSize]);

  const handleLinkClick = useCallback(
    (link: LinkRect) => {
      if (link.url) {
        onOpenUrl?.(link.url);
        return;
      }
      if (!link.dest || !onGoToPage) return;
      if (typeof link.dest === 'string') {
        document.getDestination(link.dest).then((resolved) => {
          if (resolved) {
            document.getPageIndex(resolved[0]).then((idx) => onGoToPage(idx + 1));
          }
        });
      } else if (Array.isArray(link.dest)) {
        document.getPageIndex(link.dest[0]).then((idx) => onGoToPage(idx + 1));
      }
    },
    [document, onGoToPage, onOpenUrl],
  );

  if (!isVisible || !pageSize) return null;

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div ref={textLayerRef} className="textLayer" />
      {/* Internal link overlay - above text layer */}
      {linkRects.length > 0 && (
        <div className="absolute inset-0" style={{ zIndex: 5, pointerEvents: 'none' }}>
          {linkRects.map((link, i) => (
            <div
              key={i}
              className="absolute cursor-pointer hover:bg-notion-accent/10 rounded-sm"
              style={{
                left: link.x,
                top: link.y,
                width: link.w,
                height: link.h,
                pointerEvents: 'auto',
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleLinkClick(link);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});
