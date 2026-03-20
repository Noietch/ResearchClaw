import { useState, useEffect, useRef, useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfjsLib } from './pdf-worker-setup';

interface UsePdfDocumentOptions {
  path: string;
  onFileNotFound?: () => void;
}

interface UsePdfDocumentResult {
  document: PDFDocumentProxy | null;
  numPages: number;
  loading: boolean;
  error: string | null;
}

export function usePdfDocument({
  path,
  onFileNotFound,
}: UsePdfDocumentOptions): UsePdfDocumentResult {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onFileNotFoundRef = useRef(onFileNotFound);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    onFileNotFoundRef.current = onFileNotFound;
  }, [onFileNotFound]);

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Cleanup previous document
    if (docRef.current) {
      docRef.current.destroy();
      docRef.current = null;
    }

    try {
      const filePath = path.replace(/^local-file:\/\//, '');
      if (!window.electronAPI) {
        throw new Error('Electron file API unavailable');
      }

      const base64 = await window.electronAPI.readLocalFile(filePath);

      // Convert base64 to Uint8Array
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      docRef.current = doc;
      setDocument(doc);
      setNumPages(doc.numPages);
      setLoading(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load PDF';
      if (msg === 'File not found' && onFileNotFoundRef.current) {
        onFileNotFoundRef.current();
        return;
      }
      setError(msg);
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    loadDocument();
    return () => {
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, [loadDocument]);

  return { document, numPages, loading, error };
}
