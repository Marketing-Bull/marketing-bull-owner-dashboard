import { describe, expect, it } from "vitest";
import { resolveClickUpTaskAssociation } from "@/lib/clickup-task-association";
import type { Client, Project } from "@/lib/types";

const clients = [
  { id: "client-rtt", name: "Rock The Treatment" },
  { id: "client-mb", name: "Marketing Bull" }
] as Client[];
const projects = [
  { id: "project-cro", name: "Website CRO Improvements", clientId: "client-rtt" },
  { id: "project-cost", name: "Cost Optimization", clientId: "client-mb" }
] as Project[];

describe("ClickUp task association", () => {
  it("prefers the Project custom field and derives its Client", () => {
    const result = resolveClickUpTaskAssociation(
      {
        id: "1",
        name: "Review page",
        custom_fields: [{ name: "Project", value: "Website CRO Improvements" }],
        tags: [{ name: "client:Marketing Bull" }]
      },
      clients,
      projects
    );
    expect(result).toEqual({
      projectId: "project-cro",
      clientId: "client-rtt",
      source: "project-custom-field"
    });
  });

  it("resolves dropdown option labels and namespaced tags", () => {
    expect(
      resolveClickUpTaskAssociation(
        {
          id: "1",
          name: "Review page",
          custom_fields: [
            {
              name: "Project",
              value: "option-1",
              type_config: { options: [{ id: "option-1", name: "Cost Optimization" }] }
            }
          ]
        },
        clients,
        projects
      ).projectId
    ).toBe("project-cost");
    expect(
      resolveClickUpTaskAssociation(
        { id: "2", name: "Call", tags: [{ name: "client: Rock The Treatment" }] },
        clients,
        projects
      )
    ).toEqual({ projectId: null, clientId: "client-rtt", source: "client-tag" });
  });

  it("falls back to exact List→Project and Folder/Space→Client names", () => {
    expect(
      resolveClickUpTaskAssociation(
        { id: "1", name: "Review", list: { name: "website cro improvements" } },
        clients,
        projects
      ).source
    ).toBe("project-list");
    expect(
      resolveClickUpTaskAssociation(
        { id: "2", name: "Review", folder: { name: "Rock The Treatment" } },
        clients,
        projects
      ).source
    ).toBe("client-folder");
  });

  it("does not guess when no exact entity exists", () => {
    expect(
      resolveClickUpTaskAssociation(
        { id: "1", name: "Review", list: { name: "Website" } },
        clients,
        projects
      )
    ).toEqual({ projectId: null, clientId: null, source: "none" });
  });
});
