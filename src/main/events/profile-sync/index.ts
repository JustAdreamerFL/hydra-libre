import { ProfileSyncService } from "@main/services/profile-sync";
import { registerEvent } from "../register-event";

registerEvent("profileSyncGetStatus", () => ProfileSyncService.getStatus());
registerEvent("profileSync", () => ProfileSyncService.syncProfile());
registerEvent("profileSyncRestore", () => ProfileSyncService.restoreProfile());
registerEvent("profileSyncExport", () => ProfileSyncService.exportProfile());
