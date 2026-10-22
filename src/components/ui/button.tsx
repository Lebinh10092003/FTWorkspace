import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:scale-[0.98]';

    const variants: Record<string, string> = {
      default: 'bg-blue-600 text-white shadow hover:bg-blue-700',
      destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
      outline: 'border border-slate-200 bg-white shadow-sm hover:bg-slate-50 hover:text-slate-900 text-slate-700',
      secondary: 'bg-slate-100 text-slate-900 shadow-sm hover:bg-slate-200/80',
      ghost: 'hover:bg-slate-100 hover:text-slate-900 text-slate-600',
      link: 'text-blue-600 underline-offset-4 hover:underline p-0 h-auto',
    };

    const sizes: Record<string, string> = {
      default: 'h-9 px-4 py-2',
      sm: 'h-8 rounded-md px-3 text-xs',
      lg: 'h-10 rounded-md px-8 text-base',
      icon: 'h-9 w-9',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant] || variants.default, sizes[size] || sizes.default, className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
