export function shouldSkipBookmarkRevalidation(opts: {
  actionResult: unknown;
  formData: FormData | undefined;
}) {
  return (
    opts.formData?.get("intent") === "bookmark" &&
    typeof opts.actionResult === "object" &&
    opts.actionResult !== null &&
    "success" in opts.actionResult &&
    opts.actionResult.success === true
  );
}
