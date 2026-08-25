"use client";

// Filter state that lives in the URL rather than in a component.
//
// Discovery and the pipeline both open on a list somebody narrows before they
// click into anything — a tier, a stage, a source, a sort. Held in React state
// that narrowing is gone the moment the row is opened, and pressing Back lands
// on the unfiltered list rather than on the list that was actually being read.
// Held in the query string it survives the round trip for free: the browser
// already remembers URLs, so Back restores the exact view and Forward
// re-advances to it.
//
// Writes go through router.replace rather than push. Every keystroke in a
// search box and every press of a tier button would otherwise be its own
// history entry, and Back would walk through the filtering instead of leaving
// the page. Replace keeps one entry per page, holding whatever the filters
// last said — which is precisely what Back needs to restore.
//
// Defaults are never written. A parameter equal to its default is dropped, so
// an untouched list has a clean URL and two ways of expressing the same view
// cannot exist.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const raw = params.get(key);
  const value = useMemo<T>(() => {
    if (raw === null) return fallback;
    if (allowed && !(allowed as readonly string[]).includes(raw)) return fallback;
    return raw as T;
  }, [raw, fallback, allowed]);

  const set = useCallback(
    (next: T) => {
      const search = new URLSearchParams(params.toString());
      if (next === fallback) search.delete(key);
      else search.set(key, next);
      const qs = search.toString();
      // scroll: false because a filter is read where it was pressed — jumping
      // to the top of the page on every press would lose the row being looked
      // at along with it.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, key, fallback],
  );

  return [value, set];
}
