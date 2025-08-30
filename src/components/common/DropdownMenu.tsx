import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { theme } from '../../common/theme';

export interface DropdownMenuItem {
  label?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'danger' | 'success';
  disabled?: boolean;
  divider?: boolean;
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownMenuItem[];
  ariaLabel: string;
  align?: 'left' | 'right';
  disabled?: boolean;
  stopPropagation?: boolean;
}

export function DropdownMenu({
  trigger,
  items,
  ariaLabel,
  align = 'right',
  disabled = false,
  stopPropagation = true,
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (stopPropagation) {
      e.stopPropagation();
    }
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleItemClick = (item: DropdownMenuItem) => {
    if (!item.disabled && item.onClick) {
      item.onClick();
      setIsOpen(false);
    }
  };

  const variantClasses = {
    default: 'hover:bg-hover',
    danger: 'hover:bg-red-900/30 text-red-400',
    success: 'hover:bg-green-900/30 text-green-400',
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleTriggerClick}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={clsx(
          'w-5 h-5 p-0.5 rounded flex items-center justify-center transition-all duration-150',
          'text-secondary hover:text-primary hover:bg-hover active:bg-active',
          disabled && 'opacity-50 cursor-not-allowed',
          !disabled && 'cursor-pointer'
        )}
      >
        <span className="w-4 h-4 flex items-center justify-center">
          {trigger}
        </span>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          className={clsx(
            'absolute mt-1 py-1 rounded-md shadow-lg z-50 min-w-[160px] animate-fadeIn',
            align === 'right' ? 'right-0' : 'left-0'
          )}
          style={{
            backgroundColor: theme.colors.background.elevated,
            border: `1px solid ${theme.colors.border.default}`,
          }}
        >
          {items.map((item, index) => {
            if (item.divider) {
              return (
                <div
                  key={index}
                  role="separator"
                  className="my-1 border-t border-subtle"
                  style={{ borderColor: theme.colors.border.subtle }}
                />
              );
            }

            return (
              <button
                key={index}
                role="menuitem"
                aria-disabled={item.disabled}
                onClick={() => handleItemClick(item)}
                className={clsx(
                  'w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors duration-150',
                  'text-sm',
                  item.disabled && 'opacity-50 cursor-not-allowed',
                  !item.disabled && 'cursor-pointer',
                  !item.disabled && variantClasses[item.variant || 'default']
                )}
                style={{
                  color: item.disabled ? theme.colors.text.muted : theme.colors.text.secondary,
                }}
                disabled={item.disabled}
              >
                {item.icon && (
                  <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    {item.icon}
                  </span>
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}