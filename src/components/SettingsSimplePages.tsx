import { useEffect, useState, type ReactNode } from "react";
import { MacLocalControl } from "./MacLocalControl";
import type { AppSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { AnalyticsRow } from "./AnalyticsRow";
import { OpenAtLoginRow } from "./OpenAtLoginRow";
import { DefaultBotSidebarRow } from "./DefaultBotControls";
import { TalkShortcutRow } from "./TalkShortcutRow";
import { EnginesSettings } from "./EnginesSettings";
import { PeopleSection } from "./PeopleSection";
import { ActivitySection } from "./ActivitySection";
import { AccessOverview } from "./bot-access/AccessOverview";
import { BuiltInBrowserRow } from "./BrowserSettingsRows";
import { LoginsSettings } from "./LoginsSettings";
import { SettingRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { SkinPicker } from "./SkinPicker";
import { PlaceLookRows } from "./PlaceLookCard";
import { ChromeRailRow } from "./ChromeRailToggle";
import { WindowFrameRow } from "./WindowFrameRow";
import { ProfileSummaryRow } from "./ProfileSettings";
import { ImportSettings } from "./ImportSettings";
import { NotificationRows } from "./NotificationSettingsRows";
import { AdvancedModeRow, BrowserProfilesRow, ColorUserBubblesRow, FollowUpRow, LanguageRow, SendKeyRow } from "./AppSettingsRows";
import { ThemeRow } from "./ThemeRow";
import { AdminOnly } from "./AdminOnly";
import { RemoteComputerSection } from "./RemoteComputerSection";

export type SimpleDisclosureId = "computer-elsewhere" | "billing-limits";

export type Disclose = (id: SimpleDisclosureId) => { id: SimpleDisclosureId; open: boolean; onToggle: () => void };

export const SIMPLE_ADVANCED_ONLY: readonly LocaleKey[] = [
  "settings.newBotEffort.title", "newBot.defaults", "settings.roomTurns.title", "settings.mcpCalls.title", "settings.threads.title",
  "settings.recovery.title", "settings.threadCleanup.title", "settings.font.title", "settings.chatWidth.title",
  "settings.pinnedCircles.title", "settings.universalPins.title", "settings.toolCalls.title", "settings.runCard.title", "settings.keepWarm.title",
];

type Has = (id: AppSettingsSection) => boolean;

type GeneralCategory = "account" | "appearance" | "system" | "management";

function generalCategoryFor(section?: AppSettingsSection): GeneralCategory {
  if (section === "appearance") return "appearance";
  if (section === "organization" || section === "botAccess" || section === "activity" || section === "import") return "management";
  return "account";
}

export function SimpleGeneralPage({ has, peopleOpen, onLooks, section }: { has: Has; peopleOpen: boolean; onLooks: () => void; section?: AppSettingsSection }) {
  const [category, setCategory] = useState<GeneralCategory>(() => generalCategoryFor(section));
  useEffect(() => setCategory(generalCategoryFor(section)), [section]);
  const categories: Array<{ id: GeneralCategory; label: string }> = [
    { id: "account", label: "账号与成员" },
    { id: "appearance", label: "外观与通知" },
    { id: "system", label: "启动与偏好" },
    { id: "management", label: "管理与数据" },
  ];
  return (
    <>
      <div role="tablist" aria-label="通用设置分类" className="sticky top-0 z-10 flex flex-wrap gap-2 bg-surface py-2">
        {categories.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={category === id} aria-controls={`general-panel-${id}`} id={`general-tab-${id}`} className={`ui-button ${category === id ? "bg-control font-semibold" : ""}`} onClick={() => setCategory(id)}>{label}</button>)}
      </div>
      <section role="tabpanel" id={`general-panel-${category}`} aria-labelledby={`general-tab-${category}`} className="flex flex-col gap-5">
        {category === "account" && (has("general") || has("people")) && (
          <SettingsGroup label={t("settings.group.account")} block="general">
            <SettingsRows>
              {has("general") && <ProfileSummaryRow />}
              {has("people") && <div data-settings-block="people" className="scroll-mt-4"><PeopleSection simple startOpen={peopleOpen} /></div>}
            </SettingsRows>
          </SettingsGroup>
        )}
        {category === "appearance" && has("appearance") && <>
          <SettingsGroup label={t("settings.section.appearance")} block="appearance">
            <SettingsRows>
              <ThemeRow simple />
              <PlaceLookRows />
              <ChromeRailRow />
              <WindowFrameRow />
              <ColorUserBubblesRow simple />
              <LanguageRow simple />
              <SendKeyRow simple />
              <FollowUpRow simple />
              <SettingRow title={t("settings.simple.looks.title")}>
                <button type="button" className="ui-button" onClick={onLooks}>{t("settings.simple.looks.change")}</button>
              </SettingRow>
            </SettingsRows>
          </SettingsGroup>
          <SettingsGroup label={t("notifications.title")}><SettingsRows><NotificationRows simple /></SettingsRows></SettingsGroup>
        </>}
        {category === "system" && has("general") && (
          <SettingsGroup label={t("settings.simple.group.system")}>
            <SettingsRows>
              <OpenAtLoginRow simple />
              <DefaultBotSidebarRow simple />
              <TalkShortcutRow />
              <AnalyticsRow simple />
            </SettingsRows>
          </SettingsGroup>
        )}
        {category === "management" && <>
          {has("import") && <SettingsGroup label={t("settings.section.import")} block="import"><AdminOnly><ImportSettings /></AdminOnly></SettingsGroup>}
          {has("botAccess") && <SettingsGroup label={t("settings.section.botAccess")} block="botAccess"><AccessOverview /></SettingsGroup>}
          {has("activity") && <SettingsGroup label={t("settings.section.activity")} block="activity"><ActivitySection /></SettingsGroup>}
          <div data-settings-block="advanced-mode" className="scroll-mt-4"><SettingsRows><AdvancedModeRow simple /></SettingsRows></div>
        </>}
      </section>
    </>
  );
}

export function SimpleLooksPage({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div><button type="button" className="ui-button" onClick={onBack}>{t("settings.simple.looks.back")}</button></div>
      <div data-settings-block="looks"><SkinPicker /></div>
    </>
  );
}

export function SimpleAiPage({ has, registerUrl }: { has: Has; registerUrl?: string }) {
  return (
    <>
      {has("engines") && <div data-settings-block="engines" className="flex scroll-mt-4 flex-col gap-7"><AdminOnly><EnginesSettings simple registerUrl={registerUrl} /></AdminOnly></div>}
    </>
  );
}

export type RemoteAccessCards = Record<"client" | "domain" | "pairing" | "companion", ReactNode>;

export function SimpleComputerPage({ has, remoteAccess, section = "computer" }: { section?: AppSettingsSection; has: Has; remoteAccess: RemoteAccessCards }) {
  const [tab, setTab] = useState(section === "companion" ? "devices" : section === "logins" ? "browser" : "local");
  const tabs = [{ id: "local", label: "我的电脑" }, { id: "devices", label: "连接手机" }, { id: "browser", label: "浏览器与账号" }];
  return (
    <>
      <div role="tablist" aria-label="电脑设置分类" className="sticky top-0 z-10 flex flex-wrap gap-2 bg-surface py-2">
        {tabs.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`computer-panel-${id}`} id={`computer-tab-${id}`} className={`ui-button ${tab === id ? "bg-control font-semibold" : ""}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <section role="tabpanel" id={`computer-panel-${tab}`} aria-labelledby={`computer-tab-${tab}`} className="flex flex-col gap-5">
        {tab === "local" && has("computer") && <>
          <SettingsGroup label="让 AI 使用我的电脑" block="computer">
            <p className="mb-4 text-sm text-ink-secondary">先打开下面的权限，再点重试。准备好后，AI 就能在这台电脑上帮忙。</p>
            <AdminOnly><MacLocalControl /></AdminOnly>
          </SettingsGroup>
          <SettingsGroup label="连接远程电脑" block="remote-computer">
            <p className="mb-4 text-sm text-ink-secondary">远程电脑需要先安装并启动乖乖Ai，再通过一次性配对链接或验证码连接。连接后，机器人和对话会在远程电脑上运行。</p>
            <RemoteComputerSection />
          </SettingsGroup>
        </>}
        {tab === "devices" && has("companion") && <SettingsGroup label="手机也能看对话" block="companion"><p className="mb-4 text-sm text-ink-secondary">创建配对码，然后在另一台设备上输入。</p>{remoteAccess.pairing}{remoteAccess.companion}</SettingsGroup>}
        {tab === "browser" && <>{has("computer") && <SettingsGroup label="上网浏览" block="browser"><SettingsRows><BuiltInBrowserRow /></SettingsRows><BrowserProfilesRow /></SettingsGroup>}{has("logins") && <div data-settings-block="logins"><LoginsSettings /></div>}</>}
      </section>
    </>
  );
}
