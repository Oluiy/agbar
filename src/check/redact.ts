/**
 * Evidence lines are pasted into CI logs, issues and chats. A finding that says
 * "a secret is committed" must never repeat the secret, so every evidence string
 * passes through here before it reaches a report.
 */
const PATTERNS: [RegExp, string][] = [
  // scheme://user:password@host - keep the user, hide the password
  [/(:\/\/[^\s:/@"']+:)[^\s@"']+(?=@)/g, "$1<redacted>"],
  // ADO.NET / JDBC / key=value style: Password=..., pwd=..., password: ...
  [/\b(password|passwd|pwd|secret|api[_-]?key|token)(\s*[=:]\s*["']?)[^;"'\s,&]+/gi, "$1$2<redacted>"],
  // AWS access key ids: keep the prefix so the reader can still tell what it was
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA<redacted>"],
];

export function redactSecrets(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
