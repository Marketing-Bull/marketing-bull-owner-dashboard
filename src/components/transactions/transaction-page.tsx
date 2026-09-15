import styles from "./transaction-ledger.module.css";

export type HeaderMetric = {
  label: string;
  value: React.ReactNode;
};

export function TransactionPage({ children }: { children: React.ReactNode }) {
  return <main className={styles.page}><div className={styles.shell}>{children}</div></main>;
}

export function TransactionPageHeader({
  title,
  metrics,
  action
}: {
  title: string;
  metrics: HeaderMetric[];
  action: React.ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <h1 className={styles.pageTitle}>{title}</h1>
      <div className={styles.headerEnd}>
        <div className={styles.headerMetrics} aria-label={`${title} totals`}>
          {metrics.map((metric) => (
            <div key={metric.label} className={styles.headerMetric}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
        {action}
      </div>
    </header>
  );
}
