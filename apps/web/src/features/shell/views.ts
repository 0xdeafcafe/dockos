export type View =
  | "fleet"
  | "detail"
  | "stacks"
  | "system"
  | "images"
  | "volumes"
  | "networks"
  | "settings";

export const VIEW_TITLES: Record<View, string> = {
  fleet: "CONTAINERS",
  detail: "CONTAINER",
  stacks: "STACKS · PROFILES",
  system: "SYSTEM · HOST + IMAGE AUDIT",
  images: "IMAGES",
  volumes: "VOLUMES",
  networks: "NETWORK MAP",
  settings: "SETTINGS",
};
