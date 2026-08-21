//ScaffoldConfig helps define the configuration for scaffolding a solution.
export interface ScaffoldConfig {
  projectName: string;
  outputDirectory: string;
  includeTests: boolean;
  isMicroservice: boolean;
  serviceNames: string[];
  httpPort: number;
  // Cross-stack (unlike addons, which is stack-specific): drives the
  // post-generation recommendation tips, e.g. suggesting ai-cost-guard.
  usesLlmApi: boolean;
  addons: Record<string, unknown>;
}
