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
  /** Current search query to highlight in text layer */
  searchQuery?: string;
  /** Which match index on this page is the "active" one (scrolled-to), -1 if none */
  activeMatchIndexOnPage?: number;
  /** TTS: phrase currently being spoken — highlights in the text layer */
  ttsHighlightText?: string;
  /** Temporary highlight for citation jump (page number + search text) */
  tempHighlight?: { pageNumber: number; searchText: string } | null;
}

export const PdfPage = memo(function PdfPage({
  document,
  pageNumber,
  scale,
  isVisible,
  onGoToPage,
  onOpenUrl,
  searchQuery,
  activeMatchIndexOnPage,
  ttsHighlightText,
  tempHighlight,
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

  // Highlight search matches in the text layer DOM
  useEffect(() => {
    const textLayerDiv = textLayerRef.current;
    if (!textLayerDiv) return;

    // Remove previous highlights
    textLayerDiv.querySelectorAll('mark[data-search-highlight]').forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(window.document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });

    if (!searchQuery?.trim()) return;

    const needle = searchQuery.toLowerCase();
    const spans = textLayerDiv.querySelectorAll('span');
    let matchCount = 0;

    // Strategy: walk through each text layer span and find needle occurrences.
    // The needle may span across multiple spans (e.g. "neural network" split across
    // two spans "neural " and "network"). We handle both single-span and cross-span matches.

    // First, build a flat list of text nodes within the text layer spans
    const textNodes: { node: Text; text: string; span: HTMLSpanElement }[] = [];
    spans.forEach((span) => {
      const walker = window.document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        textNodes.push({ node, text: node.textContent || '', span });
      }
    });

    // Concatenate all text with tracking of boundaries
    let fullText = '';
    const nodeMap: { nodeIdx: number; offset: number }[] = []; // fullText char index -> node + offset
    for (let i = 0; i < textNodes.length; i++) {
      const t = textNodes[i].text;
      for (let j = 0; j < t.length; j++) {
        nodeMap.push({ nodeIdx: i, offset: j });
      }
      fullText += t;
      // Add space between spans (text layer spans are separate words)
      if (i < textNodes.length - 1) {
        nodeMap.push({ nodeIdx: -1, offset: 0 }); // spacer
        fullText += ' ';
      }
    }

    const fullTextLower = fullText.toLowerCase();

    // Find all occurrences in the concatenated text
    const occurrences: { start: number; end: number }[] = [];
    let searchStart = 0;
    let pos: number;
    while ((pos = fullTextLower.indexOf(needle, searchStart)) !== -1) {
      occurrences.push({ start: pos, end: pos + needle.length });
      searchStart = pos + 1;
    }

    if (occurrences.length === 0) return;

    // Highlight each occurrence by wrapping matched characters in <mark> elements.
    // Process in reverse order to avoid invalidating indices.
    for (let occIdx = occurrences.length - 1; occIdx >= 0; occIdx--) {
      const { start, end } = occurrences[occIdx];
      const isActive = matchCount === 0 ? occIdx === (activeMatchIndexOnPage ?? -1) : false;

      // Collect ranges of real text nodes to highlight (skip spacer entries)
      const ranges: { node: Text; startOffset: number; endOffset: number }[] = [];
      let i = start;
      while (i < end) {
        const entry = nodeMap[i];
        if (!entry || entry.nodeIdx === -1) {
          i++;
          continue;
        }
        const tn = textNodes[entry.nodeIdx];
        const rangeStart = entry.offset;
        let rangeEnd = entry.offset;
        // Extend to cover consecutive chars in the same node
        while (i + 1 < end) {
          const next = nodeMap[i + 1];
          if (!next || next.nodeIdx !== entry.nodeIdx || next.offset !== rangeEnd + 1) break;
          rangeEnd = next.offset;
          i++;
        }
        ranges.push({ node: tn.node, startOffset: rangeStart, endOffset: rangeEnd + 1 });
        i++;
      }

      // Apply highlights in reverse to preserve offsets within a single node
      for (let r = ranges.length - 1; r >= 0; r--) {
        const { node, startOffset, endOffset } = ranges[r];
        if (!node.parentNode) continue;
        const text = node.textContent || '';
        if (startOffset >= text.length) continue;

        const before = text.slice(0, startOffset);
        const matched = text.slice(startOffset, Math.min(endOffset, text.length));
        const after = text.slice(Math.min(endOffset, text.length));

        const mark = window.document.createElement('mark');
        mark.setAttribute('data-search-highlight', '');
        mark.className =
          isActive && activeMatchIndexOnPage === occIdx
            ? 'pdf-search-highlight-active'
            : 'pdf-search-highlight';
        mark.textContent = matched;

        const frag = window.document.createDocumentFragment();
        if (before) frag.appendChild(window.document.createTextNode(before));
        frag.appendChild(mark);
        if (after) frag.appendChild(window.document.createTextNode(after));

        node.parentNode.replaceChild(frag, node);
      }

      matchCount++;
    }

    // After marking, check if there's an active match to scroll into view.
    // Re-assign isActive based on the actual activeMatchIndexOnPage.
    if (activeMatchIndexOnPage != null && activeMatchIndexOnPage >= 0) {
      // Re-query to find the correct active mark
      const allMarks = textLayerDiv.querySelectorAll('mark[data-search-highlight]');
      let idx = 0;
      allMarks.forEach((m) => {
        if (idx === activeMatchIndexOnPage) {
          m.className = 'pdf-search-highlight-active';
          // Scroll the mark into view within the page's scroll container
          m.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
          if (m.className === 'pdf-search-highlight-active') {
            m.className = 'pdf-search-highlight';
          }
        }
        // Count only first mark of each occurrence (occurrences may span multiple marks)
        // We count each mark individually - works because single-word matches = 1 mark each
        idx++;
      });
    }
  }, [searchQuery, activeMatchIndexOnPage, isVisible]);

  // TTS: highlight the currently spoken phrase in the text layer
  useEffect(() => {
    const textLayerDiv = textLayerRef.current;
    if (!textLayerDiv) return;

    // Remove previous TTS highlights
    textLayerDiv.querySelectorAll('mark[data-tts-highlight]').forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(window.document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });

    if (!ttsHighlightText?.trim()) return;

    // Build fullText from text layer spans (same technique as search)
    const spans = textLayerDiv.querySelectorAll('span');
    const textNodes: { node: Text; text: string }[] = [];
    spans.forEach((span) => {
      const walker = window.document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        textNodes.push({ node, text: node.textContent || '' });
      }
    });

    let fullText = '';
    const nodeMap: { nodeIdx: number; offset: number }[] = [];
    for (let i = 0; i < textNodes.length; i++) {
      const t = textNodes[i].text;
      for (let j = 0; j < t.length; j++) {
        nodeMap.push({ nodeIdx: i, offset: j });
      }
      fullText += t;
      if (i < textNodes.length - 1) {
        nodeMap.push({ nodeIdx: -1, offset: 0 });
        fullText += ' ';
      }
    }

    // Case-insensitive search for the spoken phrase
    const needle = ttsHighlightText.toLowerCase().replace(/\s+/g, ' ').trim();
    const haystack = fullText.toLowerCase();
    const pos = haystack.indexOf(needle);
    if (pos === -1) return;

    const start = pos;
    const end = pos + needle.length;

    // Collect text node ranges to highlight
    const ranges: { node: Text; startOffset: number; endOffset: number }[] = [];
    let i = start;
    while (i < end && i < nodeMap.length) {
      const entry = nodeMap[i];
      if (!entry || entry.nodeIdx === -1) {
        i++;
        continue;
      }
      const rangeStart = entry.offset;
      let rangeEnd = entry.offset;
      while (i + 1 < end && i + 1 < nodeMap.length) {
        const next = nodeMap[i + 1];
        if (!next || next.nodeIdx !== entry.nodeIdx || next.offset !== rangeEnd + 1) break;
        rangeEnd = next.offset;
        i++;
      }
      ranges.push({
        node: textNodes[entry.nodeIdx].node,
        startOffset: rangeStart,
        endOffset: rangeEnd + 1,
      });
      i++;
    }

    // Apply highlights in reverse order
    for (let r = ranges.length - 1; r >= 0; r--) {
      const { node, startOffset, endOffset } = ranges[r];
      if (!node.parentNode) continue;
      const text = node.textContent || '';
      if (startOffset >= text.length) continue;

      const before = text.slice(0, startOffset);
      const matched = text.slice(startOffset, Math.min(endOffset, text.length));
      const after = text.slice(Math.min(endOffset, text.length));

      const mark = window.document.createElement('mark');
      mark.setAttribute('data-tts-highlight', '');
      mark.className = 'pdf-tts-highlight';
      mark.textContent = matched;

      const frag = window.document.createDocumentFragment();
      if (before) frag.appendChild(window.document.createTextNode(before));
      frag.appendChild(mark);
      if (after) frag.appendChild(window.document.createTextNode(after));

      node.parentNode.replaceChild(frag, node);
    }
  }, [ttsHighlightText, isVisible]);

  // Citation: temporary highlight for clicked citations
  useEffect(() => {
    const textLayerDiv = textLayerRef.current;
    if (!textLayerDiv) return;

    // Remove previous citation highlights
    textLayerDiv.querySelectorAll('mark[data-citation-highlight]').forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(window.document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });

    // Only highlight if this is the target page
    if (!tempHighlight || tempHighlight.pageNumber !== pageNumber) return;
    if (!tempHighlight.searchText?.trim()) return;

    // Build fullText from text layer spans (same technique as search/TTS)
    const spans = textLayerDiv.querySelectorAll('span');
    const textNodes: { node: Text; text: string }[] = [];
    spans.forEach((span) => {
      const walker = window.document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        textNodes.push({ node, text: node.textContent || '' });
      }
    });

    let fullText = '';
    const nodeMap: { nodeIdx: number; offset: number }[] = [];
    for (let i = 0; i < textNodes.length; i++) {
      const t = textNodes[i].text;
      for (let j = 0; j < t.length; j++) {
        nodeMap.push({ nodeIdx: i, offset: j });
      }
      fullText += t;
      if (i < textNodes.length - 1) {
        nodeMap.push({ nodeIdx: -1, offset: 0 });
        fullText += ' ';
      }
    }

    // Find the citation marker (exact match, case-sensitive for "[1]" style markers)
    const needle = tempHighlight.searchText;
    const pos = fullText.indexOf(needle);
    if (pos === -1) return;

    const start = pos;
    const end = pos + needle.length;

    // Collect text node ranges to highlight
    const ranges: { node: Text; startOffset: number; endOffset: number }[] = [];
    let i = start;
    while (i < end && i < nodeMap.length) {
      const entry = nodeMap[i];
      if (!entry || entry.nodeIdx === -1) {
        i++;
        continue;
      }
      const rangeStart = entry.offset;
      let rangeEnd = entry.offset;
      while (i + 1 < end && i + 1 < nodeMap.length) {
        const next = nodeMap[i + 1];
        if (!next || next.nodeIdx !== entry.nodeIdx || next.offset !== rangeEnd + 1) break;
        rangeEnd = next.offset;
        i++;
      }
      ranges.push({
        node: textNodes[entry.nodeIdx].node,
        startOffset: rangeStart,
        endOffset: rangeEnd + 1,
      });
      i++;
    }

    // Apply highlights in reverse order
    for (let r = ranges.length - 1; r >= 0; r--) {
      const { node, startOffset, endOffset } = ranges[r];
      if (!node.parentNode) continue;
      const text = node.textContent || '';
      if (startOffset >= text.length) continue;

      const before = text.slice(0, startOffset);
      const matched = text.slice(startOffset, Math.min(endOffset, text.length));
      const after = text.slice(Math.min(endOffset, text.length));

      const mark = window.document.createElement('mark');
      mark.setAttribute('data-citation-highlight', '');
      mark.className = 'pdf-citation-highlight';
      mark.textContent = matched;

      const frag = window.document.createDocumentFragment();
      if (before) frag.appendChild(window.document.createTextNode(before));
      frag.appendChild(mark);
      if (after) frag.appendChild(window.document.createTextNode(after));

      node.parentNode.replaceChild(frag, node);
    }
  }, [tempHighlight, pageNumber, isVisible]);

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
              className="absolute cursor-pointer hover:bg-blue-500/10 rounded-sm"
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
