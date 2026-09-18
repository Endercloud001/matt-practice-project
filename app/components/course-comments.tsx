import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { EllipsisVertical } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { UserRole } from "~/db/schema";

type Comment = {
  id: number;
  userId: number;
  authorName: string;
  content: string;
  createdAt: string;
};

type CommentActionData =
  | { success: true; intent: "comment" | "delete-comment" }
  | { success: false; error: string };

function formatCommentDate(date: string) {
  const value = new Date(date);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function CourseComments({
  comments,
  canComment,
  currentUserId,
  currentUserRole,
}: {
  comments: Comment[];
  canComment: boolean;
  currentUserId: number | null;
  currentUserRole: UserRole | null;
}) {
  return (
    <section className="mt-16 border-t pt-8" aria-label="Course comments">
      <h2 className="mb-5 text-2xl font-bold">Comments</h2>
      {canComment && <CommentForm />}
      <div className="divide-y">
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            canDelete={
              comment.userId === currentUserId ||
              currentUserRole === UserRole.Admin
            }
          />
        ))}
      </div>
    </section>
  );
}

function CommentForm() {
  const fetcher = useFetcher<CommentActionData>();
  const [content, setContent] = useState("");
  const pending = fetcher.state !== "idle";
  const trimmedLength = content.trim().length;

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.intent === "comment") {
      setContent("");
    }
  }, [fetcher.data]);

  return (
    <fetcher.Form method="post" className="mb-6 rounded-lg border p-3">
      <input name="intent" type="hidden" value="comment" />
      <Textarea
        name="content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Post your comment"
        aria-label="Write a comment"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{trimmedLength}/500</span>
        <Button
          type="submit"
          disabled={pending || trimmedLength < 10 || trimmedLength > 500}
        >
          {pending ? "Publishing…" : "Publish"}
        </Button>
      </div>
      {fetcher.data && !fetcher.data.success && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {fetcher.data.error}
        </p>
      )}
    </fetcher.Form>
  );
}

function CommentItem({
  comment,
  canDelete,
}: {
  comment: Comment;
  canDelete: boolean;
}) {
  const fetcher = useFetcher<CommentActionData>();
  const pending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.intent === "delete-comment") {
      window.location.reload();
    }
  }, [fetcher.data]);

  return (
    <article className="relative py-4">
      <div className="flex flex-wrap items-center gap-2 pr-10 text-sm">
        <span className="break-words font-medium">{comment.authorName}</span>
        <time
          className="break-words text-muted-foreground"
          dateTime={comment.createdAt}
        >
          {formatCommentDate(comment.createdAt)}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">
        {comment.content}
      </p>
      {canDelete && (
        <details className="absolute right-0 top-4">
          <summary
            className="cursor-pointer list-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Comment actions"
          >
            <EllipsisVertical className="size-4" />
          </summary>
          <fetcher.Form
            method="post"
            className="absolute right-0 z-10 mt-1 rounded-md border bg-background p-1 shadow-md"
          >
            <input name="intent" type="hidden" value="delete-comment" />
            <input name="commentId" type="hidden" value={comment.id} />
            <button
              className="rounded px-3 py-1.5 text-sm text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
          </fetcher.Form>
        </details>
      )}
      {fetcher.data && !fetcher.data.success && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {fetcher.data.error}
        </p>
      )}
    </article>
  );
}
