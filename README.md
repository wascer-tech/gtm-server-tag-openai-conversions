# Wascer OpenAI Ads Conversions

A Google Tag Manager **server** template that sends conversion events to the
OpenAI Ads Conversions API. It reads the incoming GA4 event, builds the payload
the API expects, and can enrich the event with identifiers kept in the Wascer
Store inside your own container.

Built by [Wascer](https://wascer.com) for containers we host, and free for
anyone to use.

## What the template does

1. Reads the event that arrived at the server container.
2. Maps amount, currency and items into the OpenAI event data shape, converting
   money into the minor unit of the currency.
3. Maps user data, hashing email and external id with SHA-256 when they are not
   hashed already.
4. Resolves the OpenAI attribution identifiers, `oppref` and `obref`, from the
   landing URL, from first party cookies, or from the Wascer Store.
5. Validates the payload locally and refuses to spend a request on an event the
   API would reject anyway.
6. Sends one event per request to `POST https://bzr.openai.com/v1/events`.
7. Optionally saves the identifiers back to the Wascer Store so later events
   can find the same visitor.

## Installation

1. In your server container, open **Templates**, then **Tag Templates**, then
   **New**.
2. Open the three dot menu and choose **Import**.
3. Pick `template.tpl` from this folder and save.
4. Create a tag from the template, fill in the pixel id and the API key, and
   attach a trigger.

You find the API key in the conversions tab of OpenAI Ads Manager.

## Fields

### Configuration

| Field | What it does |
|---|---|
| OpenAI Pixel ID | Goes into the `pid` query parameter of every request. |
| API key | Sent as `Authorization: Bearer`. Store it in a variable if you rotate it often. |
| Event name | Choose a standard event or a custom one. |
| Standard event | One of the 13 names OpenAI accepts. See the table below. |
| Custom event name | Required when the event name is custom. Letters, numbers, underscores and dashes, up to 64 characters. |
| Action source | Where the conversion happened. `web` requires a page location on the incoming event. `mobile_app` is required for `app_installed` and `app_opened`. |
| Validate without saving | Sends `validate_only: true`. OpenAI checks the payload and throws it away. |

### Event data

`Map amount, currency and items from the incoming event` reads `value`,
`currency` and `items` from the GA4 event and builds `contents[]`. When the
event has no `value`, the template sums the items.

The table below the checkbox overrides anything the mapping produced.

| Field | Notes |
|---|---|
| `amount` | Already in the minor unit. 2599 means 25.99 in a two decimal currency. |
| `amount_major` | In the regular unit, such as 25.99. The template converts it. If you fill both, `amount` wins. |
| `currency` | ISO 4217 code. |
| `plan_id` | Only reaches the API on `subscription_created`, `trial_started` and custom events. |
| `contents` | A JSON array, or a variable that returns an array. |

### User data

`Map user data from the incoming event` reads the GA4 `user_data` object plus
`user_id`, `ip_override` and `user_agent`.

The table below the checkbox overrides the mapping, field by field. Plain text
goes out hashed with SHA-256. A value that already looks like a SHA-256 hash
passes through untouched. Email and city are trimmed and lowercased before
hashing or sending, and country is uppercased.

Available fields: `obref`, `email_sha256`, `external_id_sha256`, `country`,
`city`, `zip_code`, `ip_address`, `user_agent`.

### Cookies

The template can keep `__oppref` and `__obref` as first party cookies from the
server. Both are written with `Secure`, `path=/` and the SameSite value you
pick. Leave the domain on `auto` to use the registrable domain of the page that
sent the event.

`__oppref` defaults to 30 days and `__obref` to 365 days.

### Consent

By default every event is sent. Switch to `Send only when ad_storage is granted`
and the template checks `consent_state.ad_storage` on the incoming event, then
falls back to the Google consent signals string. When consent is missing the tag
reports success and sends nothing.

### Advanced

`Log the request payload to the server container console` prints the URL and the
body in preview mode. The API key is never printed.

`Report success without waiting for the OpenAI response` makes the tag finish as
soon as the request leaves. Use it when the container is under pressure and you
would rather not hold the request open.

## Wascer Store integration

The Wascer Store is a document store that runs inside the same container as your
server tagging. It needs `enable_database` turned on for the container.

Turn on `Enrich events with the Wascer Store` and the template gains two extra
steps around the OpenAI request.

**What it reads.** Before validating and sending, the template fetches the
document and fills in `oppref`, `email_sha256`, `external_id_sha256`, `country`,
`city` and `zip_code`, but only the ones the current event left empty.

**What it writes.** After the OpenAI request goes out, the template saves the
same six fields, and only the ones that exist. `ip_address` and `user_agent` are
never saved. They belong to a single request and they age badly.

**Precedence.** The user data table wins, then the incoming event, then the
Store. What you typed into the tag is an explicit decision, so nothing overrides
it. The Store is the last resort.

**The document key.** By default it is `obref`, the browser identifier the tag
keeps in a cookie. It survives across sessions, which is exactly what a purchase
made days after the click needs. You can switch it to `external_id_sha256` or to
any value of your own.

**The concrete gain.** An `order_created` that arrives from a backend webhook
has no cookies and no `oppref`. With the Store on, that event picks up the
`oppref` from the original click, and OpenAI attributes the conversion instead
of dropping it.

The Store never blocks the tag. A failure, a 404, a 503 or a timeout is logged
and the OpenAI request goes out anyway.

## Deduplication with the pixel

OpenAI counts one conversion when the browser event and the server event carry
the same identifier. The pixel sends it as `event_id` and this template sends it
as `id`. Feed both from the same value.

The template reads `event_id` from the incoming event, falls back to `eventId`,
and generates one when neither is present. A generated id cannot be
deduplicated, so set an event id whenever the same conversion also fires in the
browser.

## The 13 events

Every event carries a `data.type`. The template sets it for you.

| Event | `data.type` | Extra fields accepted |
|---|---|---|
| `page_viewed` | `contents` | `amount`, `currency`, `contents[]` |
| `contents_viewed` | `contents` | `amount`, `currency`, `contents[]` |
| `items_added` | `contents` | `amount`, `currency`, `contents[]` |
| `checkout_started` | `contents` | `amount`, `currency`, `contents[]` |
| `order_created` | `contents` | `amount`, `currency`, `contents[]` |
| `app_installed` | `customer_action` | `amount`, `currency` |
| `app_opened` | `customer_action` | `amount`, `currency` |
| `lead_created` | `customer_action` | `amount`, `currency` |
| `registration_completed` | `customer_action` | `amount`, `currency` |
| `appointment_scheduled` | `customer_action` | `amount`, `currency` |
| `subscription_created` | `plan_enrollment` | `plan_id`, `amount`, `currency`, `contents[]` |
| `trial_started` | `plan_enrollment` | `plan_id`, `amount`, `currency`, `contents[]` |
| `custom` | `custom` | `plan_id`, `amount`, `currency`, `contents[]` |

`app_installed` and `app_opened` require `action_source: mobile_app`.

## Amounts and currencies

`amount` travels in the minor unit of the currency. The template multiplies what
it reads by 1, 100 or 1000 depending on the code.

| Multiplier | Currencies |
|---|---|
| 1 | BIF, CLP, DJF, GNF, IDR, ISK, JPY, KMF, KRW, MGA, PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF |
| 1000 | BHD, IQD, JOD, KWD, LYD, OMR, TND |
| 100 | everything else |

## Testing with validate_only

Turn on `Validate without saving` and fire the tag from the server container
preview. OpenAI parses the payload, answers with any problems it finds, and
stores nothing. No test data lands in your account.

Turn on `Log the request payload to the server container console` at the same
time and you see the exact body next to the response.

When the payload looks right, turn the checkbox off and fire a real event.

## Local validation

Before the request leaves, the template checks the payload and fails the tag
with a console message instead of spending a call. It catches a missing pixel id
or API key, a missing event id, timestamp or action source, `action_source: web`
with no `source_url`, a custom event with no `custom_event_name`, an `amount`
with no `currency`, and content items with a bad `amount` or `content_type`.

## Reference

OpenAI Conversions API documentation:
https://developers.openai.com/ads/conversions-api

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Support

Open an issue in this repository, or reach the team at
[wascer.com](https://wascer.com). If you host your server container with Wascer,
support is included in your plan.
