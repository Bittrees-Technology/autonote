# Email for bittrees.org — free-first plan

Prepared September 10, 2026. This is a plan; no mail DNS, forwarding service, or mailbox server has been activated.

## Recommendation

Start with free incoming forwarding for the domain, while keeping the working transactional sender for AutoNote and CRM. Build a full mailbox server when an existing, suitable always-on Linux host and backup destination are identified. The server software can be free; reliable hosting and operation are not automatically free. Do not purchase a host, email subscription, or usage overages under the current budget.

AutoNote is already published at https://autonote.bittrees.org. Its verified outgoing address is `AutoNote <no-reply@crm.bittrees.org>`. This address sends sign-in codes; it is not a support inbox. DNS for the websites currently lives at Vercel. Receiving mail can be configured with separate MX/TXT records while preserving the website records.

## Addresses and ownership

| Address | Purpose | Initial destination |
| --- | --- | --- |
| support@bittrees.org | AutoNote and Bittrees product help | A named, monitored owner inbox |
| privacy@bittrees.org | Private data requests | Restricted owner inbox |
| security@bittrees.org | Confidential security reports | Restricted owner inbox |
| hello@bittrees.org | General enquiries | Owner inbox |
| postmaster@bittrees.org and abuse@bittrees.org | Mail operations and abuse reports | Mail administrator |

These are proposed addresses, not active mailboxes. Use aliases rather than shared passwords; disable catch-all delivery. A specific person must own support and privacy requests before publishing the addresses.

## Phase 1 — receive mail without a server bill

Use ImprovMX Free for `bittrees.org`, forwarding the six aliases to existing monitored inboxes. Its current free offering covers one domain, 25 aliases, and 500 forwarded emails/day; it does not include SMTP sending. Forwarding pauses at the daily limit. This is a receive-only first step, not hosted IMAP mailboxes or a promise of free branded replies. Replies initially come from the destination inbox unless that provider separately supports an authenticated custom-domain sender. [ImprovMX pricing](https://improvmx.com/pricing/).

Implementation sequence:

1. Confirm the destination inbox and owner; verify the forwarding account and destinations.
2. Export the current DNS records. Add only the provider-issued mail MX and verification/SPF records at Vercel. Merge any SPF changes into the one SPF record for that hostname; preserve CRM's existing sending records.
3. Add DKIM records only for services actually sending mail. Start DMARC in monitoring mode with a real report destination, then tighten it after all senders are identified and tested.
4. Test delivery from independent providers, rejected addresses, spam handling, forwarding loops, and replies. Test sign-in codes for both AutoNote and CRM after the DNS change.
5. Only after receiving and replying work, publish support@ and privacy@ in AutoNote and set the appropriate Reply-To on its transactional messages.

Keep app messages on the current verified Resend subdomain. Resend's free transactional allowance is currently 100/day and 3,000/month; account allowances are shared. AutoNote's own lower caps remain in force. Adding more sending domains must first be checked against the account's free entitlement. [Resend limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits).

## Phase 2 — full Bittrees mailbox server

Proposed host: `mail.bittrees.org`, running Docker Mailserver on an existing Linux server. Provide personal mailboxes, role aliases, authenticated sending, and IMAP access using standard mail clients. Add webmail separately if needed; do not reuse the AutoNote email-code/SIWE login as an IMAP password mechanism. Docker Mailserver's orchestration code is MIT licensed; bundled mail components retain their licenses. [Project license](https://github.com/docker-mailserver/docker-mailserver/blob/master/LICENSE).

Infrastructure acceptance before installation:

- An always-on Linux host, preferably in the EU, with a stable public IP, controllable reverse DNS, and usable inbound/outbound SMTP connectivity.
- Plan for at least 1 vCPU and 2 GB RAM, with additional headroom for optional antivirus. Begin with explicit mailbox quotas and measure real disk use. These are planning targets, not a claim that suitable free hosting has been found. [Official requirements](https://docker-mailserver.github.io/docker-mailserver/latest/faq/#what-are-the-system-requirements).
- Durable mail/configuration volumes and a separate, existing encrypted backup destination. Proposed policy: seven daily backups and four weekly backups, with a tested restore before cutover.
- SMTP port 25 for server delivery, authenticated submission over TLS on 465 or 587, and IMAP over TLS on 993. Block unused services, prevent open relaying, and restrict administration. If the host blocks required SMTP connectivity, retain Phase 1 until a suitable host or approved relay exists. [Port guidance](https://docker-mailserver.github.io/docker-mailserver/latest/config/security/understanding-the-ports/).

Install a pinned stable release with automatic TLS renewal, spam filtering, login throttling, disk alerts, queue monitoring, and scheduled security updates. Store account credentials and DKIM keys outside Git. Monitor uptime, certificate expiry, failed delivery, spam complaints and backups. Staff accounts should have individual credentials; webmail/admin MFA can be added where supported.

## Cutover and acceptance

Test mailboxes on a staging mail subdomain before changing the root MX. Check two-way delivery with Gmail and Outlook, SPF/DKIM/DMARC alignment, reverse DNS, spam rejection, SMTP authentication, IMAP clients, restarts, disk pressure, and backup restoration. Import any retained support messages from the existing inboxes.

Reduce MX TTL ahead of cutover. Switch the root MX only after tests pass, keeping the old forwarding configuration available during propagation. Do not publish unrelated forwarding and mailbox hosts as interchangeable backup MX destinations: they must route the same recipients consistently. On failure, restore the prior MX configuration and reconcile any mail accepted by the new server.

Launch is complete when all published addresses receive mail, an owner can reply appropriately, the server is not an open relay, AutoNote/CRM sign-in remains functional, and a mailbox has been restored successfully from backup.

## Information needed to implement

- The existing monitored inbox for Phase 1, including who handles private requests.
- Whether Bittrees already has an always-on Linux host with public IP/reverse-DNS control and permitted SMTP ports.
- An existing backup destination and the number of initial personal mailboxes.

Until those resources are identified, Phase 1 remains the recommended zero-subscription approach and the full server remains planned. No new paid infrastructure is authorized.
