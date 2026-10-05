/**
 * The pieces every view is laid out with (the Callstack console style): a page header, a row of
 * stat cards, and panels, each a card with a header over a table, a chart or a list.
 */
import { type ReactNode, useId } from "react";

export function Brand() {
  return (
    <span className="brand">
      <span className="wordmark">Apex Factory</span>
      <span className="chip">By Callstack</span>
    </span>
  );
}

/** A view's title, a one-line muted subtitle under it, and its actions on the right. */
export function PageHeader(props: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
}) {
  const { actions, subtitle, title } = props;
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        {subtitle === undefined ? null : <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions === undefined ? null : <div className="page-actions">{actions}</div>}
    </header>
  );
}

export interface Stat {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/** A row of stat cards. Each card's label, number and caption are read in that order. */
export function StatCards({
  stats,
  label = "Summary",
}: {
  readonly stats: readonly Stat[];
  readonly label?: string;
}) {
  return (
    <ul className="stats" aria-label={label}>
      {stats.map((stat) => (
        <li key={stat.label} className="stat">
          <p className="stat-label">{stat.label}</p>
          <p className="stat-value">{stat.value}</p>
          <p className="stat-caption">{stat.caption}</p>
        </li>
      ))}
    </ul>
  );
}

/** A card with a header, a region named by its title so a screen reader can jump to it. */
export function Panel(props: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { actions, children, className, description, title } = props;
  const id = useId();
  return (
    <section
      className={className === undefined ? "panel" : `panel ${className}`}
      aria-labelledby={id}
    >
      <div className="panel-header">
        <div>
          <h2 id={id} className="panel-title">
            {title}
          </h2>
          {description === undefined ? null : <p className="panel-description">{description}</p>}
        </div>
        {actions === undefined ? null : <div className="panel-actions">{actions}</div>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
