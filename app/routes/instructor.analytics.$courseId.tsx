import { z } from "zod";
import type { Route } from "./+types/instructor.analytics.$courseId";
import { parseParams } from "~/lib/validation";
import { loadAnalyticsPage } from "~/lib/analytics-page.server";
import {
  AnalyticsPage,
  CourseAnalyticsFallback,
} from "~/components/analytics-page";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { courseId } = parseParams(
    params,
    z.object({
      courseId: z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number)
        .pipe(z.number().int().positive().safe()),
    })
  );
  return loadAnalyticsPage({ request, courseId });
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  return serverLoader();
}
clientLoader.hydrate = true;

export function HydrateFallback() {
  return <CourseAnalyticsFallback />;
}

export default function CourseAnalytics({ loaderData }: Route.ComponentProps) {
  return <AnalyticsPage loaderData={loaderData} />;
}
