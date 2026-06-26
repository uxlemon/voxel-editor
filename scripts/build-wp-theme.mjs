// Build the SPA and package it as the Voxel Play WordPress theme zip.
import { execSync } from "child_process";
import { rmSync, cpSync } from "fs";

const THEME = "wordpress-theme/voxel-play";

console.log("• Building app…");
execSync("npm run build", { stdio: "inherit" });

console.log("• Copying dist → theme…");
rmSync(`${THEME}/dist`, { recursive: true, force: true });
cpSync("dist", `${THEME}/dist`, { recursive: true });

console.log("• Zipping theme…");
rmSync("wordpress-theme/voxel-play.zip", { force: true });
try {
  execSync("cd wordpress-theme && zip -rq voxel-play.zip voxel-play -x '*.DS_Store'", {
    stdio: "inherit",
  });
  console.log("\n✓ Theme ready: wordpress-theme/voxel-play.zip");
} catch {
  console.log(
    "\n✓ Theme folder ready: wordpress-theme/voxel-play/ (zip it manually for upload)"
  );
}
