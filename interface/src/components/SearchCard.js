export default function SearchCard({ result, apiUrl, onOpenPdf }) {
  function stripHtml(str) {
    if (!str) return str;
    const doc = new DOMParser().parseFromString(str, "text/html");
    return doc.body.textContent ?? "";
  }

  const {
    title, file, date, authors: rawAuthors,
    abstract, preview, snippet, category,
  } = result;

  const authors = rawAuthors ?? [];
  const displayAuthors = authors.length <= 3
    ? authors.join(", ")
    : `${authors.slice(0, 3).join(", ")} +${authors.length - 3} more`;

  const previewUrl  = preview ? `${apiUrl}${preview}` : null;
  const borderColor = category?.color ?? "var(--color-border)";
  const bodyHtml    = snippet || abstract || null;

  return (
    <article
      className="search-card group flex gap-5 bg-surface rounded-2xl p-5 transition-colors duration-150"
      style={{ border: `1px solid ${borderColor}` }}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <h2
          onClick={(e) => onOpenPdf(e, result)}
          className="text-base font-semibold text-ink leading-snug group-hover:text-accent transition-colors duration-150 cursor-default"
        >
          {stripHtml(title) || "Untitled"}
        </h2>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {authors.length > 0 && (
            <span className="text-ink-dim">{displayAuthors}</span>
          )}
          {date && (
            <>
              <span className="w-px h-3 bg-border" />
              <span>{date}</span>
            </>
          )}
          {file && (
            <>
              <span className="w-px h-3 bg-border" />
              <span className="font-mono truncate max-w-xs">{file}</span>
            </>
          )}
        </div>

        {bodyHtml && (
          <p
            className="cp-snippet text-sm text-ink-dim leading-relaxed line-clamp-4 mt-1
                       [&_b]:font-semibold [&_b]:text-ink [&_b]:bg-yellow-200/30
                       [&_b]:dark:bg-yellow-400/20 [&_b]:rounded [&_b]:px-0.5"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}
      </div>

      {previewUrl && (
        <button
          onClick={(e) => onOpenPdf(e, result)}
          className="search-card-thumb flex-shrink-0 w-28 self-start rounded-xl overflow-hidden border border-border
                     hover:border-accent/60 transition-all duration-200 hover:scale-105
                     hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent/40"
          title="Open PDF"
        >
          <img
            src={previewUrl}
            alt={`Preview of ${title}`}
            className="w-full aspect-[0.71] object-cover object-top"
          />
        </button>
      )}
    </article>
  );
}

