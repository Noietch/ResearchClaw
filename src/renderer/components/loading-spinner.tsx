import clsx from 'clsx';

interface LoadingSpinnerProps {
  /** Size of the spinner */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant */
  variant?: 'default' | 'light' | 'dark';
  /** Optional className for additional styling */
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
};

const variantClasses = {
  default: 'border-notion-border border-t-notion-text',
  light: 'border-white/30 border-t-white',
  dark: 'border-notion-border border-t-notion-text',
};

export function LoadingSpinner({
  size = 'md',
  variant = 'default',
  className,
}: LoadingSpinnerProps) {
  return (
    <div
      className={clsx(
        'animate-spin rounded-full border-2',
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
    />
  );
}
