// @vitest-environment node
/* The message a failed Google sign-in shows. Worth pinning: the first run of a
   fresh OAuth client almost always fails with `access_denied` because the app
   is still in Testing and the address is not a registered tester, and Google's
   own wording for that says nothing about how to fix it. */
import { describe, expect, it } from "vitest";
import { NeedsConsentError } from "./gcalAuth";

describe("NeedsConsentError", () => {
  it("turns access_denied into the console page that actually fixes it", () => {
    const message = new NeedsConsentError("me@gmail.com", "access_denied").message;
    expect(message).toContain("me@gmail.com");
    expect(message).toContain("Test users");
    expect(message).toContain("Audience");
  });

  it("names the account when a renewal simply expired", () => {
    expect(new NeedsConsentError("me@gmail.com").message).toBe("Sign in to Google again for me@gmail.com");
  });

  it("never presents Google's error text as if it were an email address", () => {
    // Regression: the reason used to be passed into the `email` slot, producing
    // "Sign in to Google again for Popup window closed".
    const message = new NeedsConsentError(undefined, "popup_closed").message;
    expect(message).not.toMatch(/for popup_closed/);
    expect(message).toContain("popup_closed");
  });

  it("keeps a bare message when Google said nothing useful", () => {
    expect(new NeedsConsentError().message).toBe("Sign in to Google again");
  });
});
