import type { ResearchProfile as ResearchProfileData } from '../hooks/use-ipc';
import { CATEGORY_COLORS, type TagCategory } from '@shared';

function BarChart({
  items,
  maxCount,
  colorClass,
}: {
  items: Array<{ label: string; count: number }>;
  maxCount: number;
  colorClass: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="w-28 flex-shrink-0 truncate text-xs text-notion-text-secondary text-right">
            {item.label}
          </span>
          <div className="flex-1 h-5 rounded bg-notion-sidebar overflow-hidden">
            <div
              className={`h-full rounded ${colorClass} transition-all`}
              style={{ width: `${maxCount > 0 ? (item.count / maxCount) * 100 : 0}%` }}
            />
          </div>
          <span className="w-6 text-xs text-notion-text-tertiary text-right">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

const CATEGORY_BAR_COLORS: Record<TagCategory, string> = {
  domain: 'bg-blue-400',
  method: 'bg-purple-400',
  topic: 'bg-green-400',
};

export function ResearchProfileView({ profile }: { profile: ResearchProfileData }) {
  if (profile.totalPapers === 0) {
    return (
      <div className="rounded-xl border border-dashed border-notion-border py-12 text-center">
        <p className="text-sm text-notion-text-tertiary">
          No papers in this collection yet. Add papers to see the research profile.
        </p>
      </div>
    );
  }

  const { tagDistribution, yearDistribution, topAuthors } = profile;

  // Group tags by category
  const tagsByCategory: Record<TagCategory, typeof tagDistribution> = {
    domain: tagDistribution.filter((t) => t.category === 'domain'),
    method: tagDistribution.filter((t) => t.category === 'method'),
    topic: tagDistribution.filter((t) => t.category === 'topic'),
  };

  const maxTagCount = Math.max(...tagDistribution.map((t) => t.count), 1);
  const maxYearCount = Math.max(...yearDistribution.map((y) => y.count), 1);

  return (
    <div className="space-y-6">
      <div className="text-sm text-notion-text-secondary">
        {profile.totalPapers} paper{profile.totalPapers !== 1 ? 's' : ''} in collection
      </div>

      {/* Tag distribution by category */}
      {(['domain', 'method', 'topic'] as TagCategory[]).map((category) => {
        const tags = tagsByCategory[category];
        if (tags.length === 0) return null;
        const colors = CATEGORY_COLORS[category];
        return (
          <div key={category}>
            <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${colors.text}`}>
              {category}
            </h3>
            <BarChart
              items={tags.slice(0, 10).map((t) => ({ label: t.name, count: t.count }))}
              maxCount={maxTagCount}
              colorClass={CATEGORY_BAR_COLORS[category]}
            />
          </div>
        );
      })}

      {/* Year distribution */}
      {yearDistribution.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-notion-text-secondary mb-2">
            Publication Years
          </h3>
          <BarChart
            items={yearDistribution.map((y) => ({ label: String(y.year), count: y.count }))}
            maxCount={maxYearCount}
            colorClass="bg-blue-400"
          />
        </div>
      )}

      {/* Top authors */}
      {topAuthors.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-notion-text-secondary mb-2">
            Top Authors
          </h3>
          <div className="space-y-1">
            {topAuthors.map((author, i) => (
              <div key={author.name} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-xs text-notion-text-tertiary text-right">{i + 1}.</span>
                <span className="flex-1 truncate text-notion-text">{author.name}</span>
                <span className="text-xs text-notion-text-tertiary">
                  {author.count} paper{author.count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
