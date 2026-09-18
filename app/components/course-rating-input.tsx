import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useFetcher } from "react-router";
import { Star } from "lucide-react";
import { RatingStars } from "~/components/rating-summary";

type RatingActionData =
  | { success: true; rating: number }
  | { success: false; error: string };

type CourseRatingInputProps = {
  personalRating: number | null;
  canRate: boolean;
  reason: string | null;
};

function ratingLabel(value: number) {
  return `${value} ${value === 1 ? "star" : "stars"}`;
}

export function CourseRatingInput({
  personalRating,
  canRate,
  reason,
}: CourseRatingInputProps) {
  const fetcher = useFetcher<RatingActionData>();
  const [selectedRating, setSelectedRating] = useState(personalRating);
  const [error, setError] = useState<string | null>(null);
  const wasSubmitting = useRef(false);
  const pending = fetcher.state !== "idle";

  useEffect(() => {
    if (!pending && !wasSubmitting.current) {
      setSelectedRating(personalRating);
    }
  }, [pending, personalRating]);

  useEffect(() => {
    if (pending) {
      wasSubmitting.current = true;
      return;
    }
    if (!wasSubmitting.current) return;

    wasSubmitting.current = false;
    if (fetcher.data?.success) {
      setSelectedRating(fetcher.data.rating);
      setError(null);
    } else if (fetcher.data && !fetcher.data.success) {
      setSelectedRating(personalRating);
      setError(fetcher.data.error);
    }
  }, [fetcher.data, pending, personalRating]);

  if (!canRate) {
    if (personalRating === null) return null;
    return (
      <div>
        <div className="mb-2 text-sm font-medium">Your rating</div>
        <RatingStars
          value={personalRating}
          label={`Your rating: ${ratingLabel(personalRating)}`}
          className="[&>span]:size-6 [&_svg]:size-6"
        />
        {reason && (
          <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
        )}
      </div>
    );
  }

  function selectRating(value: number) {
    if (pending) return;
    setSelectedRating(value);
    setError(null);
    void fetcher.submit(
      { rating: String(value) },
      { method: "post", encType: "application/x-www-form-urlencoded" }
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (pending) return;
    const current = selectedRating ?? 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = Math.min(5, current + 0.5);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = Math.max(1, current - 0.5);
    } else if (event.key === "Home") {
      next = 1;
    } else if (event.key === "End") {
      next = 5;
    }
    if (next !== null) {
      event.preventDefault();
      selectRating(next);
    }
  }

  return (
    <div>
      <div className="mb-2 text-sm font-medium">Your rating</div>
      <div
        className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="radiogroup"
        aria-label="Rate this course"
        aria-disabled={pending}
        tabIndex={pending ? -1 : 0}
        onKeyDown={handleKeyDown}
      >
        {Array.from({ length: 5 }, (_, index) => {
          const starNumber = index + 1;
          const fill = Math.max(0, Math.min(1, (selectedRating ?? 0) - index));
          const choices =
            starNumber === 1 ? [1] : [starNumber - 0.5, starNumber];
          return (
            <span className="relative size-8" key={starNumber}>
              <Star className="absolute inset-1 size-6 text-muted-foreground/40" />
              <span
                className="absolute inset-1 overflow-hidden"
                style={{ width: `${fill * 24}px` }}
                aria-hidden="true"
              >
                <Star className="size-6 fill-amber-400 text-amber-400" />
              </span>
              {choices.map((value, choiceIndex) => (
                <button
                  className={`absolute inset-y-0 ${
                    choices.length === 1
                      ? "inset-x-0"
                      : choiceIndex === 0
                        ? "left-0 w-1/2"
                        : "right-0 w-1/2"
                  } cursor-pointer disabled:cursor-not-allowed`}
                  type="button"
                  role="radio"
                  aria-label={ratingLabel(value)}
                  aria-checked={selectedRating === value}
                  disabled={pending}
                  tabIndex={-1}
                  key={value}
                  onClick={() => selectRating(value)}
                />
              ))}
            </span>
          );
        })}
      </div>
      <div className="mt-2 min-h-5 text-sm" aria-live="polite">
        {pending ? (
          <span className="text-muted-foreground">Saving…</span>
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : selectedRating !== null ? (
          <span className="text-muted-foreground">
            {ratingLabel(selectedRating)} selected
          </span>
        ) : (
          <span className="text-muted-foreground">Choose 1 to 5 stars</span>
        )}
      </div>
    </div>
  );
}
