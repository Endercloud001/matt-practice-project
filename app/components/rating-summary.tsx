import { Star } from "lucide-react";

type RatingStarsProps = {
  value: number;
  label: string;
  className?: string;
};

export function RatingStars({ value, label, className }: RatingStarsProps) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      role="img"
      aria-label={label}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, value - index)) * 100;
        return (
          <span className="relative size-4" aria-hidden="true" key={index}>
            <Star className="absolute inset-0 size-4 text-muted-foreground/40" />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill}%` }}
            >
              <Star className="size-4 fill-amber-400 text-amber-400" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function RatingSummary({
  average,
  count,
}: {
  average: number | null;
  count: number;
}) {
  if (average === null || count === 0) return null;

  const displayedValue = Math.round((average + Number.EPSILON) * 10) / 10;
  const displayedAverage = displayedValue.toFixed(1);
  return (
    <div className="flex items-center gap-2 text-sm">
      <RatingStars
        value={displayedValue}
        label={`${displayedAverage} out of 5 stars`}
      />
      <span className="font-medium">{displayedAverage}</span>
      <span className="text-muted-foreground">
        ({count} {count === 1 ? "rating" : "ratings"})
      </span>
    </div>
  );
}
