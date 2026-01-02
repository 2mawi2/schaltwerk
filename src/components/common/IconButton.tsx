import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

interface IconButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  tooltip?: string;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'danger' | 'success' | 'warning';
  stopPropagation?: boolean;
  ariaPressed?: boolean;
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
  ariaPressed,
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

  const getButtonTokens = () => {
    const base = {
      bg: 'rgb(var(--color-border-subtle-rgb) / 0.4)',
      hoverBg: 'rgb(var(--color-border-subtle-rgb) / 0.6)',
      text: 'var(--color-text-secondary)',
      border: 'rgb(var(--color-border-strong-rgb) / 0.5)',
      hoverBorder: 'rgb(var(--color-border-strong-rgb) / 0.7)',
    };

    switch (variant) {
      case 'success':
        return {
          bg: 'rgb(var(--color-accent-green-rgb) / 0.16)',
          hoverBg: 'rgb(var(--color-accent-green-rgb) / 0.24)',
          text: 'var(--color-accent-green-light)',
          border: 'rgb(var(--color-accent-green-rgb) / 0.35)',
          hoverBorder: 'rgb(var(--color-accent-green-rgb) / 0.5)',
        };
      case 'danger':
        return {
          bg: 'rgb(var(--color-accent-red-rgb) / 0.16)',
          hoverBg: 'rgb(var(--color-accent-red-rgb) / 0.24)',
          text: 'var(--color-accent-red-light)',
          border: 'rgb(var(--color-accent-red-rgb) / 0.35)',
          hoverBorder: 'rgb(var(--color-accent-red-rgb) / 0.5)',
        };
      case 'warning':
        return {
          bg: 'rgb(var(--color-accent-amber-rgb) / 0.18)',
          hoverBg: 'rgb(var(--color-accent-amber-rgb) / 0.26)',
          text: 'var(--color-accent-amber-light)',
          border: 'rgb(var(--color-accent-amber-rgb) / 0.35)',
          hoverBorder: 'rgb(var(--color-accent-amber-rgb) / 0.5)',
        };
      default:
        return base;
    }
  };

  const tokens = getButtonTokens();
  const buttonStyle = {
    '--icon-button-bg': tokens.bg,
    '--icon-button-hover-bg': tokens.hoverBg,
    '--icon-button-text': tokens.text,
    '--icon-button-border': tokens.border,
    '--icon-button-hover-border': tokens.hoverBorder,
  } as React.CSSProperties;

  const portalTarget = typeof document === 'undefined' ? null : document.body;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        className={clsx(
          'inline-flex items-center justify-center',
          'px-1.5 py-1 rounded border',
          'transition-colors duration-150', // Smooth color transitions only
          'text-[12px]', // Medium text size for better visibility
          'bg-[var(--icon-button-bg)] text-[var(--icon-button-text)] border-[var(--icon-button-border)]',
          !disabled && 'hover:bg-[var(--icon-button-hover-bg)] hover:border-[var(--icon-button-hover-border)]',
          disabled && 'opacity-50 cursor-not-allowed',
          !disabled && 'cursor-pointer',
          className
        )}
        style={buttonStyle}
        title={tooltip ? undefined : ariaLabel}
      >
        <span className="w-4 h-4 flex items-center justify-center">
          {icon}
        </span>
      </button>
      
      {showTooltip &&
        tooltip &&
        portalTarget &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-50 px-2 py-1 text-xs rounded shadow-lg pointer-events-none animate-fadeIn"
            style={{
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--color-bg-elevated)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-subtle)',
              animation: 'fadeIn 150ms ease-out',
            }}
          >
            {tooltip}
          </div>,
          portalTarget
        )}
    </>
  );
}
