/** Standard Java/Maven .gitignore, written to the root of every generated Spring Boot solution. */
export function gitignore(): string {
  return `target/
*.class
.idea/
*.iml
.vscode/
.DS_Store
`;
}
