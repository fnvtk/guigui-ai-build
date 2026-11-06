import { t as translateUi } from "@/lib/i18n";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { colorSwatch, MAUS_COLOR_LABEL, MAUS_COLOR_NAMES, type MausState } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { MBTI_AVATAR_TYPES, resolveMbtiAvatar } from "@/lib/mbti-avatar";
import { AvatarFraming, OrganizationAvatarIcons, useAvatarImage, type AvatarPatch } from "../avatar-editing";
import { Segmented } from "./rows";

export type AvatarEditorTab = "bot" | "upload";

const TABS: ReadonlyArray<readonly [AvatarEditorTab, LocaleKey | "MBTI"]> = [
  ["bot", "MBTI"],
  ["upload", "botPanel.avatar.tabUpload"],
];

const IMAGE_CROPS = ["circle", "rounded", "square"] as const;
const CROP_KEY: Record<(typeof IMAGE_CROPS)[number], LocaleKey> = {
  circle: "botPanel.avatar.circle",
  rounded: "botPanel.avatar.rounded",
  square: "botPanel.avatar.square",
};

function withConfiguredMbti(soul: string | undefined, type: string): string {
  const marker = /^AI性格配置（MBTI）：[EI][NS][FT][JP]\s*$/gm;
  const remaining = (soul ?? "").replace(marker, "").replace(/\n{3,}/g, "\n\n").trim();
  return [`AI性格配置（MBTI）：${type}`, remaining].filter(Boolean).join("\n\n");
}

export function AvatarEditorCard({ bot, onPatch, onClose }: {
  bot: Bot;
  activeState: MausState;
  onPatch: (patch: AvatarPatch) => void;
  onClose: () => void;
}) {
  const image = useAvatarImage(bot, onPatch);
  const { fileRef, crop, uploading, busy, error, upload, removeImage } = image;
  const showsImage = crop !== "mascot" && Boolean(bot.avatarUrl);
  const [tab, setTab] = useState<AvatarEditorTab>(showsImage ? "upload" : "bot");
  const tabsRef = useRef<HTMLDivElement>(null);
  // The card is a dialog: focus moves into it, onto the tab it opened on, so Escape and Tab work from the start.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, []);
  const selectedMbti = resolveMbtiAvatar(bot)?.type;
  const frameColor = bot.color === "chrome" ? "#AEB8C3" : colorSwatch(bot.color);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label={t("botPanel.avatar.edit")}
      data-panel-avatar-editor
      onKeyDown={onKeyDown}
      className="popover-surface absolute inset-x-[-5px] top-[80px] z-30 overflow-hidden rounded-2xl border border-ink/[0.08] bg-menu text-left shadow-2xl shadow-black/50"
    >
      <div ref={tabsRef} className="flex items-center gap-0.5 border-b border-ink/[0.06] p-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-avatar-tab={id}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-lg px-[11px] py-[5px] text-[13px]",
              tab === id ? "bg-ink/[0.08] font-medium text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {label === "MBTI" ? label : t(label)}
          </button>
        ))}
        <button
          type="button"
          data-avatar-reset
          disabled={busy}
          onClick={() => onPatch({ avatarCrop: "mascot", avatarUrl: null })}
          className="ml-auto rounded-lg px-[11px] py-[5px] text-[13px] text-ink-secondary hover:text-ink disabled:opacity-50"
        >{t("botPanel.avatar.reset")}</button>
      </div>

      <div className="p-3">
        {tab === "bot" && (
          <>
            <p className="mb-2.5 text-[12px] leading-relaxed text-ink-secondary">配置 AI 的工作方式；这是主动设定的人设，不是测评结果。</p>
            <div className="grid grid-cols-4 gap-1.5">
              {MBTI_AVATAR_TYPES.map((type) => {
                const selected = selectedMbti === type;
                return <button key={type} type="button" disabled={busy} aria-pressed={selected} aria-label={`Configure AI personality ${type}`} title={type}
                  onClick={() => onPatch({ soul: withConfiguredMbti(bot.soul, type), avatarCrop: "mascot", avatarUrl: null })}
                  className={cn("overflow-hidden rounded-xl border-2 p-1.5 text-center disabled:opacity-50", selected ? "ring-2 ring-ink/50" : "hover:bg-ink/[0.04]")}
                  style={{ borderColor: frameColor, backgroundColor: `${frameColor}22` }}>
                  <img src={resolveMbtiAvatar({ soul: `AI性格配置（MBTI）：${type}` })!.image} alt="" className="mx-auto mb-1 aspect-square w-full rounded-md object-cover" />
                  <span className="text-[11px] font-semibold">{type}</span>
                </button>;
              })}
            </div>
            <div className="flex flex-wrap justify-center gap-2 px-1 pb-1 pt-3.5">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={busy}
                  aria-pressed={bot.color === color}
                  aria-label={`Use ${color} mascot color`}
                  title={t(MAUS_COLOR_LABEL[color])}
                  onClick={() => onPatch({ color })}
                  className={cn(
                    "size-6 rounded-full disabled:opacity-50",
                    bot.color === color && "ring-2 ring-ink/80 ring-offset-2 ring-offset-menu",
                  )}
                  style={{ background: colorSwatch(color) }}
                />
              ))}
            </div>
          </>
        )}

        {tab === "upload" && (
          <>
            <OrganizationAvatarIcons busy={busy} onUpload={(file) => void upload(file)} />
            {showsImage && <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              onChange={(event) => void upload(event.target.files?.[0])}
            />
            <button
              type="button"
              data-avatar-drop
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void upload(event.dataTransfer.files?.[0]);
              }}
              className="flex w-full flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-ink/15 px-3 py-6 text-center text-[13px] text-ink-secondary hover:border-ink/25 hover:text-ink disabled:opacity-50"
            >
              {uploading ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
              <span>{t("botPanel.avatar.drop")}</span>
              <span className="text-[12px] text-ink-tertiary">{t("botPanel.avatar.types")}</span>
            </button>
            <div className="mt-2.5 flex items-center gap-2.5">
              <span className="shrink-0 text-[12px] text-ink-secondary">{t("botPanel.avatar.shape")}</span>
              <Segmented
                attr="data-avatar-crop"
                label={t("botPanel.avatar.shape")}
                value={showsImage ? crop : null}
                onChange={(next) => onPatch({ avatarCrop: next })}
                options={IMAGE_CROPS.map((value) => ({ value, label: t(CROP_KEY[value]), disabled: busy || !bot.avatarUrl }))}
              />
              {bot.avatarUrl && (
                <button
                  type="button"
                  onClick={removeImage}
                  disabled={busy}
                  aria-label={translateUi("ui.literal.c0b98f6e453a")}
                  title={t("botPanel.avatar.remove")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {!showsImage && <p className="mt-2 text-[12px] text-ink-tertiary">{t("botPanel.avatar.uploadHint")}</p>}
          </>
        )}

        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
