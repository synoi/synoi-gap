# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Reporting a vulnerability

**Do not open a GitHub issue for security vulnerabilities.**

- **Preferred:** Use GitHub's [private vulnerability reporting](../../security/advisories/new) (creates a private draft advisory visible only to maintainers, no email required).
- **Alternative:** Submit the form at [synoi.systems/security](https://synoi.systems/security) for reporters outside of GitHub (IETF mirrors, forks, etc.).

Include:
- A description of the vulnerability and the component affected
- Steps to reproduce or a proof-of-concept
- The potential impact (which security property breaks: OID integrity, grant isolation, receipt authenticity, tenant isolation, etc.)
- Whether you believe it affects the wire protocol spec (CC0) or only this package (Apache-2.0)

We will acknowledge receipt within 72 hours and aim to provide a fix or mitigation plan within 14 days for critical issues.

## Disclosure policy

We follow responsible disclosure. Please allow us to release a fix before publishing details publicly. We will credit reporters in the release notes unless you prefer anonymity.

## Scope

In scope:
- OID computation correctness (canonical JSON divergence, hash collision)
- Grant isolation and tenant isolation bypasses
- Receipt forgery or tampering
- Validator bypass (invalid objects passing `validateCapabilityDeclaration` etc.)
- Python SDK (`python/`) correctness issues

Out of scope:
- Vulnerabilities in downstream gateway implementations (report to that project)
- Issues in `@noble/hashes` (report upstream)
- Theoretical attacks requiring more than 2^128 operations
