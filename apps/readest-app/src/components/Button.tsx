import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';

interface ButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  /** Tooltip text when it should differ from the accessible name. */
  title?: string;
  /** Set false for a button that is still actionable but visually secondary. */
  ariaDisabled?: boolean;
  className?: string;
}

const Button: React.FC<ButtonProps> = ({
  icon,
  onClick,
  disabled = false,
  label,
  title,
  ariaDisabled,
  className,
}) => {
  const { appService } = useEnv();
  return (
    <button
      className={clsx(
        // 32px of icon is below the 44px mobile touch target (DESIGN.md), and
        // in the reader bars a miss falls through to the book and turns the
        // page (#5401), so every one of these carries the halo.
        'touch-target btn btn-ghost h-8 min-h-8 w-8 p-0',
        appService?.isMobileApp && 'hover:bg-transparent',
        disabled && 'cursor-default bg-transparent! opacity-50',
        className,
      )}
      title={title ?? label}
      aria-label={label}
      aria-disabled={ariaDisabled}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
    </button>
  );
};

export default Button;
