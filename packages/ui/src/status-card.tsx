import styles from "./status-card.module.css";

export type StatusCardState = "healthy" | "degraded" | "neutral";

export interface StatusCardProps {
  readonly title: string;
  readonly state: StatusCardState;
  readonly description: string;
  readonly eyebrow?: string;
}

export function StatusCard({
  title,
  state,
  description,
  eyebrow,
}: StatusCardProps) {
  return (
    <section className={styles.card} aria-label={title}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h2 className={styles.title}>{title}</h2>
      <div
        className={styles.status}
        role="status"
        data-state={state}
        aria-live="polite"
      >
        <span className={styles.indicator} aria-hidden="true" />
        <p className={styles.description}>{description}</p>
      </div>
    </section>
  );
}
