'use client';
import { cn } from '@/lib/utils';
import { motion, useSpring, useTransform, type SpringOptions } from 'motion/react';
import { useEffect, useMemo } from 'react';

export type AnimatedNumberProps = {
  value: number;
  className?: string;
  springOptions?: SpringOptions;
  as?: React.ElementType;
  /** Number grouping; en-IN gives lakh/crore grouping (12,50,000). */
  locale?: string;
};

export function AnimatedNumber({
  value,
  className,
  springOptions,
  as = 'span',
  locale = 'en-IN',
}: AnimatedNumberProps) {
  // Create the motion component once per element type, not on every render.
  const MotionComponent = useMemo(
    () => motion.create(as as keyof React.JSX.IntrinsicElements),
    [as]
  );

  const spring = useSpring(value, springOptions);
  const display = useTransform(spring, (current) =>
    Math.round(current).toLocaleString(locale)
  );

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return (
    <MotionComponent className={cn('tabular-nums', className)}>
      {display}
    </MotionComponent>
  );
}
