import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold', className)}
      {...props}
    />
  )
);
Badge.displayName = 'Badge';