import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudIcon,
  DownloadIcon,
  FileDirectoryIcon,
  SyncIcon,
  UploadIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import type {
  BackupProvider,
  ProfileSyncStatus,
  ProfileSyncSummary,
} from "@types";
import "./settings-backups.scss";

export function SettingsBackups() {
  const { t } = useTranslation("settings");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const [localBackupPath, setLocalBackupPath] = useState<string | null>(
    userPreferences?.localBackupPath ?? null
  );
  const [profileSyncStatus, setProfileSyncStatus] =
    useState<ProfileSyncStatus | null>(null);
  const [profileSyncBusy, setProfileSyncBusy] = useState(false);

  // Local folder sync is the free, privacy-preserving default. Hydra Cloud is
  // still available as a separate hosted option for users who choose it.
  const backupProvider: BackupProvider =
    userPreferences?.backupProvider ?? "local";

  const refreshProfileSyncStatus = useCallback(async () => {
    const status = await window.electron.profileSync
      .getStatus()
      .catch(() => null);
    setProfileSyncStatus(status);
  }, []);

  useEffect(() => {
    setLocalBackupPath(userPreferences?.localBackupPath ?? null);
  }, [userPreferences?.localBackupPath]);

  useEffect(() => {
    refreshProfileSyncStatus();
  }, [refreshProfileSyncStatus]);

  const handleProviderChange = async (provider: BackupProvider) => {
    await updateUserPreferences({ backupProvider: provider });
  };

  const handleSelectLocalBackupPath = async () => {
    const selectedPath = await window.electron.localBackup.selectPath();
    if (selectedPath) {
      // Selecting a folder opts into the free provider immediately. This
      // prevents a newly selected folder from being ignored while Hydra Cloud
      // remains selected in an older preferences file.
      await updateUserPreferences({
        localBackupPath: selectedPath,
        backupProvider: "local",
      });
      setLocalBackupPath(selectedPath);
      showSuccessToast(t("local_backup_path_set"));
      await refreshProfileSyncStatus();
    }
  };

  const showProfileSyncResult = (
    result: ProfileSyncSummary,
    action: "sync" | "restore"
  ) => {
    const total =
      result.gamesImported +
      result.achievementSetsImported +
      result.assetsImported;
    showSuccessToast(
      t(
        action === "sync" ? "profile_sync_completed" : "profile_sync_restored",
        {
          count: total,
        }
      )
    );
  };

  const handleProfileSync = async (action: "sync" | "restore") => {
    setProfileSyncBusy(true);
    try {
      const result =
        action === "sync"
          ? await window.electron.profileSync.sync()
          : await window.electron.profileSync.restore();
      showProfileSyncResult(result, action);
      await refreshProfileSyncStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      showErrorToast(message ?? t("profile_sync_failed"));
    } finally {
      setProfileSyncBusy(false);
    }
  };

  return (
    <div className="settings-backups">
      <p className="settings-backups__description">
        {t("backups_description")}
      </p>

      <div className="settings-backups__section">
        <h3 className="settings-backups__section-title">
          {t("backup_provider_label")}
        </h3>

        <div className="settings-backups__provider-cards">
          <button
            type="button"
            className={`settings-backups__provider-card ${backupProvider === "local" ? "settings-backups__provider-card--active" : ""}`}
            onClick={() => handleProviderChange("local")}
          >
            <FileDirectoryIcon size={24} />
            <span className="settings-backups__provider-card-label">
              {t("libre_folder_sync")}
            </span>
            <small>{t("free")}</small>
          </button>

          <button
            type="button"
            className={`settings-backups__provider-card ${backupProvider === "hydra-cloud" ? "settings-backups__provider-card--active" : ""}`}
            onClick={() => handleProviderChange("hydra-cloud")}
          >
            <CloudIcon size={24} />
            <span className="settings-backups__provider-card-label">
              {t("hydra_cloud")}
            </span>
            <small>{t("hosted_optional")}</small>
          </button>
        </div>
      </div>

      <div className="settings-backups__section">
        <h3 className="settings-backups__section-title">
          {t("libre_folder_sync")}
        </h3>
        <p className="settings-backups__section-description">
          {t("libre_folder_sync_description")}
        </p>

        <div className="settings-backups__local-backup-path">
          <span className="settings-backups__status-label">
            {t("local_backup_path")}:{" "}
            {localBackupPath ?? t("local_backup_path_not_set")}
          </span>
          <Button theme="outline" onClick={handleSelectLocalBackupPath}>
            <FileDirectoryIcon />
            {t("select_local_backup_path")}
          </Button>
        </div>
      </div>

      <div className="settings-backups__section settings-backups__profile-sync">
        <div className="settings-backups__profile-sync-header">
          <div>
            <h3 className="settings-backups__section-title">
              {t("profile_sync")}
            </h3>
            <p className="settings-backups__section-description">
              {t("profile_sync_description")}
            </p>
          </div>
          <SyncIcon size={22} className="settings-backups__profile-sync-icon" />
        </div>

        <div className="settings-backups__profile-sync-status">
          <span>
            {profileSyncStatus?.configured
              ? t("profile_sync_ready")
              : t("profile_sync_choose_folder")}
          </span>
          {profileSyncStatus?.lastSyncedAt && (
            <small>
              {t("profile_sync_last_synced", {
                date: new Date(profileSyncStatus.lastSyncedAt).toLocaleString(),
              })}
            </small>
          )}
        </div>

        <div className="settings-backups__profile-sync-actions">
          <Button
            onClick={() => handleProfileSync("sync")}
            disabled={profileSyncBusy || !profileSyncStatus?.configured}
          >
            <SyncIcon />
            {profileSyncBusy
              ? t("profile_sync_working")
              : t("profile_sync_now")}
          </Button>
          <Button
            theme="outline"
            onClick={() => handleProfileSync("restore")}
            disabled={profileSyncBusy || !profileSyncStatus?.configured}
          >
            <DownloadIcon />
            {t("profile_sync_restore")}
          </Button>
          <Button
            theme="outline"
            onClick={async () => {
              setProfileSyncBusy(true);
              try {
                const result = await window.electron.profileSync.export();
                showProfileSyncResult(result, "sync");
                await refreshProfileSyncStatus();
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : undefined;
                showErrorToast(message ?? t("profile_sync_failed"));
              } finally {
                setProfileSyncBusy(false);
              }
            }}
            disabled={profileSyncBusy || !profileSyncStatus?.configured}
          >
            <UploadIcon />
            {t("profile_sync_export")}
          </Button>
        </div>
      </div>
    </div>
  );
}
