import { STATUS } from "../store/uploadStore";

export default function FileRow({ name, status, message }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.75rem",
      background: "#303134",
      border: `1px solid ${
        status === STATUS.ERROR   ? "#5c2d2d" :
        status === STATUS.SUCCESS ? "#1e3a2a" : "#3c3f43"
      }`,
      borderRadius: "0.625rem", padding: "0.625rem 0.875rem",
      transition: "border-color 0.2s",
    }}>
      <div style={{ flexShrink: 0, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {status === STATUS.UPLOADING && (
          <svg style={{ width: 18, height: 18, animation: "spin 0.8s linear infinite" }} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#3c3f43" strokeWidth="2.5" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="#8ab4f8" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
        {status === STATUS.SUCCESS && (
          <svg style={{ width: 18, height: 18, color: "#34a853" }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {status === STATUS.ERROR && (
          <svg style={{ width: 18, height: 18, color: "#f28b82" }} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        {status === STATUS.WAITING && (
          <svg style={{ width: 18, height: 18, color: "#5f6368" }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0, fontSize: 13, fontWeight: 500,
          color: status === STATUS.ERROR ? "#f28b82" : status === STATUS.SUCCESS ? "#34a853" : "#e8eaed",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{name}</p>
        {message && (
          <p style={{ margin: 0, fontSize: 11, color: "#9aa0a6", marginTop: 2 }}>{message}</p>
        )}
      </div>

      <span style={{
        flexShrink: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        color: status === STATUS.UPLOADING ? "#8ab4f8" :
               status === STATUS.SUCCESS   ? "#34a853" :
               status === STATUS.ERROR     ? "#f28b82" : "#5f6368",
      }}>
        {status === STATUS.WAITING   ? "Waiting"   : null}
        {status === STATUS.UPLOADING ? "Uploading" : null}
        {status === STATUS.SUCCESS   ? "Done"      : null}
        {status === STATUS.ERROR     ? "Failed"    : null}
      </span>
    </div>
  );
}
