import { useMemo, useRef, useState } from "react";
import type { WorkshopItem, WorkshopSearchResponse } from "./types";

export interface WorkshopSearchProps {
  /**
   * Runs GET /api/workshop/search. Injected rather than reached for directly so
   * this component owns no base url and every test drives it without a fetch.
   */
  search: (q: string, cursor?: string) => Promise<WorkshopSearchResponse>;
  /**
   * Installs by workshop id alone - the daemon resolves the title from Steam.
   * The same callback the Add form uses, so installing from a search result
   * goes through exactly the same guard, error and refresh path.
   */
  onInstall: (id: string) => void;
  /** True while a mod/server task is streaming. */
  busy: boolean;
  running: boolean;
  /** Managed mod ids, so an already-installed result offers no second install. */
  installedIds: string[];
}

/**
 * A cursor is only meaningful against the query that produced it. Steam ranks
 * a typed search by vote and an empty one by trend (`query_type` 0 vs 9), so
 * replaying a cursor against different text pages through a differently
 * ordered result set entirely. They travel together for that reason.
 */
interface NextPage {
  cursor: string;
  query: string;
}

/** 29581 -> "30k". The exact figure lives in the row's tooltip. */
function formatSubs(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
}

/**
 * Client-side reordering of the results already fetched. Deliberately NOT a
 * page-scoped resort: a "Load more" appends the next batch in Steam's order,
 * so an explicit sort applies only to what is on screen, and items that
 * Steam ranked onto later pages are not pulled forward. That is the stated
 * trade-off of the client-side sort - the daemon's server-side query_type
 * sort is the correct way to get a fully ordered result set.
 */
export type WorkshopSort = "relevance" | "updated" | "created" | "installs";

export const WORKSHOP_SORTS: ReadonlyArray<{ key: WorkshopSort; label: string }> = [
  { key: "relevance", label: "Relevance" },
  { key: "updated", label: "Date updated" },
  { key: "created", label: "Date created" },
  { key: "installs", label: "Installs" },
];

/**
 * Descending dates with an unknown date sorting last. `-byDate(x, y)` would
 * flip the nulls to the front (an unknown date would pose as the newest), so
 * a descending sort gets its own arithmetic rather than a negation of an
 * ascending one.
 */
function byDateDesc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * Returns a NEW array so React state (items) is never mutated in place.
 * "relevance" is the identity: whatever order Steam returned, including after
 * a "Load more" append.
 */
export function sortWorkshopItems(items: WorkshopItem[], sort: WorkshopSort): WorkshopItem[] {
  if (sort === "relevance") return [...items];
  const out = [...items];
  out.sort((x, y) => {
    switch (sort) {
      case "updated":
        return byDateDesc(x.updatedAt, y.updatedAt);
      case "created":
        return byDateDesc(x.createdAt, y.createdAt);
      case "installs":
        return y.subscriptions - x.subscriptions;
      default:
        return sort satisfies never, 0;
    }
  });
  return out;
}

/**
 * Steam's cursor paging walks a result set that can shift between pages, so
 * the same id can legitimately arrive twice. Two rows for one mod would also
 * be two identical React keys.
 */
function dedupeById(items: WorkshopItem[]): WorkshopItem[] {
  const seen = new Set<string>();
  const out: WorkshopItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function rowTitle(item: WorkshopItem): string {
  const parts = [
    item.title,
    `Workshop id: ${item.id}`,
    `${item.subscriptions.toLocaleString()} subscribers`,
  ];
  if (item.updatedAt !== null) parts.push(`Updated ${item.updatedAt.slice(0, 10)}`);
  if (item.fileSize > 0) parts.push(`${Math.round(item.fileSize / 1024)} KB`);
  if (item.description.length > 0) parts.push("", item.description);
  return parts.join("\n");
}

export function WorkshopSearch({ search, onInstall, busy, running, installedIds }: WorkshopSearchProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WorkshopItem[]>([]);
  const [nextPage, setNextPage] = useState<NextPage | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sort, setSort] = useState<WorkshopSort>("relevance");

  const locked = busy || running;

  // Derived on each render (cheap: the list is at most a few pages), so a
  // change of `sort` or a "Load more" append both reorder correctly. The
  // state array itself is never mutated - sortWorkshopItems returns a copy.
  const sortedItems = useMemo(() => sortWorkshopItems(items, sort), [items, sort]);

  // Same shape as App's candidate guard: a slow first page can land after the
  // user has already run a second search, and only the newest request may
  // write results. Paging is included, so a "Load more" answered after a fresh
  // search cannot append a previous query's items onto the new list.
  const seq = useRef(0);

  /**
   * `page` absent means a fresh search for whatever is in the box; present
   * means the next page of the query that cursor was minted for, which is NOT
   * necessarily what the box says now - the user is free to retype without
   * submitting, and paging must not silently adopt the new text.
   */
  const runSearch = (page?: NextPage) => {
    const text = page?.query ?? query;
    const mine = ++seq.current;
    setLoading(true);
    setSearched(true);
    // Cleared as the request goes out, not when it lands: otherwise a 503 or a
    // Steam outage message sits under "Searching..." for the daemon's full
    // 10s timeout, describing a request that is already over.
    setError(null);
    search(text, page?.cursor)
      .then((r) => {
        if (mine !== seq.current) return;
        setItems((prev) => dedupeById(page === undefined ? r.items : [...prev, ...r.items]));
        setNextPage(r.nextCursor === null ? null : { cursor: r.nextCursor, query: text });
        setTotal(r.total);
      })
      .catch((e: Error) => {
        if (mine !== seq.current) return;
        // The daemon's own words, verbatim. A box with no Steam API key gets a
        // 503 whose message says exactly that and exactly where to fix it;
        // replacing it with "search failed" would throw away the only
        // actionable thing in the response.
        setError(e.message);
        // A failed *page* keeps what is already on screen; only a failed fresh
        // search clears the list it was replacing.
        if (page === undefined) {
          setItems([]);
          setNextPage(null);
          setTotal(0);
        }
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  };

  return (
    <div className="workshop">
      <form
        className="workshop-form"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <label htmlFor="workshop-q">Search the Steam Workshop</label>
        <input
          id="workshop-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Leave empty to browse trending"
        />
        {/* Deliberately NOT disabled while a search is outstanding: the
            daemon gives Steam a full 10s before it gives up, and freezing the
            one control the user has for that long is worse than allowing a
            second request. The sequence guard above is what makes overlapping
            searches safe, so the button does not have to. */}
        <button type="submit">Search</button>
        <label className="workshop-sort" htmlFor="workshop-sort">
          Sort by
          <select
            id="workshop-sort"
            value={sort}
            onChange={(e) => {
              const v = e.target.value;
              setSort(WORKSHOP_SORTS.some((o) => o.key === v) ? (v as WorkshopSort) : "relevance");
            }}
          >
            {WORKSHOP_SORTS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      {error !== null && (
        <p className="hint hint-bad" role="alert">
          {error}
        </p>
      )}

      {loading && items.length === 0 && <p className="hint">Searching&hellip;</p>}

      {searched && !loading && error === null && items.length === 0 && (
        <p className="hint">No workshop mods matched.</p>
      )}

      {items.length > 0 && (
        <p className="hint">
          Showing {items.length} of {total}
        </p>
      )}

      {running && <p className="hint hint-warn">Stop the server to install mods.</p>}
      {!running && busy && (
        <p className="hint hint-warn">A task is already running &mdash; wait for it to finish.</p>
      )}

      <ul className="workshop-list">
        {sortedItems.map((item) => {
          const installed = installedIds.includes(item.id);
          return (
            <li key={item.id} title={rowTitle(item)}>
              {/* Decorative: the title sits right beside it, so an alt would
                  only make a screen reader say the name twice. */}
              {item.previewUrl.length > 0 && (
                <img className="workshop-thumb" src={item.previewUrl} alt="" loading="lazy" />
              )}
              <span className="workshop-text">
                <span className="mod-name">{item.title}</span>
                {item.description.length > 0 && (
                  <span className="workshop-blurb">{item.description}</span>
                )}
              </span>
              <span className="workshop-subs" title={`${item.subscriptions.toLocaleString()} subscribers`}>
                {formatSubs(item.subscriptions)}
              </span>
              <button
                aria-label={`Install ${item.title}`}
                disabled={locked || installed}
                title={
                  installed
                    ? "Already installed"
                    : running
                      ? "Stop the server to change mods"
                      : busy
                        ? "A task is already running"
                        : "Installs by workshop id; the daemon resolves the name from Steam"
                }
                onClick={() => onInstall(item.id)}
              >
                {installed ? "Installed" : "Install"}
              </button>
            </li>
          );
        })}
      </ul>

      {nextPage !== null && (
        <button className="workshop-more" disabled={loading} onClick={() => runSearch(nextPage)}>
          Load more
        </button>
      )}
    </div>
  );
}
