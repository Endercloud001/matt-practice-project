import { Outlet } from "react-router";

export default function AnalyticsLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <a href="/" className="text-lg font-bold tracking-tight">
            Cadence
          </a>
          <nav aria-label="Main navigation" className="flex flex-wrap gap-2">
            <a
              className="rounded-md px-3 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              href="/instructor"
            >
              Instructor workspace
            </a>
            <a
              className="rounded-md bg-muted px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              href="/instructor/analytics"
              aria-current="page"
            >
              Analytics
            </a>
            <a
              className="rounded-md px-3 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              href="/admin/courses"
            >
              Admin courses
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 sm:p-8">
        <Outlet />
      </main>
    </div>
  );
}
