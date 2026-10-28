import { STATUS } from "../store/uploadStore";

export default function FileRow({ name, status, message }) {
  // Compute context-dependent border styling matching system tokens
  const getBorderColorClass = () => {
    switch (status) {
      case STATUS.ERROR:
        return "border-danger/30 bg-danger/5";
      case STATUS.SUCCESS:
        return "border-success/30 bg-success/5";
      default:
        return "border-border bg-surface";
    }
  };

  // Compute text styling for the file name string
  const getNameColorClass = () => {
    switch (status) {
      case STATUS.ERROR:
        return "text-danger";
      case STATUS.SUCCESS:
        return "text-success";
      default:
        return "text-ink";
    }
  };

  // Compute textual indicator label styling on the far right
  const getBadgeColorClass = () => {
    switch (status) {
      case STATUS.UPLOADING:
        return "text-chartizer-yellow";
      case STATUS.SUCCESS:
        return "text-success";
      case STATUS.ERROR:
        return "text-danger";
      default:
        return "text-ink-muted";
    }
  };

  return (
    <div
      className={`flex items-center gap-3 border rounded-xl px-3.5 py-2.5 transition-colors duration-200 ${getBorderColorClass()}`}
    >
      {/* Icon Status Indicator wrapper */}
      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
        {status === STATUS.UPLOADING && (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" className="stroke-border" strokeWidth="2.5" />
            <path d="M12 3a9 9 0 0 1 9 9" className="stroke-chartizer-yellow" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
        
        {status === STATUS.SUCCESS && (
          <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        
        {status === STATUS.ERROR && (
          <svg className="w-4 h-4 text-danger" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        
        {status === STATUS.WAITING && (
          <svg className="w-4 h-4 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>

      {/* Meta Text details block */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold truncate leading-tight ${getNameColorClass()}`}>
          {name}
        </p>
        {message && (
          <p className="text-[11px] text-ink-muted leading-tight mt-0.5">
            {message}
          </p>
        )}
      </div>

      {/* Dynamic string badge indicator */}
      <span className={`flex-shrink-0 text-[10px] font-bold tracking-wider uppercase select-none ${getBadgeColorClass()}`}>
        {status === STATUS.WAITING && "Waiting"}
        {status === STATUS.UPLOADING && "Uploading"}
        {status === STATUS.SUCCESS && "Done"}
        {status === STATUS.ERROR && "Failed"}
      </span>
    </div>
  );
}
