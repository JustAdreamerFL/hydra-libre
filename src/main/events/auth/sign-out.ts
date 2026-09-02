import { registerEvent } from "../register-event";
import {
  DownloadManager,
  HydraApi,
  WSClient,
  gamesPlaytime,
  ProfileSyncService,
} from "@main/services";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";

const signOut = async (_event: Electron.IpcMainInvokeEvent) => {
  // Flush local-first profile data before clearing the cached account. This
  // matters when a user signs out before the periodic profile sync tick.
  await ProfileSyncService.exportProfile().catch(() => {});

  const databaseOperations = db
    .batch([
      {
        type: "del",
        key: levelKeys.auth,
      },
      {
        type: "del",
        key: levelKeys.user,
      },
    ])
    .then(() => {
      /* Removes all games being played */
      gamesPlaytime.clear();

      return Promise.all([gamesSublevel.clear(), downloadsSublevel.clear()]);
    });

  /* Cancels any ongoing downloads */
  DownloadManager.cancelDownload();

  HydraApi.handleSignOut();

  await Promise.all([
    databaseOperations,
    HydraApi.post("/auth/logout").catch(() => {}),
  ]);

  WSClient.close();
};

registerEvent("signOut", signOut);
