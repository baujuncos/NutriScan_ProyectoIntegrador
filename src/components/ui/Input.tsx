'use client';

import { InputHTMLAttributes, forwardRef, useState } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {open ? (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 4.06-5.06" />
        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.17 4.19" />
        <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </>
    )}
  </svg>
);

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, id, className = '', type = 'text', ...props }, ref) => {
    const [revealed, setRevealed] = useState(false);
    const isPassword = type === 'password';
    const effectiveType = isPassword && revealed ? 'text' : type;

    const inputClass = `w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
      error ? 'border-red-400 focus:ring-red-500' : 'border-gray-300'
    } ${isPassword ? 'pr-10' : ''} ${className}`;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <div className="relative">
          <input ref={ref} id={id} type={effectiveType} className={inputClass} {...props} />
          {isPassword && (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={revealed}
              tabIndex={0}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-r-lg"
            >
              <EyeIcon open={revealed} />
            </button>
          )}
        </div>
        <div
          className={`grid overflow-hidden transition-all duration-300 ease-out ${error ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="min-h-0 overflow-hidden">
            {error ? <p className="text-xs text-red-500 pt-0.5">{error}</p> : null}
          </div>
        </div>
      </div>
    );
  },
);

Input.displayName = 'Input';
export default Input;
