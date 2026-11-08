"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_arrIncludes,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, SearchX, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { tagById } from "@/lib/agent-tags";
import { api } from "../../../../../convex/_generated/api";
import { AgentLogo } from "../agent-logo";
import { ModelLogos } from "../agent-card";

type Row = FunctionReturnType<typeof api.agents.listMarketplace>[number];

// ─── table definition: module scope, so nothing here changes between renders ───────────────────────────────

/** Only what this grid uses. Prerequisite features come before the row-model slots that need them. */
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { text: sortFn_text, basic: sortFn_basic },
  filterFns: { arrIncludes: filterFn_arrIncludes },
});

const helper = createColumnHelper<typeof features, Row>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: "Agent",
    sortFn: "text",
    cell: ({ row }) => (
      <Link href={`/space/marketplace/${row.original.slug}`} className="group flex min-w-[200px] items-center justify-start gap-3 pl-2 text-left">
        <AgentLogo name={row.original.name} logoUrl={row.original.logoUrl} className="size-9 text-sm" />
        <span className="truncate text-[13px] font-semibold text-foreground group-hover:underline">{row.original.name}</span>
      </Link>
    ),
  }),
  helper.accessor("tags", {
    id: "tags",
    header: "Tags",
    enableSorting: false,
    filterFn: "arrIncludes",
    cell: ({ getValue }) => {
      const tags = getValue();
      return (
        <div className="flex flex-wrap items-center justify-center gap-1">
          {tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="secondary" className="whitespace-nowrap font-normal text-black dark:text-white">
              {tagById(t)?.label ?? t}
            </Badge>
          ))}
          {tags.length > 2 && <span className="text-[11px] text-black dark:text-white">+{tags.length - 2}</span>}
        </div>
      );
    },
  }),
  helper.accessor("models", {
    id: "models",
    header: "Models",
    enableSorting: false,
    enableColumnFilter: false,
    cell: ({ getValue }) => (
      <div className="flex justify-center">
        <ModelLogos models={getValue()} />
      </div>
    ),
  }),
  helper.accessor("ratingAvg", {
    id: "ratingAvg",
    header: "Rating",
    sortFn: "basic",
    sortDescFirst: true,
    cell: ({ row }) =>
      row.original.ratingCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-[13px] tabular-nums">
          <Star className="size-3.5 fill-amber-400 text-amber-400" strokeWidth={1.5} />
          {row.original.ratingAvg.toFixed(1)}
          <span className="text-xs text-muted-foreground">({row.original.ratingCount})</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">No reviews</span>
      ),
  }),
  helper.accessor("priceMicros", {
    id: "priceMicros",
    header: "Price",
    sortFn: "basic",
    sortUndefined: "last",
    cell: ({ row }) => <span className="whitespace-nowrap text-[13px] font-medium tabular-nums">{row.original.priceLabel}</span>,
  }),
  helper.accessor("totalRuns", {
    id: "totalRuns",
    header: "Success",
    sortFn: "basic",
    sortDescFirst: true,
    cell: ({ row }) =>
      row.original.successRate !== null ? (
        <span className="text-[13px] font-medium tabular-nums text-emerald-600">{row.original.successRate}%</span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Open</span>,
    cell: ({ row }) => (
      <Link
        href={`/space/marketplace/${row.original.slug}`}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-400 bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        View <ArrowRight className="size-3" />
      </Link>
    ),
  }),
]);

const EMPTY: Row[] = []; // stable fallback while Convex loads: a new [] each render would rebuild every row model
const PAGE_SIZES = [10, 25, 50];
const DEFAULT_SIZE = 10;
const DEFAULT_SORT: SortingState = [{ id: "ratingAvg", desc: true }];
const SORTABLE = new Set(["name", "ratingAvg", "priceMicros", "totalRuns"]);

/** Dark grid lines: horizontal and vertical, on every cell. */
const GRID = "border-b border-r border-neutral-400 text-center last:border-r-0 dark:border-neutral-600";

// ─── URL <-> table state: only the slices a shared link should keep ─────────────────────────────────────────

type UrlState = { sorting: SortingState; columnFilters: ColumnFiltersState; pagination: PaginationState };

function stateFromUrl(sp: URLSearchParams): UrlState {
  const [sortId, dir] = (sp.get("sort") ?? "").split(".");
  const size = Number(sp.get("size"));
  const page = Number(sp.get("page"));
  const tag = sp.get("tag");
  return {
    sorting: SORTABLE.has(sortId) ? [{ id: sortId, desc: dir !== "asc" }] : DEFAULT_SORT,
    columnFilters: tag ? [{ id: "tags", value: [tag] }] : [], // arrIncludes takes a list of tags
    pagination: { pageIndex: Number.isInteger(page) && page > 1 ? page - 1 : 0, pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_SIZE },
  };
}

function urlFromState(s: UrlState): string {
  const sp = new URLSearchParams();
  const tag = (s.columnFilters.find((f) => f.id === "tags")?.value as string[] | undefined)?.[0];
  if (tag) sp.set("tag", tag);
  const sort = s.sorting[0];
  const isDefault = sort && sort.id === DEFAULT_SORT[0].id && sort.desc === DEFAULT_SORT[0].desc;
  if (sort && !isDefault) sp.set("sort", `${sort.id}.${sort.desc ? "desc" : "asc"}`);
  if (s.pagination.pageIndex > 0) sp.set("page", String(s.pagination.pageIndex + 1));
  if (s.pagination.pageSize !== DEFAULT_SIZE) sp.set("size", String(s.pagination.pageSize));
  return sp.toString();
}

/** Writes the table's own state into the address bar (replace, so Back is not flooded). Renders nothing. */
function UrlWriter({ state }: { state: UrlState }) {
  const router = useRouter();
  const pathname = usePathname();
  const next = urlFromState(state);
  useEffect(() => {
    const current = window.location.search.replace(/^\?/, "");
    if (current !== next) router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [next, pathname, router]);
  return null;
}

// ─── pagination helpers ─────────────────────────────────────────────────────────────────────────────────────

/** 1 … 4 5 6 … 20: the first, the last and a window around the current page. */
function pageWindow(current: number, total: number): (number | "gap-a" | "gap-b")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "gap-a" | "gap-b")[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push("gap-a");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < total - 1) out.push("gap-b");
  out.push(total);
  return out;
}

// ─── the grid ────────────────────────────────────────────────────────────────────────────────────────────────

export function MarketplaceTable() {
  const rows = useQuery(api.agents.listMarketplace);
  const searchParams = useSearchParams();
  const [initialState] = useState(() => stateFromUrl(new URLSearchParams(searchParams.toString())));

  // The table's own store owns sorting, filters and paging. The owner render selects nothing; each region below
  // subscribes to just the slices it reads.
  const table = useTable(
    {
      features,
      columns,
      data: rows ?? EMPTY,
      initialState,
      autoResetPageIndex: false, // a shared ?page=3 must survive the data arriving; filter/sort handlers reset it themselves
      enableSortingRemoval: false,
    },
    () => ({}),
  );

  // tags that exist in the data, most used first, for the filter chips
  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows ?? EMPTY) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  }, [rows]);

  const loading = rows === undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ── tag filter ── */}
      <table.Subscribe selector={(s) => s.columnFilters}>
        {(filters) => {
          const active = (filters.find((f) => f.id === "tags")?.value as string[] | undefined)?.[0];
          const pick = (tag: string | undefined) => {
            table.getColumn("tags")?.setFilterValue(tag ? [tag] : undefined);
            table.setPageIndex(0);
          };
          return (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
              <Chip selected={!active} onClick={() => pick(undefined)}>
                All
              </Chip>
              {topTags.map(([id]) => (
                <Chip key={id} selected={active === id} onClick={() => pick(active === id ? undefined : id)}>
                  {tagById(id)?.label ?? id}
                </Chip>
              ))}
            </div>
          );
        }}
      </table.Subscribe>

      {/* ── grid: scrolls inside its own box, so the pagination below never moves ── */}
      <div className="min-h-0 flex-1 overflow-auto border-y border-neutral-800 bg-background dark:border-neutral-500">
        <Table className="border-collapse">
          <TableHeader className="sticky top-0 z-10 bg-muted [&_tr]:border-0">
            <table.Subscribe selector={(s) => s.sorting}>
              {(sorting) => (
                <>
                  {table.getHeaderGroups().map((group) => (
                    <TableRow key={group.id} className="border-0 hover:bg-transparent">
                      {group.headers.map((header) => {
                        const col = header.column;
                        const dir = sorting.find((s) => s.id === col.id);
                        const canSort = col.getCanSort();
                        return (
                          <TableHead
                            key={header.id}
                            aria-sort={dir ? (dir.desc ? "descending" : "ascending") : canSort ? "none" : undefined}
                            className={`h-10 whitespace-nowrap bg-muted text-[11px] font-semibold uppercase tracking-wide text-foreground/70 ${GRID} border-neutral-800 dark:border-neutral-500`}
                          >
                            {header.isPlaceholder ? null : canSort ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  col.getToggleSortingHandler()?.(e);
                                  table.setPageIndex(0);
                                }}
                                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 uppercase transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                              >
                                <table.FlexRender header={header} />
                                {dir ? (
                                  dir.desc ? <ArrowDown className="size-3 text-foreground" /> : <ArrowUp className="size-3 text-foreground" />
                                ) : (
                                  <ArrowUpDown className="size-3 opacity-40" />
                                )}
                              </button>
                            ) : (
                              <table.FlexRender header={header} />
                            )}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </>
              )}
            </table.Subscribe>
          </TableHeader>

          <TableBody>
            <table.Subscribe selector={(s) => ({ a: s.sorting, b: s.columnFilters, d: s.pagination })}>
              {() => {
                if (loading) {
                  return Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i} className="border-0 hover:bg-transparent">
                      {columns.map((_c, j) => (
                        <TableCell key={j} className={`py-3.5 ${GRID}`}>
                          <Skeleton className={j === 0 ? "h-9 w-48" : "h-4 w-16"} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ));
                }
                const list = table.getRowModel().rows;
                if (list.length === 0) {
                  return (
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="py-16 text-center">
                        <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                          <SearchX className="size-7 text-muted-foreground" strokeWidth={1.5} />
                          <p className="text-sm font-medium">No agents match</p>
                          <p className="text-xs text-muted-foreground">Try another tag.</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              table.resetColumnFilters();
                              table.setPageIndex(0);
                            }}
                          >
                            <X className="size-3.5" /> Clear filter
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }
                return list.map((row) => (
                  <TableRow key={row.id} className="border-0">
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id} className={`py-2.5 ${GRID}`}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ));
              }}
            </table.Subscribe>
          </TableBody>
        </Table>
      </div>

      {/* ── footer: always at the bottom. range, page size, shadcn pagination ── */}
      <table.Subscribe selector={(s) => ({ p: s.pagination, f: s.columnFilters })}>
        {({ p }) => {
          const total = table.getPrePaginatedRowModel().rows.length;
          const pages = Math.max(1, Math.ceil(total / p.pageSize));
          const current = Math.min(p.pageIndex + 1, pages);
          const first = total === 0 ? 0 : (current - 1) * p.pageSize + 1;
          const last = Math.min(current * p.pageSize, total);
          const go = (page: number) => table.setPageIndex(Math.min(Math.max(page, 1), pages) - 1);
          const link = (page: number) => (e: React.MouseEvent) => {
            e.preventDefault();
            go(page);
          };
          return (
            <div className="flex shrink-0 flex-col items-center gap-3 sm:flex-row sm:justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="tabular-nums">{total === 0 ? "No results" : `Showing ${first}-${last} of ${total}`}</span>
                <label className="flex items-center gap-2">
                  Rows
                  <NativeSelect
                    size="sm"
                    value={p.pageSize}
                    aria-label="Rows per page"
                    onChange={(e) => {
                      table.setPageSize(Number(e.target.value));
                      table.setPageIndex(0);
                    }}
                  >
                    {PAGE_SIZES.map((n) => (
                      <NativeSelectOption key={n} value={n}>
                        {n}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              </div>

              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={link(current - 1)}
                      aria-disabled={current === 1}
                      className={current === 1 ? "pointer-events-none opacity-40" : ""}
                    />
                  </PaginationItem>
                  {pageWindow(current, pages).map((item) =>
                    typeof item === "number" ? (
                      <PaginationItem key={item}>
                        <PaginationLink href="#" isActive={item === current} onClick={link(item)}>
                          {item}
                        </PaginationLink>
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={item}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={link(current + 1)}
                      aria-disabled={current === pages}
                      className={current === pages ? "pointer-events-none opacity-40" : ""}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          );
        }}
      </table.Subscribe>

      {/* shareable link: sorting, tag filter and page go to the URL */}
      <table.Subscribe selector={(s) => ({ sorting: s.sorting, columnFilters: s.columnFilters, pagination: s.pagination })}>
        {(s) => <UrlWriter state={s} />}
      </table.Subscribe>
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-black hover:border-foreground/40 dark:text-white"
      }`}
    >
      {children}
    </button>
  );
}
