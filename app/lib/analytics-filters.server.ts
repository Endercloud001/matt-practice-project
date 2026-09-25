export const analyticsRanges = [
  "all",
  "last7days",
  "last30days",
  "lastYear",
  "custom",
] as const;
export type AnalyticsRange = (typeof analyticsRanges)[number];

export type AnalyticsFilters = {
  range: AnalyticsRange;
  instructorId?: number;
  courseId?: number;
  start?: string;
  end?: string;
  coursePage?: number;
  studentPage?: number;
};

export function parseAnalyticsFilters(
  searchParams: URLSearchParams,
  now = new Date()
): {
  query?: AnalyticsFilters;
  fields: Record<string, string[]>;
} {
  const fields: Record<string, string[]> = {};
  const rawRange = searchParams.get("range") ?? "all";
  const range = analyticsRanges.includes(rawRange as AnalyticsRange)
    ? (rawRange as AnalyticsRange)
    : "all";
  if (rawRange !== range) fields.range = ["Choose a supported date range."];

  const readId = (field: "instructorId" | "courseId") => {
    const raw = searchParams.get(field);
    if (raw === null || raw === "") return undefined;
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      fields[field] = [
        field === "courseId"
          ? "Enter a positive course ID."
          : "Enter a positive instructor ID.",
      ];
      return undefined;
    }
    return Number(raw);
  };
  const instructorId = readId("instructorId");
  const courseId = readId("courseId");
  const rawCoursePage = searchParams.get("coursePage");
  let coursePage: number | undefined;
  if (rawCoursePage !== null && rawCoursePage !== "") {
    if (
      !/^\d+$/.test(rawCoursePage) ||
      !Number.isSafeInteger(Number(rawCoursePage)) ||
      Number(rawCoursePage) < 1
    ) {
      fields.coursePage = ["Enter a positive course page number."];
    } else {
      coursePage = Number(rawCoursePage);
    }
  }
  const startRaw = searchParams.get("start");
  const rawStudentPage = searchParams.get("studentPage");
  let studentPage: number | undefined;
  if (rawStudentPage !== null && rawStudentPage !== "") {
    const page = Number(rawStudentPage);
    if (
      !/^\d+$/.test(rawStudentPage) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger((page - 1) * 20)
    ) {
      fields.studentPage = ["Enter a positive student page number."];
    } else {
      studentPage = page;
    }
  }
  const endRaw = searchParams.get("end");

  const readDate = (raw: string | null, field: "start" | "end") => {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      fields[field] = ["Enter a valid UTC calendar date."];
      return undefined;
    }
    const date = new Date(`${raw}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== raw
    ) {
      fields[field] = ["Enter a valid UTC calendar date."];
      return undefined;
    }
    return date.toISOString();
  };

  let start: string | undefined;
  let end: string | undefined;
  if (range === "custom") {
    start = readDate(startRaw, "start");
    end = readDate(endRaw, "end");
    if (start && end && start >= end)
      fields.end = ["End date must be after start date."];
  } else if (
    (startRaw && startRaw.length > 0) ||
    (endRaw && endRaw.length > 0)
  ) {
    fields.range = ["Custom dates require range=custom."];
  } else if (range !== "all") {
    const endDate = new Date(now);
    endDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const startDate = new Date(endDate);
    startDate.setUTCDate(
      startDate.getUTCDate() -
        (range === "last7days" ? 7 : range === "last30days" ? 30 : 365)
    );
    start = startDate.toISOString();
    end = endDate.toISOString();
  }

  return Object.keys(fields).length
    ? { fields }
    : {
        query: {
          range,
          ...(instructorId !== undefined ? { instructorId } : {}),
          ...(courseId !== undefined ? { courseId } : {}),
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
          ...(coursePage !== undefined ? { coursePage } : {}),
          ...(studentPage !== undefined ? { studentPage } : {}),
        },
        fields,
      };
}
