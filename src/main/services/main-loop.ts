import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { UpdateManager } from "./update-manager";
import { MAIN_LOOP_INTERVAL } from "@main/constants";
import { ProfileSyncService } from "./profile-sync";

const PROFILE_SYNC_INTERVAL = 2 * 60 * 1000;
let lastProfileSyncAt = 0;

export const startMainLoop = async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const shouldSyncProfile =
      Date.now() - lastProfileSyncAt >= PROFILE_SYNC_INTERVAL;
    if (shouldSyncProfile) lastProfileSyncAt = Date.now();

    await Promise.allSettled([
      shouldSyncProfile
        ? ProfileSyncService.syncProfile().catch(() => {})
        : Promise.resolve(),
      watchProcesses(),
      DownloadManager.watchDownloads(),
      AchievementWatcherManager.watchAchievements(),
      DownloadManager.getSeedStatus(),
      UpdateManager.checkForUpdatePeriodically(),
    ]);

    await sleep(MAIN_LOOP_INTERVAL);
  }
};
