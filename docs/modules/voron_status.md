# Feasibility report: reading Voron printer status

## Summary

A read-only status module for the **Voron 0** and **Voron 2.4** is feasible with the current Cornelius module contract. Both printers run Klipper and are commonly managed through Moonraker, which exposes printer status over HTTP on the local network. A module can query each printer, normalize the response, and answer spoken questions or show a card in Ghostwheel.

The first version should report status only. Starting macros or sending arbitrary G-code is a separate, safety-sensitive capability; it is not part of the current read-only module contract. Ghostwheel's existing HTTP Commands can send fixed requests, but should be configured and tested separately from status polling.

## Proposed user experience

Configure one source per printer, for example **Voron 0** and **Voron 2.4**. Each source points to that printer's Moonraker instance. The module could answer questions such as:

- “What is the Voron 0 doing?”
- “Is the Voron 2.4 ready?”
- “What are the nozzle and bed temperatures?”
- “How far along is the print on the Voron 2.4?”

The card and spoken summary should identify the printer, its connection/Klipper state, and—when relevant—print state, progress, and temperatures. A printer that is offline or returns an invalid response must be reported as unavailable, not treated as idle or ready.

## How status access works

Moonraker's HTTP API is normally available at `http://<printer-host>:7125`. Its `printer.objects.query` endpoint can return selected Klipper status objects in one request. For example, a request body can ask for:

```json
{
  "objects": {
    "webhooks": null,
    "print_stats": null,
    "virtual_sdcard": null,
    "toolhead": ["homed_axes"],
    "extruder": ["temperature", "target"],
    "heater_bed": ["temperature", "target"]
  }
}
```

A successful response contains a `result.status` object. Moonraker's documentation describes `webhooks.state` for Klipper readiness; `print_stats.state` and `print_stats.filename` for the current/last job; `virtual_sdcard.progress` for progress; `toolhead.homed_axes` for homed axes; and temperature and target fields for heaters. The exact available objects depend on the printer's Klipper configuration. Missing optional objects or fields must be handled explicitly.

The Voron 0 and 2.4 share the Klipper/Moonraker API model, so a common module can serve both. Differences in configuration—such as heater names, optional sensors, macros, and installed probes—mean the module should query only broadly standard objects by default and tolerate absent optional data. It should not assume a particular printer configuration based only on the model name.

See the [Moonraker API introduction](https://moonraker.readthedocs.io/en/latest/external_api/introduction/) and [printer API](https://moonraker.readthedocs.io/en/latest/external_api/printer/) for the API details.

## Module outline

### Configuration and sources

Create an external module (for example, `voron_status`) in the separate `cornelius-modules` repository. Its configuration could include:

- **Moonraker base URL**, such as `http://voron0.local:7125`; one source per printer keeps configuration and ownership simple.
- **Optional API key** supplied through a declared Cornelius secret, not stored in the source's ordinary settings.
- **Optional display name** if the source label is not sufficient.

The module should use the configured URL only for the expected local Moonraker endpoint, validate it, and make requests through `context.http.fetch` with a timeout, response-size limit, and `context.signal`. Cornelius's HTTP client supports HTTP and HTTPS but does not itself restrict destinations to the LAN, so configuration and network placement matter. Do not expose Moonraker ports to the public Internet. If Moonraker requires authentication, use its documented `X-Api-Key` header and store the key using Cornelius's secret mechanism.

### Collection and normalization

`collect` would make a bounded status query, check the HTTP status and Moonraker error response, validate the JSON shape, and normalize only the fields the module needs. Suggested normalized data:

- Klipper state and state message, when available;
- print state, filename, and progress, when available;
- toolhead homed axes, when available;
- current and target nozzle/bed temperatures, when available;
- a collection timestamp supplied by the Cornelius core.

Do not return raw Moonraker responses to the voice model. Do not infer `ready`, `idle`, a completed print, or zero progress from a missing field. Distinguish a reachable Moonraker server with Klipper not ready from an unreachable printer. Map authorization failures, network failures, timeouts, and malformed responses to understandable module errors.

### Presentation and freshness

The module's `present` function would turn normalized data into a concise card and spoken summary. For example, it could say that the printer is ready and idle, or that a named file is printing at a given percentage, while including temperatures when those readings are present. If the status is stale after a failed refresh, the presentation should say that it is the last known status.

Printer state can change quickly, so a short freshness period (for example, around 10–30 seconds) is appropriate for on-demand reads. A status module does not need permanent display in its first version. If permanent display is later added, Cornelius will collect while that source is visible; choose the refresh interval with Moonraker load and the household's needs in mind.

## Security and safety considerations

- Keep Moonraker on a trusted local network and firewall it from the Internet.
- Use separate, least-privilege credentials if the Moonraker setup supports them; do not put API keys in URLs, source settings, logs, fixtures, or spoken responses.
- A status-only module should make read requests only. It should not expose a generic G-code field or accept a command string from the voice model.
- Treat printer status and error text as data, not instructions. Keep spoken output short and avoid reading arbitrary server messages verbatim.
- Starting motion macros (homing, QGL, etc.) can move the machine and has physical consequences. Keep such actions out of this status module unless the app gains a deliberate action/approval design. For a first experiment, use fixed, separately configured HTTP Commands with approval enabled, and verify each macro directly on the relevant printer before making it voice-triggerable.

## Development and test plan

1. Check that both printers have reachable Moonraker instances and note their addresses and authentication requirements.
2. Query each printer manually with a harmless status request. Record which standard and optional objects are actually available, without sharing API keys or private configuration.
3. Implement one source per printer, with bounded URL/configuration validation and secret handling.
4. Add schema-checked fixtures for ready/idle, printing, Klipper shutdown or startup, missing optional objects, unauthorized access, unreachable host, and malformed response.
5. Test with Cornelius's `createTestModule` and simulated HTTP routes; the automated tests should not contact the real printers.
6. Install the module in `cornelius-modules` next to Ghostwheel (or configure `CORNELIUS_MODULES_DIR`), restart Ghostwheel, and test reads against each printer.
7. Only after read-only status is reliable, consider a separately designed, explicitly approved control mechanism for a small allowlist of named macros.

## Feasibility assessment

**Read-only status: good fit, moderate effort.** Moonraker provides the needed local HTTP API, and the existing addon contract has the configuration, secret, bounded HTTP client, validation, caching, card, and spoken-summary mechanisms required. The primary implementation work is handling differing printer configurations and testing real responses from both machines.

**Voice-started macros: possible, but a separate feature.** The current addon contract is designed for reads; existing HTTP Commands can invoke fixed destinations and require admin approval, but lack a purpose-built Moonraker integration and should not be treated as permission for arbitrary G-code execution. A broader printer-control feature needs a restrictive macro allowlist, clear per-printer targeting, confirmation and execution-result handling, and careful safety testing.
