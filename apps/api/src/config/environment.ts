import type { ZodIssue } from "zod";

import { type Environment, environmentSchema } from "./environment.schema.js";

export class EnvironmentValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(["Environment validation failed:", ...issues.map((issue) => `- ${issue}`)].join("\n"));

    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? "environment" : issue.path.join(".");

  return `${path}: ${issue.message}`;
}

export function parseEnvironment(source: unknown): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues.map(formatIssue));
  }

  return Object.freeze(result.data);
}
