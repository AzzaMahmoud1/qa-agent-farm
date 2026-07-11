import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RunRecord } from "../domain/types.js";

export class FileRunStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  save(run: RunRecord): void {
    const path = this.pathFor(run.id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(run, null, 2), "utf8");
  }

  get(id: string): RunRecord | null {
    const path = this.pathFor(id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as RunRecord;
  }

  list(): RunRecord[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.get(f.replace(/\.json$/, ""))!)
      .filter(Boolean)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
