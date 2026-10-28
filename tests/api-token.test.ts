import { describe, expect, it } from "vitest";
import {
  API_TOKEN_PREFIX,
  apiTokenPrefix,
  generateApiToken,
  hashApiToken,
} from "@/server/auth/api-token";

describe("API tokens", () => {
  it("generates a prefixed, high-entropy token", () => {
    const token = generateApiToken();
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(generateApiToken()).not.toBe(token);
  });

  it("hashes deterministically and never stores plaintext", () => {
    const token = generateApiToken();
    expect(hashApiToken(token)).toBe(hashApiToken(token));
    expect(hashApiToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiToken(token)).not.toContain(token);
    expect(hashApiToken(`${token}x`)).not.toBe(hashApiToken(token));
  });

  it("keeps a short prefix for display", () => {
    const token = generateApiToken();
    expect(apiTokenPrefix(token)).toHaveLength(12);
    expect(token.startsWith(apiTokenPrefix(token))).toBe(true);
  });
});
