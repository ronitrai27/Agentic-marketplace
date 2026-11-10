"use client";

import React from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Loupe } from "@lucasmarkes/hairline/react";
import { Star, ThumbsUp, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/agent-display";
import { AgentRating } from "../agent-rating";
import { refreshAgentPage } from "@/app/actions/agent-page-cache";
import { api } from "../../../../../convex/_generated/api";

type ReviewItem = {
  id: string;
  userName: string;
  userAvatar: string | null;
  rating: number;
  comment: string;
  likes: number;
  createdAt: number;
  isOwner: boolean;
  isMine?: boolean;
};

const LIKED_KEY = "catelog:liked-reviews";
const MAX_COMMENT = 1000;
const PAGE_SIZE = 8;

function readLiked(): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem(LIKED_KEY) ?? "[]") as string[],
    );
  } catch {
    return new Set();
  }
}

function writeLiked(set: Set<string>) {
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify([...set]));
  } catch {
    // private mode; likes still count, they just are not remembered
  }
}

const errMessage = (e: unknown, fallback: string) =>
  e instanceof ConvexError &&
  typeof (e.data as { message?: string })?.message === "string"
    ? (e.data as { message: string }).message
    : fallback;

/** Five stars, each filled in proportion to the value, so halves show as half stars. */
function Stars({ value, size = "size-4" }: { value: number; size?: string }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, value - (n - 1))) * 100;
        return (
          <span key={n} className={`relative ${size}`} aria-hidden>
            <Star
              className={`absolute inset-0 ${size} text-primary`}
              strokeWidth={1.5}
            />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill}%` }}
            >
              <Star
                className={`${size} fill-primary text-primary`}
                strokeWidth={1.5}
              />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Pick 1 to 5 in half steps: the left half of a star is x.5, the right half is x.0. */
function StarInput({
  value,
  onChange,
  onHover,
}: {
  value: number;
  onChange: (n: number) => void;
  onHover: (n: number) => void;
}) {
  const [hover, setHover] = React.useState(0);
  const shown = hover || value;
  const valueAt = (n: number, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = e.clientX - r.left < r.width / 2 ? n - 0.5 : n;
    return Math.max(1, v);
  };
  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseLeave={() => {
        setHover(0);
        onHover(0);
      }}
      role="radiogroup"
      aria-label="Rating"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, shown - (n - 1))) * 100;
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} stars`}
            onMouseMove={(e) => {
              const v = valueAt(n, e);
              setHover(v);
              onHover(v);
            }}
            onClick={(e) => onChange(valueAt(n, e))}
            className="relative size-6 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              className="absolute inset-0 size-6 text-muted-foreground/50"
              strokeWidth={1.5}
            />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill}%` }}
            >
              <Star
                className="size-6 fill-amber-400 text-amber-400"
                strokeWidth={1.5}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className="size-12 shrink-0 rounded-full object-cover"
    />
  ) : (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function ReviewForm({ slug, onClose }: { slug: string; onClose: () => void }) {
  const create = useMutation(api.reviews.create);
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (rating < 1) return toast.error("Pick a star rating first.");
    if (!comment.trim())
      return toast.error("Write a few words about your experience.");
    setBusy(true);
    try {
      await create({ slug, rating, comment });
      await refreshAgentPage(slug);
      toast.success("Thanks for your review");
      onClose();
    } catch (e) {
      toast.error(errMessage(e, "Could not save your review."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <AgentRating value={hover || rating} align="left" />
        <StarInput value={rating} onChange={setRating} onHover={setHover} />
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
        placeholder="What worked, what did not?"
        rows={3}
        className="resize-none"
        autoFocus
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {comment.length}/{MAX_COMMENT}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Posting…" : "Post review"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({
  r,
  liked,
  onLike,
  onDelete,
}: {
  r: ReviewItem;
  liked: boolean;
  onLike: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex gap-4 py-1! first:pt-0">
      <Avatar src={r.userAvatar} name={r.userName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {r.userName}
            </p>
            {r.isOwner && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Owner
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {fmtDate(r.createdAt)}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
          {r.comment}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {r.rating.toFixed(1)}
            </span>
            <Stars value={r.rating} />
          </div>
          <div className="flex items-center gap-3 text-xs text-foreground">
            {r.isMine && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1 hover:text-destructive"
              >
                <Trash2 className="size-4" /> Delete
              </button>
            )}
            <button
              type="button"
              onClick={onLike}
              aria-pressed={liked}
              className={`inline-flex items-center gap-1.5 hover:text-primary ${liked ? "text-yellow-500" : ""}`}
            >
              <ThumbsUp
                className={`size-4 ${liked ? "fill-yellow-500/20" : ""}`}
              />
              <span className="tabular-nums">{r.likes}</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Reviews for the agent page. Rating and the first page come from the Redis-cached page; the list itself loads live,
 * latest 8 only. Saving or deleting a review drops the cached page so the average catches up.
 */
export function AgentReviews({
  slug,
  initial,
}: {
  slug: string;
  initial: ReviewItem[];
}) {
  const status = useQuery(api.reviews.status, { slug });
  const {
    results,
    status: pageStatus,
  } = usePaginatedQuery(
    api.reviews.list,
    { slug },
    { initialNumItems: PAGE_SIZE },
  );
  const removeReview = useMutation(api.reviews.remove);
  const likeReview = useMutation(api.reviews.like);
  const [liked, setLiked] = React.useState<Set<string>>(new Set());
  React.useEffect(() => setLiked(readLiked()), []);

  const live = pageStatus !== "LoadingFirstPage";
  // Only the latest 8 are shown
  const items: ReviewItem[] = (live ? (results as ReviewItem[]) : initial).slice(0, PAGE_SIZE);

  async function onLike(r: ReviewItem) {
    const wasLiked = liked.has(r.id);
    const next = new Set(liked);
    if (wasLiked) next.delete(r.id);
    else next.add(r.id);
    setLiked(next);
    writeLiked(next);
    try {
      await likeReview({ reviewId: r.id as never, delta: wasLiked ? -1 : 1 });
    } catch (e) {
      setLiked(liked);
      writeLiked(liked);
      toast.error(errMessage(e, "Sign in to like reviews."));
    }
  }

  async function onDelete(r: ReviewItem) {
    try {
      await removeReview({ slug, reviewId: r.id as never });
      await refreshAgentPage(slug);
      toast.success("Review deleted");
    } catch (e) {
      toast.error(errMessage(e, "Could not delete your review."));
    }
  }

  const [writing, setWriting] = React.useState(false);
  let formArea: React.ReactNode = null;
  if (status?.signedIn && status.canReview) {
    formArea = writing ? (
      <ReviewForm slug={slug} onClose={() => setWriting(false)} />
    ) : (
      <div>
        <Button size="sm" variant="default" onClick={() => setWriting(true)}>
          <Pencil className="size-3.5" />
          {status.mine ? "Add new review" : "Add review"}
        </Button>
      </div>
    );
  } else if (status?.signedIn && !status.canReview)
    formArea = (
      <p className="text-xs text-muted-foreground">
        Run this agent once to leave a review.
      </p>
    );
  else if (status && !status.signedIn)
    formArea = (
      <p className="text-xs text-muted-foreground">
        Sign in and run this agent to leave a review.
      </p>
    );

  return (
    <div className="space-y-5">
      {formArea}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <div className="w-56 max-w-full">
            <Loupe />
          </div>
          <p className="text-sm text-muted-foreground">
            No review yet, be first to use and review!
          </p>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto scrollbar-thin border-b p-2">
          <ul className="divide-y divide-border">
            {items.map((r) => (
              <ReviewRow
                key={r.id}
                r={r}
                liked={liked.has(r.id)}
                onLike={() => onLike(r)}
                onDelete={() => onDelete(r)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
