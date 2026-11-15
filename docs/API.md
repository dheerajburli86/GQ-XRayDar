# GQ XRayDar quant API

Read-only REST endpoints under `/v1` and a WebSocket stream, served by the TA
server (Railway). For Python / R users who want the same numbers the app shows.

## Tokens

Create a token in the app: **Data centre → Access & API → Create token**. The
token (`xr_...`) is shown once; the server stores only its SHA-256. Each token has
scopes and its own per-minute rate limit, and every call is written to the
append-only audit log. Revoke a token from the same page.

| scope | gives |
|---|---|
| `market` | `/v1/stock/:ref`, `POST /v1/market/screen` |
| `deriv` | every `/v1/deriv/*` endpoint and the stream |
| `indices` | `/v1/indices/:key` |

```
Authorization: Token xr_...
```

## Endpoints

| method | path | scope | returns |
|---|---|---|---|
| GET | `/v1` | — | index, scopes, model versions |
| GET | `/v1/deriv/underlyings` | deriv | latest session summary per F&O underlying |
| GET | `/v1/deriv/stats/:und?from=&to=` | deriv | daily summary history |
| GET | `/v1/deriv/chain/:und?date=` | deriv | every contract with IV, Greeks and quote-quality flags |
| GET | `/v1/deriv/surface/:und?date=` | deriv | IV surface grid, term structure, SVI fits |
| GET | `/v1/deriv/screen?preset=…` or `?conds=[…]` | deriv | derivatives screener on the latest session |
| GET | `/v1/deriv/market?from=` | deriv | participant-wise OI, ban list, MWPL |
| GET | `/v1/indices/:key?from=` | indices | house index level and daily return (`CW\|USD\|G`, `EW\|LCL\|C:India`, …) |
| GET | `/v1/stock/:ref` | market | one instrument's analysis |
| POST | `/v1/market/screen` | market | `{conditions:[{field,op,value}], scope, limit}` |
| WS | `/v1/stream?token=xr_...` | deriv | `fo.session` when a new F&O session lands, `alert` for your own alerts, `ping` every 30 s |

Conventions: fractions everywhere (`0.052` = 5.2%), ISO dates, prices in the
instrument's currency. Exchange-published values (prices, OI, participant OI,
ban list) are facts; IV, Greeks, build-up, GEX and margin are calculations with
the assumptions returned alongside them. Chains are kept for the most recent
sessions only (`FO_CHAIN_KEEP_SESSIONS`); summaries for every session.

```python
import requests, pandas as pd
BASE = "https://<ta-server>"
H = {"Authorization": "Token xr_..."}
chain = pd.DataFrame(requests.get(f"{BASE}/v1/deriv/chain/NIFTY", headers=H).json()["rows"])
hist = pd.DataFrame(requests.get(f"{BASE}/v1/deriv/stats/BANKNIFTY", params={"from": "2026-06-01"}, headers=H).json()["rows"])
```

```python
import json, websocket   # pip install websocket-client
ws = websocket.create_connection("wss://<ta-server>/v1/stream?token=xr_...")
ws.send(json.dumps({"subscribe": ["fo", "alerts"]}))
while True: print(ws.recv())
```

Errors: `401` no / bad / revoked token, `403` missing scope or disabled account,
`429` the token's rate limit, `404` nothing stored for that key or date.
