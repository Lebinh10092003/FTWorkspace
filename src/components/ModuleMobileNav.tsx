import React from "react";
import { ArrowLeft } from "lucide-react";

export type ModuleMobileNavItem = {
  id: string;
  label: string;
  icon?: React.ElementType;
};

type ModuleMobileNavProps = {
  items: ModuleMobileNavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onBack?: () => void;
  backLabel?: string;
  ariaLabel?: string;
  className?: string;
};

export default function ModuleMobileNav({
  items,
  activeId,
  onSelect,
  onBack,
  backLabel = "Workspace",
  ariaLabel = "Điều hướng mô-đun",
  className = "",
}: ModuleMobileNavProps) {
  return (
    <nav className={`ft-mobile-nav ${className}`.trim()} aria-label={ariaLabel}>
      {onBack && (
        <button type="button" className="ft-mobile-nav-back" onClick={onBack} title={`Quay lại ${backLabel}`}>
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{backLabel}</span>
        </button>
      )}
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={activeId === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
