import { useState, useCallback, useEffect } from 'react';
import { PapersByTag } from '../../components/papers-by-tag';
import { ipc, onIpc, type ImportStatus } from '../../hooks/use-ipc';
import { ImportModal } from '../../components/import-modal';

export function PapersPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // on mount, fetch current status in case import is already running
  useEffect(() => {
    ipc
      .getImportStatus()
      .then((status) => {
        setImportStatus(status);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const unsub = onIpc('ingest:status', (...args) => {
      const status = args[1] as ImportStatus;
      setImportStatus(status);
      if (!status.active) setRefreshKey((k) => k + 1);
    });
    return unsub;
  }, []);

  const handleImported = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div>
      <PapersByTag
        key={refreshKey}
        importStatus={importStatus}
        onOpenImport={() => setShowImportModal(true)}
      />

      {showImportModal && (
        <ImportModal onClose={() => setShowImportModal(false)} onImported={handleImported} />
      )}
    </div>
  );
}
