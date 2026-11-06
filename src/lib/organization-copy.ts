import { t } from "./i18n";

const PORTAL_START_ERROR = "Could not start company sign-in. Check the Admin portal address and your connection.";

export function organizationConnectionMessage(message: string | undefined): string | undefined {
  return message === PORTAL_START_ERROR ? t("organization.portalUnavailable") : message;
}
