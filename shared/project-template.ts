/** Optional planning guidance; templates neither create files nor configure executable commands. */
export const PROJECT_TEMPLATES = [
  { id: "web", label: "Web full-stack" },
  { id: "ml", label: "Train model" },
  { id: "research", label: "Research" },
  { id: "library", label: "Thư viện / CLI" },
] as const;

export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number]["id"];

export function isProjectTemplate(value: unknown): value is ProjectTemplate {
  return PROJECT_TEMPLATES.some((template) => template.id === value);
}
