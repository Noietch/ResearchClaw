interface StatusDotProps {
  status: string;
  size?: 'sm' | 'md';
}

export function StatusDot({ status, size = 'md' }: StatusDotProps) {
  const sizeClass = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';

  const colorClass =
    (
      {
        idle: 'bg-gray-400',
        running: 'bg-blue-500 animate-pulse',
        completed: 'bg-green-500',
        failed: 'bg-red-500',
        scheduled: 'bg-amber-500',
        cancelled: 'bg-gray-400',
        pending: 'bg-gray-400',
      } as Record<string, string>
    )[status] ?? 'bg-gray-400';

  return <span className={`inline-block rounded-full flex-shrink-0 ${sizeClass} ${colorClass}`} />;
}
