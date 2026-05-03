import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
}

/** Reusable button component with variants and sizes */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';

  const variantClasses: Record<string, string> = {
    primary: 'bg-phi-primary text-white hover:bg-blue-700 focus:ring-phi-primary',
    secondary:
      'border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-surface text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated focus:ring-phi-primary',
    danger: 'bg-phi-danger text-white hover:bg-red-700 focus:ring-red-500',
    ghost:
      'text-gray-700 dark:text-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-elevated focus:ring-gray-300 dark:focus:ring-dark-muted',
  };

  const sizeClasses: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
};
