import { motion, useReducedMotion } from '@tio/ui';

/** Opacity/individual translate leave Floating UI's positioning transform intact. */
export function useEditorMotion() {
  const reduced = useReducedMotion();
  const duration = reduced ? 0 : motion.floating;
  return {
    useTransitionStylesProps: {
      duration,
      initial: { opacity: 0, translate: '0 3px' },
      open: { opacity: 1, translate: '0 0' },
      close: { opacity: 0, translate: '0 3px', pointerEvents: 'none' as const },
      common: { transitionTimingFunction: 'ease-out' },
    },
    useTransitionStatusProps: { duration },
  };
}
