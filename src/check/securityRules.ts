import { codeFiles, isClientCode, isOneOffLoader } from "./fileKinds.js";
import type { RepoSnapshot, RuleDefinition } from "./types.js";

/**
 * Security rules: how secrets are stored, how failures are handled, what the build
 * trusts. Split into their own file because operationalRules.ts and databaseRules.ts
 * were both within thirty lines of this project's 400-line limit.
 */

/** Fast, general-purpose digests. Correct for etags and cache keys; wrong for passwords. */
const FAST_HASH =
  /createHash\s*\(\s*["'](md5|sha1|sha256|sha512)["']|hashlib\.(md5|sha1|sha256|sha512)\s*\(|MessageDigest\.getInstance\s*\(\s*["'](MD5|SHA-1|SHA-256)["']|sha256\.New\s*\(|SHA256\.(Create|HashData)\s*\(/i;
/** The line is about a password, not a file checksum. */
const PASSWORD_WORD = /\b(password|passwd|pwd|passphrase)\b/i;
/** A real password hash on the same line means the fast digest is doing something else. */
const PROPER_HASH = /\b(bcrypt|argon2|argon2id|scrypt|pbkdf2|PasswordHasher|password_hash)\b/i;

function firstFastHashedPassword(repo: RepoSnapshot) {
  for (const file of codeFiles(repo)) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!PASSWORD_WORD.test(line) || !FAST_HASH.test(line)) continue;
      if (PROPER_HASH.test(line)) continue;
      return `${file.relPath}:${i + 1}  ${line.trim().slice(0, 100)}`;
    }
  }
  return undefined;
}

/**
 * A catch block that drops the error: empty, or logging and carrying on as though the
 * operation succeeded.
 *
 * A body of only a comment is NOT flagged. Someone who wrote "// the cache is optional"
 * made a decision; the failure mode this rule is about is the one nobody thought about.
 */
function firstSwallowedError(repo: RepoSnapshot) {
  const catchOpener = /\bcatch\b[^{]*\{\s*$|\bcatch\s*\{\s*$|\bexcept\b[^:]*:\s*$/;
  const logOnly = /^(console\.(log|error|warn|debug)|print|println!?|logger?\.|log\.|fmt\.Print|System\.out\.print)/;
  const comment = /^(\/\/|#|\*|\/\*)/;

  for (const file of codeFiles(repo)) {
    // A React component's catch is not a backend reliability problem, and a seed or
    // migration script is run once by a human who sees it fail. Both showed up as noise
    // on the corpus (Ecommerce_Solution's Cart.tsx, a realworld prisma/seed.ts).
    if (isClientCode(repo, file) || isOneOffLoader(file.relPath)) continue;
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!catchOpener.test(lines[i])) continue;
      const body: string[] = [];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const t = lines[j].trim();
        if (t === "}" || t === "});" || t === "") break;
        body.push(t);
      }
      // Only a comment, or a rethrow, means it was handled deliberately.
      if (body.some((l) => comment.test(l) || /\b(throw|raise|return|res\.|reply\.|next\()/.test(l))) continue;
      if (body.length === 0 || body.every((l) => logOnly.test(l))) {
        return `${file.relPath}:${i + 1}  ${lines[i].trim().slice(0, 100)}`;
      }
    }
  }
  return undefined;
}

// bun.lock is the text format Bun 1.2 moved to; bun.lockb is the older binary one. Missing
// the new name reported full-stack-fastapi-template as unlocked when it is not.
const LOCK_FILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "npm-shrinkwrap.json"];

export const SECURITY_RULES: RuleDefinition[] = [
  {
    id: "password-fast-hash",
    conceptId: "authentication-failures",
    severity: "high",
    passSummary: "Passwords are not hashed with a fast general-purpose digest",
    nextStep:
      "Hash passwords with a slow, memory-hard function built for the job - argon2id, scrypt or bcrypt - through your platform's library, which salts each one for you. A general-purpose digest is designed to be fast, which is exactly what an attacker with a GPU wants.",
    appliesTo: () => true,
    detect: (repo) => {
      const evidence = firstFastHashedPassword(repo);
      if (!evidence) return undefined;
      return {
        ruleId: "password-fast-hash",
        conceptId: "authentication-failures",
        severity: "high",
        summary: "A password looks like it is hashed with a fast general-purpose digest, which a GPU reverses in bulk.",
        evidence,
      };
    },
  },
  {
    id: "swallowed-error",
    conceptId: "error-handling",
    severity: "medium",
    passSummary: "No catch blocks that drop the error",
    nextStep:
      "Decide what this failure means and act on it: retry what is transient, return an error for what is not, and let anything unexpected reach one handler at the edge. If carrying on really is correct, say so in a comment - the next reader cannot tell a deliberate choice from an oversight.",
    appliesTo: () => true,
    detect: (repo) => {
      const evidence = firstSwallowedError(repo);
      if (!evidence) return undefined;
      return {
        ruleId: "swallowed-error",
        conceptId: "error-handling",
        severity: "medium",
        summary: "A catch block discards the error, so a failed operation reports success (heuristic: text match, not flow analysis).",
        evidence,
      };
    },
  },
  {
    id: "no-lockfile",
    conceptId: "supply-chain-security",
    severity: "medium",
    passSummary: "A dependency lock file is committed",
    // Libraries deliberately omit a lock file so consumers resolve their own tree, so this
    // only applies to something deployed.
    serviceOnly: true,
    nextStep:
      "Commit the lock file and install from it in CI (npm ci rather than npm install). Without it every build resolves to whatever was newest at the time, so a compromised patch release reaches production without anything in your repo changing.",
    appliesTo: (repo) => repo.allPaths.includes("package.json"),
    detect: (repo) => {
      if (LOCK_FILES.some((f) => repo.allPaths.includes(f))) return undefined;
      return {
        ruleId: "no-lockfile",
        conceptId: "supply-chain-security",
        severity: "medium",
        summary: "No dependency lock file is committed, so two builds of the same commit can install different code.",
        evidence: "package.json",
      };
    },
  },
];
