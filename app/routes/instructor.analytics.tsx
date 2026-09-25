import type { Route } from "./+types/instructor.analytics";
import { loadAnalyticsPage } from "~/lib/analytics-page.server";
import { AnalyticsPage } from "~/components/analytics-page";
export { HydrateFallback } from "~/components/analytics-page";

export async function loader({ request }: Route.LoaderArgs) {
  return loadAnalyticsPage({ request });
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  return serverLoader();
}
clientLoader.hydrate = true;

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  return <AnalyticsPage loaderData={loaderData} />;
}
