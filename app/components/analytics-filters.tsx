import { Form, useLocation } from "react-router";
import { UserRole } from "~/db/schema";
import { cn } from "~/lib/utils";
import type {
  AnalyticsPageData,
  AnalyticsPageError,
} from "~/lib/analytics-page-data";

function ScopeFilter({
  name,
  value,
  options,
  onChange,
}: {
  name: "instructorId" | "courseId";
  value: string | number | null;
  options: ({ id: number; name: string } | { id: number; title: string })[];
  onChange?: () => void;
}) {
  const instructor = name === "instructorId";
  return (
    <label className="grid gap-1 text-sm sm:max-w-xs">
      {instructor ? "Instructor" : "Course"}
      <select
        name={name}
        defaultValue={value ?? ""}
        onChange={onChange}
        className="h-10 rounded-md border bg-background px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <option value="">
          {instructor ? "All instructors" : "All authorized courses"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {"name" in option ? option.name : option.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateFilter({ name, value }: { name: "start" | "end"; value: string }) {
  return (
    <label className="grid gap-1 text-sm">
      {name === "start" ? "Start date" : "End date"}
      <input
        type="date"
        name={name}
        defaultValue={value}
        className="h-10 rounded-md border bg-background px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      />
    </label>
  );
}

export function AnalyticsFilters({
  data,
  disabled,
}: {
  data: AnalyticsPageData;
  disabled: boolean;
}) {
  const location = useLocation();
  const course = data.course;
  const currentRange = data.range;
  const currentInstructor =
    new URLSearchParams(location.search).get("instructorId") ?? "";
  const clearCustomDates = () => {
    const startInput = document.querySelector<HTMLInputElement>(
      'input[name="start"]'
    );
    const endInput =
      document.querySelector<HTMLInputElement>('input[name="end"]');
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
  };
  return (
    <Form
      key={location.key}
      method="get"
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="text-sm font-semibold">Filters</legend>
        {!course && data.viewer?.role === UserRole.Admin && (
          <ScopeFilter
            name="instructorId"
            value={currentInstructor}
            options={data.instructors}
            onChange={() => {
              const course = document.querySelector<HTMLSelectElement>(
                'select[name="courseId"]'
              );
              if (course) course.value = "";
            }}
          />
        )}
        <div className="flex flex-wrap gap-2" aria-label="Date range presets">
          {(
            [
              ["all", "All history"],
              ["last7days", "Last 7 days"],
              ["last30days", "Last 30 days"],
              ["lastYear", "Last year"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="submit"
              name="range"
              value={value}
              onClick={clearCustomDates}
              className={cn(
                "rounded-md border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                currentRange === value
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <details open={currentRange === "custom"}>
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Custom date range
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DateFilter
              name="start"
              value={currentRange === "custom" ? data.dates.start : ""}
            />
            <DateFilter
              name="end"
              value={currentRange === "custom" ? data.dates.end : ""}
            />
          </div>
          <button
            type="submit"
            name="range"
            value="custom"
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Apply custom dates
          </button>
        </details>
        {!course && (
          <ScopeFilter
            name="courseId"
            value={data.filters.courseId}
            options={data.courses}
          />
        )}
        <button
          type="submit"
          name="range"
          value={currentRange}
          onClick={() => {
            if (currentRange !== "custom") clearCustomDates();
          }}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Apply filters
        </button>
      </fieldset>
    </Form>
  );
}

export function AnalyticsFilterRecovery({
  errorData,
}: {
  errorData?: AnalyticsPageError;
}) {
  const location = useLocation();
  const course = errorData?.course;
  const currentScope = new URLSearchParams(location.search);
  const resetHref = course
    ? `/instructor/analytics/${course.id}`
    : "/instructor/analytics";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Correct the analytics filters</h1>
      {course && <p className="font-medium">{course.title}</p>}
      <Form
        key={location.key}
        method="get"
        className="space-y-3 rounded-xl border bg-card p-4"
      >
        <fieldset className="grid gap-3 sm:max-w-xl">
          <legend className="font-medium">Filters</legend>
          {errorData?.fields &&
            Object.entries(errorData.fields).map(([field, errors]) => (
              <p key={field} role="alert" className="text-sm text-destructive">
                {field}: {errors.join(" ")}
              </p>
            ))}
          <label className="grid gap-1 text-sm">
            Date range
            <select
              name="range"
              defaultValue={currentScope.get("range") ?? "all"}
              className="h-10 rounded-md border bg-background px-3"
            >
              <option value="all">All history</option>
              <option value="last7days">Last 7 days</option>
              <option value="last30days">Last 30 days</option>
              <option value="lastYear">Last year</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          {!course && errorData?.viewer?.role === UserRole.Admin && (
            <ScopeFilter
              name="instructorId"
              value={currentScope.get("instructorId") ?? ""}
              options={errorData.instructors ?? []}
            />
          )}
          {!course && (
            <ScopeFilter
              name="courseId"
              value={currentScope.get("courseId") ?? ""}
              options={errorData?.courses ?? []}
            />
          )}
          <DateFilter name="start" value={currentScope.get("start") ?? ""} />
          <DateFilter name="end" value={currentScope.get("end") ?? ""} />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Apply corrected filters
          </button>
        </fieldset>
      </Form>
      <a href={resetHref} className="underline">
        Reset filters
      </a>
    </div>
  );
}
