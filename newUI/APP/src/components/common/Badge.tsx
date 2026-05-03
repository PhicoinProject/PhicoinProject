import React from 'react';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  success:
    'bg-green-200 dark:bg-green-500 text-white border border-green-400 dark:border-green-600',
  warning:
    'bg-amber-200 dark:bg-amber-500 text-white border border-amber-400 dark:border-amber-600',
  error: 'bg-red-200 dark:bg-red-500 text-white border border-red-400 dark:border-red-600',
  info: 'bg-blue-200 dark:bg-blue-500 text-white border border-blue-400 dark:border-blue-600',
  default:
    'bg-gray-100 dark:bg-dark-elevated text-gray-700 dark:text-dark-secondary border border-gray-200 dark:border-dark-border',
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className = '' }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
