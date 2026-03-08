import { Server } from 'lucide-react';

interface RemoteStatusBadgeProps {
  host: string;
  username: string;
  status?: 'connected' | 'disconnected' | 'connecting';
  className?: string;
}

export function RemoteStatusBadge({
  host,
  username,
  status = 'disconnected',
  className = '',
}: RemoteStatusBadgeProps) {
  const statusColors = {
    connected: 'bg-green-500',
    disconnected: 'bg-gray-400',
    connecting: 'bg-amber-500 animate-pulse',
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ${className}`}
    >
      <Server size={10} />
      <span>
        SSH: {username}@{host}
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${statusColors[status]}`} title={status} />
    </div>
  );
}
