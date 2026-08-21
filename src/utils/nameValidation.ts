// Validates that `name` is a safe project/service name across supported stacks.
export function isValidIdentifierName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
}
