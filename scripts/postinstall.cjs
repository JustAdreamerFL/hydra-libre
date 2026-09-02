const { default: axios } = require("axios");
const tar = require("tar");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const execFileAsync = promisify(execFile);
const ludusaviVersion = "0.29.0";

const fileName = {
  win32: `ludusavi-v${ludusaviVersion}-win64.zip`,
  linux: `ludusavi-v${ludusaviVersion}-linux.tar.gz`,
  darwin: `ludusavi-v${ludusaviVersion}-mac.tar.gz`,
};

const ludusaviBinaryName = {
  win32: "ludusavi.exe",
  linux: "ludusavi",
  darwin: "ludusavi",
};

const downloadLudusavi = async () => {
  const platform = process.platform;
  const targetPath = path.join(process.cwd(), "ludusavi");
  const binaryPath = path.join(targetPath, ludusaviBinaryName[platform]);

  if (fs.existsSync(binaryPath)) {
    console.log("Ludusavi already exists, skipping download...");
    return;
  }

  const archiveName = fileName[platform];
  if (!archiveName) {
    throw new Error(`Unsupported platform for Ludusavi: ${platform}`);
  }

  const archivePath = path.join(process.cwd(), archiveName);
  const downloadUrl = `https://github.com/mtkennerly/ludusavi/releases/download/v${ludusaviVersion}/${archiveName}`;
  console.log(`Downloading ${archiveName}...`);

  const response = await axios.get(downloadUrl, {
    responseType: "arraybuffer",
    timeout: 120_000,
  });
  await fs.promises.writeFile(archivePath, response.data);
  await fs.promises.mkdir(targetPath, { recursive: true });

  if (platform === "win32") {
    // PowerShell is available on all supported Windows runners and avoids an
    // undeclared npx dependency during release builds.
    await execFileAsync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${targetPath.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    await tar.x({ file: archivePath, cwd: targetPath });
    await fs.promises.chmod(binaryPath, 0o755);
  }

  await fs.promises.rm(archivePath, { force: true });
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Ludusavi was not found after extracting ${archiveName}`);
  }
  console.log("Ludusavi installed successfully.");
};

downloadLudusavi().catch((error) => {
  console.error("Failed to install Ludusavi:", error.message);
  process.exitCode = 1;
});
