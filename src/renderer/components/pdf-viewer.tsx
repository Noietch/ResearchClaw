import { useState, useEffect, useCallback, useRef } from 'react';

interface PdfViewerProps {
  /** Local file path (not URL) */
  path: string;
  /** Callback when file is not found, allowing parent to show download UI */
  onFileNotFound?: () => void;
}

export function PdfViewer({ path, onFileNotFound }: PdfViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Use ref to avoid re-loading when onFileNotFound changes
  const onFileNotFoundRef = useRef(onFileNotFound);
  useEffect(() => {
    onFileNotFoundRef.current = onFileNotFound;
  }, [onFileNotFound]);

  const loadPdf = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Cleanup previous blob URL
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    let revoked = false;

    try {
      const filePath = path.replace(/^local-file:\/\//, '');
      if (!window.electronAPI) {
        throw new Error('Electron file API unavailable');
      }
      const base64 = await window.electronAPI.readLocalFile(filePath);
      if (revoked) return;

      // Convert base64 to blob
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      cleanupRef.current = () => URL.revokeObjectURL(url);
      setBlobUrl(url);
      setLoading(false);
    } catch (err) {
      if (revoked) return;
      const errorMsg = err instanceof Error ? err.message : 'Failed to load PDF';
      // Check if file not found - trigger callback instead of showing error
      if (errorMsg === 'File not found' && onFileNotFoundRef.current) {
        onFileNotFoundRef.current();
        return;
      }
      setError(errorMsg);
      setLoading(false);
    }

    return () => {
      revoked = true;
    };
  }, [path]);

  useEffect(() => {
    loadPdf();
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, [loadPdf]);

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
    <div className="h-full w-full bg-[#525659]">
      {blobUrl && (
        <iframe
          src={`${blobUrl}#navpanes=0`}
          className="h-full w-full border-0"
          title="PDF Viewer"
        />
      )}
    </div>
  );
}
