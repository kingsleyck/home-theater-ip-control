# Home Assistant stand-up and backup

Stub for humans and agents. Official install and backup docs change over time—prefer [Home Assistant installation](https://www.home-assistant.io/installation/) and [common tasks / backups](https://www.home-assistant.io/common-tasks/general/) when steps differ from this outline.

Theater activity scripts and the PWA assume a reachable Home Assistant on the same LAN (`haUrl` in `local.json`). This repo does not ship HA itself.

## Stand-up options

Pick one install method. **HAOS** (Home Assistant Operating System) is the default assumption in [`PLAN.md`](../PLAN.md) because Supervisor, add-ons, and the built-in backup UI are available. Other methods work if you accept the tradeoffs.

| Option | What it is | Fit for this project |
|--------|------------|----------------------|
| **HAOS on bare metal / NUC / mini PC** | Full OS image on dedicated hardware | Best “set and forget” theater host |
| **HAOS in a VM** | Proxmox, ESXi, Hyper-V, VirtualBox, etc. | Same features as bare metal; snapshot the VM disk as an extra safety layer |
| **Home Assistant Yellow / Green (appliance)** | Official hardware running HAOS | Same as HAOS; least DIY |
| **Home Assistant Container** | Docker/OCI image, no Supervisor | Fine if you already run containers; you manage updates, add-ons substitutes, and backup tooling yourself |
| **Core / supervised (advanced)** | Rare; more moving parts | Only if you already operate that stack |

Minimum practical resources for a theater rack: about **2 GB RAM / 2 vCPU**; prefer **4 GB / 4 vCPU**. Keep HA on the theater LAN (or routed with stable DNS). Confirm `http://homeassistant.local` or your chosen URL before wiring the PWA. That HTTP URL is the default. TLS for Home Assistant and the PWA, including a public certificate authority, a private certificate authority, and Home Assistant Link, is in [`PLAN.md`](../PLAN.md#tls).

After install:

1. Create a user and a **long-lived access token** for the PWA (`local.json` → `/auth.json`). Never commit the token.
2. Install [HACS](https://hacs.xyz/) if the rack needs custom integrations.
3. Continue with driver discovery and helpers in [`PLAN.md`](../PLAN.md).

## Backup (target-agnostic)

Treat Home Assistant config as critical: scripts, helpers, automations, and integration credentials. **Where** copies land is your choice; **that** copies exist on a schedule is not optional for a reliable theater.

### What to back up

- Prefer Home Assistant’s **backup** feature (full or partial: settings, history, media—as you need). This is the supported restore path.
- Optionally also snapshot the VM disk or host volume if HA runs virtualized.
- Do **not** rely on git of this repo as the HA backup; `local.json` and HA’s internal store are outside the template.

### Target options (examples, not prescriptions)

Copy or sync completed backup archives to any durable place you already trust:

| Target class | Examples |
|--------------|----------|
| Another machine on the LAN | NAS share, second PC, Syncthing peer |
| External / rotating media | USB drive, periodic offline copy |
| Cloud object storage | S3-compatible, Backblaze B2, provider backup bucket |
| Provider sync folders | Whatever sync client you already run on the backup host |
| VM / hypervisor snapshots | In addition to HA backups, not instead of them |

Encrypt backups when the target is not a locked LAN share. Keep at least one restore-tested copy off the HA host disk.

### Automation options

Automate **creation** and, separately, **off-host copy**:

| Approach | Notes |
|----------|--------|
| **HA built-in automatic backups** | Schedule inside HA (Settings → System → Backups). Simplest on HAOS. |
| **HA automation / script** | Trigger backup via the Backup actions/services your HA version exposes; useful for “after update” or “before publish_activity_scripts”. |
| **Supervisor / Samba / add-on** | On HAOS, an add-on or network mount can expose the backup folder for pull-based sync. |
| **Host cron / systemd timer** | On the PWA or NAS host: pull new `*.tar` backups over Samba/SFTP and copy to the target. |
| **Hypervisor schedule** | Nightly VM snapshot if HAOS is a VM—still keep HA-level backups for clean restore of config. |
| **Backup add-ons / community tools** | Only after checking they match your HA install type (HAOS vs Container). |

Agents extending this stub should link the adopter’s chosen target and schedule in their profile README (not hard-code a vendor here).

## Related

- Theater attach steps after HA is up: [`PLAN.md`](../PLAN.md)
- PWA token wiring: root [`README.md`](../README.md) Installation
- Sample racks: [`examples/`](../examples/)
