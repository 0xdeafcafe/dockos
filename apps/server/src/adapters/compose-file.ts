import { readFileSync } from "node:fs";
import type { Logger } from "../util/logger.ts";

// Optional: when DOCKOS_COMPOSE_FILE points at the stack's compose.yaml (mounted ro), stacks
// become compose profiles — including profiles that are fully down (no containers exist yet).
// This is a deliberately narrow line scanner for the two fields we need (service names +
// `profiles:`), not a YAML parser; anything it cannot read simply falls back to label grouping.

export const DEFAULT_STACK = "(default)";

export interface ComposeProfileMap {
  // service name → profiles it belongs to (empty = default profile only)
  serviceProfiles: Map<string, string[]>;
  // all stack names, "(default)" first, then profiles in file order
  stacks: string[];
}

const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+):/u;
const SERVICE_KEY = /^ {2}([A-Za-z0-9_.-]+):\s*(?:#.*)?$/u;
const PROFILES_INLINE = /^\s{4,}profiles:\s*\[([^\]]*)\]/u;
const PROFILES_BLOCK = /^\s{4,}profiles:\s*(?:#.*)?$/u;
const LIST_ITEM = /^\s{4,}-\s*(.+?)\s*(?:#.*)?$/u;

function stripQuotes(value: string): string {
  return value.trim().replaceAll(/^["']|["']$/gu, "");
}

export function parseComposeProfiles(text: string): ComposeProfileMap {
  const serviceProfiles = new Map<string, string[]>();
  const profileOrder: string[] = [];
  let inServices = false;
  let service: string | null = null;
  let inProfilesBlock = false;

  const note = (svc: string, profile: string): void => {
    const name = stripQuotes(profile);
    if (!name) return;
    serviceProfiles.get(svc)?.push(name);
    if (!profileOrder.includes(name)) profileOrder.push(name);
  };

  for (const line of text.split("\n")) {
    const top = TOP_LEVEL_KEY.exec(line);
    if (top) {
      inServices = top[1] === "services";
      service = null;
      inProfilesBlock = false;
      continue;
    }
    if (!inServices) continue;

    const svc = SERVICE_KEY.exec(line);
    if (svc?.[1]) {
      service = svc[1];
      serviceProfiles.set(service, []);
      inProfilesBlock = false;
      continue;
    }
    if (!service) continue;

    const inline = PROFILES_INLINE.exec(line);
    if (inline) {
      for (const item of (inline[1] ?? "").split(",")) note(service, item);
      inProfilesBlock = false;
      continue;
    }
    if (PROFILES_BLOCK.test(line)) {
      inProfilesBlock = true;
      continue;
    }
    if (inProfilesBlock) {
      const item = LIST_ITEM.exec(line);
      if (item?.[1]) note(service, item[1]);
      else inProfilesBlock = false;
    }
  }

  return { serviceProfiles, stacks: [DEFAULT_STACK, ...profileOrder] };
}

export function loadComposeProfiles(
  path: string | undefined,
  log: Logger,
): ComposeProfileMap | null {
  if (!path) return null;
  try {
    const map = parseComposeProfiles(readFileSync(path, "utf8"));
    if (map.serviceProfiles.size === 0) {
      log.warn({ path }, "compose file had no services — falling back to label grouping");
      return null;
    }
    log.info(
      { path, services: map.serviceProfiles.size, stacks: map.stacks },
      "compose profiles loaded",
    );
    return map;
  } catch (err) {
    log.warn({ path, err }, "could not read compose file — falling back to label grouping");
    return null;
  }
}

// Services belonging to a stack; the default stack is every service with no profiles entry.
export function servicesInStack(map: ComposeProfileMap, stack: string): string[] {
  const out: string[] = [];
  for (const [service, profiles] of map.serviceProfiles) {
    const member = stack === DEFAULT_STACK ? profiles.length === 0 : profiles.includes(stack);
    if (member) out.push(service);
  }
  return out;
}

export function stackOfService(map: ComposeProfileMap, service: string): string | null {
  const profiles = map.serviceProfiles.get(service);
  if (profiles === undefined) return null;
  return profiles[0] ?? DEFAULT_STACK;
}
