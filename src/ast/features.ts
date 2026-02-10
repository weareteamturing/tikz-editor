export const FeatureFlags = {
  version: "v1",
  tikzPictureEnvironment: true,
  pathStatements: true,
  nodeText: true,
  coordinateEditing: true,
  opaqueUnknownCommands: true,
  strongRecovery: true
} as const;

export type FeatureFlagName = Exclude<keyof typeof FeatureFlags, "version">;
