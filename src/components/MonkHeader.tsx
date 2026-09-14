// The header every Monk Mode page wears: what you are looking at, and the way
// to the other four views of it.
//
// One component rather than a layout, because the title is different on every
// page and a layout would have to render the navigation above it — which puts
// the controls before the thing they control. Here the two share a row, which
// is where the rest of the app puts a page title and its actions.

import MonkModeNav from "@/components/MonkModeNav";

export default function MonkHeader({
  title,
  subtitle,
}: {
  // A node rather than a string: the dashboard's title is the shared
  // <Greeting>, which picks itself on the server and re-checks itself in the
  // browser, and the other pages' are plain headings.
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {title}
        {subtitle && (
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
        )}
      </div>
      <MonkModeNav />
    </div>
  );
}
