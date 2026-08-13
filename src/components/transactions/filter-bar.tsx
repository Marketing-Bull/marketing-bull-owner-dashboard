import { SlidersHorizontal, X } from "lucide-react";
import styles from "./transaction-ledger.module.css";

export type ActiveFilter = {
  id: string;
  label: string;
  onRemove: () => void;
};

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.filterField}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function FilterBar({
  children,
  advanced,
  advancedOpen,
  onToggleAdvanced,
  activeFilters,
  onClear
}: {
  children: React.ReactNode;
  advanced: React.ReactNode;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  activeFilters: ActiveFilter[];
  onClear: () => void;
}) {
  return (
    <section className={styles.filterSurface} aria-label="Transaction filters">
      <div className={styles.filterPrimary}>
        {children}
        <div className={styles.filterActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onToggleAdvanced}
            aria-expanded={advancedOpen}
          >
            <SlidersHorizontal size={15} /> All filters
          </button>
          <button type="button" className={styles.quietButton} onClick={onClear} disabled={activeFilters.length === 0}>
            Clear
          </button>
        </div>
      </div>
      {advancedOpen ? <div className={styles.advancedFilters}>{advanced}</div> : null}
      {activeFilters.length > 0 ? (
        <div className={styles.activeFilters} aria-label="Active filters">
          {activeFilters.map((filter) => (
            <button key={filter.id} type="button" className={styles.filterChip} onClick={filter.onRemove}>
              {filter.label} <X size={13} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
