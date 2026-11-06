import { useEffect, useRef } from "react";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        className="w-full max-w-[360px] rounded-2xl border border-hairline/50 bg-panel p-6 text-center shadow-2xl"
      >
        <img src="/app-icon.svg" alt="" width={56} height={56} className="mx-auto size-14" />
        <h2 id="about-dialog-title" className="mt-3 text-[17px] font-semibold text-ink">{productName()}</h2>
        <p className="mt-2 text-[13px] text-ink-secondary">卡若创业派对出品</p>
        <p className="mt-1 text-[13px] text-ink-secondary">小程序搜「卡若创业派对」</p>
        <p className="mt-3 text-[12px] text-ink-tertiary">© 卡若创业派对</p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-raised px-4 py-2 text-[13px] font-medium text-ink hover:brightness-110"
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
