import fs from "node:fs";
import path from "node:path";

import { appVersion } from "@main/constants";
import {
  db,
  gameAchievementsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  Game,
  GameAchievement,
  GameShop,
  ProfileSyncStatus,
  ShopAssets,
  User,
  UserPreferences,
} from "@types";
import { logger } from "./logger";

/**
 * Name of the portable profile file written inside the user-selected backup
 * folder. It is intentionally a normal JSON file rather than a database dump:
 * it is easy to inspect, is friendly to Dropbox/Nextcloud/Syncthing, and can
 * be migrated if the LevelDB schema changes.
 */
export const PROFILE_SYNC_FILENAME = "hydra-libre-profile.json";
const PROFILE_SYNC_SCHEMA_VERSION = 1;
const MAX_PROFILE_FILE_SIZE = 50 * 1024 * 1024;

const PROFILE_PREFERENCE_KEYS: ReadonlyArray<keyof UserPreferences> = [
  "language",
  "preferQuitInsteadOfHiding",
  "runAtStartup",
  "startMinimized",
  "disableNsfwAlert",
  "enableAutoInstall",
  "seedAfterDownloadComplete",
  "showHiddenAchievementsDescription",
  "showDownloadSpeedInMegabits",
  "downloadNotificationsEnabled",
  "repackUpdatesNotificationsEnabled",
  "achievementNotificationsEnabled",
  "achievementCustomNotificationsEnabled",
  "achievementCustomNotificationPosition",
  "achievementSoundVolume",
  "friendRequestNotificationsEnabled",
  "friendStartGameNotificationsEnabled",
  "friendStartGameCustomNotificationsEnabled",
  "showDownloadSpeedInMegabytes",
  "extractFilesByDefault",
  "autoDeleteInstallerAfterExtraction",
  "enableSteamAchievements",
  "autoplayGameTrailers",
  "hideToTrayOnGameStart",
  "enableNewDownloadOptionsBadges",
  "useNativeHttpDownloader",
  "createStartMenuShortcut",
  "backupProvider",
  "showROMsInSidebar",
];

interface ProfileSyncGame {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  playTimeInMilliseconds: number;
  lastTimePlayed: string | null;
  remoteId: string | null;
  favorite?: boolean;
  isPinned?: boolean;
  pinnedDate?: string | null;
  achievementCount?: number;
  unlockedAchievementCount?: number;
  currentStreak?: number;
  longestStreak?: number;
  lastStreakDate?: string | null;
  playedDates?: string[];
}

interface ProfileSyncAchievementSet {
  objectId: string;
  shop: GameShop;
  achievements: GameAchievement["achievements"];
  unlockedAchievements: GameAchievement["unlockedAchievements"];
  updatedAt?: number;
  language?: string;
}

interface ProfileSyncSnapshot {
  schemaVersion: typeof PROFILE_SYNC_SCHEMA_VERSION;
  profileId: string | null;
  updatedAt: string;
  appVersion: string;
  profile: {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
    backgroundImageUrl: string | null;
    bio?: string;
    profileVisibility?: User["profileVisibility"];
    karma?: number;
  } | null;
  preferences: Partial<UserPreferences>;
  games: ProfileSyncGame[];
  achievements: ProfileSyncAchievementSet[];
  assets: Array<ShopAssets & { updatedAt: number }>;
}

interface ProfileSyncMetadata {
  profileId: string | null;
  lastSyncedAt: string | null;
  lastImportedAt: string | null;
  lastExportedAt: string | null;
  gameCount: number;
  achievementSetCount: number;
}

export interface ProfileSyncImportResult {
  gamesImported: number;
  achievementSetsImported: number;
  assetsImported: number;
  preferencesImported: number;
}

const EMPTY_IMPORT_RESULT: ProfileSyncImportResult = {
  gamesImported: 0,
  achievementSetsImported: 0,
  assetsImported: 0,
  preferencesImported: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isGameShop = (value: unknown): value is GameShop =>
  value === "steam" || value === "custom";

const asProfileVisibility = (value: unknown): User["profileVisibility"] =>
  value === "PUBLIC" || value === "PRIVATE" || value === "FRIENDS"
    ? value
    : undefined;

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const asNullableString = (value: unknown) =>
  typeof value === "string" ? value : null;

const asFiniteNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const asDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  const date = asDate(value);
  return date?.toISOString() ?? null;
};

const newestDate = (
  localValue: Date | string | null | undefined,
  importedValue: Date | string | null | undefined
) => {
  const localDate = asDate(localValue);
  const importedDate = asDate(importedValue);

  if (!localDate) return importedDate;
  if (!importedDate) return localDate;
  return importedDate > localDate ? importedDate : localDate;
};

const safeFileName = (fileName: string) =>
  fileName === PROFILE_SYNC_FILENAME && path.basename(fileName) === fileName;

const getProfileId = (user: User | undefined) => user?.id ?? null;

const isCompatibleProfile = (
  snapshotProfileId: string | null,
  currentProfileId: string | null
) => {
  // An unsigned-in profile is allowed to restore a file. Once both sides are
  // authenticated, however, never merge one account into another by mistake.
  if (!snapshotProfileId || !currentProfileId) return true;
  return snapshotProfileId === currentProfileId;
};

const serializeGame = (game: Game): ProfileSyncGame => ({
  objectId: game.objectId,
  shop: game.shop,
  title: game.title,
  iconUrl: game.iconUrl,
  libraryHeroImageUrl: game.libraryHeroImageUrl,
  logoImageUrl: game.logoImageUrl,
  customIconUrl: game.customIconUrl,
  customLogoImageUrl: game.customLogoImageUrl,
  customHeroImageUrl: game.customHeroImageUrl,
  playTimeInMilliseconds: Math.max(0, game.playTimeInMilliseconds ?? 0),
  lastTimePlayed: toIso(game.lastTimePlayed),
  remoteId: game.remoteId ?? null,
  favorite: game.favorite ?? false,
  isPinned: game.isPinned ?? false,
  pinnedDate: toIso(game.pinnedDate),
  achievementCount: game.achievementCount,
  unlockedAchievementCount: game.unlockedAchievementCount,
  currentStreak: game.currentStreak,
  longestStreak: game.longestStreak,
  lastStreakDate: game.lastStreakDate ?? null,
  playedDates: game.playedDates,
});

const serializeAchievementSet = (
  objectId: string,
  shop: GameShop,
  value: GameAchievement
): ProfileSyncAchievementSet => ({
  objectId,
  shop,
  achievements: value.achievements ?? [],
  unlockedAchievements: value.unlockedAchievements ?? [],
  updatedAt: value.updatedAt,
  language: value.language,
});

const parseGame = (value: unknown): ProfileSyncGame | null => {
  if (
    !isRecord(value) ||
    !asString(value.objectId) ||
    !isGameShop(value.shop)
  ) {
    return null;
  }

  return {
    objectId: asString(value.objectId),
    shop: value.shop,
    title: asString(value.title, asString(value.objectId)),
    iconUrl: asNullableString(value.iconUrl),
    libraryHeroImageUrl: asNullableString(value.libraryHeroImageUrl),
    logoImageUrl: asNullableString(value.logoImageUrl),
    customIconUrl: asNullableString(value.customIconUrl),
    customLogoImageUrl: asNullableString(value.customLogoImageUrl),
    customHeroImageUrl: asNullableString(value.customHeroImageUrl),
    playTimeInMilliseconds: Math.max(
      0,
      asFiniteNumber(value.playTimeInMilliseconds)
    ),
    lastTimePlayed: asNullableString(value.lastTimePlayed),
    remoteId: asNullableString(value.remoteId),
    favorite: asBoolean(value.favorite),
    isPinned: asBoolean(value.isPinned),
    pinnedDate: asNullableString(value.pinnedDate),
    achievementCount:
      typeof value.achievementCount === "number"
        ? Math.max(0, value.achievementCount)
        : undefined,
    unlockedAchievementCount:
      typeof value.unlockedAchievementCount === "number"
        ? Math.max(0, value.unlockedAchievementCount)
        : undefined,
    currentStreak:
      typeof value.currentStreak === "number"
        ? Math.max(0, value.currentStreak)
        : undefined,
    longestStreak:
      typeof value.longestStreak === "number"
        ? Math.max(0, value.longestStreak)
        : undefined,
    lastStreakDate: asNullableString(value.lastStreakDate),
    playedDates: Array.isArray(value.playedDates)
      ? value.playedDates.filter(
          (date): date is string => typeof date === "string"
        )
      : undefined,
  };
};

const parseAchievementSet = (
  value: unknown
): ProfileSyncAchievementSet | null => {
  if (
    !isRecord(value) ||
    !asString(value.objectId) ||
    !isGameShop(value.shop)
  ) {
    return null;
  }

  const achievements = Array.isArray(value.achievements)
    ? value.achievements.filter(isRecord)
    : [];
  const unlockedAchievements = Array.isArray(value.unlockedAchievements)
    ? value.unlockedAchievements
        .filter(isRecord)
        .map((achievement) => ({
          name: asString(achievement.name),
          unlockTime: Math.max(0, asFiniteNumber(achievement.unlockTime)),
        }))
        .filter((achievement) => achievement.name.length > 0)
    : [];

  return {
    objectId: asString(value.objectId),
    shop: value.shop,
    // Achievement definitions are supplied by Hydra/Steam and are not used
    // as filesystem paths. Keep only object-shaped entries from the file.
    achievements:
      achievements as unknown as ProfileSyncAchievementSet["achievements"],
    unlockedAchievements,
    updatedAt:
      typeof value.updatedAt === "number" ? value.updatedAt : undefined,
    language: asNullableString(value.language) ?? undefined,
  };
};

const parseSnapshot = (value: unknown): ProfileSyncSnapshot | null => {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== PROFILE_SYNC_SCHEMA_VERSION) return null;
  if (!Array.isArray(value.games) || !Array.isArray(value.achievements)) {
    return null;
  }

  const games = value.games
    .map(parseGame)
    .filter((game): game is ProfileSyncGame => game !== null);
  const achievements = value.achievements
    .map(parseAchievementSet)
    .filter((set): set is ProfileSyncAchievementSet => set !== null);

  const assets = Array.isArray(value.assets)
    ? value.assets.filter(
        (asset): asset is ShopAssets & { updatedAt: number } => {
          return (
            isRecord(asset) &&
            asString(asset.objectId).length > 0 &&
            isGameShop(asset.shop)
          );
        }
      )
    : [];

  const rawProfile = isRecord(value.profile) ? value.profile : null;
  const profile = rawProfile
    ? {
        id: asString(rawProfile.id),
        displayName: asString(rawProfile.displayName),
        profileImageUrl: asNullableString(rawProfile.profileImageUrl),
        backgroundImageUrl: asNullableString(rawProfile.backgroundImageUrl),
        bio: asString(rawProfile.bio),
        profileVisibility: asProfileVisibility(rawProfile.profileVisibility),
        karma:
          typeof rawProfile.karma === "number" &&
          Number.isFinite(rawProfile.karma)
            ? rawProfile.karma
            : undefined,
      }
    : null;

  return {
    schemaVersion: PROFILE_SYNC_SCHEMA_VERSION,
    profileId: asNullableString(value.profileId),
    updatedAt: asString(value.updatedAt),
    appVersion: asString(value.appVersion),
    profile,
    preferences: isRecord(value.preferences)
      ? (value.preferences as Partial<UserPreferences>)
      : {},
    games,
    achievements,
    assets,
  };
};

const getObjectIdAndShopFromKey = (key: string) => {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return null;

  const shop = key.slice(0, separator);
  const objectId = key.slice(separator + 1);
  if (!isGameShop(shop) || !objectId) return null;
  return { shop, objectId } as { shop: GameShop; objectId: string };
};

const mergeGame = (
  localGame: Game | undefined,
  imported: ProfileSyncGame
): Game => {
  if (!localGame) {
    return {
      title: imported.title,
      iconUrl: imported.iconUrl,
      libraryHeroImageUrl: imported.libraryHeroImageUrl,
      logoImageUrl: imported.logoImageUrl,
      customIconUrl: imported.customIconUrl ?? null,
      customLogoImageUrl: imported.customLogoImageUrl ?? null,
      customHeroImageUrl: imported.customHeroImageUrl ?? null,
      playTimeInMilliseconds: imported.playTimeInMilliseconds,
      lastTimePlayed: asDate(imported.lastTimePlayed),
      objectId: imported.objectId,
      shop: imported.shop,
      remoteId: imported.remoteId,
      isDeleted: false,
      favorite: imported.favorite,
      isPinned: imported.isPinned,
      pinnedDate: asDate(imported.pinnedDate),
      achievementCount: imported.achievementCount,
      unlockedAchievementCount: imported.unlockedAchievementCount,
      currentStreak: imported.currentStreak,
      longestStreak: imported.longestStreak,
      lastStreakDate: imported.lastStreakDate,
      playedDates: imported.playedDates,
    };
  }

  return {
    ...localGame,
    // Paths, executables, downloads and Wine prefixes are device-specific and
    // must never be replaced by a profile file from another computer.
    title: imported.title || localGame.title,
    iconUrl: imported.iconUrl ?? localGame.iconUrl,
    libraryHeroImageUrl:
      imported.libraryHeroImageUrl ?? localGame.libraryHeroImageUrl,
    logoImageUrl: imported.logoImageUrl ?? localGame.logoImageUrl,
    customIconUrl: imported.customIconUrl ?? localGame.customIconUrl,
    customLogoImageUrl:
      imported.customLogoImageUrl ?? localGame.customLogoImageUrl,
    customHeroImageUrl:
      imported.customHeroImageUrl ?? localGame.customHeroImageUrl,
    playTimeInMilliseconds: Math.max(
      localGame.playTimeInMilliseconds ?? 0,
      imported.playTimeInMilliseconds
    ),
    lastTimePlayed: newestDate(
      localGame.lastTimePlayed,
      imported.lastTimePlayed
    ),
    remoteId: localGame.remoteId ?? imported.remoteId,
    favorite: imported.favorite ?? localGame.favorite,
    isPinned: imported.isPinned ?? localGame.isPinned,
    pinnedDate: asDate(imported.pinnedDate) ?? localGame.pinnedDate,
    achievementCount: imported.achievementCount ?? localGame.achievementCount,
    unlockedAchievementCount:
      imported.unlockedAchievementCount ?? localGame.unlockedAchievementCount,
    currentStreak: imported.currentStreak ?? localGame.currentStreak,
    longestStreak: imported.longestStreak ?? localGame.longestStreak,
    lastStreakDate: imported.lastStreakDate ?? localGame.lastStreakDate,
    playedDates: imported.playedDates ?? localGame.playedDates,
  };
};

const mergeAchievementSet = (
  localValue: GameAchievement | undefined,
  imported: ProfileSyncAchievementSet
): GameAchievement => {
  const definitions = new Map<
    string,
    GameAchievement["achievements"][number]
  >();
  for (const achievement of localValue?.achievements ?? []) {
    definitions.set(achievement.name.toUpperCase(), achievement);
  }
  for (const achievement of imported.achievements) {
    if (isRecord(achievement) && typeof achievement.name === "string") {
      definitions.set(
        achievement.name.toUpperCase(),
        achievement as GameAchievement["achievements"][number]
      );
    }
  }

  const unlocked = new Map<string, number>();
  for (const achievement of localValue?.unlockedAchievements ?? []) {
    unlocked.set(achievement.name.toUpperCase(), achievement.unlockTime);
  }
  for (const achievement of imported.unlockedAchievements) {
    const key = achievement.name.toUpperCase();
    unlocked.set(key, Math.max(unlocked.get(key) ?? 0, achievement.unlockTime));
  }

  return {
    achievements: [...definitions.values()],
    unlockedAchievements: [...unlocked.entries()].map(([name, unlockTime]) => ({
      name,
      unlockTime,
    })),
    updatedAt: Math.max(localValue?.updatedAt ?? 0, imported.updatedAt ?? 0),
    language: imported.language ?? localValue?.language,
  };
};

export class ProfileSyncService {
  private static operation = Promise.resolve();

  private static withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private static async getPreferences() {
    return db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
  }

  private static async getUser() {
    return db
      .get<string, User | undefined>(levelKeys.user, {
        valueEncoding: "json",
      })
      .catch(() => undefined);
  }

  private static async getConfiguredPath() {
    const preferences = await this.getPreferences();
    const configuredPath = preferences?.localBackupPath;
    if (!configuredPath || typeof configuredPath !== "string") return null;

    return path.resolve(configuredPath);
  }

  private static async getProfileFilePath() {
    const configuredPath = await this.getConfiguredPath();
    return configuredPath
      ? path.join(configuredPath, PROFILE_SYNC_FILENAME)
      : null;
  }

  private static async readMetadata(): Promise<ProfileSyncMetadata | null> {
    try {
      return await db.get<string, ProfileSyncMetadata | null>(
        levelKeys.profileSyncMetadata,
        { valueEncoding: "json" }
      );
    } catch {
      return null;
    }
  }

  private static async writeMetadata(metadata: ProfileSyncMetadata) {
    await db.put(levelKeys.profileSyncMetadata, metadata, {
      valueEncoding: "json",
    });
  }

  private static async readSnapshot(filePath: string) {
    if (!safeFileName(path.basename(filePath))) return null;

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    if (!stat.isFile()) throw new Error("Profile sync path is not a file");
    if (stat.size > MAX_PROFILE_FILE_SIZE) {
      throw new Error("Profile sync file is too large");
    }

    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = parseSnapshot(JSON.parse(content) as unknown);
    if (!parsed) throw new Error("Unsupported or invalid profile sync file");
    return parsed;
  }

  private static async buildSnapshot(): Promise<ProfileSyncSnapshot> {
    const [games, achievementKeys, assets, preferences, user] =
      await Promise.all([
        gamesSublevel.values().all(),
        gameAchievementsSublevel.keys().all(),
        gamesShopAssetsSublevel.values().all(),
        this.getPreferences(),
        this.getUser(),
      ]);

    const achievements = await Promise.all(
      achievementKeys.map(async (key) => {
        const identity = getObjectIdAndShopFromKey(key);
        if (!identity) return null;
        const value = await gameAchievementsSublevel.get(key);
        return value
          ? serializeAchievementSet(identity.objectId, identity.shop, value)
          : null;
      })
    );

    const safePreferences: Partial<UserPreferences> = {};
    for (const key of PROFILE_PREFERENCE_KEYS) {
      const value = preferences?.[key];
      if (value !== undefined) {
        (safePreferences as Record<string, unknown>)[key] = value;
      }
    }

    return {
      schemaVersion: PROFILE_SYNC_SCHEMA_VERSION,
      profileId: getProfileId(user),
      updatedAt: new Date().toISOString(),
      appVersion,
      profile: user
        ? {
            id: user.id,
            displayName: user.displayName,
            profileImageUrl: user.profileImageUrl,
            backgroundImageUrl: user.backgroundImageUrl,
            bio: user.bio,
            profileVisibility: user.profileVisibility,
            karma: user.karma,
          }
        : null,
      preferences: safePreferences,
      games: games.filter((game) => !game.isDeleted).map(serializeGame),
      achievements: achievements.filter(
        (value): value is ProfileSyncAchievementSet => value !== null
      ),
      assets: assets.filter((asset) => isGameShop(asset.shop)),
    };
  }

  private static async writeSnapshot(
    filePath: string,
    snapshot: ProfileSyncSnapshot
  ) {
    const parentPath = path.dirname(filePath);
    await fs.promises.mkdir(parentPath, { recursive: true });

    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = JSON.stringify(snapshot, null, 2);

    try {
      await fs.promises.writeFile(temporaryPath, content, {
        encoding: "utf8",
        mode: 0o600,
      });
      // Rename is atomic on the filesystems used by the supported platforms.
      // Windows refuses to replace an existing file, so use a short fallback.
      try {
        await fs.promises.rename(temporaryPath, filePath);
      } catch (error) {
        if (
          !["EEXIST", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code ?? ""
          )
        )
          throw error;
        await fs.promises.rm(filePath, { force: true });
        await fs.promises.rename(temporaryPath, filePath);
      }
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  private static async mergeSnapshot(
    snapshot: ProfileSyncSnapshot,
    currentProfileId: string | null
  ): Promise<ProfileSyncImportResult> {
    if (!isCompatibleProfile(snapshot.profileId, currentProfileId)) {
      throw new Error(
        "This profile file belongs to a different Hydra account. Choose another folder."
      );
    }

    const [
      localGames,
      localAchievementKeys,
      localAssetKeys,
      preferences,
      localUser,
    ] = await Promise.all([
      gamesSublevel.values().all(),
      gameAchievementsSublevel.keys().all(),
      gamesShopAssetsSublevel.keys().all(),
      this.getPreferences(),
      this.getUser(),
    ]);

    if (
      snapshot.profile &&
      snapshot.profile.id &&
      (!localUser || localUser.id === snapshot.profile.id)
    ) {
      await db.put(
        levelKeys.user,
        {
          ...localUser,
          id: snapshot.profile.id,
          displayName: snapshot.profile.displayName,
          profileImageUrl: snapshot.profile.profileImageUrl,
          backgroundImageUrl: snapshot.profile.backgroundImageUrl,
          bio: snapshot.profile.bio,
          profileVisibility: snapshot.profile.profileVisibility,
          karma: snapshot.profile.karma,
          subscription: localUser?.subscription ?? null,
        },
        { valueEncoding: "json" }
      );
    }

    const localGamesByKey = new Map(
      localGames.map((game) => [levelKeys.game(game.shop, game.objectId), game])
    );

    for (const importedGame of snapshot.games) {
      const key = levelKeys.game(importedGame.shop, importedGame.objectId);
      await gamesSublevel.put(
        key,
        mergeGame(localGamesByKey.get(key), importedGame)
      );
    }

    const localAchievements = new Map<string, GameAchievement>();
    await Promise.all(
      localAchievementKeys.map(async (key) => {
        const value = await gameAchievementsSublevel.get(key);
        if (value) localAchievements.set(key, value);
      })
    );

    for (const importedSet of snapshot.achievements) {
      const key = levelKeys.game(importedSet.shop, importedSet.objectId);
      await gameAchievementsSublevel.put(
        key,
        mergeAchievementSet(localAchievements.get(key), importedSet)
      );
    }

    const localAssets = new Set(localAssetKeys);
    for (const asset of snapshot.assets) {
      const key = levelKeys.game(asset.shop, asset.objectId);
      const localAsset = localAssets.has(key)
        ? await gamesShopAssetsSublevel.get(key)
        : undefined;
      await gamesShopAssetsSublevel.put(key, {
        ...localAsset,
        ...asset,
        updatedAt: Math.max(localAsset?.updatedAt ?? 0, asset.updatedAt ?? 0),
      });
    }

    let preferencesImported = 0;
    if (Object.keys(snapshot.preferences).length > 0) {
      await db.put(
        levelKeys.userPreferences,
        { ...preferences, ...snapshot.preferences },
        { valueEncoding: "json" }
      );
      preferencesImported = Object.keys(snapshot.preferences).length;
    }

    return {
      gamesImported: snapshot.games.length,
      achievementSetsImported: snapshot.achievements.length,
      assetsImported: snapshot.assets.length,
      preferencesImported,
    };
  }

  public static async getStatus(): Promise<ProfileSyncStatus> {
    const [configuredPath, metadata, filePath] = await Promise.all([
      this.getConfiguredPath(),
      this.readMetadata(),
      this.getProfileFilePath(),
    ]);

    return {
      configured: configuredPath !== null,
      path: configuredPath,
      filePath,
      profileId: metadata?.profileId ?? null,
      lastSyncedAt: metadata?.lastSyncedAt ?? null,
      lastImportedAt: metadata?.lastImportedAt ?? null,
      lastExportedAt: metadata?.lastExportedAt ?? null,
      gameCount: metadata?.gameCount ?? 0,
      achievementSetCount: metadata?.achievementSetCount ?? 0,
    };
  }

  /** Merge a profile file into local data, then publish the merged profile. */
  public static syncProfile() {
    return this.withLock(async () => {
      const filePath = await this.getProfileFilePath();
      if (!filePath) {
        throw new Error("Select a backup folder before syncing your profile");
      }

      const user = await this.getUser();
      const existing = await this.readSnapshot(filePath);
      if (existing?.profileId && !getProfileId(user)) {
        throw new Error(
          "Sign in to the account that owns this profile folder before syncing"
        );
      }

      const imported = existing
        ? await this.mergeSnapshot(existing, getProfileId(user))
        : EMPTY_IMPORT_RESULT;
      const snapshot = await this.buildSnapshot();
      await this.writeSnapshot(filePath, snapshot);

      const now = new Date().toISOString();
      await this.writeMetadata({
        profileId: snapshot.profileId,
        lastSyncedAt: now,
        lastImportedAt: existing ? now : null,
        lastExportedAt: now,
        gameCount: snapshot.games.length,
        achievementSetCount: snapshot.achievements.length,
      });

      logger.info("Profile folder sync completed", {
        filePath,
        games: snapshot.games.length,
        achievements: snapshot.achievements.length,
      });

      return {
        filePath,
        ...imported,
        syncedAt: now,
      };
    });
  }

  /** Restore/merge without writing over the shared file. */
  public static restoreProfile() {
    return this.withLock(async () => {
      const filePath = await this.getProfileFilePath();
      if (!filePath) {
        throw new Error("Select a backup folder before restoring your profile");
      }

      const snapshot = await this.readSnapshot(filePath);
      if (!snapshot) throw new Error("No profile sync file exists yet");

      const user = await this.getUser();
      const imported = await this.mergeSnapshot(snapshot, getProfileId(user));
      const previous = await this.readMetadata();
      const now = new Date().toISOString();
      await this.writeMetadata({
        profileId: snapshot.profileId,
        lastSyncedAt: previous?.lastSyncedAt ?? null,
        lastImportedAt: now,
        lastExportedAt: previous?.lastExportedAt ?? null,
        gameCount: snapshot.games.length,
        achievementSetCount: snapshot.achievements.length,
      });

      return {
        filePath,
        ...imported,
        syncedAt: now,
      };
    });
  }

  public static exportProfile() {
    return this.withLock(async () => {
      const filePath = await this.getProfileFilePath();
      if (!filePath) {
        throw new Error("Select a backup folder before exporting your profile");
      }

      const snapshot = await this.buildSnapshot();
      await this.writeSnapshot(filePath, snapshot);
      const now = new Date().toISOString();
      const previous = await this.readMetadata();
      await this.writeMetadata({
        profileId: snapshot.profileId,
        lastSyncedAt: previous?.lastSyncedAt ?? null,
        lastImportedAt: previous?.lastImportedAt ?? null,
        lastExportedAt: now,
        gameCount: snapshot.games.length,
        achievementSetCount: snapshot.achievements.length,
      });

      return {
        filePath,
        ...EMPTY_IMPORT_RESULT,
        syncedAt: now,
      };
    });
  }
}
