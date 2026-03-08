import { AlertTriangle } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';

interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

interface PermissionCardProps {
  todoId: string;
  requestId: number;
  request: {
    options: PermissionOption[];
    toolCall: {
      title: string;
      kind: string;
      rawInput?: Record<string, unknown>;
    };
  };
  onResolved: () => void;
}

export function PermissionCard({ todoId, requestId, request, onResolved }: PermissionCardProps) {
  async function handleOption(optionId: string) {
    try {
      await ipc.confirmAgentPermission(todoId, requestId, optionId);
      onResolved();
    } catch (err) {
      console.error(err);
    }
  }

  const command = (request.toolCall.rawInput?.command as string) ?? null;

  return (
    <div className="border border-amber-200 rounded-lg overflow-hidden my-2 bg-amber-50">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100 border-b border-amber-200">
        <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
        <span className="font-medium text-sm text-amber-800">Permission Required</span>
      </div>
      <div className="px-3 py-3">
        <p className="text-sm font-medium text-amber-800 mb-1">{request.toolCall.title}</p>
        {command && (
          <p className="text-xs font-mono text-amber-700 mb-3 bg-amber-100 px-2 py-1 rounded">
            {command}
          </p>
        )}
        <div className="flex gap-2 flex-wrap">
          {request.options.map((opt) => (
            <button
              key={opt.optionId}
              onClick={() => handleOption(opt.optionId)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                opt.kind.startsWith('allow')
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-red-100 text-red-700 hover:bg-red-200'
              }`}
            >
              {opt.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
