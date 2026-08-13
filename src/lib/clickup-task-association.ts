import type { ClickUpTaskCacheInput } from "@/lib/clickup-task-cache";
import type { Client, ClickUpAssociationSource, Project } from "@/lib/types";

export type { ClickUpAssociationSource };

export type ClickUpTaskAssociation = {
  clientId: string | null;
  projectId: string | null;
  source: ClickUpAssociationSource;
};

function normalizedName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

/** Only unique exact names are eligible. Ambiguous names are left unassigned. */
function uniqueNameIndex<T extends { id: string; name: string }>(items: T[]): Map<string, T> {
  const index = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const item of items) {
    const key = normalizedName(item.name);
    if (!key) continue;
    if (index.has(key)) {
      index.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      index.set(key, item);
    }
  }
  return index;
}

function fieldValue(field: NonNullable<ClickUpTaskCacheInput["custom_fields"]>[number]): string {
  const value = field.value;
  if (typeof value === "string" || typeof value === "number") {
    const option = field.type_config?.options?.find((candidate) => String(candidate.id) === String(value));
    if (option?.name || option?.label) return option.name || option.label || "";
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "label", "value"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return "";
}

function customField(task: ClickUpTaskCacheInput, name: "client" | "project"): string {
  const match = task.custom_fields?.find((field) => normalizedName(field.name) === name);
  return match ? fieldValue(match) : "";
}

function taggedValue(task: ClickUpTaskCacheInput, name: "client" | "project"): string {
  for (const tag of task.tags ?? []) {
    const match = tag.name?.match(/^\s*(client|project)\s*[:/]\s*(.+?)\s*$/i);
    if (match?.[1]?.toLowerCase() === name) return match[2];
  }
  return "";
}

function findEntity<T extends { id: string; name: string }>(
  value: string,
  byId: Map<string, T>,
  byName: Map<string, T>
): T | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return byId.get(trimmed) ?? byName.get(normalizedName(trimmed)) ?? null;
}

/**
 * Resolve a ClickUp task without creating another mapping table to maintain.
 *
 * Project signals win because the local Project row is authoritative for its
 * Client. Custom fields and names are exact (case/punctuation insensitive), so
 * a near match never silently assigns work to the wrong account.
 */
export function resolveClickUpTaskAssociation(
  task: ClickUpTaskCacheInput,
  clients: Client[],
  projects: Project[]
): ClickUpTaskAssociation {
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const clientByName = uniqueNameIndex(clients);
  const projectByName = uniqueNameIndex(projects);

  const projectSignals: Array<[string, ClickUpAssociationSource]> = [
    [customField(task, "project"), "project-custom-field"],
    [taggedValue(task, "project"), "project-tag"],
    [task.list?.name ?? "", "project-list"]
  ];
  for (const [value, source] of projectSignals) {
    const project = findEntity(value, projectById, projectByName);
    if (project) {
      return { projectId: project.id, clientId: project.clientId, source };
    }
  }

  const clientSignals: Array<[string, ClickUpAssociationSource]> = [
    [customField(task, "client"), "client-custom-field"],
    [taggedValue(task, "client"), "client-tag"],
    [task.folder?.name ?? "", "client-folder"],
    [task.space?.name ?? "", "client-space"]
  ];
  for (const [value, source] of clientSignals) {
    const client = findEntity(value, clientById, clientByName);
    if (client) return { projectId: null, clientId: client.id, source };
  }

  return { projectId: null, clientId: null, source: "none" };
}
