# Demo walkthrough

Script for a 10-minute live demo. Terminal 1 = API, terminal 2 = web, terminal 3 = bot.

## 0. Before the call (5 minutes)

```bash
cd server && npm start        # terminal 1 - must print "listening on http://localhost:4000"
cd web    && npm run dev      # terminal 2 - note the Network IP for the phone demo
cd bot    && npm start        # terminal 3
```

Open <http://localhost:5173>, sign in as `admin@portal.local` / `demo1234`, leave the
browser on the Products tab. Share the **window**, not the full screen, so the
terminal stays partly visible.

## 1. Product catalog (2 min)

1. Point at the table: 13 seeded products across four categories.
2. Click **Search** with `drill` in the box - one row, `PT-0101`.
3. Click **Reset**, then **Low stock only** - three rows, all red `Reorder` badges.
4. Click the `Stock` column header twice - the sort toggles.

Talking point: the filter runs in SQL (`WHERE stock_qty <= reorder_level`), not in
the browser, so it stays correct when the catalog grows.

## 2. Quotation builder (3 min)

1. Switch to **Quotation**.
2. Type `drill`, press **Add**.
3. Set quantity to `2` - subtotal, 6% SST, and total recalculate live.
4. Enter a customer name, press **Generate quotation**.
5. A card appears with the real quote number (`Q-YYYYMMDD-NNNN`) and the exact total.

Talking point: the number comes from the database sequence inside the transaction,
so two people quoting at the same time can never receive the same number.

## 3. The transaction story (2 min) - this is the important part

Show the rollback with a real request, not a slide:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@portal.local","password":"demo1234"}' | jq -r .token)

# first line is valid, second requests more than exists
curl -s -X POST http://localhost:4000/api/quotes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"customerName":"Rollback Demo","items":[{"productId":2,"qty":3},{"productId":7,"qty":999}]}'
```

Expected: `{"error":"insufficient stock for PT-0103: requested 999, available 5"}`.

Then re-query the first product and show its stock is unchanged - the deduction on
line one was rolled back. This is the answer to "what was the hardest bug you hit":

> My first version read the stock, then wrote the deduction. Two concurrent quotes
> for the last unit both passed the check and both wrote, so stock went negative.
> I moved the check and the decrement inside one transaction with a write lock
> taken up front, and added the insufficient-stock test that asserts the first line
> is not deducted when a later line fails.

## 4. Mobile (1 min)

Show `http://<LAN-IP>:5173` on a phone, or resize the browser window:

- below 768 px the table is replaced by a card list, not a squeezed table;
- the manifest makes it installable - **Add to Home Screen** opens it full-screen.

Same codebase, same API, no separate native build. Say that explicitly: it is a
responsive/PWA build, not a native app.

## 5. Bot retry path (2 min)

```bash
cd bot
FAKE_FAILURE_RATE=0.3 npm start   # restart terminal 3 with a high failure rate
npm run simulate                  # in another shell, or POST 8 events by hand
```

Watch terminal 3 for the queue log:

```
[queue] retry id=... attempt=1 in 500ms: simulated transient network failure
[queue] retry id=... attempt=2 in 1000ms: simulated transient network failure
[queue] ok    id=... attempts=2 -> {"delivered":4,...}
```

Talking point: the webhook already returned `200` in under 60 ms, so the platform
will not retry and duplicate the message. The retry lives in our queue, under our
control, with a dead-letter cap.

## Questions to expect

| Question | Answer |
| --- | --- |
| How many users does this have? | It is a self-directed portfolio build, not a deployed product. The seed data is synthetic. I can walk through any line of it. |
| Team size? | Solo, end to end, which is why I can speak to every layer. |
| Why SQLite? | It made the project clone-and-run with no external service while still giving real SQL, foreign keys, and transactions. Swapping to Postgres is a driver change plus a migration. |
| Where does this not scale? | `LIKE '%x%'` search, in-memory queue, and tokens in localStorage. All three are listed in the README's limitations with the fix. |
| What would you do with your first two weeks here? | Learn your conventions and deployment pipeline before writing features, and start with small, well-scoped tasks. |
