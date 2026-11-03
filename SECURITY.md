# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue or pull request.

Use GitHub's private reporting: the **Security** tab of this repository, then **Report a vulnerability**.

Include what you found, the steps to reproduce it, the app version and your system. We will reply, keep you
updated and credit you in the fix if you want.

## What counts

The desktop app can run agents, control the computer and sign in to connectors, so these matter most:

- Reading or leaking the session token, connector secrets or any stored credential.
- Getting the app to pay, send or delete something without asking the user first.
- Remote code execution, or escaping the app's permission prompts.
- A malicious update or a bypass of update signing.

## Supported versions

Only the latest release gets security fixes.
