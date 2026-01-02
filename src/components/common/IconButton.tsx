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
    switch (variant) {
      case 'success':
        return {
          bg: 'var(--icon-button-success-bg)',
          hoverBg: 'var(--icon-button-success-hover-bg)',
          text: 'var(--icon-button-success-text)',
          border: 'var(--icon-button-success-border)',
          hoverBorder: 'var(--icon-button-success-hover-border)',
        };
      case 'danger':
        return {
          bg: 'var(--icon-button-danger-bg)',
          hoverBg: 'var(--icon-button-danger-hover-bg)',
          text: 'var(--icon-button-danger-text)',
          border: 'var(--icon-button-danger-border)',
          hoverBorder: 'var(--icon-button-danger-hover-border)',
        };
      case 'warning':
        return {
          bg: 'var(--icon-button-warning-bg)',
          hoverBg: 'var(--icon-button-warning-hover-bg)',
          text: 'var(--icon-button-warning-text)',
          border: 'var(--icon-button-warning-border)',
          hoverBorder: 'var(--icon-button-warning-hover-border)',
        };
      default:
        return {
          bg: 'var(--icon-button-default-bg)',
          hoverBg: 'var(--icon-button-default-hover-bg)',
          text: 'var(--icon-button-default-text)',
          border: 'var(--icon-button-default-border)',
          hoverBorder: 'var(--icon-button-default-hover-border)',
        };
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
