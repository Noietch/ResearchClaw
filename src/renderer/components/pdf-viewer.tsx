import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, FileWarning } from 'lucide-react';
import { LoadingSpinner } from './loading-spinner';

interface PdfViewerProps {
  /** Local file path (not URL) */
  path: string;
}

export function PdfViewer({ path }: PdfViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const loadPdf = useCallback(async () => {
    setLoading(true);
    setError(null);

    let revoked = false;

    try {
      const filePath = path.replace(/^local-file:\/\//, '');
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

      setBlobUrl(url);
      setLoading(false);
    } catch (err) {
      if (revoked) return;
      setError(err instanceof Error ? err.message : 'Failed to load PDF');
      setLoading(false);
    }

    return () => {
      revoked = true;
    };
  }, [path]);

  useEffect(() => {
    // Revoke previous blob URL
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
    loadPdf();
  }, [path, retryCount]);

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#525659]">
        <LoadingSpinner variant="light" size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#525659] p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4 rounded-xl bg-white/10 p-6 text-center backdrop-blur-sm"
        >
          <FileWarning size={40} className="text-white/70" />
          <div>
            <p className="text-sm font-medium text-white/90">Failed to load PDF</p>
            <p className="mt-1 text-xs text-white/60">{error}</p>
          </div>
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#525659]">
      {blobUrl && <iframe src={blobUrl} className="h-full w-full border-0" title="PDF Viewer" />}
    </div>
  );
}
