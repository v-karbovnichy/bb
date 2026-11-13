import {
  experimental_normalizeHostPath as normalizeHostPath,
  experimental_resolveHostPath as resolvePath,
  experimental_joinHostPath as joinPath,
  experimental_getHostPathDirname as getHostPathDirname,
  experimental_getRelativeHostPath as getRelativeHostPath,
} from "@get-bb/plugin-sdk";
import { proposalSchema, type Proposal } from "./proposals.js";
import os from "node:os";
import path from "node:path";
import { isRecord, parseMarkdownDocument } from "./markdown-document.js";
import {
  experimental_PluginRpcRefusal,
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  MAX_TREE_ENTRIES,
  VAULTS_TAG,
  docsRpcContract,
  documentTag,
  errorMessage,
  openedFileTag,
  pathTags,
  requireString,
  requireVaultPath,
  syncDeleteSchema,
  syncScopeSchema,
  syncSnapshotEntrySchema,
  syncStateEntrySchema,
  syncWriteSchema,
  treeTag,
  vaultPathSchema,
  vaultSchema,
  vaultTag,
  type OpenerSource,
  type Vault,
} from "./contract.js";
import {
  createVaultWatches,
  watchNativeVault,
  type WatchVault,
} from "./vault-watches.js";

const DEFAULT_DIR = "~/Notes";
const PREVIEW_LENGTH = 100;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const SYNC_STATE_FILE = ".bb-docs-state.json";
const SYNC_STATE_VERSION = 1;
const MENTION_SUMMARY_TTL_MS = 10_000;
const PREVIEW_RENEW_BEFORE_MS = 2 * 60_000;
const SUMMARY_READ_CONCURRENCY = 8;

class CliUsageError extends PluginCliError {
  constructor(message: string) {
    super(message, { code: "usage_error", exitCode: 2 });
  }
}

const DOCS_DESCRIPTION = [
  "Хранилища содержат документы; каждый путь указывается относительно своего хранилища.",
  "Загрузите нужные файлы в рабочую папку, отредактируйте обычными инструментами, затем выполните status и push.",
].join("\n");

const DOCS_STATUS_DESCRIPTION = [
  "Код 0: изменений нет.",
  "Код 1: операция status завершилась ошибкой.",
  "Код 2: неверное использование команды.",
  "Код 3: конфликт локальных и удалённых изменений.",
  "Код 4: есть изменения.",
  "",
  "Код 4 означает успешное выполнение status. Просмотрите результат и отдельно выполните bb docs push.",
].join("\n");

const DEPRECATED_MUTATION_WARNING =
  "Устарело: прямые изменения Docs будут удалены; используйте bb docs pull, редактируйте локальные файлы и выполняйте bb docs push.";

const DEPRECATED_DELETION_WARNING =
  "Устарело: прямые изменения Docs будут удалены; используйте bb docs pull, редактируйте локальные файлы и выполняйте bb docs push --delete.";

const VAULT_OPTION = {
  type: "string",
  placeholder: "id",
  aliases: ["vault-id", "vaultId"],
  description:
    "ID хранилища из `bb docs vaults`; по умолчанию — первое настроенное хранилище",
} as const;

const WORKSPACE_HOST_OPTION = {
  type: "string",
  placeholder: "id",
  aliases: ["host", "host-id"],
  description:
    "Хост рабочей папки; по умолчанию — хост среды чата",
} as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Вывести JSON для машинной обработки",
} as const;

const DIFF_OPTION = {
  type: "boolean",
  description: "Включить unified diff для каждого изменённого файла",
} as const;

const DELETE_OPTION = {
  type: "boolean",
  description:
    "Также удалить из хранилища локально удалённые файлы и пустые папки",
} as const;

interface SyncCliArgs {
  positionals: string[];
  vaultId: string | undefined;
  into: string | undefined;
  workspaceHostId: string | undefined;
  all: boolean;
  folder: boolean;
  delete: boolean;
  dryRun: boolean;
  diff: boolean;
}

interface VaultEntry {
  kind: "file" | "directory";
  path: string;
}

interface NoteSummary {
  path: string;
  title: string;
  preview: string;
  modifiedAtMs: number;
}

interface ResolvedOpenerFile {
  path: string;
  rootPath: string;
  hostId: string | null;
}

const syncStateSchema = z
  .object({
    schemaVersion: z.literal(SYNC_STATE_VERSION),
    vault: z
      .object({ id: z.string().min(1), name: z.string().min(1) })
      .strict(),
    scope: syncScopeSchema,
    pulledAt: z.iso.datetime(),
    entries: z.array(syncStateEntrySchema).max(MAX_TREE_ENTRIES),
    directories: z.array(vaultPathSchema).max(MAX_TREE_ENTRIES),
  })
  .strict();
type SyncScope = z.infer<typeof syncScopeSchema>;
type SyncStateEntry = z.infer<typeof syncStateEntrySchema>;
type SyncState = z.infer<typeof syncStateSchema>;
type SyncFile = z.infer<typeof syncSnapshotEntrySchema>;

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Ожидался объект");
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHome(rawPath: string): string {
  if (rawPath === "~") return os.homedir();
  if (rawPath.startsWith("~/"))
    return path.join(os.homedir(), rawPath.slice(2));
  return rawPath;
}

function requireOptionalDirectory(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return requireVaultPath(value);
}

function requireThreadStoragePath(value: unknown): string {
  const raw = requireString(value, "path").replace(/\\/g, "/");
  if (
    isAbsoluteHostPath(raw) ||
    resolvePath({ rootPath: "/", path: raw }) === null ||
    raw.split("/").includes("..")
  ) {
    throw new Error(`Неверный путь хранилища чата: ${raw}`);
  }
  return path.posix.normalize(raw);
}

function isAbsoluteHostPath(value: string): boolean {
  return normalizeHostPath(value) !== null;
}

function normalizeHostRoot(value: string): string {
  const normalized = normalizeHostPath(value);
  if (normalized === null)
    throw new Error(`Неверный абсолютный путь на хосте: ${value}`);
  return normalized;
}

function localFilePath(rootPath: string, relativePath: string): string {
  const joined = joinPath({ rootPath, relativePath });
  if (joined === null)
    throw new Error(`Неверный абсолютный путь на хосте: ${rootPath}`);
  return joined;
}

function hostPathDirname(filePath: string): string {
  const dirname = getHostPathDirname(filePath);
  if (dirname === null)
    throw new Error(`Неверный абсолютный путь на хосте: ${filePath}`);
  return dirname;
}

function hostIdArgs(hostId: string | null | undefined): { hostId?: string } {
  return hostId ? { hostId } : {};
}

function hostArgs(vault: Vault): { hostId?: string } {
  return hostIdArgs(vault.hostId);
}

function syncEntryFromFile(
  relativePath: string,
  file: Awaited<ReturnType<BbPluginApi["sdk"]["files"]["read"]>>,
): SyncStateEntry {
  return {
    remotePath: relativePath,
    localPath: relativePath,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    contentEncoding: file.contentEncoding,
    mimeType: file.mimeType ?? null,
    modifiedAtMs: file.modifiedAtMs ?? null,
  };
}

function cleanLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
}

function markdownHeadingLevel(line: string): number | null {
  const match = line.match(/^\s{0,3}(#{1,6})(?:[\t ]+|$)/);
  return match ? match[1]!.length : null;
}

function summarizeMarkdown(
  content: string,
  fallback: string,
): { title: string; preview: string } {
  const document = parseMarkdownDocument(content);
  const lines = document.body.split("\n");
  const cleanedLines = lines.map(cleanLine);
  const firstContentIndex = cleanedLines.findIndex(
    (line) => line && !line.startsWith("::html{"),
  );
  const documentHeadingIndex = document.frontmatter
    ? lines.findIndex((line) => markdownHeadingLevel(line) === 1)
    : -1;
  const titleLineIndex = document.title
    ? -1
    : documentHeadingIndex >= 0
      ? documentHeadingIndex
      : firstContentIndex;
  const title = (
    document.title ??
    (titleLineIndex >= 0 ? cleanedLines[titleLineIndex] : null) ??
    fallback
  ).slice(0, 120);
  const firstHeadingIndex = lines.findIndex(
    (line) => markdownHeadingLevel(line) !== null,
  );
  const previewHeadingIndex =
    titleLineIndex >= 0
      ? titleLineIndex
      : firstHeadingIndex >= 0 && cleanedLines[firstHeadingIndex] === title
        ? firstHeadingIndex
        : -1;
  const preview = cleanedLines
    .filter(
      (line, index) =>
        index !== previewHeadingIndex &&
        line &&
        line !== title &&
        !line.startsWith("::html{"),
    )
    .join(" ")
    .slice(0, PREVIEW_LENGTH);
  return { title, preview };
}

function deriveTitle(content: string, fallback: string): string {
  return summarizeMarkdown(content, fallback).title;
}

function kebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

function sanitizeName(raw: string): string {
  return raw
    .replace(/\.(md|html?)$/i, "")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function parseVaultRow(value: unknown): Vault {
  const row = requireRecord(value);
  return {
    id: requireString(row.id, "id"),
    name: requireString(row.name, "name"),
    hostId: typeof row.host_id === "string" && row.host_id ? row.host_id : null,
    rootPath: requireString(row.root_path, "root_path"),
  };
}

function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export default async function plugin(
  bb: BbPluginApi,
  watchVault: WatchVault = watchNativeVault,
) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS vaults (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host_id TEXT,
      root_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS entry_order (
      vault_id TEXT NOT NULL,
      parent_path TEXT NOT NULL,
      child_path TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (vault_id, parent_path, child_path)
    )`,
    `CREATE TABLE IF NOT EXISTS proposals (
      vault_id TEXT NOT NULL,
      path TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (vault_id, path)
    )`,
  ]);

  let seededDefaultVault = false;
  if (
    Number(db.prepare("SELECT COUNT(*) AS count FROM vaults").pluck().get()) ===
    0
  ) {
    const rootPath = path.resolve(expandHome(DEFAULT_DIR));
    db.prepare(
      "INSERT INTO vaults (id, name, host_id, root_path, created_at) VALUES (?, ?, NULL, ?, ?)",
    ).run("personal", "Personal", rootPath, Date.now());
    seededDefaultVault = true;
  }

  function listVaults(): Vault[] {
    return db
      .prepare(
        "SELECT id, name, host_id, root_path FROM vaults ORDER BY created_at, name",
      )
      .all()
      .map(parseVaultRow);
  }

  function getVault(vaultId?: string): Vault {
    const vaults = listVaults();
    const vault = vaultId
      ? vaults.find((candidate) => candidate.id === vaultId)
      : vaults[0];
    if (!vault)
      throw new Error(
        vaultId ? `Неизвестное хранилище: ${vaultId}` : "Хранилище не настроено",
      );
    return vault;
  }

  function listEntryOrder(vaultId: string): string[] {
    return db
      .prepare(
        "SELECT child_path FROM entry_order WHERE vault_id = ? ORDER BY parent_path, position",
      )
      .all(vaultId)
      .map((row) => requireString(requireRecord(row).child_path, "child_path"));
  }

  if (seededDefaultVault) {
    const vault = getVault("personal");
    try {
      await bb.sdk.files.mkdir({ path: vault.rootPath, recursive: true });
    } catch (error) {
      bb.log.warn(`could not create default vault: ${errorMessage(error)}`);
    }
  }

  function listVaultPaths(vault: Vault, signal?: AbortSignal) {
    return bb.sdk.files.listPaths({
      ...hostArgs(vault),
      path: vault.rootPath,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: false,
      limit: MAX_TREE_ENTRIES,
      ...(signal ? { signal } : {}),
    });
  }

  async function listEntries(
    vault: Vault,
    signal?: AbortSignal,
  ): Promise<{ entries: VaultEntry[]; truncated: boolean }> {
    const result = await listVaultPaths(vault, signal);
    return {
      entries: result.paths
        .filter(
          (entry) =>
            entry.kind === "directory" || /\.(md|html?)$/i.test(entry.path),
        )
        .map((entry) => ({
          kind: entry.kind,
          path: entry.path.replace(/\\/g, "/"),
        })),
      truncated: result.truncated,
    };
  }

  async function listNoteSummaries(
    vault: Vault,
    knownEntries?: VaultEntry[],
    signal?: AbortSignal,
  ): Promise<NoteSummary[]> {
    const entries = knownEntries ?? (await listEntries(vault, signal)).entries;
    const markdownPaths = entries
      .filter((entry) => entry.kind === "file" && /\.md$/i.test(entry.path))
      .map((entry) => entry.path);
    const notes: Array<NoteSummary | null> = markdownPaths.map(() => null);
    let nextIndex = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(SUMMARY_READ_CONCURRENCY, markdownPaths.length) },
        async () => {
          while (nextIndex < markdownPaths.length) {
            signal?.throwIfAborted();
            const index = nextIndex++;
            const notePath = markdownPaths[index]!;
            try {
              const file = await bb.sdk.files.read({
                ...hostArgs(vault),
                path: localFilePath(vault.rootPath, notePath),
                rootPath: vault.rootPath,
                ...(signal ? { signal } : {}),
              });
              const fallback = path.posix
                .basename(notePath)
                .replace(/\.md$/i, "");
              const summary = summarizeMarkdown(file.content, fallback);
              notes[index] = {
                path: notePath,
                title: summary.title,
                preview: summary.preview,
                modifiedAtMs: file.modifiedAtMs ?? 0,
              };
            } catch {}
          }
        },
      ),
    );
    signal?.throwIfAborted();
    return notes
      .filter((note): note is NoteSummary => note !== null)
      .sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  }

  const mentionSummaries = new Map<
    string,
    {
      rootPath: string;
      hostId: string | null;
      expiresAt: number;
      notes: Promise<NoteSummary[]>;
    }
  >();
  const mentionLifetime = new AbortController();
  const treeSummaries = new Map<string, Map<string, string>>();
  const watches = createVaultWatches({
    getVault,
    watchVault,
    invalidate: (tags) => invalidate(tags),
    scanRemote: async (vault, signal) => {
      const { entries } = await listEntries(vault, signal);
      const notes = await listNoteSummaries(vault, entries, signal);
      const modified = new Map<string, number>(
        entries.map((entry) => [entry.path, 0]),
      );
      for (const note of notes) modified.set(note.path, note.modifiedAtMs);
      return modified;
    },
    onExternalChange: async (vaultId, paths) => {
      mentionSummaries.delete(vaultId);
      const summaries = treeSummaries.get(vaultId);
      if (paths === null || !summaries) {
        treeSummaries.delete(vaultId);
        return true;
      }
      const vault = getVault(vaultId);
      let changed = false;
      for (const relativePath of paths) {
        if (!/\.md$/i.test(relativePath)) {
          changed = true;
          continue;
        }
        const file = await readExistingFile(vault, relativePath);
        if (file === null) {
          if (summaries.delete(relativePath)) changed = true;
          continue;
        }
        const title = deriveTitle(
          file.content,
          path.posix.basename(relativePath).replace(/\.md$/i, ""),
        );
        if (summaries.get(relativePath) !== title) {
          summaries.set(relativePath, title);
          changed = true;
        }
      }
      return changed;
    },
    warn: (message) => bb.log.warn(message),
  });
  bb.onDispose(() => {
    mentionLifetime.abort();
    mentionSummaries.clear();
    watches.stopAll();
  });

  function mentionNoteSummaries(vault: Vault): Promise<NoteSummary[]> {
    const cached = mentionSummaries.get(vault.id);
    if (
      cached &&
      cached.rootPath === vault.rootPath &&
      cached.hostId === vault.hostId &&
      cached.expiresAt > Date.now()
    ) {
      return cached.notes;
    }
    const entry = {
      rootPath: vault.rootPath,
      hostId: vault.hostId,
      expiresAt: Infinity,
      notes: listNoteSummaries(
        vault,
        undefined,
        AbortSignal.any([
          mentionLifetime.signal,
          AbortSignal.timeout(MENTION_SUMMARY_TTL_MS),
        ]),
      ),
    };
    entry.notes = entry.notes.then(
      (notes) => {
        entry.expiresAt = Date.now() + MENTION_SUMMARY_TTL_MS;
        return notes;
      },
      (error: unknown) => {
        if (mentionSummaries.get(vault.id) === entry) {
          mentionSummaries.delete(vault.id);
        }
        throw error;
      },
    );
    mentionSummaries.set(vault.id, entry);
    return entry.notes;
  }

  async function notebookData(vaultId?: string) {
    const vault = getVault(vaultId);
    try {
      const [{ entries, truncated }, hosts] = await Promise.all([
        listEntries(vault),
        bb.sdk.hosts.list(),
      ]);
      const notes = await listNoteSummaries(vault, entries);
      treeSummaries.set(
        vault.id,
        new Map(notes.map((note) => [note.path, note.title])),
      );
      return {
        vaults: listVaults(),
        vault,
        hosts,
        entries,
        entryOrder: listEntryOrder(vault.id),
        notes,
        truncated,
        error: null,
      };
    } catch (error) {
      return {
        vaults: listVaults(),
        vault,
        hosts: await bb.sdk.hosts.list().catch(() => []),
        entries: [],
        entryOrder: listEntryOrder(vault.id),
        notes: [],
        truncated: false,
        error: errorMessage(error),
      };
    }
  }

  async function readFile(vaultId: string | undefined, rawPath: unknown) {
    const vault = getVault(vaultId);
    const relativePath = requireVaultPath(rawPath);
    const file = await bb.sdk.files.read({
      ...hostArgs(vault),
      path: localFilePath(vault.rootPath, relativePath),
      rootPath: vault.rootPath,
    });
    return { ...file, path: relativePath };
  }

  async function writeFile(args: {
    vaultId?: string;
    rawPath: unknown;
    content: unknown;
    contentEncoding?: "utf8" | "base64";
    expectedSha256?: unknown;
    createOnly?: boolean;
  }) {
    const vault = getVault(args.vaultId);
    const relativePath = requireVaultPath(args.rawPath);
    if (typeof args.content !== "string")
      throw new Error('«content» должно быть строкой');
    const result = await bb.sdk.files.write({
      ...hostArgs(vault),
      path: localFilePath(vault.rootPath, relativePath),
      rootPath: vault.rootPath,
      content: args.content,
      contentEncoding: args.contentEncoding ?? "utf8",
      createParents: true,
      ...(args.createOnly
        ? { expectedSha256: null }
        : args.expectedSha256 === null ||
            typeof args.expectedSha256 === "string"
          ? { expectedSha256: args.expectedSha256 }
          : {}),
    });
    if (result.outcome === "written") {
      mentionSummaries.delete(vault.id);
      watches.recordOwnChange(vault, [relativePath]);
      invalidate([
        documentTag(vault.id, relativePath),
        ...(args.createOnly ||
        treeChangedBy(
          vault.id,
          relativePath,
          args.content,
          args.contentEncoding,
        )
          ? [treeTag(vault.id)]
          : []),
      ]);
    }
    return result;
  }

  function invalidate(tags: string[]): void {
    bb.rpc.experimental_invalidate([...new Set(tags)]);
  }

  function treeChangedBy(
    vaultId: string,
    relativePath: string,
    content: string,
    contentEncoding: "utf8" | "base64" | undefined,
  ): boolean {
    if (!/\.md$/i.test(relativePath) || contentEncoding === "base64")
      return false;
    const summaries = treeSummaries.get(vaultId);
    if (!summaries) return true;
    const next = deriveTitle(
      content,
      path.posix.basename(relativePath).replace(/\.md$/i, ""),
    );
    if (summaries.get(relativePath) === next) return false;
    summaries.set(relativePath, next);
    return true;
  }

  const vaultOperations = new Map<string, Promise<unknown>>();

  async function serializeVault<T>(
    vaultId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = vaultId;
    const previous = vaultOperations.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => {
        getVault(vaultId);
        return work();
      });
    vaultOperations.set(key, current);
    try {
      return await current;
    } finally {
      if (vaultOperations.get(key) === current) vaultOperations.delete(key);
    }
  }

  function readProposal(
    vaultId: string,
    relativePath: string,
  ): Proposal | null {
    const row = db
      .prepare("SELECT data FROM proposals WHERE vault_id = ? AND path = ?")
      .get(vaultId, relativePath);
    if (!row) return null;
    const data = z.object({ data: z.string() }).parse(row);
    return proposalSchema.parse(JSON.parse(data.data));
  }

  function saveProposal(proposal: Proposal): Proposal {
    db.prepare(
      "INSERT INTO proposals (vault_id, path, data) VALUES (?, ?, ?) ON CONFLICT(vault_id, path) DO UPDATE SET data = excluded.data",
    ).run(proposal.vaultId, proposal.path, JSON.stringify(proposal));
    invalidate([documentTag(proposal.vaultId, proposal.path)]);
    return proposal;
  }

  function requireProposal(
    vaultId: string,
    relativePath: string,
    expectedVersion: number,
  ): Proposal {
    const proposal = readProposal(vaultId, relativePath);
    if (!proposal || proposal.version !== expectedVersion) {
      throw new Error("Предложение изменилось. Прочитайте его снова, прежде чем продолжить.");
    }
    return proposal;
  }

  async function resolveOpenerFile(
    source: OpenerSource,
    pathValue: unknown,
  ): Promise<ResolvedOpenerFile> {
    const filePath = requireString(pathValue, "path");
    if (source.kind === "host") {
      if (!isAbsoluteHostPath(filePath)) {
        throw new Error("Пути к файлам на хосте должны быть абсолютными");
      }
      const normalized = normalizeHostRoot(filePath);
      return {
        path: normalized,
        rootPath: hostPathDirname(normalized),
        hostId:
          source.experimental_hostId ??
          (source.environmentId === null
            ? null
            : (
                await bb.sdk.environments.get({
                  environmentId: source.environmentId,
                })
              ).hostId),
      };
    }
    if (source.kind === "workspace" && source.environmentId) {
      const environment = await bb.sdk.environments.get({
        environmentId: source.environmentId,
      });
      if (!environment.path) {
        throw new Error("У этой среды нет пути к рабочей папке");
      }
      return {
        path: localFilePath(environment.path, filePath),
        rootPath: environment.path,
        hostId: environment.hostId,
      };
    }
    if (source.kind === "workspace" && source.projectId) {
      const hostId =
        source.experimental_hostId ??
        (await bb.sdk.system.config()).primaryHostId;
      if (!hostId) {
        throw new Error("У этого сервера bb пока нет основной машины");
      }
      const project = await bb.sdk.projects.get({
        projectId: source.projectId,
      });
      const matchingSources = project.sources.filter(
        (projectSource) => projectSource.hostId === hostId,
      );
      const [projectSource] = matchingSources;
      if (!projectSource) {
        throw new Error(
          source.experimental_hostId
            ? "У этого проекта нет рабочей папки на выбранном хосте"
            : "У этого проекта нет рабочей папки на сервере",
        );
      }
      if (matchingSources.length > 1) {
        throw new Error("У этого проекта несколько рабочих папок на указанном хосте");
      }
      const rootPath = normalizeHostRoot(projectSource.path);
      if (!isAbsoluteHostPath(rootPath)) {
        throw new Error("У этого проекта нет абсолютного пути к рабочей папке");
      }
      return {
        path: localFilePath(rootPath, filePath),
        rootPath,
        hostId,
      };
    }
    if (source.kind === "thread-storage") {
      if (!source.threadId) {
        throw new Error("Для файлов хранилища чата нужен ID чата");
      }
      const relativePath = requireThreadStoragePath(filePath);
      const storage = await bb.sdk.threads.storageLocation({
        threadId: source.threadId,
      });
      if (!isAbsoluteHostPath(storage.storageRootPath)) {
        throw new Error("У этого чата нет абсолютного пути к хранилищу");
      }
      const rootPath = normalizeHostRoot(storage.storageRootPath);
      return {
        path: localFilePath(rootPath, relativePath),
        rootPath,
        hostId: storage.hostId,
      };
    }
    throw new Error(
      "Документы могут открывать только файлы рабочей папки, хоста и хранилища чата",
    );
  }

  async function createNote(
    vaultId: string | undefined,
    input: Record<string, unknown>,
  ) {
    const vault = getVault(vaultId);
    const parent = requireOptionalDirectory(input.parent);
    const base =
      sanitizeName(typeof input.name === "string" ? input.name : "") ||
      "Untitled";
    const { entries } = await listEntries(vault);
    const existing = new Set(entries.map((entry) => entry.path.toLowerCase()));
    let relativePath = parent ? `${parent}/${base}.md` : `${base}.md`;
    let counter = 2;
    while (existing.has(relativePath.toLowerCase())) {
      relativePath = parent
        ? `${parent}/${base} ${counter}.md`
        : `${base} ${counter}.md`;
      counter += 1;
    }
    await writeFile({
      vaultId: vault.id,
      rawPath: relativePath,
      content: typeof input.content === "string" ? input.content : "",
      createOnly: true,
    });
    return { path: relativePath };
  }

  async function movePath(
    vaultId: string | undefined,
    fromValue: unknown,
    toValue: unknown,
  ) {
    const vault = getVault(vaultId);
    const from = requireVaultPath(fromValue);
    const to = requireVaultPath(toValue);
    return serializeVault(vault.id, () => moveWithinVault(vault, from, to));
  }

  async function moveWithinVault(vault: Vault, from: string, to: string) {
    await bb.sdk.files.move({
      ...hostArgs(vault),
      sourcePath: localFilePath(vault.rootPath, from),
      destinationPath: localFilePath(vault.rootPath, to),
      rootPath: vault.rootPath,
    });
    db.transaction(() => {
      const rows = db
        .prepare(
          "SELECT data FROM proposals WHERE vault_id = ? AND (path = ? OR substr(path, 1, length(?)) = ?)",
        )
        .all(vault.id, from, `${from}/`, `${from}/`);
      deleteProposals(vault.id, from);
      deleteProposals(vault.id, to);
      const insert = db.prepare(
        "INSERT INTO proposals (vault_id, path, data) VALUES (?, ?, ?)",
      );
      for (const row of rows) {
        const { data } = z.object({ data: z.string() }).parse(row);
        const proposal = proposalSchema.parse(JSON.parse(data));
        proposal.path = to + proposal.path.slice(from.length);
        insert.run(vault.id, proposal.path, JSON.stringify(proposal));
      }
    })();
    mentionSummaries.delete(vault.id);
    treeSummaries.delete(vault.id);
    watches.recordOwnChange(vault, [from, to]);
    invalidate([
      treeTag(vault.id),
      ...pathTags(vault.id, from),
      ...pathTags(vault.id, to),
    ]);
    return { path: to };
  }

  function deleteProposals(vaultId: string, relativePath: string) {
    db.prepare(
      "DELETE FROM proposals WHERE vault_id = ? AND (path = ? OR substr(path, 1, length(?)) = ?)",
    ).run(vaultId, relativePath, `${relativePath}/`, `${relativePath}/`);
  }

  async function removePath(
    vaultId: string | undefined,
    rawPath: unknown,
    recursive = false,
  ): Promise<{ ok: true }> {
    const vault = getVault(vaultId);
    const relativePath = requireVaultPath(rawPath);
    return serializeVault(vault.id, async () => {
      await bb.sdk.files.remove({
        ...hostArgs(vault),
        path: localFilePath(vault.rootPath, relativePath),
        rootPath: vault.rootPath,
        recursive,
      });
      deleteProposals(vault.id, relativePath);
      mentionSummaries.delete(vault.id);
      treeSummaries.get(vault.id)?.delete(relativePath);
      watches.recordOwnChange(vault, [relativePath]);
      invalidate([treeTag(vault.id), ...pathTags(vault.id, relativePath)]);
      return { ok: true };
    });
  }

  function scopeContains(scope: SyncScope, relativePath: string): boolean {
    if (scope.kind === "all") return true;
    if (scope.kind === "file") return relativePath === scope.path;
    return (
      relativePath === scope.path || relativePath.startsWith(`${scope.path}/`)
    );
  }

  function isMissingFileError(error: unknown): boolean {
    const message = errorMessage(error);
    return /\bENOENT\b|path does not exist|not found/i.test(message);
  }

  async function readExistingFile(
    vault: Vault,
    relativePath: string,
  ): Promise<Awaited<ReturnType<typeof bb.sdk.files.read>> | null> {
    try {
      return await bb.sdk.files.read({
        ...hostArgs(vault),
        path: localFilePath(vault.rootPath, relativePath),
        rootPath: vault.rootPath,
      });
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
  }

  async function syncSnapshot(vaultId: string | undefined, scope: SyncScope) {
    const vault = getVault(vaultId);
    const normalizedScope: SyncScope =
      scope.kind === "all"
        ? scope
        : { kind: scope.kind, path: requireVaultPath(scope.path) };
    const files: SyncFile[] = [];
    const directories: string[] = [];
    if (normalizedScope.kind === "file") {
      const file = await readFile(vault.id, normalizedScope.path);
      files.push({
        ...syncEntryFromFile(normalizedScope.path, file),
        content: file.content,
      });
    } else {
      const result = await listVaultPaths(vault);
      if (result.truncated) {
        throw new Error(
          `Область синхронизации превышает ${MAX_TREE_ENTRIES} элементов; сузьте выбор папки`,
        );
      }
      const accessible = result.paths
        .map((entry) => ({
          kind: entry.kind,
          path: entry.path.replace(/\\/g, "/"),
        }))
        .filter((entry) => {
          try {
            requireVaultPath(entry.path);
            return scopeContains(normalizedScope, entry.path);
          } catch {
            return false;
          }
        })
        .sort((left, right) => left.path.localeCompare(right.path));
      if (
        normalizedScope.kind === "folder" &&
        !accessible.some(
          (entry) =>
            entry.path === normalizedScope.path ||
            entry.path.startsWith(`${normalizedScope.path}/`),
        )
      ) {
        throw new Error(`Папка не существует: ${normalizedScope.path}`);
      }
      for (const entry of accessible) {
        if (entry.kind === "directory") {
          directories.push(entry.path);
          continue;
        }
        const file = await readFile(vault.id, entry.path);
        files.push({
          ...syncEntryFromFile(entry.path, file),
          content: file.content,
        });
      }
    }
    const folded = new Map<string, string>();
    for (const entry of [
      ...directories,
      ...files.map((file) => file.localPath),
    ]) {
      const collision = folded.get(entry.toLowerCase());
      if (collision && collision !== entry) {
        throw new Error(
          `Пути хранилища ${JSON.stringify(collision)} и ${JSON.stringify(entry)} совпадают в файловых системах без учёта регистра`,
        );
      }
      folded.set(entry.toLowerCase(), entry);
    }
    return { vault, scope: normalizedScope, files, directories };
  }

  async function syncApply(input: {
    vaultId?: string;
    writes: Array<{
      path: string;
      content: string;
      contentEncoding: "base64" | "utf8";
      expectedSha256: string | null;
    }>;
    deletes: Array<{ path: string; expectedSha256: string }>;
    directories: string[];
    deleteDirectories: string[];
    dryRun: boolean;
  }) {
    const vault = getVault(input.vaultId);
    const writes = input.writes.map((write) => ({
      ...write,
      path: requireVaultPath(write.path),
    }));
    const deletes = input.deletes.map((deletion) => ({
      ...deletion,
      path: requireVaultPath(deletion.path),
    }));
    const directories = input.directories.map((directory) =>
      requireVaultPath(directory),
    );
    const deleteDirectories = input.deleteDirectories.map((directory) =>
      requireVaultPath(directory),
    );
    type SyncTreeEntry = {
      path: string;
      kind: "directory" | "file";
      operation: string;
    };
    const assertValidTree = (entries: SyncTreeEntry[], label: string): void => {
      const folded = new Map<string, SyncTreeEntry>();
      const files = new Set<string>();
      for (const entry of entries) {
        const key = entry.path.toLowerCase();
        const existing = folded.get(key);
        if (existing) {
          throw new Error(
            `${label} paths ${JSON.stringify(existing.path)} (${existing.operation}) and ${JSON.stringify(entry.path)} (${entry.operation}) collide`,
          );
        }
        folded.set(key, entry);
        if (entry.kind === "file") files.add(key);
      }
      for (const entry of entries) {
        const parts = entry.path.toLowerCase().split("/");
        for (let index = 1; index < parts.length; index += 1) {
          const ancestor = parts.slice(0, index).join("/");
          if (files.has(ancestor)) {
            throw new Error(
              `${label} path ${JSON.stringify(entry.path)} is nested beneath a file`,
            );
          }
        }
      }
    };
    assertValidTree(
      [
        ...writes.map((write) => ({
          path: write.path,
          kind: "file" as const,
          operation: "write",
        })),
        ...deletes.map((deletion) => ({
          path: deletion.path,
          kind: "file" as const,
          operation: "delete",
        })),
        ...directories.map((directory) => ({
          path: directory,
          kind: "directory" as const,
          operation: "create directory",
        })),
        ...deleteDirectories.map((directory) => ({
          path: directory,
          kind: "directory" as const,
          operation: "delete directory",
        })),
      ],
      "Запрос синхронизации",
    );
    const currentListing = await listVaultPaths(vault);
    if (currentListing.truncated) {
      throw new Error(
          `Хранилище содержит более ${MAX_TREE_ENTRIES} элементов; сузьте область синхронизации`,
      );
    }
    const currentEntries: SyncTreeEntry[] = currentListing.paths.map(
      (entry) => ({
        path: requireVaultPath(entry.path.replace(/\\/g, "/")),
        kind: entry.kind,
        operation: "existing vault entry",
      }),
    );
    assertValidTree(currentEntries, "Хранилище");
    const currentByPath = new Map(
      currentEntries.map((entry) => [entry.path, entry]),
    );
    const fileDeletes = new Set(deletes.map((deletion) => deletion.path));
    const directoryDeletes = new Set(deleteDirectories);
    const writePaths = new Set(writes.map((write) => write.path));
    for (const directory of deleteDirectories) {
      if (
        writes.some((write) => write.path.startsWith(`${directory}/`)) ||
        directories.some(
          (candidate) =>
            candidate === directory || candidate.startsWith(`${directory}/`),
        )
      ) {
        throw new Error(
          `Запрос синхронизации одновременно удаляет ${JSON.stringify(directory)} и создаёт в нём файлы`,
        );
      }
      const remainingChild = currentEntries.find(
        (entry) =>
          entry.path.startsWith(`${directory}/`) &&
          !fileDeletes.has(entry.path) &&
          !directoryDeletes.has(entry.path),
      );
      if (remainingChild) {
        throw new Error(
          `Папка ${JSON.stringify(directory)} не пуста; удаление ${JSON.stringify(remainingChild.path)} не запланировано`,
        );
      }
    }
    const futureEntries = currentEntries.filter((entry) => {
      if (entry.kind === "file") {
        return !fileDeletes.has(entry.path) && !writePaths.has(entry.path);
      }
      return !directoryDeletes.has(entry.path);
    });
    for (const directory of directories) {
      if (currentByPath.get(directory)?.kind !== "directory") {
        futureEntries.push({
          path: directory,
          kind: "directory",
          operation: "create directory",
        });
      }
    }
    for (const write of writes) {
      futureEntries.push({
        path: write.path,
        kind: "file",
        operation: "write",
      });
    }
    assertValidTree(futureEntries, "Результирующее хранилище");
    const conflicts: Array<{
      path: string;
      expectedSha256: string | null;
      currentSha256: string | null;
    }> = [];
    for (const mutation of [...writes, ...deletes]) {
      const current = await readExistingFile(vault, mutation.path);
      if ((current?.sha256 ?? null) !== mutation.expectedSha256) {
        conflicts.push({
          path: mutation.path,
          expectedSha256: mutation.expectedSha256,
          currentSha256: current?.sha256 ?? null,
        });
      }
    }
    if (conflicts.length > 0) {
      return {
        outcome: "conflict" as const,
        written: [],
        deleted: [],
        createdDirectories: [],
        deletedDirectories: [],
        conflicts,
        errors: [],
      };
    }
    if (input.dryRun) {
      return {
        outcome: "applied" as const,
        written: [],
        deleted: [],
        createdDirectories: [],
        deletedDirectories: [],
        conflicts: [],
        errors: [],
      };
    }
    const written: SyncStateEntry[] = [];
    const deleted: string[] = [];
    const createdDirectories: string[] = [];
    const deletedDirectories: string[] = [];
    const errors: Array<{ path: string; message: string }> = [];
    for (const directory of [...directories].sort()) {
      if (currentByPath.get(directory)?.kind === "directory") continue;
      try {
        await bb.sdk.files.mkdir({
          ...hostArgs(vault),
          path: localFilePath(vault.rootPath, directory),
          rootPath: vault.rootPath,
          recursive: true,
        });
        createdDirectories.push(directory);
      } catch (error) {
        errors.push({
          path: directory,
          message: errorMessage(error),
        });
      }
    }
    for (const write of writes) {
      try {
        const result = await writeFile({
          vaultId: vault.id,
          rawPath: write.path,
          content: write.content,
          contentEncoding: write.contentEncoding,
          expectedSha256: write.expectedSha256,
          createOnly: write.expectedSha256 === null,
        });
        if (result.outcome === "conflict") {
          conflicts.push({
            path: write.path,
            expectedSha256: write.expectedSha256,
            currentSha256: result.currentSha256,
          });
          continue;
        }
        const refreshed = await readFile(vault.id, write.path);
        written.push(syncEntryFromFile(write.path, refreshed));
      } catch (error) {
        errors.push({
          path: write.path,
          message: errorMessage(error),
        });
      }
    }
    for (const deletion of deletes) {
      try {
        const current = await readExistingFile(vault, deletion.path);
        if (current?.sha256 !== deletion.expectedSha256) {
          conflicts.push({
            path: deletion.path,
            expectedSha256: deletion.expectedSha256,
            currentSha256: current?.sha256 ?? null,
          });
          continue;
        }
        await removePath(vault.id, deletion.path, false);
        deleted.push(deletion.path);
      } catch (error) {
        errors.push({
          path: deletion.path,
          message: errorMessage(error),
        });
      }
    }
    for (const directory of [...deleteDirectories].sort(
      (left, right) =>
        right.split("/").length - left.split("/").length ||
        right.localeCompare(left),
    )) {
      try {
        await removePath(vault.id, directory, false);
        deletedDirectories.push(directory);
      } catch (error) {
        if (isMissingFileError(error)) continue;
        errors.push({
          path: directory,
          message: errorMessage(error),
        });
      }
    }
    const appliedCount =
      written.length +
      deleted.length +
      createdDirectories.length +
      deletedDirectories.length;
    if (createdDirectories.length > 0) invalidate([treeTag(vault.id)]);
    return {
      outcome:
        errors.length > 0 || (conflicts.length > 0 && appliedCount > 0)
          ? ("partial" as const)
          : conflicts.length > 0
            ? ("conflict" as const)
            : ("applied" as const),
      written,
      deleted,
      createdDirectories,
      deletedDirectories,
      conflicts,
      errors,
    };
  }

  const previewLeases = new Map<
    string,
    Promise<{ baseUrl: string; expiresAtMs: number }>
  >();

  async function previewLease(vault: Vault) {
    const key = JSON.stringify([vault.hostId, vault.rootPath]);
    const cached = previewLeases.get(key);
    if (cached) {
      const lease = await cached.catch(() => null);
      if (lease && lease.expiresAtMs - Date.now() > PREVIEW_RENEW_BEFORE_MS)
        return lease;
      if (previewLeases.get(key) !== cached) return previewLease(vault);
    }
    const next = bb.sdk.files.createPreview({
      ...hostArgs(vault),
      rootPath: vault.rootPath,
    });
    previewLeases.set(key, next);
    next.catch(() => {
      if (previewLeases.get(key) === next) previewLeases.delete(key);
    });
    return next;
  }

  async function titleRenameTarget(
    vault: Vault,
    currentPath: string,
    content: string,
  ): Promise<string | null> {
    if (!/^untitled(?: \d+)?\.md$/i.test(path.posix.basename(currentPath)))
      return null;
    if (parseMarkdownDocument(content).title) return null;
    const base = kebabCase(deriveTitle(content, ""));
    if (!base) return null;
    const parent = path.posix.dirname(currentPath);
    const desired = parent === "." ? `${base}.md` : `${parent}/${base}.md`;
    if (desired.toLowerCase() === currentPath.toLowerCase()) return null;
    return (await readExistingFile(vault, desired)) === null ? desired : null;
  }

  const handlers: PluginRpcHandlers<typeof docsRpcContract> = {
    async readProposal(input) {
      return readProposal(getVault(input.vaultId).id, input.path);
    },
    async proposeNote(input) {
      const vaultId = getVault(input.vaultId).id;
      return serializeVault(vaultId, async () => {
        const previous = readProposal(vaultId, input.path);
        if ((previous?.version ?? null) !== input.expectedVersion) {
          throw new Error(
            "Предложение изменилось. Прочитайте его снова, прежде чем предлагать изменения.",
          );
        }
        const file = await readFile(vaultId, input.path);
        if (
          file.contentEncoding !== "utf8" ||
          file.sha256 !== input.expectedSha256
        ) {
          throw new Error(
            "Документ изменился. Прочитайте его снова, прежде чем предлагать изменения.",
          );
        }
        return saveProposal({
          vaultId,
          path: input.path,
          version: (previous?.version ?? 0) + 1,
          baseContent: file.content,
          baseSha256: file.sha256,
          content: input.content,
          status: "pending",
          resolvedSha256: null,
        });
      });
    },
    async updateProposal(input) {
      const vaultId = getVault(input.vaultId).id;
      return serializeVault(vaultId, async () => {
        const proposal = requireProposal(
          vaultId,
          input.path,
          input.expectedVersion,
        );
        if (proposal.status !== "pending")
          throw new Error("Это предложение больше не ожидает решения.");
        return saveProposal({
          ...proposal,
          content: input.content,
          version: proposal.version + 1,
        });
      });
    },
    async resolveProposal(input) {
      const vaultId = getVault(input.vaultId).id;
      return serializeVault(vaultId, async () => {
        const proposal = requireProposal(
          vaultId,
          input.path,
          input.expectedVersion,
        );
        const status = (
          {
            accept: proposal.status === "pending" ? "accepted" : null,
            reject: proposal.status === "pending" ? "rejected" : null,
            undo:
              proposal.status === "accepted"
                ? "undone"
                : proposal.status === "rejected"
                  ? "pending"
                  : null,
            redo: proposal.status === "undone" ? "pending" : null,
          } as const
        )[input.action];
        if (!status)
          throw new Error(
            input.action === "undo"
              ? "Нечего отменять."
              : input.action === "redo"
                ? "Нечего повторять."
                : "Это предложение больше не ожидает решения.",
          );
        const next = { ...proposal, status, version: proposal.version + 1 };
        const restoring = status === "undone";
        const conflictMessage = restoring
          ? "Документ изменился. Отмена перезапишет более новые правки."
          : "Документ изменился. Запросите обновлённое предложение.";
        if (status === "accepted" || restoring) {
          const expectedSha256 = restoring
            ? proposal.resolvedSha256
            : proposal.baseSha256;
          if (!expectedSha256) throw new Error("Нечего отменять.");
          const result = await writeFile({
            vaultId,
            rawPath: input.path,
            content: restoring ? proposal.baseContent : proposal.content,
            expectedSha256,
          });
          if (result.outcome === "conflict") throw new Error(conflictMessage);
          next.resolvedSha256 = result.sha256;
        } else if (status === "pending") {
          const file = await readFile(vaultId, input.path);
          if (file.sha256 !== proposal.baseSha256)
            throw new Error(conflictMessage);
        }
        return saveProposal(next);
      });
    },
    async syncSnapshot(input) {
      return syncSnapshot(input.vaultId, input.scope);
    },
    async syncApply(input) {
      return syncApply(input);
    },
    async listNotes(input) {
      return notebookData(input.vaultId);
    },
    async readNote(input) {
      return readFile(input.vaultId, input.path);
    },
    async readDocument(input) {
      const vault = getVault(input.vaultId);
      return serializeVault(vault.id, async () => {
        const [file, preview] = await Promise.all([
          readFile(vault.id, input.path).catch((error: unknown) => {
            if (!isMissingFileError(error)) throw error;
            throw new experimental_PluginRpcRefusal({
              code: "not_found",
              message: `Путь не существует: ${input.path}`,
            });
          }),
          previewLease(vault),
        ]);
        return {
          vaultId: vault.id,
          path: input.path,
          content: file.content,
          sha256: file.sha256,
          proposal: readProposal(vault.id, input.path),
          preview,
        };
      });
    },
    async saveDocument(input) {
      const vault = getVault(input.vaultId);
      return serializeVault(vault.id, async () => {
        const result = await writeFile({
          vaultId: vault.id,
          rawPath: input.path,
          content: input.content,
          expectedSha256: input.expectedSha256,
        });
        if (result.outcome === "conflict")
          throw new experimental_PluginRpcRefusal({
            code: "conflict",
            message: "Документ изменился в другом месте.",
          });
        const destination = input.renameToTitle
          ? await titleRenameTarget(vault, input.path, input.content)
          : null;
        if (destination === null)
          return { path: input.path, sha256: result.sha256 };
        await moveWithinVault(vault, input.path, destination);
        return { path: destination, sha256: result.sha256 };
      });
    },
    async saveNote(input) {
      return serializeVault(getVault(input.vaultId).id, () =>
        writeFile({
          vaultId: input.vaultId,
          rawPath: input.path,
          content: input.content,
          expectedSha256: input.expectedSha256,
        }),
      );
    },
    async createNote(input) {
      return createNote(input.vaultId, input);
    },
    async deletePath(input) {
      return removePath(input.vaultId, input.path, input.recursive === true);
    },
    async createFolder(input) {
      const vault = getVault(input.vaultId);
      const relativePath = requireVaultPath(input.path);
      await bb.sdk.files.mkdir({
        ...hostArgs(vault),
        path: localFilePath(vault.rootPath, relativePath),
        rootPath: vault.rootPath,
        recursive: false,
      });
      invalidate([treeTag(vault.id)]);
      return { path: relativePath };
    },
    async reorderFiles(input) {
      const vault = getVault(input.vaultId);
      const parent = requireOptionalDirectory(input.parent);
      const paths = input.paths.map((value) => requireVaultPath(value));
      if (new Set(paths).size !== paths.length) {
        throw new Error('«paths» не должен содержать повторяющихся путей');
      }
      if (
        paths.some(
          (filePath) =>
            path.posix.dirname(filePath) !== (parent || ".") ||
            !/\.(md|html?)$/i.test(filePath),
        )
      ) {
        throw new Error('Каждый упорядоченный путь должен быть файлом в «parent»');
      }
      const currentFiles = (await listEntries(vault)).entries
        .filter(
          (entry) =>
            entry.kind === "file" &&
            path.posix.dirname(entry.path) === (parent || "."),
        )
        .map((entry) => entry.path);
      if (
        paths.length !== currentFiles.length ||
        currentFiles.some((filePath) => !paths.includes(filePath))
      ) {
        throw new Error(
          "Файлы изменились во время сортировки; обновите список и попробуйте снова",
        );
      }
      const replaceOrder = db.transaction(() => {
        db.prepare(
          "DELETE FROM entry_order WHERE vault_id = ? AND parent_path = ?",
        ).run(vault.id, parent);
        const insert = db.prepare(
          "INSERT INTO entry_order (vault_id, parent_path, child_path, position) VALUES (?, ?, ?, ?)",
        );
        paths.forEach((filePath, position) =>
          insert.run(vault.id, parent, filePath, position),
        );
      });
      replaceOrder();
      invalidate([treeTag(vault.id)]);
      return { paths };
    },
    async movePath(input) {
      return movePath(input.vaultId, input.from, input.to);
    },
    async createVault(input) {
      const name = requireString(input.name, "name");
      const rootPath = requireString(input.rootPath, "rootPath");
      if (!isAbsoluteHostPath(rootPath))
        throw new Error('«rootPath» должен быть абсолютным');
      const hostId = optionalString(input.hostId) ?? null;
      const resolvedRoot = normalizeHostRoot(rootPath);
      await bb.sdk.files.mkdir({
        ...hostIdArgs(hostId),
        path: resolvedRoot,
        recursive: true,
      });
      const baseId = kebabCase(name) || "vault";
      const ids = new Set(listVaults().map((vault) => vault.id));
      let id = baseId;
      let counter = 2;
      while (ids.has(id)) id = `${baseId}-${counter++}`;
      db.prepare(
        "INSERT INTO vaults (id, name, host_id, root_path, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, name, hostId, resolvedRoot, Date.now());
      invalidate([VAULTS_TAG, vaultTag(id)]);
      return getVault(id);
    },
    async removeVault(input) {
      const id = requireString(input.vaultId, "vaultId");
      return serializeVault(id, async () => {
        if (listVaults().length <= 1)
          throw new Error("Требуется хотя бы одно хранилище");
        db.transaction(() => {
          db.prepare("DELETE FROM proposals WHERE vault_id = ?").run(id);
          db.prepare("DELETE FROM entry_order WHERE vault_id = ?").run(id);
          db.prepare("DELETE FROM vaults WHERE id = ?").run(id);
        })();
        mentionSummaries.delete(id);
        treeSummaries.delete(id);
        invalidate([VAULTS_TAG, treeTag(id)]);
        return { ok: true as const };
      });
    },
    async uploadAttachment(input) {
      const vaultId = input.vaultId;
      const notePath = requireVaultPath(input.notePath, { extension: ".md" });
      const content = requireString(input.content, "content");
      const bytes = Buffer.from(content, "base64");
      if (bytes.length > MAX_ATTACHMENT_BYTES)
        throw new Error("Вложение превышает 20 МБ");
      const rawName = requireString(input.name, "name");
      const extension = path.extname(rawName).toLowerCase();
      const original =
        sanitizeName(path.basename(rawName, extension)) || "image";
      if (
        !new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]).has(
          extension,
        )
      ) {
        throw new Error("Неподдерживаемый тип изображения");
      }
      const parent = path.posix.dirname(notePath);
      const attachment = `${original}-${Date.now().toString(36)}${extension}`;
      const relativePath =
        parent === "."
          ? `_attachments/${attachment}`
          : `${parent}/_attachments/${attachment}`;
      const result = await writeFile({
        vaultId,
        rawPath: relativePath,
        content,
        contentEncoding: "base64",
        createOnly: true,
      });
      return {
        path: relativePath,
        markdownPath: `./_attachments/${attachment}`,
        result,
      };
    },
    async preparePreview(input) {
      const vault = getVault(input.vaultId);
      const relativePath = requireVaultPath(input.path);
      await bb.sdk.files.read({
        ...hostArgs(vault),
        path: localFilePath(vault.rootPath, relativePath),
        rootPath: vault.rootPath,
      });
      return previewLease(vault);
    },
    async openFile(input) {
      const target = await resolveOpenerFile(input.source, input.path);
      const previewPath = getRelativeHostPath({
        rootPath: target.rootPath,
        candidatePath: target.path,
      });
      if (previewPath === null)
        throw new Error("Открытые файлы должны оставаться внутри корневой папки");
      const args = {
        ...hostIdArgs(target.hostId),
        path: target.path,
        rootPath: target.rootPath,
      };
      const [file, preview] = await Promise.all([
        bb.sdk.files.read(args),
        bb.sdk.files.createPreview({
          ...hostIdArgs(target.hostId),
          rootPath: target.rootPath,
        }),
      ]);
      return {
        file,
        preview,
        previewPath,
      };
    },
    async saveOpenedFile(input) {
      const target = await resolveOpenerFile(input.source, input.path);
      const result = await bb.sdk.files.write({
        ...hostIdArgs(target.hostId),
        path: target.path,
        rootPath: target.rootPath,
        content: input.content,
        ...(input.expectedSha256 === null ||
        typeof input.expectedSha256 === "string"
          ? { expectedSha256: input.expectedSha256 }
          : {}),
      });
      if (result.outcome === "written") {
        mentionSummaries.clear();
        invalidate([openedFileTag(input.source, input.path)]);
      }
      return result;
    },
  };

  bb.rpc.register(docsRpcContract, handlers);

  async function readHttpInput<Schema extends z.ZodType>(
    context: Parameters<Parameters<BbPluginApi["http"]["route"]>[2]>[0],
    schema: Schema,
  ): Promise<
    { ok: true; value: z.output<Schema> } | { ok: false; response: Response }
  > {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return {
        ok: false,
        response: context.json(
          {
            ok: false,
            error: {
              code: "invalid_json",
              message: "request body must be JSON",
            },
          },
          400,
        ),
      };
    }
    const result = await schema.safeParseAsync(input);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      response: context.json(
        {
          ok: false,
          error: {
            code: "invalid_input",
            message: "request input validation failed",
            issues: result.error.issues.map((issue) => ({
              message: issue.message,
              ...(issue.path.length > 0 ? { path: issue.path } : {}),
            })),
          },
        },
        400,
      ),
    };
  }

  function routeRpc<Schema extends z.ZodType>(
    routePath: string,
    schema: Schema,
    handle: (input: z.output<Schema>) => object | Promise<object>,
  ): void {
    bb.http.route(
      "POST",
      routePath,
      async (context) => {
        const input = await readHttpInput(context, schema);
        if (!input.ok) return input.response;
        return context.json(await handle(input.value));
      },
      { auth: "token" },
    );
  }

  routeRpc("/list", docsRpcContract.listNotes.input, handlers.listNotes);

  function resolveHostPath(rootPath: string, candidate: string): string {
    const resolved = resolvePath({ rootPath, path: candidate });
    if (resolved === null)
      throw new CliUsageError(`Неверный путь на хосте: ${candidate}`);
    return resolved;
  }

  async function resolveWorkspaceHostId(
    args: SyncCliArgs,
    context: PluginCliContext,
  ): Promise<string | undefined> {
    if (args.workspaceHostId) return args.workspaceHostId;
    if (!context.threadId) return undefined;
    const thread = await bb.sdk.threads.get({ threadId: context.threadId });
    if (!thread.environmentId) return undefined;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    return environment.hostId;
  }

  async function readWorkspaceFile(
    rootPath: string,
    hostId: string | undefined,
    relativePath: string,
  ): Promise<Awaited<ReturnType<typeof bb.sdk.files.read>> | null> {
    try {
      return await bb.sdk.files.read({
        ...hostIdArgs(hostId),
        path: localFilePath(rootPath, relativePath),
        rootPath,
      });
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
  }

  async function readSyncState(
    rootPath: string,
    hostId: string | undefined,
  ): Promise<{
    state: SyncState;
    sha256: string;
  } | null> {
    const file = await readWorkspaceFile(rootPath, hostId, SYNC_STATE_FILE);
    if (!file) return null;
    if (file.contentEncoding !== "utf8") {
      throw new Error(`${SYNC_STATE_FILE} должен содержать JSON в кодировке UTF-8`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      throw new Error(
        `${SYNC_STATE_FILE} повреждён; переместите эту рабочую папку и выполните pull в пустую папку`,
      );
    }
    const result = syncStateSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `${SYNC_STATE_FILE} недействителен: ${z.prettifyError(result.error)}. Переместите эту рабочую папку и выполните pull в пустую папку`,
      );
    }
    const remotePaths = result.data.entries.map((entry) => entry.remotePath);
    const localPaths = result.data.entries.map((entry) => entry.localPath);
    if (
      new Set(remotePaths).size !== remotePaths.length ||
      new Set(localPaths).size !== localPaths.length
    ) {
      throw new Error(`${SYNC_STATE_FILE} содержит повторяющиеся записи`);
    }
    if (
      result.data.entries.some(
        (entry) =>
          entry.localPath !== entry.remotePath ||
          !scopeContains(result.data.scope, entry.remotePath),
      ) ||
      result.data.directories.some(
        (directory) => !scopeContains(result.data.scope, directory),
      )
    ) {
      throw new Error(
        `${SYNC_STATE_FILE} содержит запись вне объявленной области`,
      );
    }
    return { state: result.data, sha256: file.sha256 };
  }

  async function writeSyncState(
    rootPath: string,
    hostId: string | undefined,
    state: SyncState,
    expectedSha256: string | null,
  ): Promise<void> {
    const result = await bb.sdk.files.write({
      ...hostIdArgs(hostId),
      path: localFilePath(rootPath, SYNC_STATE_FILE),
      rootPath,
      content: `${JSON.stringify(state, null, 2)}\n`,
      createParents: true,
      expectedSha256,
    });
    if (result.outcome === "conflict") {
      throw new Error(
        `${SYNC_STATE_FILE} изменился одновременно с операцией; данные в хранилище не затронуты. Повторите pull для восстановления`,
      );
    }
  }

  function stateFromSnapshot(snapshot: {
    vault: Vault;
    scope: SyncScope;
    files: SyncFile[];
    directories: string[];
  }): SyncState {
    return {
      schemaVersion: SYNC_STATE_VERSION,
      vault: { id: snapshot.vault.id, name: snapshot.vault.name },
      scope: snapshot.scope,
      pulledAt: new Date().toISOString(),
      entries: snapshot.files.map(({ content: _content, ...entry }) => entry),
      directories: snapshot.directories,
    };
  }

  function sameScope(left: SyncScope, right: SyncScope): boolean {
    return (
      left.kind === right.kind &&
      (left.kind === "all" ||
        (right.kind !== "all" && left.path === right.path))
    );
  }

  function parsePullScope(args: SyncCliArgs): SyncScope {
    if (args.all && (args.folder || args.positionals.length > 0)) {
      throw new CliUsageError(
        "--all нельзя использовать вместе с путём или --folder",
      );
    }
    if (args.all) return { kind: "all" };
    const scopePath = args.positionals[0];
    if (!scopePath) {
      throw new CliUsageError("Для pull укажите <path> или --all");
    }
    if (args.positionals.length > 1) {
      throw new CliUsageError("Для pull можно указать только один путь хранилища");
    }
    return {
      kind: args.folder ? "folder" : "file",
      path: requireVaultPath(scopePath),
    };
  }

  function simpleDiff(remotePath: string, base: string, local: string): string {
    if (base === local) return "";
    const before = base.split("\n");
    const after = local.split("\n");
    let prefix = 0;
    while (
      prefix < before.length &&
      prefix < after.length &&
      before[prefix] === after[prefix]
    )
      prefix += 1;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    )
      suffix += 1;
    const removed = before.slice(prefix, before.length - suffix);
    const added = after.slice(prefix, after.length - suffix);
    return [
      `--- a/${remotePath}`,
      `+++ b/${remotePath}`,
      `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
      ...removed.map((line) => `-${line}`),
      ...added.map((line) => `+${line}`),
    ].join("\n");
  }

  async function runPull(args: SyncCliArgs, context: PluginCliContext) {
    const scope = parsePullScope(args);
    const snapshot = await syncSnapshot(args.vaultId, scope);
    const cwd = context.cwd ?? process.cwd();
    const rootPath = resolveHostPath(
      cwd,
      args.into ?? `docs-${snapshot.vault.id}`,
    );
    const hostId = await resolveWorkspaceHostId(args, context);
    const existing = await readSyncState(rootPath, hostId);
    if (
      existing &&
      (existing.state.vault.id !== snapshot.vault.id ||
        !sameScope(existing.state.scope, snapshot.scope))
    ) {
      throw new Error(
        `${SYNC_STATE_FILE} относится к другому хранилищу или области; выберите другую папку с --into`,
      );
    }
    const oldEntries = new Map(
      existing?.state.entries.map((entry) => [entry.remotePath, entry]) ?? [],
    );
    const remoteEntries = new Map(
      snapshot.files.map((entry) => [entry.remotePath, entry]),
    );
    const remoteDirectories = new Set(snapshot.directories);
    const removedDirectories =
      existing?.state.directories.filter(
        (directory) => !remoteDirectories.has(directory),
      ) ?? [];
    const writes: Array<{
      file: SyncFile;
      expectedSha256: string | null;
    }> = [];
    const deletes: Array<{ path: string; expectedSha256: string }> = [];
    const conflicts: Array<{ path: string; reason: string }> = [];
    for (const remote of snapshot.files) {
      const base = oldEntries.get(remote.remotePath);
      const local = await readWorkspaceFile(rootPath, hostId, remote.localPath);
      if (!base) {
        if (!local) writes.push({ file: remote, expectedSha256: null });
        else if (local.sha256 !== remote.sha256)
          conflicts.push({
            path: remote.localPath,
            reason: "untracked local file differs from the vault",
          });
        continue;
      }
      if (!local) {
        if (remote.sha256 !== base.sha256)
          conflicts.push({
            path: remote.localPath,
            reason: "locally deleted while the vault file also changed",
          });
        continue;
      }
      if (local.sha256 === remote.sha256) continue;
      if (local.sha256 === base.sha256) {
        writes.push({ file: remote, expectedSha256: local.sha256 });
      } else if (remote.sha256 !== base.sha256) {
        conflicts.push({
          path: remote.localPath,
          reason: "both local and vault copies changed",
        });
      }
    }
    for (const base of oldEntries.values()) {
      if (remoteEntries.has(base.remotePath)) continue;
      const local = await readWorkspaceFile(rootPath, hostId, base.localPath);
      if (!local) continue;
      if (local.sha256 === base.sha256)
        deletes.push({ path: base.localPath, expectedSha256: local.sha256 });
      else
        conflicts.push({
          path: base.localPath,
          reason: "vault file was deleted while the local copy changed",
        });
    }
    if (conflicts.length > 0) {
      return {
        outcome: "conflict" as const,
        rootPath,
        vaultId: snapshot.vault.id,
        scope: snapshot.scope,
        written: [],
        deleted: [],
        deletedDirectories: [],
        conflicts,
      };
    }
    const written: string[] = [];
    const deleted: string[] = [];
    const deletedDirectories: string[] = [];
    try {
      await bb.sdk.files.mkdir({
        ...hostIdArgs(hostId),
        path: rootPath,
        recursive: true,
      });
      for (const directory of snapshot.directories) {
        await bb.sdk.files.mkdir({
          ...hostIdArgs(hostId),
          path: localFilePath(rootPath, directory),
          rootPath,
          recursive: true,
        });
      }
      for (const write of writes) {
        const result = await bb.sdk.files.write({
          ...hostIdArgs(hostId),
          path: localFilePath(rootPath, write.file.localPath),
          rootPath,
          content: write.file.content,
          contentEncoding: write.file.contentEncoding,
          createParents: true,
          expectedSha256: write.expectedSha256,
        });
        if (result.outcome === "conflict") {
          throw new Error(
            `Локальный файл изменился во время загрузки: ${write.file.localPath}; повторите pull для восстановления`,
          );
        }
        written.push(write.file.localPath);
      }
      for (const deletion of deletes) {
        const current = await readWorkspaceFile(
          rootPath,
          hostId,
          deletion.path,
        );
        if (current?.sha256 !== deletion.expectedSha256) {
          throw new Error(
            `Локальный файл изменился во время загрузки: ${deletion.path}; повторите pull для восстановления`,
          );
        }
        await bb.sdk.files.remove({
          ...hostIdArgs(hostId),
          path: localFilePath(rootPath, deletion.path),
          rootPath,
          recursive: false,
        });
        deleted.push(deletion.path);
      }
      for (const directory of [...removedDirectories].sort(
        (left, right) =>
          right.split("/").length - left.split("/").length ||
          right.localeCompare(left),
      )) {
        try {
          await bb.sdk.files.remove({
            ...hostIdArgs(hostId),
            path: localFilePath(rootPath, directory),
            rootPath,
            recursive: false,
          });
          deletedDirectories.push(directory);
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
        }
      }
      await writeSyncState(
        rootPath,
        hostId,
        stateFromSnapshot(snapshot),
        existing?.sha256 ?? null,
      );
    } catch (error) {
      return {
        outcome: "partial" as const,
        rootPath,
        vaultId: snapshot.vault.id,
        scope: snapshot.scope,
        written,
        deleted,
        deletedDirectories,
        conflicts: [],
        errors: [
          {
            message: errorMessage(error),
          },
        ],
      };
    }
    return {
      outcome: "pulled" as const,
      rootPath,
      vaultId: snapshot.vault.id,
      scope: snapshot.scope,
      written,
      deleted,
      deletedDirectories,
      conflicts: [],
    };
  }

  async function runPushPlan(
    args: SyncCliArgs,
    context: PluginCliContext,
    apply: boolean,
  ) {
    const cwd = context.cwd ?? process.cwd();
    const defaultVault = getVault(args.vaultId);
    const rootPath = resolveHostPath(
      cwd,
      args.positionals[0] ?? args.into ?? `docs-${defaultVault.id}`,
    );
    if (args.positionals.length > 1) {
      throw new Error("Для push/status можно указать только одну рабочую папку");
    }
    const hostId = await resolveWorkspaceHostId(args, context);
    const existing = await readSyncState(rootPath, hostId);
    if (!existing) {
      throw new Error(
        `${SYNC_STATE_FILE} не найден; сначала выполните bb docs pull`,
      );
    }
    if (args.vaultId && args.vaultId !== existing.state.vault.id) {
      throw new Error(
        `Рабочая папка относится к хранилищу ${existing.state.vault.id}, а не ${args.vaultId}`,
      );
    }
    const snapshot = await syncSnapshot(
      existing.state.vault.id,
      existing.state.scope,
    );
    const listing = await bb.sdk.files.listPaths({
      ...hostIdArgs(hostId),
      path: rootPath,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: false,
      limit: MAX_TREE_ENTRIES,
    });
    if (listing.truncated) {
      throw new Error(
        `Локальная рабочая папка содержит более ${MAX_TREE_ENTRIES} элементов; сузьте область pull`,
      );
    }
    const localPaths = listing.paths
      .map((entry) => ({
        kind: entry.kind,
        path: entry.path.replace(/\\/g, "/"),
      }))
      .filter((entry) => entry.path !== SYNC_STATE_FILE)
      .filter((entry) => {
        try {
          requireVaultPath(entry.path);
          return true;
        } catch {
          return false;
        }
      });
    const localFiles = new Map<
      string,
      Awaited<ReturnType<typeof bb.sdk.files.read>>
    >();
    for (const entry of localPaths) {
      if (entry.kind !== "file") continue;
      const file = await readWorkspaceFile(rootPath, hostId, entry.path);
      if (file) localFiles.set(entry.path, file);
    }
    const baseByLocal = new Map(
      existing.state.entries.map((entry) => [entry.localPath, entry]),
    );
    const remoteByPath = new Map(
      snapshot.files.map((entry) => [entry.remotePath, entry]),
    );
    const writes: Array<{
      path: string;
      content: string;
      contentEncoding: "base64" | "utf8";
      expectedSha256: string | null;
    }> = [];
    const deletes: Array<{ path: string; expectedSha256: string }> = [];
    const conflicts: Array<{ path: string; reason: string }> = [];
    const warnings: Array<{ path: string; reason: string }> = [];
    const diffs: string[] = [];
    const localFolded = new Map<string, string>();
    for (const entry of localPaths) {
      const collision = localFolded.get(entry.path.toLowerCase());
      if (collision && collision !== entry.path) {
        conflicts.push({
          path: entry.path,
          reason: `local path collides with ${collision} on case-insensitive filesystems`,
        });
      }
      localFolded.set(entry.path.toLowerCase(), entry.path);
    }
    for (const [localPath, local] of localFiles) {
      if (!scopeContains(existing.state.scope, localPath)) {
        conflicts.push({
          path: localPath,
          reason: "local file is outside the pulled scope",
        });
        continue;
      }
      const base = baseByLocal.get(localPath);
      const remotePath = base?.remotePath ?? requireVaultPath(localPath);
      const remote = remoteByPath.get(remotePath);
      if (!base) {
        if (remote && remote.sha256 !== local.sha256) {
          conflicts.push({
            path: remotePath,
            reason: "new local file collides with a vault file",
          });
        } else if (!remote) {
          writes.push({
            path: remotePath,
            content: local.content,
            contentEncoding: local.contentEncoding,
            expectedSha256: null,
          });
        }
        continue;
      }
      if (!remote) {
        conflicts.push({
          path: remotePath,
          reason: "vault file was deleted after pull",
        });
        continue;
      }
      if (local.sha256 === remote.sha256) continue;
      if (local.sha256 === base.sha256 && remote.sha256 !== base.sha256) {
        conflicts.push({
          path: remotePath,
          reason: "vault file changed after pull",
        });
      } else if (
        local.sha256 !== base.sha256 &&
        remote.sha256 === base.sha256
      ) {
        writes.push({
          path: remotePath,
          content: local.content,
          contentEncoding: local.contentEncoding,
          expectedSha256: base.sha256,
        });
        if (
          args.diff &&
          local.contentEncoding === "utf8" &&
          remote.contentEncoding === "utf8"
        ) {
          diffs.push(simpleDiff(remotePath, remote.content, local.content));
        }
      } else {
        conflicts.push({
          path: remotePath,
          reason: "both local and vault copies changed",
        });
      }
    }
    for (const base of existing.state.entries) {
      if (localFiles.has(base.localPath)) continue;
      const remote = remoteByPath.get(base.remotePath);
      if (!remote) continue;
      if (!args.delete) {
        warnings.push({
          path: base.remotePath,
          reason: "local deletion ignored; pass --delete to remove from vault",
        });
      } else if (remote.sha256 !== base.sha256) {
        conflicts.push({
          path: base.remotePath,
          reason: "locally deleted while the vault file also changed",
        });
      } else {
        deletes.push({ path: base.remotePath, expectedSha256: base.sha256 });
      }
    }
    for (const remote of snapshot.files) {
      const tracked = existing.state.entries.some(
        (entry) => entry.remotePath === remote.remotePath,
      );
      const matchingLocal = localFiles.has(remote.localPath);
      if (!tracked && !matchingLocal) {
        conflicts.push({
          path: remote.remotePath,
          reason: "new vault file is not present locally; pull before pushing",
        });
      }
    }
    const discoveredLocalDirectories = localPaths
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.path);
    const localDirectories = discoveredLocalDirectories.filter((directory) =>
      scopeContains(existing.state.scope, directory),
    );
    for (const directory of discoveredLocalDirectories) {
      const structuralAncestor =
        existing.state.scope.kind !== "all" &&
        existing.state.scope.path.startsWith(`${directory}/`);
      if (
        !scopeContains(existing.state.scope, directory) &&
        !structuralAncestor
      ) {
        conflicts.push({
          path: directory,
          reason: "local directory is outside the pulled scope",
        });
      }
    }
    const localDirectorySet = new Set(localDirectories);
    const remoteDirectorySet = new Set(snapshot.directories);
    const trackedDirectorySet = new Set(existing.state.directories);
    const createDirectories: string[] = [];
    const deleteDirectories: string[] = [];
    for (const directory of localDirectories) {
      if (
        trackedDirectorySet.has(directory) &&
        !remoteDirectorySet.has(directory)
      ) {
        conflicts.push({
          path: directory,
          reason: "vault directory was deleted after pull",
        });
      } else if (!remoteDirectorySet.has(directory)) {
        createDirectories.push(directory);
      }
    }
    for (const directory of existing.state.directories) {
      if (
        localDirectorySet.has(directory) ||
        !remoteDirectorySet.has(directory)
      )
        continue;
      if (
        existing.state.scope.kind === "folder" &&
        directory === existing.state.scope.path
      ) {
        warnings.push({
          path: directory,
          reason:
            "pulled folder root deletion ignored; pull its parent or the whole vault to delete it",
        });
      } else if (!args.delete) {
        warnings.push({
          path: directory,
          reason:
            "local directory deletion ignored; pass --delete to remove it from the vault",
        });
      } else {
        deleteDirectories.push(directory);
      }
    }
    for (const directory of snapshot.directories) {
      if (
        !trackedDirectorySet.has(directory) &&
        !localDirectorySet.has(directory)
      ) {
        conflicts.push({
          path: directory,
          reason:
            "new vault directory is not present locally; pull before pushing",
        });
      }
    }
    const plan = {
      rootPath,
      vaultId: existing.state.vault.id,
      scope: existing.state.scope,
      writes: writes.map((write) => write.path),
      deletes: deletes.map((deletion) => deletion.path),
      directories: createDirectories,
      deleteDirectories,
      conflicts,
      warnings,
      diffs: diffs.filter(Boolean),
    };
    if (!apply || args.dryRun || conflicts.length > 0) {
      return {
        outcome:
          conflicts.length > 0 ? ("conflict" as const) : ("planned" as const),
        ...plan,
      };
    }
    const applied = await syncApply({
      vaultId: existing.state.vault.id,
      writes,
      deletes,
      directories: createDirectories,
      deleteDirectories,
      dryRun: false,
    });
    if (applied.outcome !== "applied") {
      return { outcome: applied.outcome, ...plan, applied };
    }
    const refreshed = await syncSnapshot(
      existing.state.vault.id,
      existing.state.scope,
    );
    await writeSyncState(
      rootPath,
      hostId,
      stateFromSnapshot(refreshed),
      existing.sha256,
    );
    return { outcome: "pushed" as const, ...plan, applied };
  }

  function stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

  function formatSyncHumanOutput(command: string, result: unknown): string {
    if (!isRecord(result)) return JSON.stringify(result, null, 2);
    if (command === "pull") {
      if (result.outcome === "conflict") {
        return `Загрузка остановлена: конфликтов — ${Array.isArray(result.conflicts) ? result.conflicts.length : 0}. Файлы не изменены.\n${JSON.stringify(result.conflicts, null, 2)}`;
      }
      if (result.outcome === "partial") {
        return `Загрузка в ${String(result.rootPath)} выполнена частично. Предыдущий манифест остаётся действительным; повторите pull для восстановления.\n${JSON.stringify(result.errors, null, 2)}`;
      }
      return `Загружено файлов: ${stringArray(result.written).length}, папка: ${String(result.rootPath)}${stringArray(result.deleted).length > 0 ? `; удалено файлов, удалённых в хранилище: ${stringArray(result.deleted).length}` : ""}${stringArray(result.deletedDirectories).length > 0 ? `; удалено папок, удалённых в хранилище: ${stringArray(result.deletedDirectories).length}` : ""}.`;
    }
    if (command === "status" || command === "push") {
      const writes = stringArray(result.writes);
      const deletes = stringArray(result.deletes);
      const directories = stringArray(result.directories);
      const deleteDirectories = stringArray(result.deleteDirectories);
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
      const lines = [
        `Рабочая папка документов: ${String(result.rootPath)}`,
        `Хранилище: ${String(result.vaultId)}`,
        `Изменения: записей — ${writes.length}, удалений файлов — ${deletes.length}, созданий папок — ${directories.length}, удалений папок — ${deleteDirectories.length}, предупреждений — ${warnings.length}, конфликтов — ${conflicts.length}`,
      ];
      if (writes.length > 0) lines.push(`Записать:\n  ${writes.join("\n  ")}`);
      if (deletes.length > 0) lines.push(`Удалить:\n  ${deletes.join("\n  ")}`);
      if (directories.length > 0)
        lines.push(`Создать папки:\n  ${directories.join("\n  ")}`);
      if (deleteDirectories.length > 0)
        lines.push(`Удалить папки:\n  ${deleteDirectories.join("\n  ")}`);
      if (warnings.length > 0)
        lines.push(`Предупреждения:\n${JSON.stringify(warnings, null, 2)}`);
      if (conflicts.length > 0)
        lines.push(`Конфликты:\n${JSON.stringify(conflicts, null, 2)}`);
      const diffs = stringArray(result.diffs);
      if (diffs.length > 0) lines.push(diffs.join("\n\n"));
      if (result.outcome === "pushed") lines.push("Отправка завершена.");
      else if (result.outcome === "planned")
        lines.push(
          command === "push"
            ? "Пробный запуск: изменения в хранилище не внесены."
            : "Изменения в хранилище не внесены.",
        );
      else if (result.outcome === "partial")
        lines.push("Отправка выполнена частично; повторите status для восстановления.");
      else if (result.outcome === "conflict")
        lines.push(
          "Изменения не отправлены; сначала выполните pull и разрешите конфликты.",
        );
      return lines.join("\n");
    }
    return JSON.stringify(result, null, 2);
  }
  routeRpc("/read", docsRpcContract.readNote.input, handlers.readNote);
  routeRpc("/write", docsRpcContract.saveNote.input, handlers.saveNote);
  routeRpc("/mkdir", docsRpcContract.createFolder.input, handlers.createFolder);
  routeRpc("/move", docsRpcContract.movePath.input, handlers.movePath);
  routeRpc("/remove", docsRpcContract.deletePath.input, handlers.deletePath);
  routeRpc(
    "/sync/snapshot",
    docsRpcContract.syncSnapshot.input,
    handlers.syncSnapshot,
  );
  routeRpc("/sync/apply", docsRpcContract.syncApply.input, handlers.syncApply);

  async function attemptCli(
    work: () => Promise<PluginCliResult>,
  ): Promise<PluginCliResult> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PluginCliError) throw error;
      throw new PluginCliError(errorMessage(error), {
        code: "operation_failed",
      });
    }
  }

  function renderCliResult(
    command: string,
    result: unknown,
    asJson: boolean,
  ): string {
    return asJson
      ? JSON.stringify(result, null, 2)
      : formatSyncHumanOutput(command, result);
  }

  function workspaceArgs(args: {
    positionals: string[];
    vaultId: string | undefined;
    into: string | undefined;
    workspaceHostId: string | undefined;
    all?: boolean;
    folder?: boolean;
    delete?: boolean;
    dryRun?: boolean;
    diff?: boolean;
  }): SyncCliArgs {
    return {
      positionals: args.positionals,
      vaultId: args.vaultId,
      into: args.into,
      workspaceHostId: args.workspaceHostId,
      all: args.all ?? false,
      folder: args.folder ?? false,
      delete: args.delete ?? false,
      dryRun: args.dryRun ?? false,
      diff: args.diff ?? false,
    };
  }

  function statusExitCode(result: unknown): number {
    if (!isRecord(result)) return 0;
    if (result.outcome === "conflict") return 3;
    const changed = [
      "writes",
      "deletes",
      "directories",
      "deleteDirectories",
      "warnings",
    ].some(
      (key) =>
        Array.isArray(result[key]) && (result[key] as unknown[]).length > 0,
    );
    return changed ? 4 : 0;
  }

  const proposalPositionals = [
    {
      name: "path",
      description: "Путь Markdown относительно корня хранилища",
      required: true,
    },
  ] as const;
  const proposalVersionOption = {
    type: "string",
    required: true,
    description:
      "Версия из результата proposal; используйте none, только если предложения нет",
  } as const;

  function parseProposalVersion(value: string): number | null {
    if (value === "none") return null;
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version < 1)
      throw new CliUsageError("Ожидается положительный номер версии предложения или none.");
    return version;
  }

  const proposalCommands = Object.fromEntries(
    (["accept", "reject", "undo", "redo"] as const).map((action) => [
      action,
      cliCommand({
        summary: ({ accept: "Принять", reject: "Отклонить", undo: "Отменить", redo: "Повторить" } as const)[action] + " предложение изменения документа",
        positionals: proposalPositionals,
        options: {
          vault: VAULT_OPTION,
          version: proposalVersionOption,
          json: JSON_OPTION,
        },
        run: (input) =>
          attemptCli(async () => {
            const expectedVersion = parseProposalVersion(input.options.version);
            if (expectedVersion === null)
              throw new CliUsageError(
                "Для этого действия нужна версия предложения.",
              );
            const result = await handlers.resolveProposal({
              vaultId: input.options.vault,
              path: requireVaultPath(input.positionals.path),
              action,
              expectedVersion,
            });
            return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
          }),
      }),
    ]),
  );

  bb.cli.register(
    defineCli({
      name: "docs",
      summary: "Поиск и безопасная синхронизация хранилищ Docs",
      description: DOCS_DESCRIPTION,
      usageErrorExitCode: 2,
      commands: {
        ...proposalCommands,
        proposal: cliCommand({
          summary: "Прочитать текущее предложение и его версию",
          positionals: proposalPositionals,
          options: { vault: VAULT_OPTION, json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: JSON.stringify(
                await handlers.readProposal({
                  vaultId: input.options.vault,
                  path: requireVaultPath(input.positionals.path),
                }),
                null,
                2,
              ),
            })),
        }),
        propose: cliCommand({
          summary: "Предложить правку Markdown без изменения документа",
          positionals: proposalPositionals,
          options: {
            vault: VAULT_OPTION,
            version: proposalVersionOption,
            json: JSON_OPTION,
            "expected-sha256": {
              type: "string",
              required: true,
              description: "Текущий SHA-256 документа из read --json",
            },
            file: {
              type: "string",
              required: true,
              description:
                "Файл UTF-8 в рабочей папке с полным предлагаемым Markdown",
            },
            "workspace-host": WORKSPACE_HOST_OPTION,
          },
          run: (input, context) =>
            attemptCli(async () => {
              const candidatePath = resolveHostPath(
                context.cwd ?? process.cwd(),
                input.options.file,
              );
              const hostId = await resolveWorkspaceHostId(
                workspaceArgs({
                  positionals: [],
                  vaultId: input.options.vault,
                  into: undefined,
                  workspaceHostId: input.options["workspace-host"],
                }),
                context,
              );
              const file = await bb.sdk.files.read({
                ...hostIdArgs(hostId),
                path: candidatePath,
                rootPath: hostPathDirname(candidatePath),
              });
              if (file.contentEncoding !== "utf8")
                throw new CliUsageError(
                  "Файл предложения должен содержать Markdown в UTF-8.",
                );
              const result = await handlers.proposeNote({
                vaultId: input.options.vault,
                path: requireVaultPath(input.positionals.path, {
                  extension: ".md",
                }),
                content: file.content,
                expectedSha256: input.options["expected-sha256"],
                expectedVersion: parseProposalVersion(input.options.version),
              });
              return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
            }),
        }),
        "proposal-update": cliCommand({
          summary: "Изменить ожидающее предложение с проверкой версии",
          positionals: proposalPositionals,
          options: {
            vault: VAULT_OPTION,
            version: proposalVersionOption,
            json: JSON_OPTION,
            content: {
              type: "string",
              required: true,
              description: "Полный Markdown предлагаемого варианта",
            },
          },
          run: (input) =>
            attemptCli(async () => {
              const expectedVersion = parseProposalVersion(
                input.options.version,
              );
              if (expectedVersion === null)
                throw new CliUsageError(
                  "Для этого действия нужна версия предложения.",
                );
              const result = await handlers.updateProposal({
                vaultId: input.options.vault,
                path: requireVaultPath(input.positionals.path),
                content: input.options.content,
                expectedVersion,
              });
              return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
            }),
        }),
        vaults: cliCommand({
          summary: "Показать настроенные хранилища",
          suggestFor: ["vault"],
          options: { json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "vaults",
                listVaults(),
                input.options.json,
              ),
            })),
        }),
        "vault-add": cliCommand({
          summary: "Добавить хранилище",
          suggestFor: ["add-vault", "vault-create"],
          positionals: [
            {
              name: "name",
              description: "Отображаемое название хранилища",
              required: true,
            },
            {
              name: "absolute-root",
              description:
                "Абсолютный путь к папке на хосте; если папки нет, она будет создана",
              required: true,
            },
            {
              name: "host-id",
              description:
                "Подключённый хост с папкой; не указывайте для этого сервера",
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "vault-add",
                await handlers.createVault({
                  name: input.positionals.name,
                  rootPath: input.positionals["absolute-root"],
                  hostId: input.positionals["host-id"],
                }),
                input.options.json,
              ),
            })),
        }),
        "vault-remove": cliCommand({
          summary: "Удалить настройки хранилища",
          suggestFor: ["remove-vault", "vault-delete"],
          positionals: [
            {
              name: "id",
              description: "ID хранилища из `bb docs vaults`",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "vault-remove",
                await handlers.removeVault({ vaultId: input.positionals.id }),
                input.options.json,
              ),
            })),
        }),
        list: cliCommand({
          summary: "Показать заметки и папки",
          aliases: ["ls"],
          options: { vault: VAULT_OPTION, json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "list",
                await notebookData(input.options.vault),
                input.options.json,
              ),
            })),
        }),
        read: cliCommand({
          summary: "Прочитать файл",
          aliases: ["cat"],
          positionals: [
            {
              name: "path",
              description: "Путь относительно корня хранилища",
              required: true,
            },
          ],
          options: { vault: VAULT_OPTION, json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => {
              const result = await readFile(
                input.options.vault,
                input.positionals.path,
              );
              return {
                exitCode: 0,
                stdout:
                  !input.options.json &&
                  isRecord(result) &&
                  typeof result.content === "string"
                    ? result.content
                    : renderCliResult("read", result, input.options.json),
              };
            }),
        }),
        pull: cliCommand({
          summary: "Загрузить файл, папку со вложениями или всё хранилище",
          description:
            "Записывает файлы в рабочую папку с манифестом .bb-docs-state.json. Отредактируйте их обычными инструментами, затем выполните bb docs status и bb docs push.",
          suggestFor: ["fetch", "clone", "checkout"],
          positionals: [
            {
              name: "path",
              description:
                "Файл хранилища или папка с --folder; не указывайте только с --all",
            },
          ],
          options: {
            vault: VAULT_OPTION,
            into: {
              type: "string",
              placeholder: "dir",
              aliases: ["dir", "target"],
              description:
                "Рабочая папка для загрузки; по умолчанию docs-<vault-id> внутри текущей папки",
            },
            "workspace-host": WORKSPACE_HOST_OPTION,
            all: {
              type: "boolean",
              description: "Загрузить всё хранилище вместо одного пути",
            },
            folder: {
              type: "boolean",
              aliases: ["recursive"],
              description: "Считать путь папкой со вложениями",
            },
            json: JSON_OPTION,
          },
          constraints: [{ kind: "at-most-one", options: ["all", "folder"] }],
          run: (input, context) =>
            attemptCli(async () => {
              const path = input.positionals.path;
              const result = await runPull(
                workspaceArgs({
                  positionals: path === undefined ? [] : [path],
                  vaultId: input.options.vault,
                  into: input.options.into,
                  workspaceHostId: input.options["workspace-host"],
                  all: input.options.all,
                  folder: input.options.folder,
                }),
                context,
              );
              return {
                exitCode: !isRecord(result)
                  ? 0
                  : result.outcome === "conflict"
                    ? 3
                    : result.outcome === "partial"
                      ? 1
                      : 0,
                stdout: renderCliResult("pull", result, input.options.json),
              };
            }),
        }),
        status: cliCommand({
          summary: "Показать локальные правки, конфликты и проигнорированные удаления",
          description: DOCS_STATUS_DESCRIPTION,
          positionals: [
            {
              name: "workspace-dir",
              description:
                "Папка с загруженными файлами; по умолчанию --into или docs-<vault-id>",
            },
          ],
          options: {
            vault: VAULT_OPTION,
            "workspace-host": WORKSPACE_HOST_OPTION,
            delete: DELETE_OPTION,
            diff: DIFF_OPTION,
            json: JSON_OPTION,
          },
          run: (input, context) =>
            attemptCli(async () => {
              const directory = input.positionals["workspace-dir"];
              const result = await runPushPlan(
                workspaceArgs({
                  positionals: directory === undefined ? [] : [directory],
                  vaultId: input.options.vault,
                  into: undefined,
                  workspaceHostId: input.options["workspace-host"],
                  delete: input.options.delete,
                  diff: input.options.diff,
                }),
                context,
                false,
              );
              return {
                exitCode: statusExitCode(result),
                stdout: renderCliResult("status", result, input.options.json),
              };
            }),
        }),
        push: cliCommand({
          summary: "Безопасно отправить локальные правки с проверкой изменений",
          description:
            "Не записывает файл, если он изменился в хранилище после загрузки. Разрешите конфликт, затем повторите pull или push.",
          positionals: [
            {
              name: "workspace-dir",
              description:
                "Папка с загруженными файлами; по умолчанию --into или docs-<vault-id>",
            },
          ],
          options: {
            vault: VAULT_OPTION,
            "workspace-host": WORKSPACE_HOST_OPTION,
            delete: DELETE_OPTION,
            "dry-run": {
              type: "boolean",
              aliases: ["dryrun", "plan"],
              description: "Спланировать отправку без записи в хранилище",
            },
            diff: DIFF_OPTION,
            json: JSON_OPTION,
          },
          run: (input, context) =>
            attemptCli(async () => {
              const directory = input.positionals["workspace-dir"];
              const result = await runPushPlan(
                workspaceArgs({
                  positionals: directory === undefined ? [] : [directory],
                  vaultId: input.options.vault,
                  into: undefined,
                  workspaceHostId: input.options["workspace-host"],
                  delete: input.options.delete,
                  dryRun: input.options["dry-run"],
                  diff: input.options.diff,
                }),
                context,
                true,
              );
              return {
                exitCode: !isRecord(result)
                  ? 0
                  : result.outcome === "conflict"
                    ? 3
                    : result.outcome === "partial"
                      ? 1
                      : 0,
                stdout: renderCliResult("push", result, input.options.json),
              };
            }),
        }),
        write: cliCommand({
          summary: "Устарело: записать файл UTF-8 напрямую",
          description:
            "Вместо этого используйте bb docs pull, редактируйте файлы и выполняйте bb docs push.",
          positionals: [
            {
              name: "path",
              description: "Путь относительно корня хранилища",
              required: true,
            },
          ],
          options: {
            vault: VAULT_OPTION,
            content: {
              type: "string",
              required: true,
              placeholder: "text",
              aliases: ["text", "body"],
              description: "Полное содержимое файла UTF-8",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "write",
                await writeFile({
                  vaultId: input.options.vault,
                  rawPath: input.positionals.path,
                  content: input.options.content,
                }),
                input.options.json,
              ),
              stderr: DEPRECATED_MUTATION_WARNING,
            })),
        }),
        mkdir: cliCommand({
          summary: "Устарело: создать папку напрямую",
          description:
            "Вместо этого используйте bb docs pull, создайте папку локально и выполните bb docs push.",
          positionals: [
            {
              name: "path",
              description: "Путь к папке относительно корня хранилища",
              required: true,
            },
          ],
          options: { vault: VAULT_OPTION, json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "mkdir",
                await handlers.createFolder({
                  vaultId: input.options.vault,
                  path: input.positionals.path,
                }),
                input.options.json,
              ),
              stderr: DEPRECATED_MUTATION_WARNING,
            })),
        }),
        move: cliCommand({
          summary: "Устарело: переместить путь напрямую",
          description:
            "Вместо этого используйте bb docs pull, переместите файл локально и выполните bb docs push --delete.",
          positionals: [
            {
              name: "from",
              description: "Существующий путь относительно корня хранилища",
              required: true,
            },
            {
              name: "to",
              description: "Путь назначения относительно корня хранилища",
              required: true,
            },
          ],
          options: { vault: VAULT_OPTION, json: JSON_OPTION },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "move",
                await movePath(
                  input.options.vault,
                  input.positionals.from,
                  input.positionals.to,
                ),
                input.options.json,
              ),
              stderr: DEPRECATED_MUTATION_WARNING,
            })),
        }),
        remove: cliCommand({
          summary: "Устарело: удалить файл или папку напрямую",
          description:
            "Вместо этого используйте bb docs pull, удалите файл локально и выполните bb docs push --delete.",
          aliases: ["rm"],
          positionals: [
            {
              name: "path",
              description: "Путь относительно корня хранилища",
              required: true,
            },
          ],
          options: {
            vault: VAULT_OPTION,
            recursive: {
              type: "boolean",
              description: "Удалить папку со всем содержимым",
            },
            json: JSON_OPTION,
          },
          run: (input) =>
            attemptCli(async () => ({
              exitCode: 0,
              stdout: renderCliResult(
                "remove",
                await removePath(
                  input.options.vault,
                  input.positionals.path,
                  input.options.recursive,
                ),
                input.options.json,
              ),
              stderr: DEPRECATED_DELETION_WARNING,
            })),
        }),
      },
    }),
  );

  bb.ui.registerMentionProvider({
    id: "note",
    label: "Docs",
    async search({ query }) {
      const needle = query.trim().toLowerCase();
      const matches = [];
      for (const vault of listVaults()) {
        for (const note of await mentionNoteSummaries(vault)) {
          if (
            needle &&
            !`${vault.name} ${note.title} ${note.preview} ${note.path}`
              .toLowerCase()
              .includes(needle)
          )
            continue;
          matches.push({
            id: `${vault.id}:${note.path}`,
            title: note.title,
            subtitle: `${vault.name} · ${note.preview || note.path}`,
            icon: "FileText",
          });
          if (matches.length === 25) return matches;
        }
      }
      return matches;
    },
    async resolve(itemId) {
      const separator = itemId.indexOf(":");
      if (separator < 1) throw new Error("Неверная ссылка на заметку");
      const vaultId = itemId.slice(0, separator);
      const relativePath = itemId.slice(separator + 1);
      const file = await readFile(vaultId, relativePath);
      const proposal = readProposal(getVault(vaultId).id, relativePath);
      return {
        context:
          `Docs document (${vaultId}/${relativePath}):\nSHA-256: ${file.sha256}\n\n${file.content}` +
          (proposal
            ? `\n\nDocs proposal metadata:\n${JSON.stringify(proposal)}\nUse bb docs propose with this version and current document hash to propose a revision; do not push over the user's document.`
            : "\n\nProposal version: none. Use bb docs propose to suggest changes for approval."),
      };
    },
  });

  bb.rpc.experimental_whileWatched("listNotes", (read, signal) => {
    if (!("input" in read)) return;
    const input = docsRpcContract.listNotes.input.safeParse(read.input);
    if (!input.success) return;
    const vault = listVaults().find((candidate) =>
      input.data.vaultId === undefined
        ? true
        : candidate.id === input.data.vaultId,
    );
    if (vault) watches.retain(vault.id, signal);
  });

  bb.rpc.experimental_whileWatched("readDocument", (read, signal) => {
    if (!("input" in read)) return;
    const input = docsRpcContract.readDocument.input.safeParse(read.input);
    if (!input.success) return;
    const vault = listVaults().find(
      (candidate) => candidate.id === input.data.vaultId,
    );
    if (!vault) return;
    watches.retain(vault.id, signal);
    void renewPreviewWhileWatched(vault, input.data.path, signal);
  });

  async function renewPreviewWhileWatched(
    vault: Vault,
    relativePath: string,
    signal: AbortSignal,
  ) {
    while (!signal.aborted) {
      let lease: { expiresAtMs: number };
      try {
        lease = await previewLease(vault);
      } catch {
        return;
      }
      await waitForDelay(
        Math.max(
          1_000,
          lease.expiresAtMs - PREVIEW_RENEW_BEFORE_MS - Date.now() + 1_000,
        ),
        signal,
      );
      if (!signal.aborted) invalidate([documentTag(vault.id, relativePath)]);
    }
  }
}
