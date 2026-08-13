import styles from "@/app/(app)/entities.module.css";

/**
 * An honest not-built-yet screen. These routes are in the menu on purpose —
 * the finished app's shape should be visible now — but a placeholder that
 * pretends to be a feature is worse than none, so each one says what it will
 * do, which consolidation phase delivers it, and where the capability lives
 * in the meantime.
 */
export function PlaceholderScreen({
  eyebrow,
  title,
  phase,
  description,
  meanwhile
}: {
  eyebrow: string;
  title: string;
  phase: string;
  description: string;
  meanwhile?: string;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.title}>{title}</h1>
          </div>
          <span className={styles.statusChip}>{phase}</span>
        </header>
        <section className={styles.card}>
          <p className={styles.empty}>{description}</p>
          {meanwhile ? <p className={styles.empty}>Until then: {meanwhile}</p> : null}
        </section>
      </div>
    </main>
  );
}
