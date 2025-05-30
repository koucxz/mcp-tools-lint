export function redact(value: string, secrets: string[]): string {
  let output = value;
  for (const secret of secrets) {
    if (secret.length > 0) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}