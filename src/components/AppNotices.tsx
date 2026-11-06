import { useEffect, useState } from "react";
import { Rocket, Star } from "lucide-react";
import { api, useStore } from "@/state/store";
import { APP_REPOSITORY } from "@/lib/app-links";
import { track } from "@/lib/analytics";
import { brandStatus } from "@/lib/brand";
import { jobRoutine, useCloudIntent } from "@/lib/cloud-intent";
import { CLOUD_INTENT_GIVEN, cloudSetupStage } from "@/lib/cloud-setup";
import { cornerPopupWaits, firstReplyPending } from "@/lib/corner-popup";
import { WHATS_NEW_NOTICE, CLOUD_INTRO, CLOUD_TRIAL_NOTICE, CLOUD_NOTICE, BOAT_OFFER_NOTICE, dismissNotice, launchNotice, markLaunchNotice, nextNotice, noticeSeen, PRODUCT_HUNT_NOTICE, PRODUCT_HUNT_UNTIL, PRODUCT_HUNT_URL, SIMPLE_MODE_NOTICE, STAR_NOTICE, TWO_PLACES_NOTICE, UPDATES_CONSENT_NOTICE, usedBefore } from "@/lib/notices";
import { useTwoPlaces } from "@/lib/two-places";
import { useSimpleModePromptSeen } from "@/lib/simple-mode-prompt";
import { cloudSignInDue, welcomeFinishedThisLaunch, type WelcomeViewer } from "@/lib/onboarding";
import { launchDialogShown, markLaunchDialog } from "@/lib/launch-dialogs";
import { useUpdaterState } from "@/lib/updater";
import { t } from "@/lib/i18n";
import { engineReady } from "./EngineLibrary";
import { useMoveQuiet } from "./CloudSendStrip";
import { LinkButton, NoticeCard, NotNowButton } from "./NoticeCard";
import { useOtherDialogOpen } from "./notice-dialogs";
import { localDesktopPage } from "./onboarding/WelcomeGate";
import { UpdatesConsentDialog, updatesConsentBridge, useUpdatesConsent } from "./UpdatesConsent";
import { useMausBotWelcomeDue } from "./MausBotWelcome";
import { reportSimpleModePrompt, SimpleModePrompt } from "./SimpleModePrompt";
import { TwoPlacesCard } from "./TwoPlacesCard";

function StarCard({ onDismiss }: { onDismiss: () => void }) {
  return <NoticeCard titleId="github-star-title" notice="github-star" icon={Star} title={t("star.title")} onDismiss={onDismiss}>
    <p className="mb-3 mt-1 text-[13px] text-ink-secondary">{t("star.body")}</p>
    <div className="flex flex-wrap items-center gap-3">
      <LinkButton url={APP_REPOSITORY} label={t("star.button")} onOpened={onDismiss} />
      <NotNowButton onClick={onDismiss} />
    </div>
  </NoticeCard>;
}

function ProductHuntCard({ onDone }: { onDone: (action: "upvote" | "not_now" | "close") => void }) {
  return <NoticeCard titleId="product-hunt-title" notice="product-hunt" icon={Rocket} title={t("productHunt.title")} onDismiss={() => onDone("close")}>
    <p className="mb-3 mt-1 text-[13px] text-ink-secondary">{t("productHunt.body")}</p>
    <div className="flex flex-wrap items-center gap-3">
      <LinkButton url={PRODUCT_HUNT_URL} label={t("productHunt.button")} onOpened={() => onDone("upvote")} />
      <NotNowButton onClick={() => onDone("not_now")} />
    </div>
  </NoticeCard>;
}

export function AppNotices({ quiet = false, viewer = null, now = Date.now }: { quiet?: boolean; viewer?: WelcomeViewer | null; now?: () => number }) {
  const { state, dispatch } = useStore();
  const remote = window.ogb?.remoteClient?.active === true;
  const local = localDesktopPage();
  const bridge = !remote && local ? window.ogb?.cloudAccount : undefined;
  const [organization, setOrganization] = useState<boolean | null>(window.ogb?.organization ? null : false);
  const [closed, setClosed] = useState(false);
  const [simpleShown, setSimpleShown] = useState(false);
  const consentHere = (local || viewer?.cloudHome === true) && brandStatus().source !== "file";
  const consent = useUpdatesConsent(consentHere ? updatesConsentBridge() : undefined);
  const [consentDone, setConsentDone] = useState(false);
  const updater = useUpdaterState();
  const intent = useCloudIntent();
  const moving = useMoveQuiet(now);
  const mausBot = useMausBotWelcomeDue(viewer);
  // Bots in two places: this computer's page only, where main knows what lives here.
  const two = useTwoPlaces();
  const twoFact = !local || two.suggest === null ? false : two.suggest === undefined ? null : true;
  useEffect(() => {
    const org = window.ogb?.organization;
    if (!org) return;
    let active = true;
    const read = (next: { status: string; organization?: unknown }) => { if (active) setOrganization(next.status !== "signed-out" && Boolean(next.organization)); };
    const unsubscribe = org.onState(read);
    void org.state().then(read, () => { if (active) setOrganization(false); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const record = state.config?.onboarding;
  const consentDue = consent.state?.available === true && consent.state.due && !consentDone;
  const consentBlocked = useOtherDialogOpen(consentDue) || Boolean(state.liveCall && state.liveCall.status !== "ended");
  const consentFact = !consentHere || consentDone ? false : consent.state === undefined ? null : consentDue ? (consentBlocked ? null : true) : false;
  // Every page with the app's chrome, desktop or Cloud, new install or not: once per browser, as the mode is.
  const simpleDue = !useSimpleModePromptSeen();
  const simpleBlocked = useOtherDialogOpen(simpleDue) || Boolean(state.liveCall && state.liveCall.status !== "ended");

  const setupRecord = record && (intent.pending || intent.sent) ? { ...record, hintsSeen: [...record.hintsSeen, CLOUD_INTENT_GIVEN] } : record;
  const setupHere = cloudSignInDue(viewer, state, engineReady)
    || ["waiting", "shown"].includes(cloudSetupStage({ viewer, connected: state.connected, enginesKnown: state.instances.length > 0,
      engineReady: state.instances.some(engineReady), onboarding: setupRecord, planned: Boolean(jobRoutine(state.routines, intent.sent)) }));
  const waits = cornerPopupWaits(state, updater, { quiet, idle: true, viewer }) || Boolean(state.cloudAdd) || state.cloudHowTo || setupHere;
  const cards = Boolean(bridge);
  // Promotions never land on a new install's first chat: they wait for its first reply, and the full-screen What's new popup
  // also for a launch after the one whose welcome just finished. Account and billing notices keep their own rules.
  // Unknown (null) until the bots have loaded, so nothing lower in the queue flashes up before them.
  const firstChat = firstReplyPending(state);
  // MausBot's first-launch card goes first: the popup and the question wait while it is due. The popup skips a launch the
  // card used; the question may follow the card once it closes, as it follows the popup.
  const afterWelcome = welcomeFinishedThisLaunch() || launchDialogShown() === "mausbot" || firstChat;
  const consentWaits = welcomeFinishedThisLaunch() || firstChat;
  const mausBotFirst = mausBot.due;
  const consentNow = consentWaits === true || consentFact === false ? false : consentWaits === null || mausBotFirst ? null : consentFact;
  // After a closed popup only the product-updates question may follow in this launch; nothing else does.
  const notice = waits ? null : closed ? (consentNow === true ? UPDATES_CONSENT_NOTICE : null) : cards || consentHere || simpleDue || twoFact !== false ? nextNotice({
    [WHATS_NEW_NOTICE]: false, [CLOUD_INTRO]: false, [CLOUD_TRIAL_NOTICE]: false, [CLOUD_NOTICE]: false, [BOAT_OFFER_NOTICE]: false,
    [SIMPLE_MODE_NOTICE]: !simpleDue || afterWelcome === true ? false : afterWelcome === null || mausBotFirst || simpleBlocked ? null : true,
    [UPDATES_CONSENT_NOTICE]: consentNow,
    [TWO_PLACES_NOTICE]: twoFact,
    [PRODUCT_HUNT_NOTICE]: !cards || moving || firstChat === true || brandStatus().source === "file" || now() >= PRODUCT_HUNT_UNTIL ? false
      : organization === null || moving === null || firstChat === null ? null : !organization,
    [STAR_NOTICE]: !bridge || moving || brandStatus().source === "file" || !usedBefore(state.bots) ? false : moving === null ? null : true,
  }, id => id === STAR_NOTICE || id === PRODUCT_HUNT_NOTICE ? noticeSeen(record, id) : false, launchNotice()) : null;

  useEffect(() => {
    if (!notice) return;
    markLaunchNotice(notice);
    // The popups and the question own this launch: MausBot's first-launch card waits for a later one.
    if (notice === SIMPLE_MODE_NOTICE || notice === UPDATES_CONSENT_NOTICE) markLaunchDialog("notices");
    if (notice === SIMPLE_MODE_NOTICE && !simpleShown) {
      setSimpleShown(true);
      reportSimpleModePrompt("shown");
    }
  }, [notice]);

  const save = (id: string) => {
    const patch = dismissNotice(record, id);
    if (patch) void api("/api/config", { method: "PUT", body: JSON.stringify(patch) })
      .then(config => dispatch({ type: "configStatus", config })).catch(() => {});
  };
  const close = () => { setClosed(true); };
  if (!notice) return null;

  if (notice === SIMPLE_MODE_NOTICE) return <SimpleModePrompt onClose={close} />;

  if (notice === UPDATES_CONSENT_NOTICE && consent.state) {
    const done = () => { setConsentDone(true); close(); };
    return <UpdatesConsentDialog signedIn={consent.state.signedIn}
      onYes={async email => { await consent.choose("opted_in", email); done(); }}
      onNo={() => { done(); void consent.choose("declined").catch(() => {}); }} />;
  }
  if (notice === TWO_PLACES_NOTICE && two.suggest) {
    const { key, kind } = two.suggest;
    return <TwoPlacesCard suggest={two.suggest}
      onBring={() => { track("two_places_card", { action: "bring", kind }); return two.accept(key).then(close); }}
      onDismiss={() => { track("two_places_card", { action: "not_now", kind }); two.dismiss(key); close(); }} />;
  }
  if (notice === PRODUCT_HUNT_NOTICE) {
    return <ProductHuntCard onDone={action => { track("product_hunt_card", { action }); close(); save(PRODUCT_HUNT_NOTICE); }} />;
  }
  if (notice === STAR_NOTICE) return <StarCard onDismiss={() => { close(); save(STAR_NOTICE); }} />;
  return null;
}
