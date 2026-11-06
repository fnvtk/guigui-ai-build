import { resolveSurface, type Destination, type Surface } from "./surface.ts";

/** Removed desktop settings never grant access to the person's Mac as a replacement. */
export function guaiSurfacePlan(input: Parameters<typeof resolveSurface>[0]) {
  const destination: Destination = input.destination === undefined || input.destination === "cloud" || input.destination === "vm" ? "browser" : input.destination;
  const pinnedSurface = input.pinnedSurface === "cloud" || input.pinnedSurface === "vm" ? "browser" : input.pinnedSurface;
  return resolveSurface({ ...input, destination, pinnedSurface });
}
export function guaiOffersSurface(surface: Surface): boolean { return surface === "local" || surface === "browser"; }
export function guaiRemovedDesktopPath(path: string): boolean {
  return /^\/api\/(?:team-computers|computers\/(?:boxes|vps)|local-computer)(?:\/|$)/.test(path) ||
    /^\/api\/bots\/[^/]+\/(?:computer|local-computer)(?:\/|$)/.test(path);
}
