"use client";
import { useEffect } from "react";

export default function PdfModal({ modal, modalStage, onClose }) {
  const isOpen    = modalStage === "open";
  const isClosing = modalStage === "closing";

  useEffect(() => {
    if (modal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);

    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [modal, onClose]);

  if (!modal) return null;

  return (
    <div
      onClick={onClose}
      style={{ transition: "opacity 300ms" }}
      className={`fixed inset-0 z-50 flex items-center justify-center
        ${isOpen    ? "bg-black/70" : "bg-black/0"}
        ${isClosing ? "bg-black/0"  : ""}
      `}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transition: "all 350ms cubic-bezier(0.4, 0, 0.2, 1)",
          width:    isOpen ? "90vw" : `${modal.rect.width}px`,
          height:   isOpen ? "90vh" : `${modal.rect.height}px`,
          position: "fixed",
          top:      isOpen ? "5vh"  : `${modal.rect.top}px`,
          left:     isOpen ? "5vw"  : `${modal.rect.left}px`,
          borderRadius: isOpen ? "12px" : "4px",
          overflow: "hidden",
          boxShadow: isOpen ? "0 25px 60px rgba(0,0,0,0.8)" : "none",
        }}
      >
        {!isOpen && (
          <img src={modal.previewUrl} alt="" className="w-full h-full object-cover" />
        )}
        {isOpen && (
          <embed
            src={modal.pdfUrl}
            className="w-full h-full border-0 bg-[#303134]"
            title="PDF viewer"
          />
        )}
      </div>
    </div>
  );
}
