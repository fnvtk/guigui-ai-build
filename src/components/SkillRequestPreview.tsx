import { t as translateUi } from "@/lib/i18n";
import { reviewedSkillSha256, type SkillRequestCardData } from "../../shared/skill-request";

/**
 * Security: learned instructions render as inert plain text; the approval hash binds this exact preview to the staged
 * file.
 */
export function SkillRequestPreview({ request }: { request: SkillRequestCardData }) {
  const reviewedSha256 = reviewedSkillSha256(request);
  if (!reviewedSha256) {
    return (
      <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[12px] leading-relaxed text-danger">
        {translateUi("ui.literal.c24d41824f89")}
        {request.action === "update" ? " propose the update again." : " create the skill again."}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-hairline/40 bg-inset p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-secondary">
        <span>
          {translateUi("ui.literal.61fb9a9adbc0")}{request.references?.length ? " and its reference files" : ""} {translateUi("ui.literal.51de2b835bd3")} {request.action === "update" ? "replacing the current version" : "enabling"}
        </span>
        <span className="font-mono" title={`sha256 ${reviewedSha256}`}>
          {translateUi("ui.literal.b310da45b1eb")} {reviewedSha256.slice(0, 8)}
        </span>
      </div>
      <div className="mt-1 break-all text-[11px] text-ink-secondary">{translateUi("ui.literal.922acd282cc0")} {request.source || "Unknown"}</div>
      <pre
        tabIndex={0}
        aria-label={`Full SKILL.md for ${request.name}`}
        className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
      >
        {request.preview}
      </pre>
      {request.references?.map((file) => (
        <div key={file.path} className="mt-3 border-t border-hairline/40 pt-2">
          <div className="font-mono text-[11px] text-ink-secondary">{file.path}</div>
          <pre
            tabIndex={0}
            aria-label={`Full ${file.path} for ${request.name}`}
            className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
          >
            {file.content}
          </pre>
        </div>
      ))}
    </div>
  );
}
