import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { theme } from '../../common/theme';

interface IconButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  tooltip?: string;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'danger' | 'success' | 'warning';
  stopPropagation?: boolean;
}

export function IconButton({
  icon,
  onClick,
  ariaLabel,
  tooltip,
  disabled = false,
  className,
  variant = 'default',
  stopPropagation = true,
}: IconButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  });

  const handleMouseEnter = () => {
    if (tooltip && buttonRef.current) {
      timeoutRef.current = setTimeout(() => {
        const rect = buttonRef.current!.getBoundingClientRect();
        setTooltipPosition({
          top: rect.top - 30,
          left: rect.left + rect.width / 2,
        });
        setShowTooltip(true);
      }, 500);
    }
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowTooltip(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (stopPropagation) {
      e.stopPropagation();
    }
    if (!disabled) {
      onClick();
    }
  };

  // Match existing button styles from the app
  const getButtonClasses = () => {
    if (disabled) {
      return 'opacity-50 cursor-not-allowed';
    }

    switch (variant) {
      case 'success':
        return 'bg-green-800/60 hover:bg-green-700/60 text-green-300';
      case 'danger':
        return 'bg-red-800/60 hover:bg-red-700/60 text-red-300';
      case 'warning':
        return 'bg-yellow-800/60 hover:bg-yellow-700/60 text-yellow-300';
      default:
        return 'bg-slate-700/60 hover:bg-slate-600/60 text-slate-300';
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        disabled={disabled}
        aria-label={ariaLabel}
        className={clsx(
          'inline-flex items-center justify-center',
          'px-1.5 py-1 rounded',
          'transition-colors duration-150', // Smooth color transitions only
          'text-[12px]', // Medium text size for better visibility
          getButtonClasses(),
          !disabled && 'cursor-pointer',
          className
        )}
        title={tooltip || ariaLabel}
      >
        <span className="w-4 h-4 flex items-center justify-center">
          {icon}
        </span>
      </button>
      
      {showTooltip && tooltip && (
        <div
          role="tooltip"
          className="fixed z-50 px-2 py-1 text-xs rounded shadow-lg pointer-events-none animate-fadeIn"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
            transform: 'translateX(-50%)',
            backgroundColor: theme.colors.background.elevated,
            color: theme.colors.text.primary,
            border: `1px solid ${theme.colors.border.subtle}`,
            animation: 'fadeIn 150ms ease-out',
          }}
        >
          {tooltip}
        </div>
      )}
    </>
  );
}