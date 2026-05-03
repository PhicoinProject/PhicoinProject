import React from 'react';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  success:
    'bg-green-500 dark:bg-green-600 text-white border border-green-600 dark:border-green-700',
  warning:
    'bg-amber-500 dark:bg-amber-600 text-white border border-amber-600 dark:border-amber-700',
  error: 'bg-red-500 dark:bg-red-600 text-white border border-red-600 dark:border-red-700',
  info: 'bg-blue-500 dark:bg-blue-600 text-white border border-blue-600 dark:border-blue-700',
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
