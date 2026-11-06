import { Switch } from "./SettingsPrimitives";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronRight, Globe, Monitor, Power, Settings, X } from "lucide-react";
import { api, currentTaskBot, useStore, type Bot, type ConfigStatus } from "@/state/store";
import { useAdvancedMode } from "@/lib/interface-mode";
import { ComputerFilesPane } from "./ComputerFilesPane";
import { effectivePlace, isComputerPlace, placeOffered } from "@/lib/place";
import type { CloudBackend } from "../../shared/wire";
import { cn } from "@/lib/cn";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { RoutinesSection } from "./bot-settings/RoutinesSection";
import { AndroidDevicePanel, useAndroidUsbDevices } from "./AndroidDevicePanel";
import { BrowserPanel } from "./BrowserPanel";
import { usePanelPage, type PanelPage } from "@/lib/page-open";
const DataPanel = lazy(() => import("./data/DataPanel").then((module) => ({ default: module.DataPanel })));
import { browserAvailable, browserUnavailableReason, builtInBrowserEnabled } from "@/lib/feature-flags";
import { SignInBanner } from "./SignInRequestCard";
import { LocalScreenPreview } from "./LocalScreenPreview";
import { LinuxLocalControl } from "./LinuxLocalControl";
import { MacLocalControl } from "./MacLocalControl"; import { WindowsLocalControl } from "./WindowsLocalControl";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import {
  instanceSupportsLocalComputer,
  localComputerDisabledReason,
  localComputerSelectable,
  persistedComputerSelectionMatches,
} from "@/lib/local-computer";
import { moveBetweenTabs, PANEL_TABS, panelTabProps, scrollTabsWithWheel, TAB_PANEL_FOCUS, tabPanelProps, useAndroidTabFallback } from "./computer-panel-tabs";
import { releaseComputerPanelFocus, useComputerPanelEntry } from "@/lib/computer-panel-focus";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, useComputerPanelResize } from "./computer-panel-resize";
import {
  computerPanelTabs,
  readComputerPanelView,
  resolveComputerPanelView,
  writeComputerPanelView,
  type ComputerPanelView,
} from "@/lib/computer-panel-view";
import { approvalModeFor } from "../../shared/approval-mode";
import { placeFacts, placeViewFor, usePlaceSeat, worksOnSimpleLabel } from "@/lib/place-view";
import { t } from "@/lib/i18n";
import { LocalizedPanelError, panelErrorText } from "@/lib/computer-messages";

type Phase = "checking" | "local" | "local-unavailable" | "auto-unavailable" | "browser" | "off";

export function ComputerPanel({
  bot: profileBot,
}: {
  bot: Bot;
}) {
  const { dragProps } = useCaptionChrome();
  const { panelWidth, separatorRef, separatorWidth, onSeparatorKeyDown, onResizeStart, onResizeMove, onResizeEnd } = useComputerPanelResize();
  const { state, dispatch, flushBotPatches } = useStore();
  const liveTask = profileBot.tasks?.find((task) => task.threadId === profileBot.threadId);
  const livePlace = effectivePlace(profileBot, liveTask);
  const threadBot = currentTaskBot(profileBot);
  const bot = { ...threadBot, computer: livePlace === "auto" ? undefined : livePlace };
  const placeLive = Boolean(bot.busy);
  const { capabilities, ready: capabilitiesReady } = useDesktopCapabilities();
  const localAvailable = capabilities.localComputer.available;
  const providerSupportsLocal = instanceSupportsLocalComputer(state.instances, bot);
  const localSelectable = placeOffered("local", state.config) && localComputerSelectable({ capabilities, providerSupportsLocal });
  const [localAutoWarningTarget, setLocalAutoWarningTarget] = useState<string | null>(null);
  const localDisabledReason = localComputerDisabledReason({ capabilities, providerSupportsLocal });
  const placeSeat = usePlaceSeat(state.config, capabilities.host.platform);
  const [phase, setPhase] = useState<Phase>("checking");
  const [persistedComputerSelection, setPersistedComputerSelection] = useState<{
    botId: string;
    computer: Bot["computer"];
    cloudBackend: CloudBackend;
    section: string;
  } | null>(null);
  const cloudBackend = bot.cloudBackend ?? "box";
  const computerSelectionPersisted = Boolean(
    persistedComputerSelection
      && persistedComputerSelection.botId === bot.id
      && persistedComputerSelection.computer === profileBot.computer
      && persistedComputerSelection.cloudBackend === cloudBackend
      && persistedComputerSelection.section === (bot.section?.trim() ?? ""),
  );
  const updateComputerSelection = useCallback((patch: {
    computer?: Bot["computer"] | null;
    cloudBackend?: CloudBackend;
    browser?: boolean;
    acknowledgeLocalAuto?: boolean;
  }) => {
    // Clear in the same render as the optimistic profile change; the resolving effect waits for its PATCH.
    setPhase("checking");
    dispatch({ type: "updateBot", botId: bot.id, patch });
  }, [bot.id, dispatch]);
  useEffect(() => {
    let alive = true;
    setPersistedComputerSelection(null);
    void flushBotPatches(bot.id).then((persistedBot) => {
      if (!alive) return;
      if (persistedBot && !persistedComputerSelectionMatches({
        computer: profileBot.computer,
        cloudBackend,
        persistedBot,
      })) return;
      if (persistedBot && (persistedBot.section?.trim() ?? "") !== (bot.section?.trim() ?? "")) return;
      setPersistedComputerSelection({
        botId: bot.id,
        computer: profileBot.computer,
        cloudBackend,
        section: bot.section?.trim() ?? "",
      });
    });
    return () => {
      alive = false;
    };
  }, [bot.id, profileBot.computer, bot.section, cloudBackend, flushBotPatches]);
  const [error, setError] = useState<Error | string | null>(null);
  const errorText = panelErrorText(error);
  const advanced = useAdvancedMode();
  const [storedPanelView, setPanelView] = useState<ComputerPanelView>(() => readComputerPanelView(bot.id));
  const requestedDataResult = state.dataResultFocus?.botId === bot.id ? state.dataResultFocus : undefined;
  const [dataRequest, setDataRequest] = useState<{ id: string; requestId: number }>();
  const androidStatus = useAndroidUsbDevices();
  const androidConnected = androidStatus.devices.length > 0;
  const panelTabs = computerPanelTabs({ advanced, androidConnected });
  const panelView = resolveComputerPanelView(storedPanelView, { advanced, androidConnected });
  const panelRef = useComputerPanelEntry(profileBot.id, panelView);
  const browserAvailableHere = browserAvailable(state.config);
  const browserEnabled = builtInBrowserEnabled(state.config) && bot.browser !== false
    && (browserAvailableHere || state.config?.browserEngine?.installable === true);
  const explicitPanelView = useRef(false);
  const selectPanelView = (view: ComputerPanelView) => {
    explicitPanelView.current = true;
    setPanelView(view);
    writeComputerPanelView(bot.id, view);
  };

  const previousPanelTarget = useRef<string | null>(null);
  // Excludes the model and Auto's resolved surface: neither may move the tab.
  const panelTargetKey = `${profileBot.id}:${profileBot.threadId}:${livePlace}:${profileBot.cloudBackend ?? "box"}`;
  useEffect(() => {
    const previous = previousPanelTarget.current;
    if (previous === panelTargetKey && (explicitPanelView.current || !(bot.computer === "browser" && browserEnabled))) return;
    if (previous !== panelTargetKey) explicitPanelView.current = false;
    previousPanelTarget.current = panelTargetKey;
    setPanelView(bot.computer === "browser" && browserEnabled ? "browser"
      : previous === null ? readComputerPanelView(bot.id) : "computer");
  }, [panelTargetKey, bot.id, bot.computer, browserEnabled]);

  useEffect(() => {
    if (!requestedDataResult || requestedDataResult.consumed) return;
    explicitPanelView.current = true;
    setDataRequest(requestedDataResult);
    setPanelView("data");
    writeComputerPanelView(bot.id, "data");
    dispatch({ type: "dataResultFocusConsumed", requestId: requestedDataResult.requestId });
  }, [bot.id, dispatch, requestedDataResult]);

  const requestedSignIn = state.signInFocus?.botId === bot.id ? state.signInFocus : undefined;
  const [signInRequest, setSignInRequest] = useState<{ url: string; site: string; nonce: number }>();
  // A published page's Open (usePageOpener): this bot's browser shows, with the page in a new tab.
  const [pageRequest, setPageRequest] = useState<PanelPage>();
  usePanelPage(bot.id, (page) => { selectPanelView("browser"); setPageRequest(page); });
  useEffect(() => {
    if (!requestedSignIn || requestedSignIn.consumed) return;
    const view = requestedSignIn.place === "browser" ? "browser" : "computer";
    explicitPanelView.current = true;
    setPanelView(view);
    writeComputerPanelView(bot.id, view);
    if (view === "browser") setSignInRequest({ url: requestedSignIn.url, site: requestedSignIn.site, nonce: requestedSignIn.requestId });
    dispatch({ type: "signInFocusConsumed", requestId: requestedSignIn.requestId });
  }, [bot.id, dispatch, requestedSignIn]);

  useAndroidTabFallback(bot.id, androidStatus, setPanelView);
  const botRoutines = state.routines
    .filter((routine) => routine.botId === bot.id)
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  useEffect(() => {
    if (panelView !== "computer") return;
    setPhase("checking");
    setError(null);
    if (!computerSelectionPersisted) return;
    if (bot.computer === undefined) {
      setPhase("auto-unavailable");
      return;
    }
    if (bot.computer === "off") {
      setPhase("off");
      return;
    }
    if (bot.computer === "local") {
      if (!providerSupportsLocal) setError(new LocalizedPanelError("computer.err.localEngine"));
      setPhase(capabilitiesReady && localAvailable && providerSupportsLocal ? "local" : "local-unavailable");
      return;
    }
    setPhase("browser");
  }, [bot.id, bot.threadId, bot.computer, panelView, computerSelectionPersisted, providerSupportsLocal, capabilitiesReady, localAvailable, cloudBackend]);


  const signInHelp = state.computerControl[bot.id]?.help ?? null;
  const signInAsker = signInHelp ? state.bots.find((candidate) => candidate.id === signInHelp.botId)?.name ?? bot.name : bot.name;
  const signInBanner = () => signInHelp && <SignInBanner help={signInHelp} askerName={signInAsker} onError={setError} />;

  const browserCanTurnOn = browserAvailableHere || state.config?.browserEngine?.installable === true;
  const [browserTurningOn, setBrowserTurningOn] = useState(false);
  const turnOnBrowser = async () => {
    if (browserTurningOn) return;
    setBrowserTurningOn(true);
    setError(null);
    try {
      if (!builtInBrowserEnabled(state.config)) {
        const config: ConfigStatus = await api("/api/config", {
          method: "PATCH",
          body: JSON.stringify({ features: { browser: true } }),
        });
        dispatch({ type: "configStatus", config });
      }
      if (profileBot.browser === false) dispatch({ type: "updateBot", botId: profileBot.id, patch: { browser: true } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setBrowserTurningOn(false);
    }
  };

  const turnOffBrowser = () => {
    setError(null);
    dispatch({ type: "updateBot", botId: profileBot.id, patch: { browser: false } });
  };
  const browserSwitchRow = (
    <div data-testid="browser-switch-row" className="mb-3 flex items-center gap-3 rounded-xl bg-card px-3 py-2.5">
      <Globe size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{t("computer.browserSwitch.title", { name: bot.name })}</div>
        {!browserCanTurnOn && <div className="text-[12px] text-ink-secondary">{browserUnavailableReason(state.config)}</div>}
      </div>
      <Switch
        checked={browserEnabled}
        disabled={browserTurningOn || (!browserEnabled && !browserCanTurnOn)}
        aria-label={t("computer.browserSwitch.title", { name: bot.name })}
        onClick={() => (browserEnabled ? turnOffBrowser() : void turnOnBrowser())}
      />
    </div>
  );

  const placeOptions = [
    ["local", Monitor], ["browser", Globe], ["off", Power],
  ].filter(([mode]) => mode !== "local" || placeOffered("local", state.config)).map(([mode, Icon]) => {
    const view = placeViewFor(placeFacts({ bot, place: mode as "local" | "browser" | "off", seat: placeSeat, config: state.config, instances: state.instances,
      local: { ready: localSelectable, reason: localDisabledReason ?? t("computer.unavailableLocal") } }));
    return { mode: mode as "local" | "browser" | "off", Icon, simpleLabel: worksOnSimpleLabel(mode as "local" | "browser" | "off", capabilities.host.platform), selected: (profileBot.computer === "cloud" || profileBot.computer === "vm" ? "browser" : profileBot.computer) === mode, disabled: (mode === "local" && !localSelectable), unavailableTitle: mode === "local" ? localDisabledReason : view.short, view };
  });
  const worksOnView = placeOptions.find(({ selected }) => selected)?.view ?? placeOptions.find(({ mode }) => mode === "off")!.view;
  const selectedPlace = profileBot.computer === "cloud" || profileBot.computer === "vm" ? "browser" : profileBot.computer ?? "auto";
  const pinnedPlace = liveTask?.surface === "cloud" || liveTask?.surface === "vm" ? "browser" : liveTask?.surface;
  const showPinnedPlace = !advanced && pinnedPlace && liveTask?.surfaceAuto !== true && selectedPlace !== "off" && pinnedPlace !== selectedPlace;
  const selectPlace = (mode: (typeof placeOptions)[number]["mode"]) => {
    if (mode === profileBot.computer) return;
    if (mode === "local" && approvalModeFor(profileBot) === "auto") {
      setLocalAutoWarningTarget(bot.id);
    }
    else if (mode === "browser") updateComputerSelection({ computer: mode, browser: true });
    else updateComputerSelection({ computer: mode });
  };
  const tabClass = (active: boolean) => cn(
    "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition-colors @max-[28rem]/paneltabs:[&>svg]:hidden @max-[22rem]/paneltabs:px-2",
    active ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
  );

  const chooseTab = (view: ComputerPanelView) => {
    if (view === "browser") setError(null);
    selectPanelView(view);
  };

  return (
    <>
    <aside
      className={cn(
        "animate-panel-in relative flex h-full shrink-0 flex-col border-l border-hairline/40 bg-panel",
        "max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full!",
      )}
      ref={panelRef}
      data-computer-panel
      style={{ width: panelWidth }}
    >
      <div
        ref={separatorRef}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("computer.resizeAria")}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        aria-valuenow={separatorWidth ?? undefined}
        tabIndex={0}
        onKeyDown={onSeparatorKeyDown}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-accent/40 focus-visible:bg-accent/60 max-md:hidden"
      />
      {/* ml-1.5 keeps the drag region clear of the resize handle: a later drag region in the DOM wins. */}
      <div {...dragProps} className="@container/paneltabs ml-1.5 py-3 pl-2.5 pr-4">
        <div className="relative flex min-h-7 items-center justify-center">
          {advanced && (
            <button
              onClick={() => {
                releaseComputerPanelFocus(panelRef.current, bot.id);
                dispatch({ type: "toggleComputer", open: false });
                dispatch({ type: "toggleSettings", open: true, section: "access" });
              }}
              className="absolute left-0 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
              title={t("computer.botSettings")}
            >
              <Settings size={18} />
            </button>
          )}
          <div className="mx-9 flex min-w-0 touch-pan-x gap-0.5 overflow-x-auto whitespace-nowrap rounded-full bg-inset p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-tour="computer-tabs" data-testid="computer-tabs" role="tablist" aria-label={t("computer.tabsAria")} onWheel={scrollTabsWithWheel} onKeyDown={(event) => moveBetweenTabs(event, panelTabs, chooseTab)}>
            {panelTabs.map((view) => {
              const { Icon, label, tour } = PANEL_TABS[view];
              const live = !placeLive ? undefined
                : view === "computer" && isComputerPlace(livePlace) ? "computer-tab-live"
                : view === "browser" && livePlace === "browser" ? "browser-tab-live" : undefined;
              return (
                <button key={view} type="button" data-tour={tour} {...panelTabProps(view, view === panelView)} title={t(label)} onClick={() => chooseTab(view)} className={tabClass(view === panelView)}>
                  <Icon size={13} /> {t(label)}
                  {live && <span className="size-1.5 animate-pulse rounded-full bg-success" role="img" aria-label={t("place.live")} data-testid={live} />}
                </button>
              );
            })}
          </div>
          <button
            data-computer-panel-close
            onClick={() => {
              releaseComputerPanelFocus(panelRef.current, bot.id);
              dispatch({ type: "toggleComputer", open: false });
            }}
            className="absolute right-0 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
            aria-label={t("computer.close")}
            title={t("computer.close")}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {panelView === "routines" ? (
        <div {...tabPanelProps("routines")} className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", TAB_PANEL_FOCUS)}>
          <RoutinesSection key={bot.id} bot={bot} routines={botRoutines} runs={state.routineRuns} defaultRunOn="maus" />
        </div>
      ) : panelView === "browser" && browserEnabled ? (
        <div {...tabPanelProps("browser")} className={cn("flex min-h-0 flex-1 flex-col px-4 pb-4", TAB_PANEL_FOCUS)}>
          {browserSwitchRow}
          {signInHelp?.place === "browser" && <div className="-mt-1 mb-3">{signInBanner()}</div>}
          <BrowserPanel bot={bot} signIn={signInRequest} page={pageRequest} />
          {errorText && (
            <div role="alert" className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {errorText}
            </div>
          )}
        </div>
      ) : panelView === "browser" ? (
        <div {...tabPanelProps("browser")} className={cn("flex-1 overflow-y-auto px-5 pb-5", TAB_PANEL_FOCUS)} data-testid="browser-off">
          {browserSwitchRow}
          <div className="mt-2 flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-8 text-center">
            <Globe size={22} className="text-ink-secondary" aria-hidden="true" />
            <div className="text-[14px] font-medium text-ink">{t("computer.browserOff.title")}</div>
            <p className="text-[12px] leading-5 text-ink-secondary">
              {browserCanTurnOn ? t("computer.browserOff.body", { name: bot.name }) : browserUnavailableReason(state.config)}
            </p>
            {errorText && (
              <div role="alert" className="w-full rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                {errorText}
              </div>
            )}
          </div>
        </div>
      ) : panelView === "data" ? (
        <div {...tabPanelProps("data")} className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", TAB_PANEL_FOCUS)}>
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-ink-secondary" role="status">{t("data.loading")}</div>}>
            <DataPanel key={bot.id} bot={bot} requestedCard={dataRequest} />
          </Suspense>
        </div>
      ) : panelView === "files" ? (
        <div {...tabPanelProps("files")} className={cn("flex min-h-0 flex-1 flex-col", TAB_PANEL_FOCUS)}>
          <ComputerFilesPane bot={bot} />
        </div>
      ) : panelView === "android" && androidConnected ? (
        <div {...tabPanelProps("android")} className={cn("flex-1 overflow-y-auto px-4 pt-2", TAB_PANEL_FOCUS)}>
          <AndroidDevicePanel status={androidStatus} />
        </div>
      ) : (
        <div {...tabPanelProps("computer")} className={cn("flex-1 overflow-y-auto px-5 pb-5", TAB_PANEL_FOCUS)}>
          <div className="mb-3 mt-2 text-[13px] text-ink-secondary">{t("computer.screenOf", { name: bot.name })}</div>
          {phase === "local" || phase === "local-unavailable" ? <>
            <LocalScreenPreview />
            <LinuxLocalControl />
            <MacLocalControl />
            <WindowsLocalControl />
          </> : <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">{t("computer.phase.localUnavailable")}</div>}
          {errorText && <div role="alert" className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{errorText}</div>}
          <div className="mt-4 rounded-xl bg-card p-4" data-testid="where-works">
            <div className="text-[15px] font-medium text-ink">{advanced ? t("computer.worksOn") : t("computer.simple.whereWorks", { name: bot.name })}</div>
            <div role="group" aria-label={t("computer.destinationAria")} className="mt-3 grid grid-cols-3 gap-2">
              {placeOptions.map(({ mode, Icon, selected, disabled, unavailableTitle, simpleLabel }) => (
        <button key={mode} type="button" disabled={disabled} title={unavailableTitle ?? undefined} aria-pressed={selected} onClick={() => selectPlace(mode)} className={cn("flex min-w-0 flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-center", selected ? "border-accent/60 bg-accent/10 text-ink" : "border-hairline/50 bg-panel/30 text-ink-secondary", disabled && "cursor-not-allowed opacity-50")}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{simpleLabel}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 text-[12px] leading-5 text-ink-secondary" data-testid="place-line">{worksOnView.line}</div>
            {showPinnedPlace && <div className="mt-2 flex items-center gap-2" data-testid="place-pinned-note">
              <p className="min-w-0 flex-1 text-[12px] leading-5 text-ink-secondary">{t("place.pinnedNoteSimple", { place: worksOnSimpleLabel(pinnedPlace, capabilities.host.platform) })}</p>
              <button type="button" data-testid="place-unpin" disabled={Boolean(bot.busy)} title={bot.busy ? t("place.busy") : undefined} onClick={() => dispatch({ type: "updateTask", botId: profileBot.id, threadId: profileBot.threadId, patch: { surface: null } })} className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium leading-5 text-accent-text hover:bg-control disabled:opacity-45">{t("place.unpinSimple", { place: worksOnSimpleLabel(selectedPlace === "auto" ? undefined : selectedPlace, capabilities.host.platform) })}</button>
            </div>}
          </div>
          {advanced && <button type="button" onClick={() => selectPanelView("routines")} className="mt-4 flex w-full items-start gap-3 rounded-xl bg-card p-4 text-left hover:bg-raised">
            <CalendarClock size={17} className="mt-0.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-ink">{t("computer.tab.routines")} <span className="ml-1 text-[11px] text-ink-secondary">{botRoutines.length}</span></span></span>
            <ChevronRight size={14} className="shrink-0 text-ink-secondary rtl:-scale-x-100" aria-hidden="true" />
          </button>}
        </div>

      )}

    </aside>
    <LocalComputerAutoWarning
      open={localAutoWarningTarget !== null}
      onCancel={() => setLocalAutoWarningTarget(null)}
      onConfirm={() => {
        const targetBotId = localAutoWarningTarget;
        setLocalAutoWarningTarget(null);
        if (!targetBotId) return;
        if (targetBotId === bot.id) setPhase("checking");
        dispatch({
          type: "updateBot",
          botId: targetBotId,
          patch: { computer: "local", acknowledgeLocalAuto: true },
        });
      }}
    />
    </>
  );
}
