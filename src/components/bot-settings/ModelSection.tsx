import { EffortRow, ModelPicker } from "../ModelPicker";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { ProposalStatus } from "./ProposalStatus";
import { ThreadModelsLine } from "../ThreadModelsLine";
import { t } from "@/lib/i18n";
import { Select } from "../Select";

export function ModelSection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const { draft } = useBotEditor();
  const modelVariants = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.modelVariants;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-card p-4">
        <ModelPicker
          bot={bot}
          contained
          label={
            <div>
              <div className="text-[15px] font-medium text-ink">{t("model.section.default")}</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                {draft ? t("model.section.starting") : t("model.section.threads")}
              </div>
              <ProposalStatus bot={bot} kind="chief" />
            </div>
          }
        />
        {!draft && <ThreadModelsLine bot={bot} className="mt-3" />}
      </div>

      <EffortRow
        bot={bot}
        className="rounded-xl bg-card p-4"
        label={
          <div>
            <div className="text-[15px] font-medium text-ink">{modelVariants ? t("model.simple.reasoning") : t("model.section.effort")}</div>
            {/* Codex applies a level to the whole thread and cannot take one back, so this says what the app sends, not where the engine ends up. */}
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              {modelVariants ? (draft ? t("model.section.startingReasoning") : t("model.section.threads")) : t(bot.modelSelection.effort ? "model.section.effortHelp" : "model.section.effortHelpDefault")}
            </div>
            <ProposalStatus bot={bot} kind="chief" />
          </div>
        }
      />
      {!draft && state.config?.cacheKeepWarm && (
        <KeepWarmRow bot={bot} workspaceOn={state.config.cacheKeepWarm.enabled}
          onChange={(cacheKeepWarm) => dispatch({ type: "updateBot", botId: bot.id, patch: { cacheKeepWarm } })} />
      )}
    </div>
  );
}

function KeepWarmRow({ bot, workspaceOn, onChange }: { bot: Bot; workspaceOn: boolean; onChange: (value: boolean | null) => void }) {
  const value = bot.cacheKeepWarm === true ? "on" : bot.cacheKeepWarm === false ? "off" : "follow";
  return (
    <div className="rounded-xl bg-card p-4">
      <label htmlFor="bot-cache-keepwarm" className="text-[15px] font-medium text-ink">{t("bot.keepWarm.title")}</label>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("bot.keepWarm.help")}</div>
      <Select className="mt-3 max-w-full" id="bot-cache-keepwarm" value={value}
        onChange={(event) => onChange(event.target.value === "on" ? true : event.target.value === "off" ? false : null)}>
        <option value="follow">{t("bot.keepWarm.follow", { state: t(workspaceOn ? "bot.keepWarm.on" : "bot.keepWarm.off") })}</option>
        <option value="on">{t("bot.keepWarm.on")}</option>
        <option value="off">{t("bot.keepWarm.off")}</option>
      </Select>
    </div>
  );
}
