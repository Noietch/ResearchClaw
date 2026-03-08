/**
 * PriorityBar — 5-cell rating-style priority indicator.
 *
 * Like a star rating but with flat rectangles.
 * Clicking cell i sets priority = i (0-based).
 *
 * Color is unified per priority level (all cells same color):
 *   0 (Low)    → green
 *   1 (Normal) → lime
 *   2 (Medium) → yellow
 *   3 (High)   → orange
 *   4 (Urgent) → red
 */

// Color for each priority level (all cells use this color when selected)
const LEVEL_COLORS = [
  '#0f7b0f', // Low — green
  '#5cb85c', // Normal — lime
  '#dfab01', // Medium — yellow
  '#fa8c16', // High — orange
  '#eb5757', // Urgent — red
];

const LEVEL_LABELS = ['Low', 'Normal', 'Medium', 'High', 'Urgent'];

/** Read-only display — shows filled cells with unified color based on level. */
export function PriorityBarIcon({ value }: { value: number }) {
  const activeColor = LEVEL_COLORS[value] ?? LEVEL_COLORS[0];

  return (
    <span
      className="inline-flex items-center"
      style={{ gap: 2 }}
      title={`Priority: ${LEVEL_LABELS[value] ?? 'Low'}`}
      aria-label={`Priority: ${LEVEL_LABELS[value] ?? 'Low'}`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 6,
            height: 10,
            borderRadius: 2,
            backgroundColor: i <= value ? activeColor : '#d1d5db',
            flexShrink: 0,
          }}
        />
      ))}
    </span>
  );
}

/** Interactive rating-style picker — click a cell to set priority. */
export function PriorityPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const activeColor = LEVEL_COLORS[value] ?? LEVEL_COLORS[0];

  return (
    <div className="flex items-center gap-2">
      {/* Clickable cells */}
      <div className="flex items-center" style={{ gap: 4 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            title={LEVEL_LABELS[i]}
            style={{
              width: 20,
              height: 28,
              borderRadius: 4,
              backgroundColor: i <= value ? activeColor : '#e5e7eb',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.15s, transform 0.1s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scaleY(1.1)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scaleY(1)';
            }}
          />
        ))}
      </div>
      {/* Label */}
      <span className="text-sm text-notion-text-secondary w-14">{LEVEL_LABELS[value]}</span>
    </div>
  );
}
