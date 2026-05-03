import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

/** Reusable text input with label and error message */
export const Input: React.FC<InputProps> = ({ label, error, id, className = '', ...props }) => {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-dark-secondary">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`mt-1 w-full rounded-md border border-gray-300 dark:border-dark-muted bg-white dark:bg-dark-surface text-gray-900 dark:text-dark-text px-3 py-2 text-sm shadow-sm focus:border-phi-primary focus:outline-none focus:ring-1 focus:ring-phi-primary ${error ? 'border-red-500 dark:border-red-500' : ''} ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};
