import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UnloadedMod } from "./types.js";

export function unloadedModsDir(stateDir: string): string {
  return join(stateDir, "unloaded-mods");
}

export async function listUnloaded(dir: string): Promise<UnloadedMod[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const mods: UnloadedMod[] = [];
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith(".jar")) continue;
      if (!entry.isFile()) continue;
      const reasonFile = join(dir, `${entry.name}.reason`);
      let reason = "Unknown";
      try {
        reason = await readFile(reasonFile, "utf8");
        reason = reason.trim();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      mods.push({ jar: entry.name, reason });
    }
    return mods.sort((a, b) => a.jar.localeCompare(b.jar));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Failed to read unloaded mods at ${dir}: ${(e as Error).message}`);
  }
}

export async function unloadJar(
  jarFilename: string,
  modsDir: string,
  unloadedDir: string,
  reason: string,
): Promise<void> {
  const src = join(modsDir, jarFilename);
  const dst = join(unloadedDir, jarFilename);
  await mkdir(unloadedDir, { recursive: true });
  await rename(src, dst);
  await writeFile(`${dst}.reason`, reason, "utf8");
}

export async function enableJar(
  jarFilename: string,
  modsDir: string,
  unloadedDir: string,
): Promise<void> {
  const src = join(unloadedDir, jarFilename);
  const dst = join(modsDir, jarFilename);
  await rename(src, dst);
  await unlink(`${src}.reason`).catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  });
}
