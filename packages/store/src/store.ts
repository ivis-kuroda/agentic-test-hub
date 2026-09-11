import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

import { layoutFor, pathFor, type EntityKind } from "./layout.ts";
import { hashContents, loadSuite, type FileState, type LoadedSuite } from "./load.ts";
import { toYaml } from "./serialize.ts";

/** A save that would have overwritten someone else's change. */
export class ConflictError extends Error {
  readonly file: string;
  /** The hash the file actually has. */
  readonly actualHash: string;
  /** The file's current contents, so a caller can show the difference. */
  readonly current: string;

  constructor(file: string, actualHash: string, current: string) {
    super(`${file} changed since it was read`);
    this.name = "ConflictError";
    this.file = file;
    this.actualHash = actualHash;
    this.current = current;
  }
}

/** A request to write one entity. */
export interface SaveRequest {
  readonly kind: EntityKind;
  /** The entity. Validated against its schema before anything is written. */
  readonly entity: unknown;
  /**
   * The hash the caller last saw, or `undefined` when creating.
   *
   * Supplying it is how two people editing the same case stop being a silent
   * last-write-wins. Omitting it for an existing file is rejected rather than
   * treated as consent: a save with no idea what it is overwriting is a bug
   * in the caller.
   */
  readonly expectedHash?: string;
}

/** What a completed save wrote. */
export interface SaveResult {
  readonly file: string;
  readonly hash: string;
  /** True when the file did not exist before. */
  readonly created: boolean;
}

/**
 * The specification directory, and the only thing that writes to it.
 *
 * Two guarantees justify a class rather than loose functions:
 *
 * - **One writer.** Every write goes through a single queue. Concurrent
 *   writes to a working tree that git also operates on corrupt it, and a web
 *   editor will happily issue two at once.
 * - **No blind overwrites.** A write carries the hash its author last saw.
 *   Without that, two people editing the same case lose one of the edits with
 *   nothing reported.
 */
export class SpecStore {
  private readonly root: string;
  /** The tail of the write queue. Writes chain onto it, never run beside it. */
  private queue: Promise<unknown> = Promise.resolve();

  /** @param root - Specification root directory. */
  constructor(root: string) {
    this.root = root;
  }

  /** Reads the whole suite. */
  load(): Promise<LoadedSuite> {
    return loadSuite(this.root);
  }

  /**
   * Writes one entity, refusing to overwrite an unexpected change.
   *
   * @param request - What to write, and what the caller last saw.
   * @returns Where it was written and the file's new hash.
   * @throws {ConflictError} When the file changed since it was read.
   */
  save(request: SaveRequest): Promise<SaveResult> {
    return this.serialise(() => this.writeNow(request));
  }

  /**
   * Removes an entity, refusing to remove an unexpected change.
   *
   * @param kind - What kind of entity it is.
   * @param id - Its identifier.
   * @param expectedHash - The hash the caller last saw.
   * @returns The path that was removed.
   * @throws {ConflictError} When the file changed since it was read.
   */
  remove(kind: EntityKind, id: string, expectedHash: string): Promise<{ file: string }> {
    return this.serialise(async () => {
      const path = pathFor(this.root, kind, id);
      const existing = await this.readExisting(path);
      if (existing === undefined) throw new Error(`${relative(this.root, path)} does not exist`);
      if (existing.hash !== expectedHash) {
        throw new ConflictError(relative(this.root, path), existing.hash, existing.text);
      }
      await rm(path);
      return { file: relative(this.root, path) };
    });
  }

  /** Chains work onto the write queue, so writes never overlap. */
  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    // The queue must survive a failed write: without catching here, one
    // rejection would make every subsequent save reject with the same error.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async readExisting(path: string): Promise<{ text: string; hash: string } | undefined> {
    try {
      const text = await readFile(path, "utf8");
      return { text, hash: hashContents(text) };
    } catch (cause) {
      if ((cause as { code?: string }).code === "ENOENT") return undefined;
      throw cause;
    }
  }

  private async writeNow(request: SaveRequest): Promise<SaveResult> {
    const layout = layoutFor(request.kind);
    // Validated before the hash is checked, so a malformed entity is reported
    // as malformed rather than as a conflict. The schema also settles the
    // identifier's prefix, so a case cannot be filed as a viewpoint; there is
    // deliberately no second check here to imply otherwise.
    const entity = layout.schema.parse(request.entity) as { id: string };

    const path = pathFor(this.root, request.kind, entity.id);
    const file = relative(this.root, path);
    const existing = await this.readExisting(path);

    if (existing !== undefined) {
      if (request.expectedHash === undefined) {
        throw new ConflictError(file, existing.hash, existing.text);
      }
      if (existing.hash !== request.expectedHash) {
        throw new ConflictError(file, existing.hash, existing.text);
      }
    }

    const text = toYaml(entity, layout.schema);
    if (existing?.text === text) {
      // Nothing changed. Skipped so that saving an untouched form does not
      // produce a commit with an empty diff.
      return { file, hash: existing.hash, created: false };
    }

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
    return { file, hash: hashContents(text), created: existing === undefined };
  }
}

export type { FileState };
